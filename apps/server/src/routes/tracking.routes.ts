import { Router } from "express";
import QRCode from "qrcode";
import { prisma } from "../lib/prisma.js";
import { asyncHandler } from "../lib/asyncHandler.js";
import { notFound } from "../lib/errors.js";
import { trackingUrl } from "../lib/tracking.js";

export const trackingRouter = Router();

const STAGE_ORDER = ["WAITING", "IN_SERVICE", "QUALITY_CHECK", "READY", "COMPLETED"];

// Public, no auth -- anyone with the QR/token link (printed at check-in) can view live status.
trackingRouter.get(
  "/:token",
  asyncHandler(async (req, res) => {
    const entry = await prisma.queueEntry.findUnique({
      where: { trackingToken: req.params.token },
      include: {
        customer: { select: { name: true } },
        vehicle: { select: { make: true, model: true, plate: true } },
        bay: { select: { name: true } },
        serviceJob: { include: { items: true, technician: { select: { email: true } } } },
      },
    });

    if (!entry) {
      // The token may belong to an appointment that hasn't been checked in yet --
      // the same QR is handed out at booking time and stays valid through check-in.
      const appt = await prisma.appointment.findUnique({
        where: { trackingToken: req.params.token },
        include: { customer: { select: { name: true } }, vehicle: { select: { make: true, model: true, plate: true } } },
      });
      if (!appt) throw notFound("Tracking link not found");
      return res.json({
        status: "BOOKED",
        stageIndex: -1,
        stages: STAGE_ORDER,
        customerName: appt.customer.name,
        vehicle: appt.vehicle,
        bay: null,
        scheduledAt: appt.scheduledAt,
        services: [],
      });
    }

    res.json({
      status: entry.status,
      stageIndex: STAGE_ORDER.indexOf(entry.status),
      stages: STAGE_ORDER,
      customerName: entry.customer.name,
      vehicle: entry.vehicle,
      bay: entry.bay?.name ?? null,
      checkedInAt: entry.checkedInAt,
      startedAt: entry.startedAt,
      qcAt: entry.qcAt,
      completedAt: entry.completedAt,
      services: entry.serviceJob?.items.map((i) => i.name) ?? [],
    });
  })
);

trackingRouter.get(
  "/:token/qrcode.png",
  asyncHandler(async (req, res) => {
    const png = await QRCode.toBuffer(trackingUrl(req.params.token), { width: 320 });
    res.set("Content-Type", "image/png");
    res.send(png);
  })
);
