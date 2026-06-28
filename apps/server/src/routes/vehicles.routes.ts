import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { asyncHandler } from "../lib/asyncHandler.js";
import { authenticate, requireRole } from "../middleware/auth.js";
import { notFound } from "../lib/errors.js";

export const vehiclesRouter = Router();
vehiclesRouter.use(authenticate, requireRole("MANAGER", "RECEPTIONIST", "CASHIER", "TECHNICIAN"));

vehiclesRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const plate = (req.query.plate as string | undefined)?.trim();
    const vehicles = await prisma.vehicle.findMany({
      where: plate ? { plate: { contains: plate } } : undefined,
      include: { customer: true },
      take: 50,
    });
    res.json(vehicles);
  })
);

vehiclesRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const vehicle = await prisma.vehicle.findUnique({
      where: { id: req.params.id },
      include: {
        customer: true,
        photos: true,
        inspections: { orderBy: { createdAt: "desc" }, include: { photos: true } },
        queueEntries: { orderBy: { checkedInAt: "desc" }, take: 10 },
      },
    });
    if (!vehicle) throw notFound("Vehicle not found");
    res.json(vehicle);
  })
);
