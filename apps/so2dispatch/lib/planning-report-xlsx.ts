import "server-only";
import ExcelJS from "exceljs";
import type { ReportSheet } from "@/lib/planning-report-sheet";

// Planning's report as Excel, from its sheet (lib/planning-report-sheet): a
// title band, the summary, then a filterable table — group bands over the
// header where the sheet has them, colours as on screen.

const HEAD_BG = "FF1F3864";
const GROUP_BG = "FF2F5496";
const RULE = "FFBFC9D9";
const TONES: Record<string, string> = { red: "FFB91C1C", green: "FF047857", amber: "FFB45309", blue: "FF0369A1", muted: "FF6B7280" };

export async function buildPlanningReportXlsx(sheet: ReportSheet): Promise<Buffer> {
  const { columns, rows, summary } = sheet;
  const wb = new ExcelJS.Workbook();
  wb.creator = "Risansi SO to Dispatch";
  wb.created = new Date();
  const ws = wb.addWorksheet("Planning");
  const n = columns.length;

  const generated = new Date().toLocaleString("en-GB", {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata",
  });
  const t = ws.addRow([sheet.title]);
  t.height = 24;
  t.getCell(1).font = { bold: true, size: 14, color: { argb: "FFFFFFFF" } };
  t.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEAD_BG } };
  t.getCell(1).alignment = { vertical: "middle", indent: 1 };
  ws.mergeCells(1, 1, 1, n);
  const sub = ws.addRow([`${sheet.filterLine}  ·  generated ${generated} IST`]);
  sub.font = { size: 9, color: { argb: TONES.muted } };
  ws.mergeCells(2, 1, 2, n);

  // The summary: the PDF's tiles, label then value, side by side.
  const sr = ws.addRow(summary.tiles.flatMap((x) => [x.label, x.value]));
  summary.tiles.forEach((x, i) => {
    sr.getCell(i * 2 + 1).font = { bold: true, size: 9, color: { argb: TONES.muted } };
    sr.getCell(i * 2 + 2).font = { bold: true, size: 12, color: { argb: x.tone ? TONES[x.tone] : "FF111827" } };
    sr.getCell(i * 2 + 2).alignment = { horizontal: "left" };
  });
  for (const c of summary.counts) {
    if (!c.text) continue;
    const r = ws.addRow([`${c.label}:  ${c.text}`]);
    r.font = { size: 9 };
    ws.mergeCells(r.number, 1, r.number, n);
  }
  ws.addRow([]);

  // A band naming each group of columns, above the header.
  const side = { style: "thin" as const, color: { argb: RULE } };
  if (columns.some((c) => c.group)) {
    const g = ws.addRow(columns.map((c) => c.group ?? ""));
    let start = 0;
    for (let i = 1; i <= n; i++) {
      if (i === n || columns[i].group !== columns[start].group) {
        if (i - 1 > start) ws.mergeCells(g.number, start + 1, g.number, i);
        start = i;
      }
    }
    g.eachCell({ includeEmpty: true }, (cell) => {
      cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: GROUP_BG } };
      cell.alignment = { vertical: "middle", horizontal: "center" };
      cell.border = { top: side, bottom: side, left: side, right: side };
    });
  }
  const head = ws.addRow(columns.map((c) => c.label));
  const headRow = head.number;
  head.height = 30;
  head.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEAD_BG } };
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
  });
  columns.forEach((c, i) => (ws.getColumn(i + 1).width = c.width));
  ws.views = [{ state: "frozen", ySplit: headRow, xSplit: 2 }];

  for (const line of rows) {
    const r = ws.addRow(line.cells);
    r.alignment = { vertical: "top", wrapText: true };
    line.cells.forEach((_, i) => {
      // A pump SO's later EC rows: its SO's columns in grey, so each SO reads as one.
      const dim = line.repeat && i < (sheet.soColumns ?? 0);
      const tone = dim ? "muted" : line.tones[i];
      if (line.bold[i] || tone) r.getCell(i + 1).font = { bold: line.bold[i] && !dim, ...(tone ? { color: { argb: TONES[tone] } } : {}) };
    });
  }

  const last = ws.rowCount;
  for (let r = headRow; r <= last; r++) {
    ws.getRow(r).eachCell({ includeEmpty: true }, (cell) => {
      cell.border = { top: side, bottom: side, left: side, right: side };
    });
  }
  ws.autoFilter = { from: { row: headRow, column: 1 }, to: { row: Math.max(headRow, last), column: n } };
  ws.pageSetup = { orientation: "landscape", paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0 };

  return Buffer.from(await wb.xlsx.writeBuffer());
}
