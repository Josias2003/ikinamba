import { prisma } from "./prisma.js";

export async function recordAudit(opts: {
  userId?: string | null;
  action: string;
  entity: string;
  entityId?: string | null;
  metadata?: Record<string, unknown>;
}) {
  await prisma.auditLog.create({
    data: {
      userId: opts.userId ?? null,
      action: opts.action,
      entity: opts.entity,
      entityId: opts.entityId ?? null,
      metadata: opts.metadata ? JSON.stringify(opts.metadata) : null,
    },
  });
}
