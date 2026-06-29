import { prisma } from "../lib/prisma.js";
import { badRequest, conflict, notFound } from "../lib/errors.js";
import { providerFor } from "./payments/mockProvider.js";
import { pointsEarnedFor, rwfValueOfPoints, tierForSpend } from "../lib/loyalty.js";
import { notifyCustomer, templates } from "./notifications.service.js";

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

  const paidSoFar = invoice.payments.filter((p) => p.status === "SUCCESS").reduce((s, p) => s + p.amount, 0);
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

export async function refundInvoice(invoiceId: string) {
  const invoice = await prisma.invoice.findUnique({ where: { id: invoiceId }, include: { payments: true } });
  if (!invoice) throw notFound("Invoice not found");
  const successfulPayments = invoice.payments.filter((p) => p.status === "SUCCESS");
  if (!successfulPayments.length) throw badRequest("No successful payments to refund");

  await prisma.$transaction([
    ...successfulPayments.map((p) => prisma.payment.update({ where: { id: p.id }, data: { status: "REFUNDED" } })),
    prisma.invoice.update({ where: { id: invoiceId }, data: { status: "REFUNDED" } }),
  ]);

  return prisma.invoice.findUnique({ where: { id: invoiceId }, include: { payments: true, items: true } });
}
