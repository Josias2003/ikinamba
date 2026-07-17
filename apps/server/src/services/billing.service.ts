import { prisma } from "../lib/prisma.js";
import { badRequest, conflict, notFound } from "../lib/errors.js";
import { providerFor } from "./payments/mockProvider.js";
import { pointsEarnedFor, rwfValueOfPoints, tierForSpend } from "../lib/loyalty.js";
import { notifyCustomer, templates } from "./notifications.service.js";

function successfulPaidTotal(payments: { amount: number; status: string }[]) {
  return payments.filter((p) => p.status === "SUCCESS").reduce((s, p) => s + p.amount, 0);
}

function successfulRefundTotal(payments: { amount: number; status: string }[]) {
  return Math.abs(payments.filter((p) => p.status === "REFUNDED" && p.amount < 0).reduce((s, p) => s + p.amount, 0));
}

export async function createInvoiceForQueueEntry(
  queueEntryId: string,
  opts: { discountAmount?: number; redeemPoints?: number } = {}
) {
  const entry = await prisma.queueEntry.findUnique({
    where: { id: queueEntryId },
    include: { serviceJob: { include: { items: true } }, customer: true, invoice: true },
  });
  if (!entry?.serviceJob) throw notFound("Service job not found for this queue entry");
  if (entry.invoice) throw conflict("Invoice already exists for this queue entry");

  const subtotal = entry.serviceJob.items.reduce((sum, item) => sum + item.price * item.qty, 0);
  const discountAmount = opts.discountAmount ?? 0;

  const redeemPoints = opts.redeemPoints ?? 0;
  if (redeemPoints > entry.customer.loyaltyPoints) throw badRequest("Customer does not have that many loyalty points");
  const loyaltyValueApplied = Math.min(rwfValueOfPoints(redeemPoints), subtotal - discountAmount);

  const total = Math.max(0, subtotal - discountAmount - loyaltyValueApplied);

  const invoice = await prisma.invoice.create({
    data: {
      queueEntryId,
      customerId: entry.customerId,
      subtotal,
      discountAmount,
      loyaltyPointsUsed: redeemPoints,
      loyaltyValueApplied,
      tax: 0,
      total,
      items: { create: entry.serviceJob.items.map((i) => ({ description: i.name, price: i.price, qty: i.qty })) },
    },
    include: { items: true },
  });

  if (redeemPoints > 0) {
    await prisma.$transaction([
      prisma.customer.update({ where: { id: entry.customerId }, data: { loyaltyPoints: { decrement: redeemPoints } } }),
      prisma.loyaltyTransaction.create({
        data: { customerId: entry.customerId, points: -redeemPoints, type: "REDEEM", reason: `Invoice ${invoice.id}` },
      }),
    ]);
  }

  return invoice;
}

/** Lets a customer pay for their booking up front ("Pay with MoMo now") before any
 * QueueEntry exists -- mirrors createInvoiceForQueueEntry's shape but prices off the
 * appointment's requested service items instead of a completed ServiceJob's items.
 * Idempotent: calling this again for an appointment that already has an invoice just
 * returns the existing one instead of double-invoicing. */
export async function createInvoiceForAppointment(appointmentId: string) {
  const appt = await prisma.appointment.findUnique({
    where: { id: appointmentId },
    include: { serviceItems: { include: { catalogItem: true } }, invoice: true },
  });
  if (!appt) throw notFound("Appointment not found");
  if (appt.invoice) return appt.invoice;

  const subtotal = appt.serviceItems.reduce((sum, si) => sum + si.catalogItem.basePrice, 0);

  return prisma.invoice.create({
    data: {
      appointmentId,
      customerId: appt.customerId,
      subtotal,
      total: subtotal,
      items: { create: appt.serviceItems.map((si) => ({ description: si.catalogItem.name, price: si.catalogItem.basePrice, qty: 1 })) },
    },
    include: { items: true },
  });
}

export async function recordPayment(invoiceId: string, method: string, amount: number, phoneNumber?: string) {
  const invoice = await prisma.invoice.findUnique({ where: { id: invoiceId }, include: { payments: true, customer: true, items: true } });
  if (!invoice) throw notFound("Invoice not found");

  if (invoice.status === "REFUNDED" || invoice.status === "PARTIALLY_REFUNDED") {
    throw conflict("Refunded invoices cannot accept new payments");
  }

  const paidSoFar = successfulPaidTotal(invoice.payments);
  if (paidSoFar >= invoice.total) throw conflict("Invoice is already fully paid");

  const result = await providerFor(method).charge({ amount, reference: invoiceId, phoneNumber });

  const payment = await prisma.payment.create({
    data: { invoiceId, method, amount, status: result.success ? "SUCCESS" : "FAILED", providerRef: result.providerRef },
  });

  if (!result.success) return { payment, providerMessage: result.message };

  const newPaidTotal = paidSoFar + amount;
  const newStatus = newPaidTotal >= invoice.total ? "PAID" : "PARTIALLY_PAID";
  await prisma.invoice.update({ where: { id: invoiceId }, data: { status: newStatus } });

  if (newStatus === "PAID") {
    const earned = pointsEarnedFor(invoice.subtotal - invoice.discountAmount);
    const newTotalSpend = invoice.customer.totalSpend + (invoice.subtotal - invoice.discountAmount);
    await prisma.$transaction([
      prisma.customer.update({
        where: { id: invoice.customerId },
        data: { loyaltyPoints: { increment: earned }, totalSpend: newTotalSpend, loyaltyTier: tierForSpend(newTotalSpend) },
      }),
      prisma.loyaltyTransaction.create({
        data: { customerId: invoice.customerId, points: earned, type: "EARN", reason: `Invoice ${invoiceId}` },
      }),
    ]);

    const { subject, html } = templates.paymentReceipt(
      invoice.customer.name,
      invoice.total,
      invoice.items.map((i) => ({ name: i.description, price: i.price }))
    );
    await notifyCustomer({ customerId: invoice.customerId, template: "PAYMENT_RECEIPT", subject, html });
  }

  return { payment, providerMessage: result.message };
}

