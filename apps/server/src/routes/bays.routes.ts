import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { asyncHandler } from "../lib/asyncHandler.js";
import { validateBody } from "../middleware/validate.js";
import { authenticate, requireRole } from "../middleware/auth.js";

export const baysRouter = Router();
baysRouter.use(authenticate, requireRole("MANAGER", "RECEPTIONIST", "TECHNICIAN"));

baysRouter.get("/", asyncHandler(async (_req, res) => res.json(await prisma.bay.findMany())));

baysRouter.post(
  "/",
  requireRole("MANAGER"),
  validateBody(z.object({ name: z.string().min(1) })),
  asyncHandler(async (req, res) => res.status(201).json(await prisma.bay.create({ data: { name: req.body.name } })))
);

baysRouter.patch(
  "/:id/status",
  requireRole("MANAGER"),
  validateBody(z.object({ status: z.enum(["IDLE", "OCCUPIED", "MAINTENANCE"]) })),
  asyncHandler(async (req, res) => res.json(await prisma.bay.update({ where: { id: req.params.id }, data: { status: req.body.status } })))
);
