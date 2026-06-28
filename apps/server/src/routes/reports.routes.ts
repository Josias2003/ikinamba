import { Router } from "express";
import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";
import { authenticate, requireRole } from "../middleware/auth.js";
import { asyncHandler } from "../lib/asyncHandler.js";
import { getDashboardMetrics, getCustomerRetention } from "../services/reports.service.js";

export const reportsRouter = Router();
reportsRouter.use(authenticate, requireRole("ADMIN", "MANAGER"));

reportsRouter.get(
  "/dashboard",
  asyncHandler(async (req, res) => {
    const days = Number(req.query.days ?? 30);
    const [metrics, retention] = await Promise.all([getDashboardMetrics(days), getCustomerRetention()]);
    res.json({ ...metrics, retention });
  })
);

reportsRouter.get(
  "/export/excel",
  asyncHandler(async (req, res) => {
    const metrics = await getDashboardMetrics(Number(req.query.days ?? 30));
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
  asyncHandler(async (req, res) => {
    const metrics = await getDashboardMetrics(Number(req.query.days ?? 30));
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