export async function refundInvoice(invoiceId: string, opts: { amount?: number; reason: string; confirmedExternal?: boolean }) {
  const reason = opts.reason.trim();
  if (!reason) throw badRequest("Refund reason is required");

  const invoice = await prisma.invoice.findUnique({ where: { id: invoiceId }, include: { payments: true, customer: true } });
  if (!invoice) throw notFound("Invoice not found");
  if (invoice.status !== "PAID" && invoice.status !== "PARTIALLY_REFUNDED") {
    throw badRequest("Only fully paid or partially refunded invoices can be refunded");
  }
  const successfulPayments = invoice.payments.filter((p) => p.status === "SUCCESS");
  if (!successfulPayments.length) throw badRequest("No successful payments to refund");

  const paidTotal = successfulPaidTotal(invoice.payments);
  const refundedTotal = successfulRefundTotal(invoice.payments);
  const refundable = paidTotal - refundedTotal;
  if (refundable <= 0) throw conflict("Invoice has already been fully refunded");

  const amount = opts.amount ?? refundable;
  if (amount <= 0) throw badRequest("Refund amount must be greater than zero");
  if (amount > refundable) throw badRequest(`Refund amount exceeds refundable balance (${refundable})`);

  const providerResults = [];
  let remaining = amount;
  for (const payment of successfulPayments) {
    if (remaining <= 0) break;
    const paymentRefunded = Math.abs(
      invoice.payments
        .filter((p) => p.status === "REFUNDED" && p.providerRef?.startsWith(`${payment.id}:`))
        .reduce((sum, p) => sum + p.amount, 0)
    );
    const availableOnPayment = payment.amount - paymentRefunded;
    if (availableOnPayment <= 0) continue;

    const refundAmount = Math.min(availableOnPayment, remaining);
    const provider = providerFor(payment.method);
    const result = provider.refund
      ? await provider.refund({ amount: refundAmount, reference: payment.providerRef || payment.id })
      : { success: false, providerRef: payment.providerRef || payment.id, message: `${payment.method} refunds must be processed externally` };

    if (!result.success && !opts.confirmedExternal) {
      throw conflict(result.message);
    }

    providerResults.push({ payment, refundAmount, result });
    remaining -= refundAmount;
  }

  if (remaining > 0) throw conflict("Could not allocate refund across successful payments");

  const newRefundedTotal = refundedTotal + amount;
  const newStatus = newRefundedTotal >= paidTotal ? "REFUNDED" : "PARTIALLY_REFUNDED";
  const earnedPoints = pointsEarnedFor(invoice.subtotal - invoice.discountAmount);
  const loyaltyRatio = invoice.total > 0 ? amount / invoice.total : 1;
  const pointsToReverse = Math.min(invoice.customer.loyaltyPoints, Math.round(earnedPoints * loyaltyRatio));
  const spendToReverse = (invoice.subtotal - invoice.discountAmount) * loyaltyRatio;
  const newTotalSpend = Math.max(0, invoice.customer.totalSpend - spendToReverse);

  await prisma.$transaction([
    ...providerResults.map(({ payment, refundAmount, result }) =>
      prisma.payment.create({
        data: {
          invoiceId,
          method: payment.method,
          amount: -refundAmount,
          status: "REFUNDED",
          providerRef: `${payment.id}:${result.providerRef}`,
        },
      })
    ),
    prisma.invoice.update({ where: { id: invoiceId }, data: { status: newStatus } }),
    prisma.customer.update({
      where: { id: invoice.customerId },
      data: {
        loyaltyPoints: { decrement: pointsToReverse },
        totalSpend: newTotalSpend,
        loyaltyTier: tierForSpend(newTotalSpend),
      },
    }),
    ...(pointsToReverse > 0
      ? [
          prisma.loyaltyTransaction.create({
            data: { customerId: invoice.customerId, points: -pointsToReverse, type: "ADJUST", reason: `Refund ${invoiceId}` },
          }),
        ]
      : []),
  ]);

  const { subject, html } = templates.paymentRefund(invoice.customer.name, amount, reason);
  await notifyCustomer({ customerId: invoice.customerId, template: "PAYMENT_REFUND", subject, html });

  return prisma.invoice.findUnique({ where: { id: invoiceId }, include: { payments: true, items: true } });
}
