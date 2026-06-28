import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { asyncHandler } from "../lib/asyncHandler.js";
import { validateBody } from "../middleware/validate.js";
import { authenticate, requireRole } from "../middleware/auth.js";

export const catalogRouter = Router();

// Public: the booking widget and chatbot both need to read the catalog without auth.
catalogRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    res.json(await prisma.serviceCatalogItem.findMany({ where: { isActive: true }, orderBy: { category: "asc" } }));
  })
);

const itemSchema = z.object({
  name: z.string().min(1),
  category: z.enum(["WASH", "DETAIL", "MAINTENANCE", "INSPECTION", "ADDON"]),
  basePrice: z.number().positive(),
  durationMinutes: z.number().int().positive(),
});

catalogRouter.post(
  "/",
  authenticate,
  requireRole("MANAGER"),
  validateBody(itemSchema),
  asyncHandler(async (req, res) => res.status(201).json(await prisma.serviceCatalogItem.create({ data: req.body })))
);

catalogRouter.patch(
  "/:id",
  authenticate,
  requireRole("MANAGER"),
  validateBody(itemSchema.partial()),
  asyncHandler(async (req, res) => res.json(await prisma.serviceCatalogItem.update({ where: { id: req.params.id }, data: req.body })))
);
