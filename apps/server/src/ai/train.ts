import { prisma } from "../lib/prisma.js";
import { logger } from "../lib/logger.js";
import { trainLogisticRegression, saveModel } from "./logisticRegression.js";
import { CHURN_FEATURE_NAMES, MAINTENANCE_FEATURE_NAMES, computeChurnFeatures, computeMaintenanceFeatures } from "./features.js";

const DAY_MS = 86_400_000;

/** Builds a forward-looking labeled dataset from the seeded history: for each customer, pick several
 * cutoff dates within their visit history, compute features using only data up to that cutoff, and label
 * 1 ("churned") if they did NOT return within the next CHURN_WINDOW_DAYS. This avoids label leakage
 * (label depends only on what happens *after* the cutoff, features only on what happened *before* it). */
const CHURN_WINDOW_DAYS = 45;
const MAINTENANCE_WINDOW_DAYS = 30;

export async function trainChurnModel() {
  const customers = await prisma.customer.findMany({
    include: { queueEntries: { orderBy: { checkedInAt: "asc" } } },
  });

  const features: number[][] = [];
  const labels: number[] = [];

  const now = new Date();

  for (const customer of customers) {
    const visits = customer.queueEntries;
    if (visits.length < 2) continue;

    // Every visit is a candidate cutoff -- including the last one. Excluding the last visit was
    // the original bug: it meant a customer who visited once and never came back (the clearest
    // churn signal there is) never produced a label, because we only checked for a *next visit
    // within the dataset* rather than "did 45 days pass with no return, as of today." Skip cutoffs
    // where the 45-day window hasn't fully elapsed yet -- the outcome isn't knowable yet (censored).
    for (let i = 0; i < visits.length; i++) {
      const cutoff = visits[i].checkedInAt;
      const windowEnd = new Date(cutoff.getTime() + CHURN_WINDOW_DAYS * DAY_MS);
      if (windowEnd > now) continue;

      const returned = visits.some((v) => v.checkedInAt > cutoff && v.checkedInAt <= windowEnd);

      const f = await computeChurnFeatures(customer.id, cutoff);
      features.push(f);
      labels.push(returned ? 0 : 1);
    }
  }

  if (features.length < 10) {
    logger.warn("Not enough historical data to train churn model meaningfully");
    return;
  }

  const model = trainLogisticRegression(features, labels, CHURN_FEATURE_NAMES);
  saveModel("churn", model);
  logger.info(`Trained churn model on ${model.trainingSize} samples`);
}

export async function trainMaintenanceModel() {
  const vehicles = await prisma.vehicle.findMany({
    include: { inspections: { orderBy: { createdAt: "asc" } } },
  });

  const features: number[][] = [];
  const labels: number[] = [];

  const now = new Date();

  for (const vehicle of vehicles) {
    const inspections = vehicle.inspections;
    if (inspections.length < 2) continue;

    for (let i = 0; i < inspections.length; i++) {
      const cutoff = inspections[i].createdAt;
      const windowEnd = new Date(cutoff.getTime() + MAINTENANCE_WINDOW_DAYS * DAY_MS);
      if (windowEnd > now) continue;

      const serviceDueSoon = inspections.some((insp) => insp.createdAt > cutoff && insp.createdAt <= windowEnd);

      const f = await computeMaintenanceFeatures(vehicle.id, cutoff);
      features.push(f);
      labels.push(serviceDueSoon ? 1 : 0);
    }
  }

  if (features.length < 10) {
    logger.warn("Not enough historical data to train maintenance model meaningfully");
    return;
  }

  const model = trainLogisticRegression(features, labels, MAINTENANCE_FEATURE_NAMES);
  saveModel("maintenance", model);
  logger.info(`Trained maintenance model on ${model.trainingSize} samples`);
}

export async function trainAllModels() {
  await trainChurnModel();
  await trainMaintenanceModel();
}
