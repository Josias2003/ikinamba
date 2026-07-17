import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { asyncHandler } from "../lib/asyncHandler.js";
import { validateBody } from "../middleware/validate.js";
import { authenticate, requireRole } from "../middleware/auth.js";
import { createInvoiceForQueueEntry, recordPayment, refundInvoice } from "../services/billing.service.js";
import { recordAudit } from "../lib/audit.js";
import { notFound } from "../lib/errors.js";
import { readPageParams, pagedResult } from "../lib/pagination.js";

export const billingRouter = Router();
billingRouter.use(authenticate);

// Invoicing/payment entry is CASHIER's own named job, full stop -- MANAGER reads the
// invoice list/detail for oversight (see the GET routes below) but doesn't duplicate the
// write action, and ADMIN's only billing job is refund sign-off (financial control), kept
// further down as its own single-actor route.
const operateBilling = requireRole("CASHIER");

// Vehicles ready for pickup (or already picked up) that don't have an invoice yet --
// read-only oversight data, same as /invoices below, so MANAGER keeps visibility into the
// invoicing backlog even though it can't act on it (operateBilling is CASHIER-only and is
// reserved for the actual write actions further down).
billingRouter.get(
  "/billable",
  requireRole("MANAGER", "CASHIER"),
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
// RECEPTIONIST/TECHNICIAN can also view receipts read-only -- they have no write action
// on this router at all, just visibility.
billingRouter.get(
  "/invoices/:id",
  requireRole("MANAGER", "CASHIER", "ADMIN", "RECEPTIONIST", "TECHNICIAN"),
  asyncHandler(async (req, res) => {
    const invoice = await prisma.invoice.findUnique({
      where: { id: req.params.id },
      include: { items: true, payments: true, customer: true, queueEntry: { include: { vehicle: true } } },
    });
    if (!invoice) throw notFound("Invoice not found");
    res.json(invoice);
  })
);

const INVOICE_SORT_FIELDS = ["createdAt", "total", "status"] as const;

billingRouter.get(
  "/invoices",
  requireRole("MANAGER", "CASHIER", "ADMIN", "RECEPTIONIST", "TECHNICIAN"),
  asyncHandler(async (req, res) => {
    const status = req.query.status as string | undefined;
    const params = readPageParams(req, INVOICE_SORT_FIELDS);
    const where = {
      status: status || undefined,
      customer: params.search ? { name: { contains: params.search } } : undefined,
    };
    const [invoices, total] = await Promise.all([
      prisma.invoice.findMany({
        where,
        include: { customer: true, payments: true },
        orderBy: { [params.sortBy ?? "createdAt"]: params.sortDir },
        skip: (params.page - 1) * params.pageSize,
        take: params.pageSize,
      }),
      prisma.invoice.count({ where }),
    ]);
    res.json(pagedResult(invoices, total, params));
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
  requireRole("ADMIN"),
  validateBody(z.object({ reason: z.string().min(1), amount: z.number().positive().optional(), confirmedExternal: z.boolean().optional() })),
  asyncHandler(async (req, res) => {
    const invoice = await refundInvoice(req.params.id, req.body);
    await recordAudit({
      userId: req.user!.sub,
      action: "REFUND",
      entity: "Invoice",
      entityId: req.params.id,
      metadata: { reason: req.body.reason, amount: req.body.amount ?? "FULL", confirmedExternal: Boolean(req.body.confirmedExternal) },
    });
    res.json(invoice);
  })
);
