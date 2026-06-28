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
  validateBody(z.object({ customerId: z.string(), vehicleId: z.string() })),
  asyncHandler(async (req, res) => {
    const entry = await checkIn(req.body);
    await recordAudit({ userId: req.user!.sub, action: "WALK_IN_CHECK_IN", entity: "QueueEntry", entityId: entry.id });
    res.status(201).json(entry);
  })
);

queueRouter.post(
  "/bays/:bayId/assign-next",
  requireRole("RECEPTIONIST"),
  asyncHandler(async (req, res) => res.json(await assignNextToBay(req.params.bayId)))
);

// Dispatch decision -- who works on what is RECEPTIONIST's call, not something a
// technician can reassign for themself or others, and not MANAGER's job either (floor
// dispatch is RECEPTIONIST's named responsibility, not a shared one).
queueRouter.patch(
  "/:id/technician",
  requireRole("RECEPTIONIST"),
  validateBody(z.object({ technicianId: z.string() })),
  asyncHandler(async (req, res) => {
    await setTechnician(req.params.id, req.body.technicianId);
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

queueRouter.patch(
  "/:id/complete",
  requireRole("RECEPTIONIST"),
  asyncHandler(async (req, res) => res.json(await completeAndReleaseBay(req.params.id)))
);
