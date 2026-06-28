import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { asyncHandler } from "../lib/asyncHandler.js";
import { validateBody } from "../middleware/validate.js";
import { authenticate, requireRole } from "../middleware/auth.js";
import { notFound } from "../lib/errors.js";
import { recordAudit } from "../lib/audit.js";

export const customersRouter = Router();
customersRouter.use(authenticate);

const staffOnly = requireRole("MANAGER", "RECEPTIONIST", "CASHIER", "TECHNICIAN");

customersRouter.get(
  "/",
  staffOnly,
  asyncHandler(async (req, res) => {
    const search = (req.query.search as string | undefined)?.trim();
    const customers = await prisma.customer.findMany({
      where: search
        ? {
            OR: [
              { name: { contains: search } },
              { phone: { contains: search } },
              { vehicles: { some: { plate: { contains: search } } } },
            ],
          }
        : undefined,
      include: { vehicles: true, insight: true },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    res.json(customers);
  })
);

customersRouter.get(
  "/:id",
  staffOnly,
  asyncHandler(async (req, res) => {
    const customer = await prisma.customer.findUnique({
      where: { id: req.params.id },
      include: {
        vehicles: { include: { photos: true } },
        invoices: { include: { payments: true, items: true }, orderBy: { createdAt: "desc" } },
        loyaltyTxns: { orderBy: { createdAt: "desc" } },
        insight: true,
      },
    });
    if (!customer) throw notFound("Customer not found");
    res.json(customer);
  })
);

const customerSchema = z.object({
  name: z.string().min(1),
  phone: z.string().min(5),
  email: z.string().email().optional(),
  address: z.string().optional(),
  preferredContact: z.enum(["PHONE", "EMAIL", "SMS"]).optional(),
});

customersRouter.post(
  "/",
  staffOnly,
  validateBody(customerSchema),
  asyncHandler(async (req, res) => {
    const customer = await prisma.customer.create({ data: req.body });
    await recordAudit({ userId: req.user!.sub, action: "CREATE", entity: "Customer", entityId: customer.id });
    res.status(201).json(customer);
  })
);

customersRouter.patch(
  "/:id",
  staffOnly,
  validateBody(customerSchema.partial()),
  asyncHandler(async (req, res) => {
    const customer = await prisma.customer.update({ where: { id: req.params.id }, data: req.body });
    await recordAudit({ userId: req.user!.sub, action: "UPDATE", entity: "Customer", entityId: customer.id });
    res.json(customer);
  })
);

const vehicleSchema = z.object({
  make: z.string().min(1),
  model: z.string().min(1),
  year: z.number().int().min(1980).max(2100),
  plate: z.string().min(1),
  vin: z.string().optional(),
  color: z.string().optional(),
});

customersRouter.post(
  "/:id/vehicles",
  staffOnly,
  validateBody(vehicleSchema),
  asyncHandler(async (req, res) => {
    const vehicle = await prisma.vehicle.create({ data: { ...req.body, customerId: req.params.id } });
    await recordAudit({ userId: req.user!.sub, action: "CREATE", entity: "Vehicle", entityId: vehicle.id });
    res.status(201).json(vehicle);
  })
);
