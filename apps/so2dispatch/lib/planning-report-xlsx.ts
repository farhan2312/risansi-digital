import "server-only";
import ExcelJS from "exceljs";
import {
  COLUMNS,
  PUMP_COLUMNS,
  PUMP_SO_KEYS,
  pumpLines,
  pumpSummary,
  pumpTone,
  soLines,
  spareSummary,
  spareTone,
} from "@/lib/planning-report-pdf";
import type { ReadyLotEvent } from "@/lib/orders";

// Planning's report as Excel: the same lines, columns and colours as the PDF
// — Spare one row per SO, Pump one per pump EC (its SO's columns repeated on
// each, so the sheet filters cleanly) — the summary on top, a filterable
// table beneath.

type Row = Record<string, unknown>;

const HEAD_BG = "FF1F3864";
const RULE = "FFBFC9D9";
const TONES: Record<string, string> = { red: "FFB91C1C", green: "FF047857", amber: "FFB45309", blue: "FF0369A1", muted: "FF6B7280" };

// Excel widths (characters), by column key.
const WIDTHS: Record<string, number> = {
  sl: 7, so: 18, soDate: 12, type: 10, ecs: 7, status: 22, soStatus: 16, readiness: 22, overdue: 10,
  dispatchTarget: 13, ld: 11, history: 26, lots: 34, remarks: 34, assembly: 22, dispatch: 18,
  ec: 16, pump: 24, qty: 7, ready: 9, ecStatus: 18, boi: 13,
};
// Numbers stay numbers, to sum and sort.
const NUMERIC = new Set(["ecs", "qty", "overdue"]);

export async function buildPlanningReportXlsx(
  rows: Row[],
  filterLine: string,
  histories: Map<string, ReadyLotEvent[]> = new Map(),
  kind: "spare" | "pump" = "spare"
): Promise<Buffer> {
  if (kind === "pump") {
    const lines = pumpLines(rows, histories);
    return sheet("Pump planning report", filterLine, pumpSummary(lines), PUMP_COLUMNS, lines, pumpTone, (l) => l.first);
  }
  const lines = soLines(rows, histories);
  return sheet("Spare planning report", filterLine, spareSummary(lines), COLUMNS, lines, spareTone);
}

async function sheet<L>(
  title: string,
  filterLine: string,
  summary: { tiles: { label: string; value: number; tone?: string }[]; counts: { label: string; text: string }[] },
  columns: { label: string; key: keyof L & string }[],
  lines: L[],
  tone: (l: L, key: string) => string | undefined,
  first?: (l: L) => boolean
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Risansi SO to Dispatch";
  wb.created = new Date();
  const ws = wb.addWorksheet("Planning");
  const n = columns.length;

  const generated = new Date().toLocaleString("en-GB", {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata",
  });
  const t = ws.addRow([title]);
  t.height = 24;
  t.getCell(1).font = { bold: true, size: 14, color: { argb: "FFFFFFFF" } };
  t.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEAD_BG } };
  t.getCell(1).alignment = { vertical: "middle", indent: 1 };
  ws.mergeCells(1, 1, 1, n);
  const sub = ws.addRow([`${filterLine}  ·  generated ${generated} IST`]);
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

  const head = ws.addRow(columns.map((c) => c.label));
  const headRow = head.number;
  head.height = 30;
  head.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEAD_BG } };
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
  });
  columns.forEach((c, i) => (ws.getColumn(i + 1).width = WIDTHS[c.key] ?? 14));
  ws.views = [{ state: "frozen", ySplit: headRow }];

  for (const l of lines) {
    const r = ws.addRow(
      columns.map((c) => {
        const v = l[c.key];
        if (NUMERIC.has(c.key)) return Number(v) > 0 ? Number(v) : null;
        const s = v === null || v === undefined ? "" : String(v).trim();
        return s || null;
      })
    );
    r.alignment = { vertical: "top", wrapText: true };
    // A pump SO's later EC lines: its columns in grey, so each SO reads as one.
    const later = first ? !first(l) : false;
    columns.forEach((c, i) => {
      const cell = r.getCell(i + 1);
      const tn = tone(l, c.key);
      const bold = c.key === "so" || c.key === "ec" || tn === "red";
      const color = later && PUMP_SO_KEYS.has(c.key) ? TONES.muted : tn ? TONES[tn] : undefined;
      if (bold || color) cell.font = { bold, ...(color ? { color: { argb: color } } : {}) };
    });
  }

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
