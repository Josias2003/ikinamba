import cron from "node-cron";
import { logger } from "../lib/logger.js";
import { sendAppointmentReminders } from "./appointmentReminders.js";
import { checkLowStock } from "./lowStockCheck.js";
import { recomputeCustomerInsights } from "../ai/scoring.js";
import { runDailyBackup } from "./backup.js";

export function startCronJobs() {
  // Every 15 min: send reminders for appointments coming up soon.
  cron.schedule("*/15 * * * *", () => sendAppointmentReminders().catch((e) => logger.error(e)));

  // Hourly: flag inventory items below reorder threshold.
  cron.schedule("0 * * * *", () => checkLowStock().catch((e) => logger.error(e)));

  // Nightly at 02:00: recompute churn-risk / maintenance-due scores for all customers.
  cron.schedule("0 2 * * *", () => recomputeCustomerInsights().catch((e) => logger.error(e)));

  // Nightly at 01:00: snapshot the database (14-day retention).
  cron.schedule("0 1 * * *", () => runDailyBackup().catch((e) => logger.error(e)));

  logger.info("Cron jobs scheduled (reminders, low-stock, AI insight recompute, nightly backup)");
}
