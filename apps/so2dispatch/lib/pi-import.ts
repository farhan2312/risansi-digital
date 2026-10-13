import "server-only";
import ExcelJS from "exceljs";

/**
 * Parse a PI Excel into rows for the Operation card (order_billing_docs).
 *
 * One header row, one row per PI. Columns matched by name, so column order is
 * free: PI No. / PI Date / PI Value (and common variants). Rows are validated
 * before anything is written; a fully-blank row is skipped.
 */

export type ParsedPi = {
  pi_no: string;
  pi_date: string | null;
  pi_value: string | null;
  errors: string[];
};

// Header label -> field, keyed on a normalized (letters+digits only) form so
// "PI No.", "pi_no" and "PI  Number" all match.
const COLUMN_MAP: Record<string, keyof Omit<ParsedPi, "errors">> = {
  pino: "pi_no",
  pinumber: "pi_no",
  proformano: "pi_no",
  proformainvoiceno: "pi_no",
  pidate: "pi_date",
  proformadate: "pi_date",
  pivalue: "pi_value",
  piamount: "pi_value",
  value: "pi_value",
  amount: "pi_value",
};

function norm(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function toIsoDate(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function cellText(cell: ExcelJS.Cell): string {
  const v = cell.value;
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return toIsoDate(v);
  if (typeof v === "object") {
    if ("result" in v && v.result !== undefined && v.result !== null) {
      return v.result instanceof Date ? toIsoDate(v.result) : String(v.result);
    }
    if ("richText" in v && Array.isArray(v.richText)) {
      return v.richText.map((r) => r.text).join("");
    }
    if ("text" in v && typeof v.text === "string") return v.text;
    return "";
  }
  return String(v).trim();
}

function parseDate(cell: ExcelJS.Cell): { value?: string; error?: string } {
  const raw = cell.value;
  if (raw === null || raw === undefined || raw === "") return {};
  if (raw instanceof Date) return { value: toIsoDate(raw) };

  const text = cellText(cell).trim();
  if (text === "") return {};
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return { value: text };

  const dmy = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (dmy) {
    const [, d, m, y] = dmy;
    const day = Number(d);
    const month = Number(m);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      const mm = String(month).padStart(2, "0");
      const dd = String(day).padStart(2, "0");
      return { value: `${y}-${mm}-${dd}` };
    }
  }
  return { error: `"${text}" is not a date (use dd/mm/yyyy)` };
}

export type PiImportParse = {
  rows: ParsedPi[];
  unmapped: string[];
  /** True when no column mapped to PI No. — the sheet's shape is wrong. */
  missingPiNo: boolean;
};

export async function parsePiWorkbook(buffer: Buffer): Promise<PiImportParse> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  const ws = wb.worksheets[0];
  if (!ws) return { rows: [], unmapped: [], missingPiNo: true };

  const headerRow = ws.getRow(1);
  const unmapped: string[] = [];
  const colToField = new Map<number, keyof Omit<ParsedPi, "errors">>();
  headerRow.eachCell({ includeEmpty: false }, (cell, colNo) => {
    const label = cellText(cell).trim();
    if (label === "") return;
    const field = COLUMN_MAP[norm(label)];
    if (field) colToField.set(colNo, field);
    else unmapped.push(label);
  });

  const missingPiNo = ![...colToField.values()].includes("pi_no");
  const rows: ParsedPi[] = [];

  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const rec: ParsedPi = {
      pi_no: "",
      pi_date: null,
      pi_value: null,
      errors: [],
    };
    let hasAny = false;

    for (const [colNo, field] of colToField) {
      const cell = row.getCell(colNo);
      const text = cellText(cell).trim();
      if (text === "") continue;
      hasAny = true;

      if (field === "pi_date") {
        const { value, error } = parseDate(cell);
        if (error) rec.errors.push(`PI Date: ${error}`);
        else if (value) rec.pi_date = value;
      } else if (field === "pi_value") {
        const n = Number(text.replace(/,/g, ""));
        if (!Number.isFinite(n)) rec.errors.push(`PI Value "${text}" is not a number`);
        else rec.pi_value = String(n);
      } else {
        rec.pi_no = text;
      }
    }

    if (!hasAny) continue; // blank spacer row
    if (rec.pi_no === "") rec.errors.push("PI No. is required");
    rows.push(rec);
  }

  return { rows, unmapped, missingPiNo };
}
