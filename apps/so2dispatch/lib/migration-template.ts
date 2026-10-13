// The data-migration workbook: every sheet the export writes, empty, with the
// input rules attached — dropdowns from the schema's option lists, date and
// number checks, and a note on each header saying what goes in it.
//
// Built from exportSheetDefs() rather than a list of its own, so the template,
// the export and anything that later reads the template back all agree on the
// sheet names and headers. A new field on a section appears here by itself.
import ExcelJS from "exceljs";
import { exportSheetDefs, type SheetSpec } from "@/lib/order-export";
import type { OrderField, OrderFieldType } from "@/lib/order-schema";

const HEAD_BG = "FF1F3864";
const KEY_HEAD_BG = "FF0F5257";
const KEY_BG = "FFE6F2F2";
const RULE = "FFBFC9D9";
const MUTED = "FF5B6B80";

/** Rows pre-formatted with the input rules. More can be added by copying down. */
const INPUT_ROWS = 1000;

// Sheets and columns that cannot be typed into a spreadsheet.
const SKIP_SHEETS = new Set(["Quality documents"]); // files, not values
const NOT_INPUT = new Set([
  "order_copy_file_name", // an uploaded file
  "lr_file_name", // an uploaded file
  "dispatch_status", // recomputed from the invoices
  "order_status", // the same, or set by Central Visibility on the SO page
]);

/** Who fills each sheet in the app — so the file can be split across teams. */
const OWNER: Record<string, string> = {
  Orders: "Central Visibility",
  "EC Items": "Central Visibility",
  Accounts: "Accounts",
  PIs: "Billing & Operations",
  "Payment terms": "Central Visibility",
  Invoices: "Dispatch",
  "Drawing revisions": "Drawing",
  "Bought-out items": "Purchase",
  Quality: "Quality (required documents: Central Visibility)",
  Planning: "Planning",
  "Assembly & Packing": "Assembly & Packing",
  "Packing slips": "Planning (tentative) · Assembly & Packing (actual)",
};

/** How many rows each sheet takes — the thing people most often get wrong. */
function rowRule(spec: SheetSpec): string {
  if (spec.name === "Orders") return "One row per SO";
  if (spec.name === "EC Items") return "One row per EC";
  if (spec.name === "Accounts") return "One row per SO";
  if (["Quality", "Planning", "Assembly & Packing"].includes(spec.name)) {
    return "One row per EC";
  }
  return spec.perEc ? "As many rows per EC as needed" : "As many rows per SO as needed";
}

// The export's own extra columns carry no field definition to read a hint
// from. Rev. # sits beside the drawing's Revision No. and gets mistaken for it.
const EXTRA_NOTES: Record<string, string> = {
  "Rev. #":
    "Whole number — the order of this hand-off for the EC: 1 for the first issue, 2 for the next, and so on.\nNot the drawing's own revision label; that goes in Revision No.",
};

type Column = {
  label: string;
  type: OrderFieldType;
  options?: string[];
  note: string;
  key?: boolean;
};

function typeHint(type: OrderFieldType): string {
  switch (type) {
    case "date":
      return "Date (dd-mm-yyyy)";
    case "number":
      return "Number";
    case "int":
      return "Whole number";
    case "select":
      return "Pick from the list";
    default:
      return "Text";
  }
}

function noteFor(field: OrderField): string {
  const lines = [typeHint(field.type)];
  if (field.options?.length) {
    lines.push(`Allowed: ${field.options.map((o) => o.value).join(", ")}`);
  }
  for (const d of field.dependsOn ?? []) {
    const when = Array.isArray(d.value) ? d.value.join(" / ") : d.value;
    lines.push(`Only when ${d.column.replace(/_/g, " ")} ${d.not ? "is not" : "="} ${when}`);
  }
  if (field.centralOnly) lines.push("Filled by Central Visibility");
  return lines.join("\n");
}

