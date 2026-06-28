import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { asyncHandler } from "../lib/asyncHandler.js";
import { validateBody } from "../middleware/validate.js";
import { authenticate, requireRole } from "../middleware/auth.js";
import { createInvoiceForQueueEntry, recordPayment, refundInvoice } from "../services/billing.service.js";
import { recordAudit } from "../lib/audit.js";
import { notFound } from "../lib/errors.js";

export const billingRouter = Router();
billingRouter.use(authenticate);

// ADMIN's only billing job is refund sign-off (financial control) -- it does not do
// day-to-day invoicing/payment entry, so it's deliberately left out of this default and
// only added back on the specific routes it actually needs (read access to navigate to
// an invoice, plus the refund action itself).
const operateBilling = requireRole("MANAGER", "CASHIER");

// Vehicles ready for pickup (or already picked up) that don't have an invoice yet.
billingRouter.get(
  "/billable",
  operateBilling,
  asyncHandler(async (_req, res) => {
    const entries = await prisma.queueEntry.findMany({
      where: { status: { in: ["READY", "COMPLETED"] }, invoice: null },
      include: { customer: true, vehicle: true, serviceJob: { include: { items: true } } },
      orderBy: { checkedInAt: "desc" },
    });
    res.json(entries);
  })
);

billingRouter.post(
  "/invoices",
  operateBilling,
  validateBody(
    z.object({ queueEntryId: z.string(), discountAmount: z.number().min(0).optional(), redeemPoints: z.number().int().min(0).optional() })
  ),
  asyncHandler(async (req, res) => {
    const invoice = await createInvoiceForQueueEntry(req.body.queueEntryId, req.body);
    await recordAudit({ userId: req.user!.sub, action: "CREATE", entity: "Invoice", entityId: invoice.id });
    res.status(201).json(invoice);
  })
);

// Read access for ADMIN too -- it needs to find/view an invoice to exercise its one
// billing action (refund), even though it can't create invoices or record payments.
billingRouter.get(
  "/invoices/:id",
  requireRole("MANAGER", "CASHIER", "ADMIN"),
  asyncHandler(async (req, res) => {
    const invoice = await prisma.invoice.findUnique({
      where: { id: req.params.id },
      include: { items: true, payments: true, customer: true, queueEntry: { include: { vehicle: true } } },
    });
    if (!invoice) throw notFound("Invoice not found");
    res.json(invoice);
  })
);

billingRouter.get(
  "/invoices",
  requireRole("MANAGER", "CASHIER", "ADMIN"),
  asyncHandler(async (req, res) => {
    const status = req.query.status as string | undefined;
    const invoices = await prisma.invoice.findMany({
      where: status ? { status } : undefined,
      include: { customer: true, payments: true },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    res.json(invoices);
  })
);

// Supports split payments: call multiple times against the same invoice with different methods/amounts.
billingRouter.post(
  "/invoices/:id/payments",
  operateBilling,
  validateBody(z.object({ method: z.enum(["CASH", "MOMO", "AIRTEL", "CARD"]), amount: z.number().positive(), phoneNumber: z.string().optional() })),
  asyncHandler(async (req, res) => {
    const result = await recordPayment(req.params.id, req.body.method, req.body.amount, req.body.phoneNumber);
    await recordAudit({
      userId: req.user!.sub,
      action: "PAYMENT",
      entity: "Invoice",
      entityId: req.params.id,
      metadata: { method: req.body.method, amount: req.body.amount, success: result.payment.status === "SUCCESS" },
    });
    res.status(result.payment.status === "SUCCESS" ? 201 : 402).json(result);
  })
);

billingRouter.post(
  "/invoices/:id/refund",
  requireRole("ADMIN", "MANAGER"),
  asyncHandler(async (req, res) => {
    const invoice = await refundInvoice(req.params.id);
    await recordAudit({ userId: req.user!.sub, action: "REFUND", entity: "Invoice", entityId: req.params.id });
    res.json(invoice);
  })
);
