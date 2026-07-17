import { Router } from "express";
import type { Request } from "express";
import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";
import { authenticate, requireRole } from "../middleware/auth.js";
import { asyncHandler } from "../lib/asyncHandler.js";
import { badRequest } from "../lib/errors.js";
import { pdfHeader, pdfSectionTitle, pdfTable, pdfMetricRow, pdfFooter } from "../lib/pdf.js";
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

const ROLE_REPORT_TITLE: Record<string, string> = {
  CASHIER: "Cashier Activity Report",
  RECEPTIONIST: "Receptionist Activity Report",
  TECHNICIAN: "Technician Activity Report",
};

reportsRouter.get(
  "/my/export/pdf",
  requireRole("CASHIER", "RECEPTIONIST", "TECHNICIAN"),
  asyncHandler(async (req, res) => {
    const role = req.user!.role;
    const report: any = await myReportFor(role, req.user!.sub, resolveRange(req));
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", "attachment; filename=my-report.pdf");

    const doc = new PDFDocument({ margin: 50 });
    doc.pipe(res);
    pdfHeader(doc, ROLE_REPORT_TITLE[role] ?? "My Report", `${report.since} to ${report.until}`);

    if (role === "CASHIER") {
      pdfMetricRow(doc, [
        { label: "Invoices created", value: String(report.invoicesCreated) },
        { label: "Total collected", value: `RWF ${Math.round(report.totalCollected).toLocaleString()}` },
      ]);
      pdfSectionTitle(doc, "Payments by method");
      pdfTable(
        doc,
        ["Method", "Amount (RWF)"],
        report.paymentsByMethod.map((m: any) => [m.method, Math.round(m.amount).toLocaleString()])
      );
      pdfSectionTitle(doc, "Payments recorded");
      pdfTable(
        doc,
        ["Time", "Customer", "Method", "Amount"],
        report.payments.map((p: any) => [new Date(p.paidAt).toLocaleString(), p.customer, p.method, Math.round(p.amount).toLocaleString()])
      );
    } else if (role === "RECEPTIONIST") {
      pdfMetricRow(doc, [
        { label: "Appointment check-ins", value: String(report.appointmentCheckIns) },
        { label: "Walk-ins checked in", value: String(report.walkInCheckIns) },
      ]);
      pdfSectionTitle(doc, "Check-in details");
      pdfTable(
        doc,
        ["Time", "Source", "Customer", "Plate", "Status"],
        report.checkIns.map((c: any) => [new Date(c.checkedInAt).toLocaleString(), c.source, c.customer, c.plate, c.status])
      );
    } else if (role === "TECHNICIAN") {
      pdfMetricRow(doc, [
        { label: "Jobs assigned", value: String(report.jobsAssigned) },
        { label: "Jobs completed", value: String(report.jobsCompleted) },
        { label: "Avg. service time", value: `${report.avgServiceMinutes}m` },
        { label: "QC sign-offs", value: String(report.qcSignOffs) },
      ]);
      pdfSectionTitle(doc, "Revenue generated");
      doc.fontSize(11).text(`RWF ${Math.round(report.revenueGenerated).toLocaleString()} from completed jobs in this range.`);
      pdfSectionTitle(doc, "Job details");
      pdfTable(
        doc,
        ["Vehicle", "Customer", "Services", "Status", "Duration"],
        report.jobs.map((j: any) => [j.plate, j.customer, j.services.join(", "), j.status, j.durationMinutes == null ? "-" : `${j.durationMinutes}m`])
      );
    }

    pdfFooter(doc);
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

    const revenueDetailSheet = workbook.addWorksheet("Revenue Details");
    revenueDetailSheet.addRow(["Date", "Customer", "Vehicle", "Services", "Status", "Total (RWF)"]);
    metrics.revenueDetails.forEach((r) =>
      revenueDetailSheet.addRow([r.date, r.customer, r.vehicle, r.services.join(", "), r.status, r.total])
    );

    const vehiclesSheet = workbook.addWorksheet("Vehicles Serviced");
    vehiclesSheet.addRow(["Checked In", "Customer", "Vehicle", "Plate", "Technician", "Services", "Status", "Invoice Status"]);
    metrics.vehicleDetails.forEach((v) =>
      vehiclesSheet.addRow([v.checkedInAt, v.customer, v.vehicle, v.plate, v.technician ?? "", v.services.join(", "), v.status, v.invoiceStatus ?? ""])
    );

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
    const range = resolveRange(req);
    const metrics = await getDashboardMetrics(range);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", "attachment; filename=ikinamba-report.pdf");

    const doc = new PDFDocument({ margin: 50 });
    doc.pipe(res);
    pdfHeader(doc, "Operations Report", `${range.since.toLocaleDateString()} to ${range.until.toLocaleDateString()}`);

    pdfMetricRow(doc, [
      { label: "Vehicles serviced", value: String(metrics.vehiclesServiced) },
      { label: "Total revenue", value: `RWF ${Math.round(metrics.totalRevenue).toLocaleString()}` },
      { label: "Avg. service time", value: `${metrics.avgServiceMinutes}m` },
    ]);

    pdfSectionTitle(doc, "Service popularity");
    pdfTable(
      doc,
      ["Service", "Times performed"],
      metrics.servicePopularity.map((s) => [s.name, s.count])
    );

    pdfSectionTitle(doc, "Staff productivity");
    pdfTable(
      doc,
      ["Staff email", "Jobs completed"],
      metrics.staffProductivity.map((s) => [s.email, s.count])
    );

    pdfSectionTitle(doc, "Revenue details");
    pdfTable(
      doc,
      ["Date", "Customer", "Vehicle", "Total"],
      metrics.revenueDetails.slice(0, 20).map((r) => [new Date(r.date).toLocaleDateString(), r.customer, r.vehicle, Math.round(r.total).toLocaleString()])
    );

    pdfSectionTitle(doc, "Vehicles serviced");
    pdfTable(
      doc,
      ["Check-in", "Customer", "Plate", "Status"],
      metrics.vehicleDetails.slice(0, 20).map((v) => [new Date(v.checkedInAt).toLocaleDateString(), v.customer, v.plate, v.status])
    );

    pdfFooter(doc);
    doc.end();
  })
);