/** A sheet's columns as the template writes them: keys first, then fields. */
function columnsOf(spec: SheetSpec): Column[] {
  const keys: Column[] = [
    {
      label: "SO No.",
      type: "text",
      key: true,
      note: "Required. Must match the SO No. on the Orders sheet exactly.",
    },
  ];
  if (spec.perEc) {
    keys.push({
      label: "EC No.",
      type: "text",
      key: true,
      note: "Required. Must match an EC No. on the EC Items sheet exactly.",
    });
  }
  // The Orders and EC Items sheets are where an SO and an EC are first
  // declared, so their key note says so rather than pointing at themselves.
  if (spec.name === "Orders") {
    keys[0].note = "Required. Unique per SO — every other sheet refers to it.";
  }
  if (spec.name === "EC Items") {
    keys[1].note = "Required. Unique per EC — the EC-level sheets refer to it.";
  }

  const extra: Column[] = (spec.extra ?? []).map((e) => ({
    label: e.label,
    type: e.options ? "select" : e.type,
    options: e.options,
    note:
      EXTRA_NOTES[e.label] ??
      (e.options
        ? `Pick from the list\nAllowed: ${e.options.join(", ")}`
        : typeHint(e.type)),
  }));

  const fields: Column[] = spec.fields
    .filter((f) => !f.computed && !NOT_INPUT.has(f.column))
    .map((f) => ({
      label: f.label,
      type: f.type,
      options: f.options?.map((o) => o.value),
      note: noteFor(f),
    }));

  return [...keys, ...extra, ...fields];
}

function fill(cell: ExcelJS.Cell, argb: string) {
  cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb } };
}

/**
 * Option lists live on one hidden sheet and every dropdown points at a range
 * there. An inline list is capped at 255 characters, which the longer
 * vocabularies (planning status, delay reasons) would overrun.
 *
 * The lists are gathered while the input sheets are written and the sheet is
 * added afterwards: a range is only a reference by name, and adding it last
 * keeps the visible tabs in order.
 */
class Lists {
  private columns: string[][] = [];
  private byKey = new Map<string, string>();

  /** An absolute range holding `values`, shared by every identical list. */
  rangeFor(values: string[]): string {
    const key = JSON.stringify(values);
    const known = this.byKey.get(key);
    if (known) return known;

    this.columns.push(values);
    const letter = columnLetter(this.columns.length);
    const range = `Lists!$${letter}$1:$${letter}$${values.length}`;
    this.byKey.set(key, range);
    return range;
  }

  addTo(wb: ExcelJS.Workbook) {
    const ws = wb.addWorksheet("Lists", { state: "veryHidden" });
    this.columns.forEach((values, c) => {
      values.forEach((v, r) => {
        ws.getCell(r + 1, c + 1).value = v;
      });
    });
  }
}

/** 1 → A, 27 → AA. */
function columnLetter(n: number): string {
  let s = "";
  for (let x = n; x > 0; x = Math.floor((x - 1) / 26)) {
    s = String.fromCharCode(65 + ((x - 1) % 26)) + s;
  }
  return s;
}

function validationFor(col: Column, lists: Lists): ExcelJS.DataValidation | null {
  if (col.options?.length) {
    return {
      type: "list",
      allowBlank: true,
      formulae: [lists.rangeFor(col.options)],
      showErrorMessage: true,
      errorStyle: "stop",
      errorTitle: col.label,
      error: `Pick one of: ${col.options.join(", ")}`.slice(0, 255),
    };
  }
  if (col.type === "date") {
    return {
      type: "date",
      operator: "greaterThan",
      allowBlank: true,
      formulae: [new Date(Date.UTC(2000, 0, 1))],
      showErrorMessage: true,
      errorStyle: "stop",
      errorTitle: col.label,
      error: "Enter a date, e.g. 15-09-2026.",
    };
  }
  if (col.type === "number" || col.type === "int") {
    return {
      type: col.type === "int" ? "whole" : "decimal",
      operator: "greaterThanOrEqual",
      allowBlank: true,
      formulae: [0],
      showErrorMessage: true,
      errorStyle: "stop",
      errorTitle: col.label,
      error:
        col.type === "int" ? "Enter a whole number." : "Enter a number (no text or ₹ sign).",
    };
  }
  return null;
}

function numFmtFor(type: OrderFieldType): string | null {
  if (type === "date") return "dd-mm-yyyy";
  if (type === "number") return "#,##0.00";
  if (type === "int") return "0";
  // Text columns are forced to text so an SO No. like "0123" or "26/1/1455"
  // is not turned into a number or a date by Excel.
  return "@";
}

