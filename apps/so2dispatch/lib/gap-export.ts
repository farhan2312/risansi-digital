// The Details-not-filled sheet as Excel, to fill in: a row per SO, a column
// per field missing anywhere — the blank cells to fill in yellow, those that
// do not apply to the SO grey "N/A", what is there already as it stands, and
// a drop-down on each choice field.

import ExcelJS from "exceljs";
import type { GapSheet } from "@/lib/order-gaps";

const HEAD_BG = "FF1F3864";
const GROUP_BG = "FF2F5496";
const KEY_BG = "FFEAF0F8";
const MISS_BG = "FFFFF2CC";
const MISS_EDGE = "FFF4B183";
const NA_BG = "FFF2F2F2";
const RULE = "FFBFC9D9";

const KEYS = [
  { header: "Sl. No.", width: 8 },
  { header: "SO No.", width: 16 },
  { header: "SO Date", width: 12 },
  { header: "Type", width: 9 },
  { header: "Client Code", width: 13 },
  { header: "Client Name", width: 30 },
  { header: "Missing", width: 9 },
];

const isDate = (t: string) => t === "date";
const isNumber = (t: string) => t === "number" || t === "int";

export function buildGapWorkbook(sheet: GapSheet, scope: string): ExcelJS.Workbook {
  return buildGapWorkbookSheets([{ name: "Details not filled", sheet, scope }]);
}

/** One worksheet per part (Pump, Spare…), each laid out as buildGapWorkbook's. */
export function buildGapWorkbookSheets(parts: { name: string; sheet: GapSheet; scope: string }[]): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Risansi SO to Dispatch";
  wb.created = new Date();
  for (const p of parts) addGapSheet(wb, p.name, p.sheet, p.scope);
  return wb;
}

function addGapSheet(wb: ExcelJS.Workbook, name: string, sheet: GapSheet, scope: string): void {
  const ws = wb.addWorksheet(name, {
    views: [{ state: "frozen", xSplit: 2, ySplit: 3 }],
  });
  const total = KEYS.length + sheet.columns.length;

  // 1: what the sheet is, and how to read it.
  const title = ws.addRow([`Details not filled — ${scope} · ${sheet.rows.length} SOs · yellow = to fill, grey N/A = does not apply`]);
  title.font = { bold: true, size: 12, color: { argb: "FF1F3864" } };
  title.height = 22;
  ws.mergeCells(1, 1, 1, total);

  // 2: the groups (Client, Purchase Order…) over their fields; 3: the fields.
  const groupRow = ws.addRow([...KEYS.map(() => ""), ...sheet.columns.map((c) => c.group)]);
  const headRow = ws.addRow([...KEYS.map((k) => k.header), ...sheet.columns.map((c) => c.label)]);
  ws.mergeCells(2, 1, 2, KEYS.length);
  groupRow.getCell(1).value = "SO";
  let start = KEYS.length + 1;
  for (let i = 1; i <= sheet.columns.length; i++) {
    const g = sheet.columns[i - 1].group;
    const next = sheet.columns[i]?.group;
    if (next !== g) {
      const end = KEYS.length + i;
      if (end > start) ws.mergeCells(2, start, 2, end);
      start = end + 1;
    }
  }
  for (const [row, bg] of [
    [groupRow, GROUP_BG],
    [headRow, HEAD_BG],
  ] as const) {
    row.height = row === headRow ? 42 : 20;
    row.eachCell({ includeEmpty: true }, (cell) => {
      cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: row === headRow ? 10 : 11 };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: bg } };
      cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
      cell.border = { left: { style: "thin", color: { argb: "FFFFFFFF" } }, right: { style: "thin", color: { argb: "FFFFFFFF" } } };
    });
  }

  KEYS.forEach((k, i) => (ws.getColumn(i + 1).width = k.width));
  sheet.columns.forEach((c, i) => {
    const col = ws.getColumn(KEYS.length + i + 1);
    col.width = Math.min(30, Math.max(12, c.label.length * 0.9));
    if (isDate(c.type)) col.numFmt = "dd-mmm-yyyy";
  });

  for (const r of sheet.rows) {
    const values: (string | number | Date | null)[] = [
      r.sl_no,
      r.so_no,
      r.so_date ? new Date(r.so_date) : null,
      r.order_type,
      r.client_code,
      r.client_name,
      r.missing,
    ];
    for (const c of sheet.columns) {
      const cell = r.cells[c.column];
      if (!cell || cell.s === "na") values.push("N/A");
      else if (cell.s === "miss") values.push(null);
      else if (isDate(c.type) && cell.v) values.push(new Date(cell.v));
      else if (isNumber(c.type) && cell.v && Number.isFinite(Number(cell.v))) values.push(Number(cell.v));
      else values.push(cell.v);
    }
    const row = ws.addRow(values);
    row.alignment = { vertical: "top", wrapText: true };
    for (let i = 1; i <= KEYS.length; i++) {
      const cell = row.getCell(i);
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: KEY_BG } };
      if (i === 2) cell.font = { bold: true };
    }
    row.getCell(3).numFmt = "dd-mmm-yyyy";
    row.getCell(7).font = { bold: true, color: { argb: "FFC00000" } };
    row.getCell(7).alignment = { horizontal: "center", vertical: "top" };
    sheet.columns.forEach((c, i) => {
      const cell = row.getCell(KEYS.length + i + 1);
      const st = r.cells[c.column]?.s ?? "na";
      if (st === "miss") {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: MISS_BG } };
        // A choice field fills from its own list.
        if (c.options.length) {
          const list = `"${c.options.join(",")}"`;
          if (list.length <= 255) {
            cell.dataValidation = { type: "list", allowBlank: true, formulae: [list], showErrorMessage: false };
          }
        }
      } else if (st === "na") {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: NA_BG } };
        cell.font = { color: { argb: "FF9A9A9A" }, italic: true };
        cell.alignment = { horizontal: "center", vertical: "top" };
      }
    });
  }

  // Thin rules round everything; the cells to fill with a warmer edge.
  for (let r = 3; r <= ws.rowCount; r++) {
    ws.getRow(r).eachCell({ includeEmpty: true }, (cell, colNo) => {
      if (colNo > total) return;
      const miss = r > 3 && (cell.fill as ExcelJS.FillPattern | undefined)?.fgColor?.argb === MISS_BG;
      const edge = { style: "thin" as const, color: { argb: miss ? MISS_EDGE : RULE } };
      cell.border = { top: edge, bottom: edge, left: edge, right: edge };
    });
  }
  ws.autoFilter = { from: { row: 3, column: 1 }, to: { row: Math.max(3, ws.rowCount), column: total } };
}
