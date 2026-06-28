import { Router } from "express";
import type { Request } from "express";
import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";
import { authenticate, requireRole } from "../middleware/auth.js";
import { asyncHandler } from "../lib/asyncHandler.js";
import { badRequest } from "../lib/errors.js";
import {
  getDashboardMetrics,
  getCustomerRetention,
  getCashierReport,
  getReceptionistReport,
  getTechnicianReport,
  defaultRange,
  type DateRange,
} from "../services/reports.service.js";

export const reportsRouter = Router();
reportsRouter.use(authenticate);

/** Real custom range from ?since=YYYY-MM-DD&until=YYYY-MM-DD, falling back to the
 * trailing 30 days when absent -- the frontend's week/month/quarter buttons are just
 * sugar that compute concrete since/until dates before calling these endpoints, so the
 * backend only ever has to understand one thing: an explicit date range. */
function resolveRange(req: Request): DateRange {
  const { since, until } = req.query as { since?: string; until?: string };
  if (!since && !until) return defaultRange();
  return {
    since: since ? new Date(since) : new Date(Date.now() - 30 * 86_400_000),
    until: until ? new Date(`${until}T23:59:59`) : new Date(),
  };
}

async function myReportFor(role: string, userId: string, range: DateRange) {
  if (role === "CASHIER") return getCashierReport(userId, range);
  if (role === "RECEPTIONIST") return getReceptionistReport(userId, range);
  if (role === "TECHNICIAN") return getTechnicianReport(userId, range);
  throw badRequest("No report defined for this role");
}

// Each staff role's own report -- CASHIER/RECEPTIONIST/TECHNICIAN never had a
// meaningful report before this; MANAGER/ADMIN keep using the full /dashboard below.
reportsRouter.get(
  "/my",
  requireRole("CASHIER", "RECEPTIONIST", "TECHNICIAN"),
  asyncHandler(async (req, res) => {
    res.json(await myReportFor(req.user!.role, req.user!.sub, resolveRange(req)));
  })
);

reportsRouter.get(
  "/my/export/excel",
  requireRole("CASHIER", "RECEPTIONIST", "TECHNICIAN"),
  asyncHandler(async (req, res) => {
    const report = await myReportFor(req.user!.role, req.user!.sub, resolveRange(req));
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("My Report");
    sheet.addRow(["Metric", "Value"]);
    Object.entries(report).forEach(([key, value]) => {
      if (Array.isArray(value)) return; // breakdown arrays (e.g. paymentsByMethod) get their own block below
      sheet.addRow([key, value as any]);
    });
    for (const [key, value] of Object.entries(report)) {
      if (!Array.isArray(value)) continue;
      sheet.addRow([]);
      sheet.addRow([key]);
      value.forEach((row: Record<string, unknown>) => sheet.addRow(Object.values(row)));
    }
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", "attachment; filename=my-report.xlsx");
    await workbook.xlsx.write(res);
    res.end();
  })
);

reportsRouter.get(
  "/my/export/pdf",
  requireRole("CASHIER", "RECEPTIONIST", "TECHNICIAN"),
  asyncHandler(async (req, res) => {
    const report: any = await myReportFor(req.user!.role, req.user!.sub, resolveRange(req));
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", "attachment; filename=my-report.pdf");

    const doc = new PDFDocument({ margin: 50 });
    doc.pipe(res);
    doc.fontSize(20).text("My Report", { align: "center" });
    doc.fontSize(11).text(`${report.since} to ${report.until}`, { align: "center" });
    doc.moveDown();
    doc.fontSize(12);
    Object.entries(report).forEach(([key, value]) => {
      if (key === "since" || key === "until") return;
      if (Array.isArray(value)) {
        doc.text(`${key}:`);
        value.forEach((row: Record<string, unknown>) => doc.text(`  - ${Object.values(row).join(": ")}`));
      } else {
        doc.text(`${key}: ${value}`);
      }
    });
    doc.end();
  })
);

reportsRouter.get(
  "/dashboard",
  requireRole("ADMIN", "MANAGER"),
  asyncHandler(async (req, res) => {
    const range = resolveRange(req);
    const [metrics, retention] = await Promise.all([getDashboardMetrics(range), getCustomerRetention()]);
    res.json({ ...metrics, retention });
  })
);

reportsRouter.get(
  "/export/excel",
  requireRole("ADMIN", "MANAGER"),
  asyncHandler(async (req, res) => {
    const metrics = await getDashboardMetrics(resolveRange(req));
    const workbook = new ExcelJS.Workbook();

    const revenueSheet = workbook.addWorksheet("Revenue");
    revenueSheet.addRow(["Date", "Total (RWF)"]);
    metrics.revenueByDay.forEach((r) => revenueSheet.addRow([r.date, r.total]));

    const popularitySheet = workbook.addWorksheet("Service Popularity");
    popularitySheet.addRow(["Service", "Count"]);
    metrics.servicePopularity.forEach((s) => popularitySheet.addRow([s.name, s.count]));

    const staffSheet = workbook.addWorksheet("Staff Productivity");
    staffSheet.addRow(["Staff Email", "Jobs Completed"]);
    metrics.staffProductivity.forEach((s) => staffSheet.addRow([s.email, s.count]));

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", "attachment; filename=ikinamba-report.xlsx");
    await workbook.xlsx.write(res);
    res.end();
  })
);

reportsRouter.get(
  "/export/pdf",
  requireRole("ADMIN", "MANAGER"),
  asyncHandler(async (req, res) => {
    const metrics = await getDashboardMetrics(resolveRange(req));
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", "attachment; filename=ikinamba-report.pdf");

    const doc = new PDFDocument({ margin: 50 });
    doc.pipe(res);

    doc.fontSize(20).text("IKINAMBA Operations Report", { align: "center" });
    doc.moveDown();
    doc.fontSize(12).text(`Generated: ${new Date().toLocaleString()}`);
    doc.text(`Vehicles serviced: ${metrics.vehiclesServiced}`);
    doc.text(`Total revenue: RWF ${metrics.totalRevenue.toLocaleString()}`);
    doc.text(`Average service duration: ${metrics.avgServiceMinutes} minutes`);
    doc.moveDown();

    doc.fontSize(14).text("Service Popularity");
    doc.fontSize(11);
    metrics.servicePopularity.forEach((s) => doc.text(`- ${s.name}: ${s.count}`));
    doc.moveDown();

    doc.fontSize(14).text("Staff Productivity");
    doc.fontSize(11);
    metrics.staffProductivity.forEach((s) => doc.text(`- ${s.email}: ${s.count} jobs`));

    doc.end();
  })
);
