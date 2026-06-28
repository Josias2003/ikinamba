import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { asyncHandler } from "../lib/asyncHandler.js";
import { validateBody } from "../middleware/validate.js";
import { authenticate, requireRole } from "../middleware/auth.js";
import { notifyCustomer } from "../services/notifications.service.js";
import { notFound } from "../lib/errors.js";

export const notificationsRouter = Router();
notificationsRouter.use(authenticate);

notificationsRouter.get(
  "/log",
  requireRole("MANAGER", "RECEPTIONIST"),
  asyncHandler(async (req, res) => {
    const customerId = req.query.customerId as string | undefined;
    const logs = await prisma.notificationLog.findMany({
      where: customerId ? { customerId } : undefined,
      orderBy: { createdAt: "desc" },
      take: 200,
    });
    res.json(logs);
  })
);

const broadcastSchema = z.object({
  segment: z.enum(["ALL", "GOLD", "SILVER", "BRONZE"]),
  subject: z.string().min(1),
  html: z.string().min(1),
});

// Promotional broadcast to a loyalty-tier segment (or everyone).
notificationsRouter.post(
  "/broadcast",
  requireRole("MANAGER"),
  validateBody(broadcastSchema),
  asyncHandler(async (req, res) => {
    const { segment, subject, html } = req.body;
    const customers = await prisma.customer.findMany({
      where: segment === "ALL" ? {} : { loyaltyTier: segment },
    });

    let sent = 0;
    for (const customer of customers) {
      await notifyCustomer({ customerId: customer.id, template: "PROMOTIONAL", subject, html });
      sent++;
    }
    res.json({ sent });
  })
);

notificationsRouter.get(
  "/messages/:customerId",
  asyncHandler(async (req, res) => {
    if (req.user!.role === "CUSTOMER" && req.user!.customerId !== req.params.customerId) {
      return res.status(403).json({ error: "Forbidden" });
    }
    const messages = await prisma.message.findMany({
      where: { customerId: req.params.customerId },
      orderBy: { createdAt: "asc" },
    });
    res.json(messages);
  })
);

notificationsRouter.post(
  "/messages/:customerId",
  validateBody(z.object({ body: z.string().min(1) })),
  asyncHandler(async (req, res) => {
    const isCustomer = req.user!.role === "CUSTOMER";
    if (isCustomer && req.user!.customerId !== req.params.customerId) {
      return res.status(403).json({ error: "Forbidden" });
    }
    const customer = await prisma.customer.findUnique({ where: { id: req.params.customerId } });
    if (!customer) throw notFound("Customer not found");

    const message = await prisma.message.create({
      data: {
        customerId: req.params.customerId,
        sender: isCustomer ? "CUSTOMER" : "STAFF",
        staffId: isCustomer ? undefined : req.user!.sub,
        body: req.body.body,
      },
    });
    res.status(201).json(message);
  })
);
