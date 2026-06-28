// SQLite has no native enum type, so these are the canonical value lists
// enforced at the application layer (zod schemas use these arrays).

export const ROLES = [
  "ADMIN",
  "MANAGER",
  "CASHIER",
  "RECEPTIONIST",
  "TECHNICIAN",
  "CUSTOMER",
] as const;
export type Role = (typeof ROLES)[number];

export const STAFF_ROLES: Role[] = ["ADMIN", "MANAGER", "CASHIER", "RECEPTIONIST", "TECHNICIAN"];

export const LOYALTY_TIERS = ["BRONZE", "SILVER", "GOLD"] as const;
export type LoyaltyTier = (typeof LOYALTY_TIERS)[number];

export const SERVICE_CATEGORIES = ["WASH", "DETAIL", "MAINTENANCE", "INSPECTION", "ADDON"] as const;
export type ServiceCategory = (typeof SERVICE_CATEGORIES)[number];

export const APPOINTMENT_STATUSES = ["CONFIRMED", "WAITLISTED", "CANCELLED", "COMPLETED", "NO_SHOW"] as const;
export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];

export const APPOINTMENT_SOURCES = ["ONLINE", "PHONE", "WALK_IN"] as const;
export type AppointmentSource = (typeof APPOINTMENT_SOURCES)[number];

export const QUEUE_STATUSES = [
  "WAITING",
  "IN_SERVICE",
  "QUALITY_CHECK",
  "READY",
  "COMPLETED",
  "CANCELLED",
] as const;
export type QueueStatus = (typeof QUEUE_STATUSES)[number];

export const BAY_STATUSES = ["IDLE", "OCCUPIED", "MAINTENANCE"] as const;
export type BayStatus = (typeof BAY_STATUSES)[number];

export const INVOICE_STATUSES = ["UNPAID", "PARTIALLY_PAID", "PAID", "REFUNDED"] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export const PAYMENT_METHODS = ["CASH", "MOMO", "AIRTEL", "CARD", "LOYALTY"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const PAYMENT_STATUSES = ["PENDING", "SUCCESS", "FAILED", "REFUNDED"] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const LOYALTY_TXN_TYPES = ["EARN", "REDEEM", "ADJUST"] as const;
export type LoyaltyTxnType = (typeof LOYALTY_TXN_TYPES)[number];

export const NOTIFICATION_CHANNELS = ["EMAIL", "IN_APP"] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

export const INVENTORY_CATEGORIES = ["CHEMICAL", "PART", "CONSUMABLE"] as const;
export type InventoryCategory = (typeof INVENTORY_CATEGORIES)[number];

export const PURCHASE_ORDER_STATUSES = ["DRAFT", "SUBMITTED", "APPROVED", "RECEIVED", "CANCELLED"] as const;
export type PurchaseOrderStatus = (typeof PURCHASE_ORDER_STATUSES)[number];