function writeInputSheet(wb: ExcelJS.Workbook, spec: SheetSpec, lists: Lists) {
  const cols = columnsOf(spec);
  const keyCount = cols.filter((c) => c.key).length;
  const ws = wb.addWorksheet(spec.name, {
    views: [{ state: "frozen", xSplit: keyCount, ySplit: 1 }],
  });

  const head = ws.addRow(cols.map((c) => (c.key ? `${c.label} *` : c.label)));
  head.height = 34;
  head.alignment = { vertical: "middle", wrapText: true };
  head.eachCell((cell, n) => {
    const col = cols[n - 1];
    fill(cell, col.key ? KEY_HEAD_BG : HEAD_BG);
    cell.font = { bold: true, size: 10, color: { argb: "FFFFFFFF" } };
    cell.border = { bottom: { style: "thin", color: { argb: RULE } } };
    cell.note = col.note;
  });

  cols.forEach((col, i) => {
    const column = ws.getColumn(i + 1);
    column.width = col.key ? 18 : Math.min(34, Math.max(14, col.label.length + 4));
    const fmt = numFmtFor(col.type);
    const rule = validationFor(col, lists);
    for (let r = 2; r <= INPUT_ROWS + 1; r += 1) {
      const cell = ws.getCell(r, i + 1);
      if (fmt) cell.numFmt = fmt;
      if (rule) cell.dataValidation = rule;
      if (col.key) fill(cell, KEY_BG);
    }
  });

  ws.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: cols.length },
  };
  return { cols };
}

function writeInstructions(ws: ExcelJS.Worksheet, specs: SheetSpec[]) {
  const title = ws.addRow(["Data migration template"]);
  title.font = { bold: true, size: 16, color: { argb: HEAD_BG } };
  title.height = 24;
  ws.addRow([
    "Order-to-Dispatch · one sheet per subject, linked by SO No. and EC No.",
  ]).font = { color: { argb: MUTED } };
  ws.addRow([]);

  const rules = [
    "How the sheets connect",
    "• Orders holds one row per SO. Every other sheet refers back to it by SO No.",
    "• EC Items holds one row per EC. The EC-level sheets refer back to it by SO No. + EC No.",
    "• PIs, Invoices, Drawing revisions, Bought-out items and Packing slips are lists — add as many rows per SO or EC as there are entries.",
    "",
    "Filling it in",
    "• Columns marked * are required. SO No. and EC No. must be spelled exactly the same on every sheet.",
    "• Hover over any header to see what goes in it and the allowed values.",
    "• Where a cell offers a dropdown, pick from it — other values are rejected.",
    "• Enter dates as real dates (dd-mm-yyyy). Amounts as plain numbers, without ₹ or commas typed in.",
    "• Leave a cell blank if the value is not known. Do not rename sheets or headers.",
    "• Sl. No. is assigned by the system and is not part of this template.",
    "",
    "Not carried in this file",
    "• Attachments — order copy, LR copy and Quality documents. Upload them in the app after migration.",
    "• Dispatch Status — worked out from the invoices.",
    "• Target date history — enter each target's current date; earlier revisions cannot be recovered from a single column.",
  ];
  for (const line of rules) {
    const row = ws.addRow([line]);
    if (line && !line.startsWith("•")) {
      row.font = { bold: true, color: { argb: HEAD_BG } };
    }
    row.alignment = { wrapText: true, vertical: "top" };
    ws.mergeCells(row.number, 1, row.number, 5);
  }
  ws.addRow([]);

  const head = ws.addRow(["Sheet", "Keyed by", "Rows", "Filled in by", "What it holds"]);
  head.font = { bold: true, color: { argb: "FFFFFFFF" } };
  head.eachCell((cell) => fill(cell, HEAD_BG));

  for (const spec of specs) {
    const row = ws.addRow([
      spec.name,
      spec.perEc ? "SO + EC" : "SO",
      rowRule(spec),
      OWNER[spec.name] ?? "",
      spec.about,
    ]);
    row.getCell(1).font = { bold: true };
    row.alignment = { wrapText: true, vertical: "top" };
    row.eachCell((cell) => {
      cell.border = { bottom: { style: "hair", color: { argb: RULE } } };
    });
  }

  ws.getColumn(1).width = 22;
  ws.getColumn(2).width = 11;
  ws.getColumn(3).width = 28;
  ws.getColumn(4).width = 30;
  ws.getColumn(5).width = 60;
}

/** Every input sheet, its columns, for anything that reads the template back. */
export function migrationSheets(): { name: string; perEc: boolean; headers: string[] }[] {
  return exportSheetDefs()
    .filter((s) => !SKIP_SHEETS.has(s.name))
    .map((s) => ({
      name: s.name,
      perEc: s.perEc,
      headers: columnsOf(s).map((c) => c.label),
    }));
}

export function buildMigrationTemplate(): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Risansi SO to Dispatch";
  const specs = exportSheetDefs().filter((s) => !SKIP_SHEETS.has(s.name));

  writeInstructions(wb.addWorksheet("Instructions"), specs);
  const lists = new Lists();
  for (const spec of specs) writeInputSheet(wb, spec, lists);
  lists.addTo(wb);
  return wb;
}
