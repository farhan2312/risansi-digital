import "server-only";
import ExcelJS from "exceljs";
import { query } from "@/lib/db";
import { searchClients, type MarketIntellClient } from "@/lib/market-intell";
import type { NewOrderInput } from "@/lib/orders";
import { ORDER_TYPE_OPTIONS, YES_NO_OPTIONS } from "@/lib/order-schema";

/**
 * Daily Excel import of SO-level order details.
 *
 * The workbook is the `daily_import.xlsx` template: one header row, one row
 * per sales order. Headers are matched by name (not position) so the template
 * can be reordered, and every row is validated before anything is written.
 */

// Header label -> orders column. Keys are normalized (lowercased, stripped of
// everything but letters and digits) so "SO Date", "so date" and "So_Date"
// all land on the same field.
const COLUMN_MAP: Record<string, keyof NewOrderInput> = {
  clientcode: "client_code",
  quotationno: "quotation_no",
  sono: "so_no",
  sodate: "so_date",
  // The PO's terms as worded: free text, kept as Payment Terms Remarks. The
  // structured term lines are Central's to fill in the app. An older sheet
  // headed just "Payment Terms" lands in the same place.
  paymenttermsremarks: "payment_terms_remarks",
  paymentterms: "payment_terms_remarks",
  ldyesno: "ld",
  ld: "ld",
  lddate: "ld_date",
  custpono: "po_no",
  pono: "po_no",
  podate: "customer_po_date",
  orderquantity: "total_quantity",
  ordervalue: "order_value",
  ordertype: "order_type",
};

export type ImportRow = {
  rowNo: number;
  values: NewOrderInput;
  errors: string[];
  warnings: string[];
};

export type ParsedImport = {
  headers: string[];
  unmapped: string[];
  rows: ImportRow[];
};

function normalizeHeader(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function toIsoDate(d: Date): string {
  // Excel dates arrive as UTC midnight; format off the UTC parts so a
  // negative local offset cannot roll the date back a day.
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
    // Formula / rich-text / hyperlink cells expose the rendered value.
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

// Accepts a real Excel date, an ISO string, or dd/mm/yyyy (and dd-mm-yyyy).
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

// Match a free-text cell against a fixed option list, case-insensitively.
function matchOption(text: string, options: string[]): string | null {
  const t = text.trim().toLowerCase();
  return options.find((o) => o.toLowerCase() === t) ?? null;
}

export async function parseOrderWorkbook(buffer: Buffer): Promise<ParsedImport> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  const ws = wb.worksheets[0];
  if (!ws) return { headers: [], unmapped: [], rows: [] };

  const headerRow = ws.getRow(1);
  const headers: string[] = [];
  const unmapped: string[] = [];
  const colToField = new Map<number, keyof NewOrderInput>();
  headerRow.eachCell({ includeEmpty: false }, (cell, colNo) => {
    const label = cellText(cell).trim();
    if (label === "") return;
    headers.push(label);
    const field = COLUMN_MAP[normalizeHeader(label)];
    if (field) colToField.set(colNo, field);
    else unmapped.push(label);
  });

  const orderTypes = ORDER_TYPE_OPTIONS.map((o) => o.value);
  const yesNo = YES_NO_OPTIONS.map((o) => o.value);
  const rows: ImportRow[] = [];

  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const values: NewOrderInput = {};
    const errors: string[] = [];
    let hasAnyValue = false;

    for (const [colNo, field] of colToField) {
      const cell = row.getCell(colNo);
      const text = cellText(cell).trim();
      if (text === "") continue;
      hasAnyValue = true;

      switch (field) {
        case "so_date":
        case "ld_date":
        case "customer_po_date": {
          const { value, error } = parseDate(cell);
          if (error) errors.push(`${field}: ${error}`);
          else if (value) values[field] = value;
          break;
        }
        case "order_type": {
          const match = matchOption(text, orderTypes);
          if (!match) {
            errors.push(
              `Order Type "${text}" must be one of ${orderTypes.join(", ")}`
            );
          } else {
            values.order_type = match;
          }
          break;
        }
        case "ld": {
          const match = matchOption(text, yesNo);
          if (!match) errors.push(`LD "${text}" must be Yes or No`);
          else values.ld = match;
          break;
        }
        case "order_value": {
          const n = Number(text.replace(/,/g, ""));
          if (!Number.isFinite(n)) {
            errors.push(`Order Value "${text}" is not a number`);
          } else if (n < 0) {
            errors.push(`Order Value "${text}" cannot be negative`);
          } else {
            values.order_value = String(n);
          }
          break;
        }
        case "total_quantity": {
          const n = Number(text.replace(/,/g, ""));
          if (!Number.isInteger(n)) {
            errors.push(`Order Quantity "${text}" is not a whole number`);
          } else if (n < 0) {
            errors.push(`Order Quantity "${text}" cannot be negative`);
          } else {
            values.total_quantity = String(n);
          }
          break;
        }
        default:
          values[field] = text;
      }
    }

    if (!hasAnyValue) continue; // blank spacer row
    if (!(values.client_code ?? "").trim()) errors.push("Client Code is required");
    // Every imported order is priced in INR — the sheet carries no currency.
    if (values.order_value) values.order_currency = "INR";

    rows.push({ rowNo: r, values, errors, warnings: [] });
  }

  await enrichClients(rows);
  await flagDuplicateSoNos(rows);
  return { headers, unmapped, rows };
}

