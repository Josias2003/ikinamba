import { prisma } from "../lib/prisma.js";

export const CHURN_FEATURE_NAMES = ["daysSinceLastVisit", "visitsLast90Days", "avgSpend", "totalSpend"];
export const MAINTENANCE_FEATURE_NAMES = ["daysSinceLastService", "mileage", "serviceCount"];

/** Builds churn features for a customer as of `asOf`, using only data at/before that date -- this is what makes the training set's forward-looking labels valid (no leakage from the future into the features). */
export async function computeChurnFeatures(customerId: string, asOf: Date): Promise<number[]> {
  const entries = await prisma.queueEntry.findMany({
    where: { customerId, checkedInAt: { lte: asOf } },
    orderBy: { checkedInAt: "desc" },
    include: { invoice: true },
  });

  if (entries.length === 0) return [9999, 0, 0, 0];

  const last = entries[0];
  const daysSinceLastVisit = Math.floor((asOf.getTime() - last.checkedInAt.getTime()) / 86_400_000);
  const ninetyDaysAgo = new Date(asOf.getTime() - 90 * 86_400_000);
  const visitsLast90Days = entries.filter((e) => e.checkedInAt >= ninetyDaysAgo).length;
  const spends = entries.map((e) => e.invoice?.total ?? 0).filter((v) => v > 0);
  const totalSpend = spends.reduce((a, b) => a + b, 0);
  const avgSpend = spends.length ? totalSpend / spends.length : 0;

  return [daysSinceLastVisit, visitsLast90Days, avgSpend, totalSpend];
}

export async function computeMaintenanceFeatures(vehicleId: string, asOf: Date): Promise<number[]> {
  const inspections = await prisma.maintenanceInspection.findMany({
    where: { vehicleId, createdAt: { lte: asOf } },
    orderBy: { createdAt: "desc" },
  });

  if (inspections.length === 0) return [9999, 0, 0];

  const last = inspections[0];
  const daysSinceLastService = Math.floor((asOf.getTime() - last.createdAt.getTime()) / 86_400_000);
  const mileage = last.mileage ?? 0;

  return [daysSinceLastService, mileage, inspections.length];
}
