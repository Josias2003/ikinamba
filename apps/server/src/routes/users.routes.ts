import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { asyncHandler } from "../lib/asyncHandler.js";
import { validateBody } from "../middleware/validate.js";
import { authenticate, requireRole } from "../middleware/auth.js";
import { hashPassword } from "../lib/auth.js";
import { recordAudit } from "../lib/audit.js";
import { ROLES } from "../types/enums.js";
import { runDailyBackup } from "../jobs/backup.js";
import { readPageParams, pagedResult } from "../lib/pagination.js";

// ADMIN-exclusive -- user/account management is the admin role's own job, not something
// to share with MANAGER (reverted after explicit feedback: "let admin do the admin role,
// not give it to manager" -- see [[project-kariza-roles-separation]]).
export const usersRouter = Router();
usersRouter.use(authenticate, requireRole("ADMIN"));

usersRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    res.json(
      await prisma.user.findMany({
        select: { id: true, email: true, role: true, isActive: true, totpEnabled: true, createdAt: true },
        orderBy: { createdAt: "desc" },
      })
    );
  })
);

const createSchema = z.object({ email: z.string().email(), password: z.string().min(8), role: z.enum(ROLES) });

usersRouter.post(
  "/",
  validateBody(createSchema),
  asyncHandler(async (req, res) => {
    const passwordHash = await hashPassword(req.body.password);
    const user = await prisma.user.create({ data: { email: req.body.email, passwordHash, role: req.body.role } });
    await recordAudit({ userId: req.user!.sub, action: "CREATE", entity: "User", entityId: user.id });
    res.status(201).json({ id: user.id, email: user.email, role: user.role });
  })
);

usersRouter.patch(
  "/:id/deactivate",
  asyncHandler(async (req, res) => {
    const user = await prisma.user.update({ where: { id: req.params.id }, data: { isActive: false } });
    await recordAudit({ userId: req.user!.sub, action: "DEACTIVATE", entity: "User", entityId: user.id });
    res.json({ ok: true });
  })
);

usersRouter.patch(
  "/:id/reactivate",
  asyncHandler(async (req, res) => {
    const user = await prisma.user.update({ where: { id: req.params.id }, data: { isActive: true } });
    await recordAudit({ userId: req.user!.sub, action: "REACTIVATE", entity: "User", entityId: user.id });
    res.json({ ok: true });
  })
);

usersRouter.post(
  "/backup",
  asyncHandler(async (req, res) => {
    await runDailyBackup();
    await recordAudit({ userId: req.user!.sub, action: "MANUAL_BACKUP", entity: "System" });
    res.json({ ok: true });
  })
);

usersRouter.get(
  "/audit-log",
  asyncHandler(async (req, res) => {
    const { category, since, until } = req.query as { category?: string; since?: string; until?: string };
    const params = readPageParams(req, ["createdAt"] as const);
    const where = {
      category: category && category !== "ALL" ? category : undefined,
      createdAt: {
        gte: since ? new Date(since) : undefined,
        lte: until ? new Date(`${until}T23:59:59`) : undefined,
      },
      OR: params.search
        ? [
            { action: { contains: params.search } },
            { entity: { contains: params.search } },
            { user: { email: { contains: params.search } } },
          ]
        : undefined,
    };
    const [logs, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (params.page - 1) * params.pageSize,
        take: params.pageSize,
        include: { user: { select: { email: true } } },
      }),
      prisma.auditLog.count({ where }),
    ]);
    res.json(pagedResult(logs, total, params));
  })
);
