import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { asyncHandler } from "../lib/asyncHandler.js";
import { validateBody } from "../middleware/validate.js";
import { authenticate, requireRole } from "../middleware/auth.js";
import { upload, publicUrlFor } from "../lib/storage.js";
import { recordAudit } from "../lib/audit.js";
import { notFound } from "../lib/errors.js";

export const maintenanceRouter = Router();
maintenanceRouter.use(authenticate, requireRole("MANAGER", "TECHNICIAN"));

const checklistItemSchema = z.object({ item: z.string(), status: z.enum(["OK", "ATTENTION", "FAILED"]), notes: z.string().optional() });

const inspectionSchema = z.object({
  vehicleId: z.string(),
  queueEntryId: z.string().optional(),
  checklist: z.array(checklistItemSchema),
  dtcCodes: z.array(z.string()).default([]), // manually entered by technician, no scanner integration
  mileage: z.number().int().optional(),
  findings: z.string().optional(),
  nextServiceDueAt: z.string().optional(),
});

maintenanceRouter.post(
  "/inspections",
  validateBody(inspectionSchema),
  asyncHandler(async (req, res) => {
    const inspection = await prisma.maintenanceInspection.create({
      data: {
        vehicleId: req.body.vehicleId,
        queueEntryId: req.body.queueEntryId,
        technicianId: req.user!.sub,
        checklist: JSON.stringify(req.body.checklist),
        dtcCodes: JSON.stringify(req.body.dtcCodes),
        mileage: req.body.mileage,
        findings: req.body.findings,
        nextServiceDueAt: req.body.nextServiceDueAt ? new Date(req.body.nextServiceDueAt) : undefined,
      },
    });
    await recordAudit({ userId: req.user!.sub, action: "CREATE", entity: "MaintenanceInspection", entityId: inspection.id });
    res.status(201).json(inspection);
  })
);

maintenanceRouter.get(
  "/inspections/:id",
  asyncHandler(async (req, res) => {
    const inspection = await prisma.maintenanceInspection.findUnique({
      where: { id: req.params.id },
      include: { photos: true, vehicle: true, technician: { select: { email: true } } },
    });
    if (!inspection) throw notFound("Inspection not found");
    res.json({ ...inspection, checklist: JSON.parse(inspection.checklist), dtcCodes: JSON.parse(inspection.dtcCodes) });
  })
);

maintenanceRouter.post(
  "/inspections/:id/photos",
  upload.array("photos", 6),
  asyncHandler(async (req, res) => {
    const files = (req.files as Express.Multer.File[]) || [];
    const inspection = await prisma.maintenanceInspection.findUnique({ where: { id: req.params.id } });
    if (!inspection) throw notFound("Inspection not found");

    const photos = await prisma.$transaction(
      files.map((f) =>
        prisma.vehiclePhoto.create({
          data: { vehicleId: inspection.vehicleId, inspectionId: inspection.id, url: publicUrlFor(f.filename), type: "INSPECTION" },
        })
      )
    );
    res.status(201).json(photos);
  })
);

maintenanceRouter.post(
  "/vehicles/:vehicleId/photos",
  upload.array("photos", 6),
  asyncHandler(async (req, res) => {
    const files = (req.files as Express.Multer.File[]) || [];
    const type = (req.body?.type as string) || "INTAKE";
    const photos = await prisma.$transaction(
      files.map((f) =>
        prisma.vehiclePhoto.create({ data: { vehicleId: req.params.vehicleId, url: publicUrlFor(f.filename), type } })
      )
    );
    res.status(201).json(photos);
  })
);
