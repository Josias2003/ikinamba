import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { asyncHandler } from "../lib/asyncHandler.js";
import { validateBody } from "../middleware/validate.js";
import { authenticate, requireRole } from "../middleware/auth.js";
import { notFound } from "../lib/errors.js";
import { assertSlotAvailable, getAvailability, createPublicBooking } from "../services/appointments.service.js";
import { checkIn } from "../services/queue.service.js";
import { recordAudit } from "../lib/audit.js";

export const appointmentsRouter = Router();

appointmentsRouter.get(
  "/availability",
  asyncHandler(async (req, res) => {
    const date = req.query.date ? new Date(req.query.date as string) : new Date();
    res.json(await getAvailability(date));
  })
);

const bookSchema = z.object({
  customerId: z.string().optional(),
  // Inline customer creation supports the public booking widget (no login required to book).
  customer: z.object({ name: z.string(), phone: z.string(), email: z.string().email().optional() }).optional(),
  vehicleId: z.string().optional(),
  vehicle: z
    .object({ make: z.string(), model: z.string(), year: z.number(), plate: z.string(), color: z.string().optional() })
    .optional(),
  scheduledAt: z.string(),
  serviceItemIds: z.array(z.string()).min(1),
  notes: z.string().optional(),
  source: z.enum(["ONLINE", "PHONE", "WALK_IN"]).default("ONLINE"),
});

// Public endpoint: customers can book without an account (per the lightweight-customer-auth decision).
appointmentsRouter.post(
  "/",
  validateBody(bookSchema),
  asyncHandler(async (req, res) => {
    const scheduledAt = new Date(req.body.scheduledAt);
    await assertSlotAvailable(scheduledAt);
    const appointment = await createPublicBooking({ ...req.body, scheduledAt });
    res.status(201).json(appointment);
  })
);

appointmentsRouter.get(
  "/",
  authenticate,
  requireRole("MANAGER", "RECEPTIONIST"),
  asyncHandler(async (req, res) => {
    const date = req.query.date as string | undefined;
    const where = date
      ? { scheduledAt: { gte: new Date(`${date}T00:00:00`), lt: new Date(`${date}T23:59:59`) } }
      : {};
    const appointments = await prisma.appointment.findMany({
      where,
      include: { customer: true, vehicle: true, serviceItems: { include: { catalogItem: true } } },
      orderBy: { scheduledAt: "asc" },
    });
    res.json(appointments);
  })
);

appointmentsRouter.patch(
  "/:id/reschedule",
  authenticate,
  requireRole("MANAGER", "RECEPTIONIST"),
  validateBody(z.object({ scheduledAt: z.string() })),
  asyncHandler(async (req, res) => {
    const scheduledAt = new Date(req.body.scheduledAt);
    await assertSlotAvailable(scheduledAt, req.params.id);
    const appt = await prisma.appointment.update({ where: { id: req.params.id }, data: { scheduledAt } });
    res.json(appt);
  })
);

appointmentsRouter.patch(
  "/:id/cancel",
  authenticate,
  requireRole("MANAGER", "RECEPTIONIST"),
  asyncHandler(async (req, res) => {
    const appt = await prisma.appointment.update({ where: { id: req.params.id }, data: { status: "CANCELLED" } });
    res.json(appt);
  })
);

// Check-in: converts a confirmed appointment (or a fresh walk-in) into a live QueueEntry.
appointmentsRouter.post(
  "/:id/check-in",
  authenticate,
  requireRole("MANAGER", "RECEPTIONIST"),
  asyncHandler(async (req, res) => {
    const appt = await prisma.appointment.findUnique({ where: { id: req.params.id } });
    if (!appt) throw notFound("Appointment not found");
    const entry = await checkIn({ customerId: appt.customerId, vehicleId: appt.vehicleId, appointmentId: appt.id });
    await recordAudit({ userId: req.user!.sub, action: "CHECK_IN", entity: "QueueEntry", entityId: entry.id });
    res.status(201).json(entry);
  })
);
