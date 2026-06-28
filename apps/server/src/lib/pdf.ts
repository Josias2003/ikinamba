import type PDFKit from "pdfkit";

type PDFDocument = InstanceType<typeof PDFKit>;

const BRAND = "#1ea696";
const BRAND_DARK = "#13847a";
const INK_DARK = "#161c1f";
const ROW_ALT = "#f0f4f3";
const BORDER = "#d0d8da";

/** Colored header band with the business name + report title -- replaces the plain
 * centered-text title every export previously used. Leaves the cursor (doc.y) just below
 * the band so normal content can follow immediately. */
export function pdfHeader(doc: PDFDocument, title: string, subtitle?: string) {
  const pageWidth = doc.page.width;
  doc.rect(0, 0, pageWidth, 80).fill(BRAND);
  doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(16).text("New Class Car Wash", 50, 22, { lineBreak: false });
  doc.font("Helvetica").fontSize(9).text("IKINAMBA Management System", 50, 44, { lineBreak: false });
  doc.font("Helvetica-Bold").fontSize(13).text(title, 0, 22, { align: "right", width: pageWidth - 50 });
  if (subtitle) doc.font("Helvetica").fontSize(9).text(subtitle, 0, 44, { align: "right", width: pageWidth - 50 });
  doc.fillColor(INK_DARK).font("Helvetica");
  doc.x = doc.page.margins.left;
  doc.y = 100;
}

export function pdfSectionTitle(doc: PDFDocument, text: string) {
  doc.moveDown(0.6);
  doc.fillColor(BRAND_DARK).font("Helvetica-Bold").fontSize(13).text(text);
  doc.fillColor(INK_DARK).font("Helvetica").fontSize(10);
  doc.moveDown(0.2);
}

/** A real ruled table (header band + alternating row shading + outer border) instead of
 * a bulleted list -- PDFKit has no built-in table primitive, so rows/columns are drawn
 * manually. Breaks across pages when a table runs past the bottom margin. */
export function pdfTable(doc: PDFDocument, headers: string[], rows: (string | number)[][], colWidths?: number[]) {
  const tableWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const widths = colWidths ?? headers.map(() => tableWidth / headers.length);
  const rowHeight = 22;
  const startX = doc.page.margins.left;
  let y = doc.y;
  const tableTop = y;

  function drawHeaderRow() {
    doc.rect(startX, y, tableWidth, rowHeight).fill(BRAND);
    doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(9);
    let x = startX;
    headers.forEach((h, i) => {
      doc.text(h, x + 6, y + 6, { width: widths[i] - 12, lineBreak: false });
      x += widths[i];
    });
    y += rowHeight;
  }

  drawHeaderRow();
  doc.font("Helvetica").fontSize(9);

  rows.forEach((row, rIdx) => {
    if (y > doc.page.height - doc.page.margins.bottom - rowHeight) {
      doc.addPage();
      y = doc.page.margins.top;
      drawHeaderRow();
      doc.font("Helvetica").fontSize(9);
    }
    if (rIdx % 2 === 1) doc.rect(startX, y, tableWidth, rowHeight).fill(ROW_ALT);
    doc.fillColor(INK_DARK);
    let x = startX;
    row.forEach((cell, i) => {
      doc.text(String(cell), x + 6, y + 6, { width: widths[i] - 12, lineBreak: false });
      x += widths[i];
    });
    y += rowHeight;
  });

  doc.rect(startX, tableTop, tableWidth, y - tableTop).stroke(BORDER);
  doc.x = startX;
  doc.y = y + 14;
}

/** Compact metric cards in a row (e.g. total revenue / vehicles serviced) -- a lighter
 * alternative to a full table for a handful of headline numbers. */
export function pdfMetricRow(doc: PDFDocument, metrics: { label: string; value: string }[]) {
  const tableWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const cardWidth = tableWidth / metrics.length - 8;
  const cardHeight = 50;
  const startX = doc.page.margins.left;
  const y = doc.y;
  metrics.forEach((m, i) => {
    const x = startX + i * (cardWidth + 8);
    doc.rect(x, y, cardWidth, cardHeight).fillAndStroke(ROW_ALT, BORDER);
    doc.fillColor(BRAND_DARK).font("Helvetica-Bold").fontSize(13).text(m.value, x + 8, y + 10, { width: cardWidth - 16, lineBreak: false });
    doc.fillColor(INK_DARK).font("Helvetica").fontSize(8).text(m.label.toUpperCase(), x + 8, y + 30, { width: cardWidth - 16, lineBreak: false });
  });
  doc.x = startX;
  doc.y = y + cardHeight + 16;
}

export function pdfFooter(doc: PDFDocument) {
  // Must stay inside the bottom margin -- PDFKit auto-inserts a blank page if a text
  // draw's y position falls past `page.height - margins.bottom`, even with explicit
  // coordinates, so this can't just sit a few px above the physical page edge.
  const bottom = doc.page.height - doc.page.margins.bottom - 20;
  doc
    .fontSize(8)
    .fillColor("#8a9499")
    .text(`Generated ${new Date().toLocaleString()} -- New Class Car Wash / IKINAMBA`, 0, bottom, {
      align: "center",
      width: doc.page.width,
    });
}
