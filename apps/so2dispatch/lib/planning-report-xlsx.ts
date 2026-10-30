import "server-only";
import ExcelJS from "exceljs";
import { COLUMNS, soLines } from "@/lib/planning-report-pdf";
import type { ReadyLotEvent } from "@/lib/orders";

// Planning's report as Excel: the same SO lines and columns as the PDF, with
// the summary on top and a filterable table beneath.

type Row = Record<string, unknown>;

const HEAD_BG = "FF1F3864";
const RULE = "FFBFC9D9";
const GREEN = "FF047857";
const RED = "FFB91C1C";
const AMBER = "FFB45309";

// Excel widths (characters) for the PDF's columns, in its order.
const WIDTHS: Record<string, number> = {
  sl: 7, so: 18, soDate: 12, type: 10, ecs: 7, status: 22, readiness: 22, overdue: 10,
  dispatchTarget: 13, ld: 11, history: 26, lots: 30, remarks: 34, assembly: 22, dispatch: 18,
};

export async function buildPlanningReportXlsx(
  rows: Row[],
  filterLine: string,
  histories: Map<string, ReadyLotEvent[]> = new Map()
): Promise<Buffer> {
  const lines = soLines(rows, histories);
  const wb = new ExcelJS.Workbook();
  wb.creator = "Risansi SO to Dispatch";
  wb.created = new Date();
  const ws = wb.addWorksheet("Planning", { views: [{ state: "frozen", ySplit: 5 }] });
  const n = COLUMNS.length;

  const generated = new Date().toLocaleString("en-GB", {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata",
  });
  const title = ws.addRow(["Planning progress report"]);
  title.font = { bold: true, size: 14, color: { argb: HEAD_BG } };
  ws.mergeCells(1, 1, 1, n);
  const sub = ws.addRow([`${filterLine}  ·  generated ${generated} IST`]);
  sub.font = { size: 9, color: { argb: "FF6B7280" } };
  ws.mergeCells(2, 1, 2, n);

  // The summary: totals, as the PDF's tiles.
  const ecCount = lines.reduce((t, l) => t + l.ecs, 0);
  const summary: [string, number, string?][] = [
    ["SOs", lines.length],
    ["ECs", ecCount],
    ["Ready", lines.filter((l) => l.ready).length, GREEN],
    ["Overdue", lines.filter((l) => l.overdue > 0).length, RED],
    ["Date moved", lines.filter((l) => l.dateMoves > 0).length, AMBER],
  ];
  const sr = ws.addRow(summary.flatMap(([label, value]) => [label, value]));
  summary.forEach(([, , color], i) => {
    sr.getCell(i * 2 + 1).font = { bold: true, size: 9, color: { argb: "FF6B7280" } };
    sr.getCell(i * 2 + 2).font = { bold: true, size: 12, color: { argb: color ?? "FF111827" } };
    sr.getCell(i * 2 + 2).alignment = { horizontal: "left" };
  });
  ws.addRow([]);

  const head = ws.addRow(COLUMNS.map((c) => c.label));
  head.height = 30;
  head.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEAD_BG } };
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
  });
  COLUMNS.forEach((c, i) => (ws.getColumn(i + 1).width = WIDTHS[c.key] ?? 14));

  for (const l of lines) {
    const r = ws.addRow(
      COLUMNS.map((c) => {
        if (c.key === "overdue") return l.overdue > 0 ? l.overdue : null;
        if (c.key === "ecs") return l.ecs;
        const v = String(l[c.key] ?? "").trim();
        return v || null;
      })
    );
    r.alignment = { vertical: "top", wrapText: true };
    COLUMNS.forEach((c, i) => {
      const cell = r.getCell(i + 1);
      if (c.key === "so") cell.font = { bold: true };
      if (c.key === "overdue" && l.overdue > 0) cell.font = { bold: true, color: { argb: RED } };
      if (c.key === "history" && l.dateMoves > 0) cell.font = { color: { argb: AMBER } };
      if (c.key === "status" && l.ready) cell.font = { color: { argb: GREEN } };
      if (c.key === "dispatch")
        cell.font = { color: { argb: l.dispatch === "Fully dispatch" ? GREEN : l.dispatch === "LOT dispatch" ? "FF0369A1" : AMBER } };
    });
  }

  const headRow = 5;
  const last = ws.rowCount;
  for (let r = headRow; r <= last; r++) {
    ws.getRow(r).eachCell({ includeEmpty: true }, (cell) => {
      const side = { style: "thin" as const, color: { argb: RULE } };
      cell.border = { top: side, bottom: side, left: side, right: side };
    });
  }
  ws.autoFilter = { from: { row: headRow, column: 1 }, to: { row: Math.max(headRow, last), column: n } };
  ws.pageSetup = { orientation: "landscape", paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0 };

  return Buffer.from(await wb.xlsx.writeBuffer());
}
