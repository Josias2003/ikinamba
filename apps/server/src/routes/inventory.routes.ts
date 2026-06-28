import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { asyncHandler } from "../lib/asyncHandler.js";
import { validateBody } from "../middleware/validate.js";
import { authenticate, requireRole } from "../middleware/auth.js";
import { recordAudit } from "../lib/audit.js";
import { notFound } from "../lib/errors.js";

export const inventoryRouter = Router();
inventoryRouter.use(authenticate);

// ADMIN's only inventory job is PO approval (financial control) -- it doesn't run
// day-to-day stock/supplier/item management, so it's left out of this default and only
// added back on the purchase-order read/approve routes it actually needs.
const operateInventory = requireRole("MANAGER");

inventoryRouter.get(
  "/items",
  operateInventory,
  asyncHandler(async (req, res) => {
    const items = await prisma.inventoryItem.findMany({ orderBy: { name: "asc" } });
    const lowStockOnly = req.query.lowStock === "true";
    res.json(lowStockOnly ? items.filter((i) => i.stockLevel <= i.reorderThreshold) : items);
  })
);

const itemSchema = z.object({
  name: z.string().min(1),
  unit: z.string().min(1),
  category: z.enum(["CHEMICAL", "PART", "CONSUMABLE"]),
  stockLevel: z.number().min(0),
  reorderThreshold: z.number().min(0),
  costPerUnit: z.number().min(0),
  expiryDate: z.string().optional(),
});

inventoryRouter.post(
  "/items",
  operateInventory,
  validateBody(itemSchema),
  asyncHandler(async (req, res) => {
    const item = await prisma.inventoryItem.create({
      data: { ...req.body, expiryDate: req.body.expiryDate ? new Date(req.body.expiryDate) : undefined },
    });
    await recordAudit({ userId: req.user!.sub, action: "CREATE", entity: "InventoryItem", entityId: item.id });
    res.status(201).json(item);
  })
);

inventoryRouter.patch(
  "/items/:id/adjust",
  operateInventory,
  validateBody(z.object({ delta: z.number(), reason: z.string() })),
  asyncHandler(async (req, res) => {
    const item = await prisma.inventoryItem.update({
      where: { id: req.params.id },
      data: { stockLevel: { increment: req.body.delta } },
    });
    await recordAudit({
      userId: req.user!.sub,
      action: "ADJUST_STOCK",
      entity: "InventoryItem",
      entityId: item.id,
      metadata: { delta: req.body.delta, reason: req.body.reason },
    });
    res.json(item);
  })
);

inventoryRouter.get("/suppliers", operateInventory, asyncHandler(async (_req, res) => res.json(await prisma.supplier.findMany())));

inventoryRouter.post(
  "/suppliers",
  operateInventory,
  validateBody(z.object({ name: z.string().min(1), email: z.string().email().optional(), phone: z.string().optional() })),
  asyncHandler(async (req, res) => res.status(201).json(await prisma.supplier.create({ data: req.body })))
);

// Read access for ADMIN too -- it needs to see purchase orders to exercise its one
// inventory action (approve), even though it can't create/adjust stock itself.
inventoryRouter.get(
  "/purchase-orders",
  requireRole("MANAGER", "ADMIN"),
  asyncHandler(async (_req, res) =>
    res.json(
      await prisma.purchaseOrder.findMany({
        include: { supplier: true, items: { include: { inventoryItem: true } }, createdBy: { select: { email: true } } },
        orderBy: { createdAt: "desc" },
      })
    )
  )
);

const poSchema = z.object({
  supplierId: z.string(),
  items: z.array(z.object({ inventoryItemId: z.string(), qty: z.number().positive(), unitCost: z.number().min(0) })).min(1),
});

// Manager-approved draft PO -- this is what a low-stock alert ultimately feeds into.
inventoryRouter.post(
  "/purchase-orders",
  operateInventory,
  validateBody(poSchema),
  asyncHandler(async (req, res) => {
    const po = await prisma.purchaseOrder.create({
      data: {
        supplierId: req.body.supplierId,
        createdById: req.user!.sub,
        status: "DRAFT",
        items: { create: req.body.items },
      },
      include: { items: true },
    });
    await recordAudit({ userId: req.user!.sub, action: "CREATE", entity: "PurchaseOrder", entityId: po.id });
    res.status(201).json(po);
  })
);

inventoryRouter.patch(
  "/purchase-orders/:id/approve",
  requireRole("ADMIN", "MANAGER"),
  asyncHandler(async (req, res) => {
    const po = await prisma.purchaseOrder.update({
      where: { id: req.params.id },
      data: { status: "APPROVED", approvedById: req.user!.sub },
    });
    res.json(po);
  })
);

// Receiving a PO replenishes stock for each line item.
inventoryRouter.patch(
  "/purchase-orders/:id/receive",
  operateInventory,
  asyncHandler(async (req, res) => {
    const po = await prisma.purchaseOrder.findUnique({ where: { id: req.params.id }, include: { items: true } });
    if (!po) throw notFound("Purchase order not found");

    await prisma.$transaction([
      ...po.items.map((i) =>
        prisma.inventoryItem.update({ where: { id: i.inventoryItemId }, data: { stockLevel: { increment: i.qty } } })
      ),
      prisma.purchaseOrder.update({ where: { id: po.id }, data: { status: "RECEIVED" } }),
    ]);

    res.json({ ok: true });
  })
);
