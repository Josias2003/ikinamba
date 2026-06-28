import { Router } from "express";
import { z } from "zod";
import { authenticate, optionalAuthenticate, requireRole } from "../middleware/auth.js";
import { asyncHandler } from "../lib/asyncHandler.js";
import { validateBody } from "../middleware/validate.js";
import { generateDashboardInsights } from "../ai/insights.js";
import { askChatbot } from "../ai/chatbot.js";
import { recomputeCustomerInsights, scoreSingleCustomer } from "../ai/scoring.js";
import { isOllamaAvailable } from "../ai/ollamaClient.js";
import { forecastExpectedVisits } from "../ai/forecast.js";
import { prisma } from "../lib/prisma.js";

export const aiRouter = Router();

aiRouter.get("/status", authenticate, asyncHandler(async (_req, res) => {
  res.json({ ollamaAvailable: await isOllamaAvailable() });
}));

aiRouter.get(
  "/insights",
  authenticate,
  requireRole("ADMIN", "MANAGER"),
  asyncHandler(async (_req, res) => {
    res.json(await generateDashboardInsights());
  })
);

aiRouter.post(
  "/insights/recompute",
  authenticate,
  requireRole("MANAGER"),
  asyncHandler(async (_req, res) => {
    const updated = await recomputeCustomerInsights();
    res.json({ updated });
  })
);

aiRouter.get(
  "/insights/at-risk",
  authenticate,
  requireRole("ADMIN", "MANAGER"),
  asyncHandler(async (_req, res) => {
    const atRisk = await prisma.customerInsight.findMany({
      where: { churnRiskLabel: { in: ["MEDIUM", "HIGH"] } },
      include: { customer: true },
      orderBy: { churnRisk: "desc" },
    });
    res.json(atRisk);
  })
);

aiRouter.get(
  "/forecast",
  authenticate,
  requireRole("ADMIN", "MANAGER"),
  asyncHandler(async (req, res) => {
    const days = Number(req.query.days) || 7;
    res.json(await forecastExpectedVisits(days));
  })
);

aiRouter.get(
  "/insights/customer/:customerId",
  authenticate,
  asyncHandler(async (req, res) => {
    const cached = await prisma.customerInsight.findUnique({ where: { customerId: req.params.customerId } });
    if (cached) return res.json(cached);
    const live = await scoreSingleCustomer(req.params.customerId);
    res.json(live);
  })
);

const chatSchema = z.object({
  history: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string(),
        // Round-tripped from a prior reply's structured tool result (e.g. a pending
        // booking preview) so the server can act on it deterministically instead of
        // asking the model to re-extract/re-state it on the next turn -- see askChatbot.
        display: z.object({ type: z.string(), data: z.any() }).optional(),
      })
    )
    .max(20),
});

// Public: anonymous customers on the booking/tracking pages use this with no token.
// Logged-in staff hit the same endpoint from the widget embedded in the internal app --
// optionalAuthenticate picks up their role (if any) so askChatbot can scope the answer.
aiRouter.post(
  "/chat",
  optionalAuthenticate,
  validateBody(chatSchema),
  asyncHandler(async (req, res) => {
    res.json(await askChatbot(req.body.history, req.user?.role));
  })
);
