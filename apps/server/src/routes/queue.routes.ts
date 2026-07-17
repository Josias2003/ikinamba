import { Router } from "express";
import { z } from "zod";
import { authenticate, requireRole } from "../middleware/auth.js";
import { asyncHandler } from "../lib/asyncHandler.js";
import { validateBody } from "../middleware/validate.js";
import { recordAudit } from "../lib/audit.js";
import { prisma } from "../lib/prisma.js";
import {
  checkIn,
  assignNextToBay,
  setTechnician,
  addServiceItems,
  moveToQualityCheck,
  signQualityCheck,
  completeAndReleaseBay,
  findByTrackingToken,
  getBoard,
} from "../services/queue.service.js";

export const queueRouter = Router();
queueRouter.use(authenticate, requireRole("MANAGER", "RECEPTIONIST", "TECHNICIAN"));

queueRouter.get("/board", asyncHandler(async (_req, res) => res.json(await getBoard())));

queueRouter.get("/by-token/:token", asyncHandler(async (req, res) => res.json(await findByTrackingToken(req.params.token))));

queueRouter.get(
  "/technicians",
  asyncHandler(async (_req, res) => {
    res.json(await prisma.user.findMany({ where: { role: "TECHNICIAN", isActive: true }, select: { id: true, email: true } }));
  })
);

queueRouter.post(
  "/walk-in",
  requireRole("RECEPTIONIST"),
  validateBody(
    z
      .object({
        customerId: z.string().optional(),
        vehicleId: z.string().optional(),
        customer: z.object({
          name: z.string().min(1),
          phone: z.string().min(5),
          email: z.string().email().optional(),
        }).optional(),
        vehicle: z.object({
          make: z.string().min(1),
          model: z.string().min(1),
          year: z.number().int().min(1980).max(2100),
          plate: z.string().min(1),
          color: z.string().optional(),
        }).optional(),
      })
      .refine((body) => (body.customerId && body.vehicleId) || (body.customer && body.vehicle), {
        message: "Provide an existing customer/vehicle or new customer/vehicle details.",
      })
  ),
  asyncHandler(async (req, res) => {
    let customerId = req.body.customerId;
    let vehicleId = req.body.vehicleId;

    if (!customerId || !vehicleId) {
      const newCustomer = req.body.customer!;
      const newVehicle = req.body.vehicle!;
      const created = await prisma.$transaction(async (tx) => {
        const existingVehicle = await tx.vehicle.findUnique({ where: { plate: newVehicle.plate } });
        if (existingVehicle) {
          return { customerId: existingVehicle.customerId, vehicleId: existingVehicle.id };
        }

        const customer = await tx.customer.create({ data: newCustomer });
        const vehicle = await tx.vehicle.create({ data: { ...newVehicle, customerId: customer.id } });
        return { customerId: customer.id, vehicleId: vehicle.id };
      });
      customerId = created.customerId;
      vehicleId = created.vehicleId;
    }

    const entry = await checkIn({ customerId, vehicleId });

    await recordAudit({ userId: req.user!.sub, action: "WALK_IN_CHECK_IN", entity: "QueueEntry", entityId: entry.id });
    res.status(201).json(await prisma.queueEntry.findUnique({
      where: { id: entry.id },
      include: { customer: true, vehicle: true, bay: true, serviceJob: { include: { items: true, technician: true } } },
    }));
  })
);

queueRouter.post(
  "/bays/:bayId/assign-next",
  requireRole("RECEPTIONIST"),
  asyncHandler(async (req, res) => res.json(await assignNextToBay(req.params.bayId)))
);

// Dispatch (assigning/reassigning any job) is RECEPTIONIST's call. A TECHNICIAN may
// additionally hand off a job already assigned to themselves -- enforced inside
// setTechnician(), not here, since it depends on whose job it currently is.
queueRouter.patch(
  "/:id/technician",
  requireRole("RECEPTIONIST", "TECHNICIAN"),
  validateBody(z.object({ technicianId: z.string() })),
  asyncHandler(async (req, res) => {
    await setTechnician(req.params.id, req.body.technicianId, { id: req.user!.sub, role: req.user!.role });
    res.json({ ok: true });
  })
);

queueRouter.post(
  "/:id/items",
  validateBody(z.object({ catalogItemIds: z.array(z.string()).min(1) })),
  asyncHandler(async (req, res) => res.json(await addServiceItems(req.params.id, req.body.catalogItemIds)))
);

queueRouter.patch("/:id/quality-check", asyncHandler(async (req, res) => res.json(await moveToQualityCheck(req.params.id))));

queueRouter.patch(
  "/:id/sign-quality-check",
  requireRole("TECHNICIAN"),
  asyncHandler(async (req, res) => {
    const entry = await signQualityCheck(req.params.id, req.user!.sub);
    await recordAudit({ userId: req.user!.sub, action: "QC_SIGN_OFF", entity: "QueueEntry", entityId: entry.id });
    res.json(entry);
  })
);

// RECEPTIONIST can release any vehicle; a TECHNICIAN can additionally release one
// assigned to themselves (enforced inside completeAndReleaseBay(), which depends on
// whose job it is) -- still finance-gated either way (see that function).
queueRouter.patch(
  "/:id/complete",
  requireRole("RECEPTIONIST", "TECHNICIAN"),
  asyncHandler(async (req, res) => res.json(await completeAndReleaseBay(req.params.id, { id: req.user!.sub, role: req.user!.role })))
);
