import { prisma } from "./prisma.js";

type Category = "AUTH" | "BILLING" | "INVENTORY" | "USER_MGMT" | "QUEUE" | "CUSTOMER" | "MAINTENANCE" | "OTHER";
type Severity = "INFO" | "WARNING" | "DANGER";

/** Maps (action, entity) to a category/severity so every call site stays a plain
 * `recordAudit({ action, entity, ... })` -- the categorization lives here once instead
 * of being repeated/guessed at every call site or re-derived client-side from a free-text
 * action string. */
function classify(action: string, entity: string): { category: Category; severity: Severity } {
  switch (action) {
    case "LOGIN":
      return { category: "AUTH", severity: "INFO" };
    case "LOGOUT":
      return { category: "AUTH", severity: "INFO" };
    case "FAILED_LOGIN":
      return { category: "AUTH", severity: "DANGER" };
    case "CHANGE_PASSWORD":
      return { category: "AUTH", severity: "WARNING" };
    case "CHECK_IN":
    case "WALK_IN_CHECK_IN":
    case "QC_SIGN_OFF":
      return { category: "QUEUE", severity: "INFO" };
    case "PAYMENT":
      return { category: "BILLING", severity: "INFO" };
    case "REFUND":
      return { category: "BILLING", severity: "WARNING" };
    case "ADJUST_STOCK":
      return { category: "INVENTORY", severity: "INFO" };
    case "DEACTIVATE":
      return { category: "USER_MGMT", severity: "DANGER" };
    case "REACTIVATE":
      return { category: "USER_MGMT", severity: "WARNING" };
    case "MANUAL_BACKUP":
      return { category: "USER_MGMT", severity: "WARNING" };
    case "CREATE":
    case "UPDATE":
      if (entity === "Invoice") return { category: "BILLING", severity: "INFO" };
      if (entity === "InventoryItem" || entity === "PurchaseOrder") return { category: "INVENTORY", severity: "INFO" };
      if (entity === "Customer" || entity === "Vehicle") return { category: "CUSTOMER", severity: "INFO" };
      if (entity === "MaintenanceInspection") return { category: "MAINTENANCE", severity: "INFO" };
      if (entity === "User") return { category: "USER_MGMT", severity: "INFO" };
      return { category: "OTHER", severity: "INFO" };
    default:
      return { category: "OTHER", severity: "INFO" };
  }
}

export async function recordAudit(opts: {
  userId?: string | null;
  action: string;
  entity: string;
  entityId?: string | null;
  metadata?: Record<string, unknown>;
}) {
  const { category, severity } = classify(opts.action, opts.entity);
  await prisma.auditLog.create({
    data: {
      userId: opts.userId ?? null,
      action: opts.action,
      entity: opts.entity,
      entityId: opts.entityId ?? null,
      metadata: opts.metadata ? JSON.stringify(opts.metadata) : null,
      category,
      severity,
    },
  });
}
