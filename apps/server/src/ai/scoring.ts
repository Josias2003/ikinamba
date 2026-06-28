import { prisma } from "../lib/prisma.js";
import { logger } from "../lib/logger.js";
import { loadModel, scoreWithModel } from "./logisticRegression.js";
import { computeChurnFeatures, computeMaintenanceFeatures } from "./features.js";

const riskLabel = (score: number): "LOW" | "MEDIUM" | "HIGH" => (score < 0.33 ? "LOW" : score < 0.66 ? "MEDIUM" : "HIGH");

/** Recomputes churn-risk and predictive-maintenance scores for every customer and caches them
 * in CustomerInsight. Run nightly via cron and on-demand from the AI dashboard. */
export async function recomputeCustomerInsights() {
  const churnModel = loadModel("churn");
  const maintenanceModel = loadModel("maintenance");
  if (!churnModel || !maintenanceModel) {
    logger.warn("AI models not trained yet -- run `npm run db:seed` to train them, skipping insight recompute");
    return;
  }

  const customers = await prisma.customer.findMany({ include: { vehicles: true } });
  const now = new Date();
  let updated = 0;

  for (const customer of customers) {
    const churnFeatures = await computeChurnFeatures(customer.id, now);
    const churnRisk = scoreWithModel(churnModel, churnFeatures);

    let maintenanceDueScore = 0;
    for (const vehicle of customer.vehicles) {
      const features = await computeMaintenanceFeatures(vehicle.id, now);
      maintenanceDueScore = Math.max(maintenanceDueScore, scoreWithModel(maintenanceModel, features));
    }

    await prisma.customerInsight.upsert({
      where: { customerId: customer.id },
      create: {
        customerId: customer.id,
        churnRisk,
        churnRiskLabel: riskLabel(churnRisk),
        maintenanceDueScore,
      },
      update: {
        churnRisk,
        churnRiskLabel: riskLabel(churnRisk),
        maintenanceDueScore,
        lastComputedAt: now,
      },
    });
    updated++;
  }

  logger.info(`Recomputed AI insights for ${updated} customer(s)`);
  return updated;
}

export async function scoreSingleCustomer(customerId: string) {
  const churnModel = loadModel("churn");
  if (!churnModel) return null;
  const features = await computeChurnFeatures(customerId, new Date());
  const churnRisk = scoreWithModel(churnModel, features);
  return { churnRisk, churnRiskLabel: riskLabel(churnRisk) };
}