/**
 * Fill client details from the (read-only) Market Intell directory, so the
 * sheet only has to carry the client code.
 */
export async function enrichClients(rows: ImportRow[]): Promise<void> {
  const codes = [
    ...new Set(
      rows
        .map((r) => (r.values.client_code ?? "").trim())
        .filter((c) => c !== "")
    ),
  ];
  if (codes.length === 0) return;

  const found = new Map<string, MarketIntellClient>();
  for (const code of codes) {
    try {
      const matches = await searchClients(code, 5);
      const exact = matches.find(
        (c) => c.code.toLowerCase() === code.toLowerCase()
      );
      if (exact) found.set(code.toLowerCase(), exact);
    } catch (error) {
      console.error("client directory lookup failed during import:", error);
      return; // directory unreachable — import without enrichment
    }
  }

  for (const row of rows) {
    const code = (row.values.client_code ?? "").trim();
    if (code === "") continue;
    const client = found.get(code.toLowerCase());
    if (!client) {
      row.warnings.push(`Client code "${code}" is not in the client directory`);
      continue;
    }
    row.values.client_name = client.legal_name ?? undefined;
    row.values.market_type = client.market_type ?? undefined;
    row.values.client_type = client.client_type ?? undefined;
    row.values.industry_type = client.industry ?? undefined;
    row.values.zone = client.zone ?? undefined;
    row.values.reps = client.rep_name ?? undefined;
  }
}

/**
 * A daily sheet often repeats yesterday's rows — flag SOs that already exist
 * (and duplicates within the sheet itself) so they are not created twice.
 */
export async function flagDuplicateSoNos(rows: ImportRow[]): Promise<void> {
  const soNos = [
    ...new Set(
      rows.map((r) => (r.values.so_no ?? "").trim()).filter((s) => s !== "")
    ),
  ];
  if (soNos.length === 0) return;

  const existing = await query<{ so_no: string }>(
    `SELECT so_no FROM orders WHERE so_no = ANY($1::text[])`,
    [soNos]
  );
  const taken = new Set(
    existing.rows.map((r) => String(r.so_no).trim().toLowerCase())
  );

  const seen = new Set<string>();
  for (const row of rows) {
    const so = (row.values.so_no ?? "").trim().toLowerCase();
    if (so === "") continue;
    if (taken.has(so)) row.errors.push(`SO ${row.values.so_no} already exists`);
    else if (seen.has(so)) {
      row.errors.push(`SO ${row.values.so_no} is repeated in this sheet`);
    }
    seen.add(so);
  }
}
