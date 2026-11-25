import "server-only";
// The EC import: ECs for SOs already in the portal, from the ERP's EC export
// (R_MKT_EC_PUMP_EXCEL), read as it comes. The header row is found by name
// (a Unit Code line above it is passed over), each row read and checked,
// rows sharing an EC No. made one EC — their quantities added, everything
// else the same or the EC is an error — and each EC checked against its SO.
// Nothing is written here; the action creates the ECs the preview passed.

import ExcelJS from "exceljs";
import { query } from "@/lib/db";
import { CLOSED_ORDER_STATUSES, orderStatusSql } from "@/lib/dept-view";
import { PUMP_LIKE, PUMP_TYPE_OPTIONS } from "@/lib/order-schema";
import type { NewItemInput } from "@/lib/orders";

type Field = keyof NewItemInput | "so_no";

/** Header (letters and digits only, lower case) -> field. The ERP's own spellings first. */
const HEADERS: Record<string, Field> = {
  sonumber: "so_no",
  sono: "so_no",
  salesorderno: "so_no",
  ecno: "ec_no",
  ecnumber: "ec_no",
  ecdate: "ec_date",
  ordertypepumpspare: "item_type",
  ordertype: "item_type",
  type: "item_type",
  pumptype: "pump_type",
  modelnumaberaspernameplate: "model_no",
  modelnumberaspernameplate: "model_no",
  modelno: "model_no",
  modelnumber: "model_no",
  internalmode: "internal_model",
  internalmodel: "internal_model",
  quantity: "quantity",
  qty: "quantity",
  suction: "suction",
  delivery: "delivery",
  liquid: "liquid",
  capacity: "capacity",
  head: "head",
  drivemotorrating: "drive_motor_rating",
  drivemotorspeed: "drive_motor_speed",
  pumpspeed: "pump_speed",
  pumpserialno: "pump_sno",
  application: "application",
  seriesversion: "version",
  version: "version",
  tagno: "tag_no",
  baseplate: "base_plate",
  boi: "boi",
  ecattachmentlink: "ec_link",
  ecattachment: "ec_link",
};

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

function cellText(v: ExcelJS.CellValue): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "object") {
    if ("result" in v && v.result != null) return v.result instanceof Date ? v.result.toISOString().slice(0, 10) : String(v.result);
    if ("richText" in v && Array.isArray(v.richText)) return v.richText.map((r) => r.text).join("");
    if ("text" in v && typeof v.text === "string") return v.text;
    return "";
  }
  return String(v).trim();
}

const MONTHS: Record<string, string> = { jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06", jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12" };

/** A date as YYYY-MM-DD: an Excel date, ISO, dd-mm-yyyy, dd/mm/yyyy or dd-Mon-yyyy. */
function toDate(v: ExcelJS.CellValue): string | null {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = cellText(v).trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/);
  if (m) return `${m[3].length === 2 ? `20${m[3]}` : m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  m = s.match(/^(\d{1,2})[-\s]([A-Za-z]{3})[A-Za-z]*[-\s,]*(\d{2,4})$/);
  if (m && MONTHS[m[2].toLowerCase()]) return `${m[3].length === 2 ? `20${m[3]}` : m[3]}-${MONTHS[m[2].toLowerCase()]}-${m[1].padStart(2, "0")}`;
  return null;
}

// A value with its unit in the same cell: the number, and the unit as the portal lists it.
const CAPACITY_UNITS: Record<string, string> = {
  m3hr: "M³/hr", m3h: "M³/hr", "m³hr": "M³/hr", "m³h": "M³/hr", cumhr: "M³/hr", cmh: "M³/hr", m3perhr: "M³/hr",
  lph: "LPH", lpm: "LPM", gpm: "GPM", klpd: "KLPD", tph: "TPH",
};
const HEAD_UNITS: Record<string, string> = {
  mwc: "MWC", m: "MWC", mtr: "MWC", mtrs: "MWC", meter: "MWC", meters: "MWC", metre: "MWC", mlc: "MLC",
  bar: "Bar", kgcm2: "Kg/cm²", "kgcm²": "Kg/cm²",
};
const MOTOR_UNITS: Record<string, string> = { kw: "KW", hp: "HP" };

function withUnit(raw: string, units: Record<string, string>): { value?: string; unit?: string; problem?: string } {
  const s = raw.trim();
  if (!s) return {};
  const m = s.match(/^(\d+(?:\.\d+)?)\s*(.*)$/);
  if (!m) return { problem: `"${s}" is not a number` };
  const unitText = m[2].toLowerCase().replace(/[\s.]/g, "").replace(/\//g, "").replace("per", "");
  if (!unitText) return { value: m[1] };
  const unit = units[unitText] ?? units[unitText.replace("³", "3")];
  return unit ? { value: m[1], unit } : { value: m[1], problem: `unit "${m[2].trim()}" not known` };
}

function speed(raw: string): { value?: string; problem?: string } {
  const s = raw.trim();
  if (!s) return {};
  const m = s.match(/^(\d+(?:\.\d+)?)\s*(rpm)?$/i);
  return m ? { value: m[1] } : { problem: `"${s}" is not a speed` };
}

function yesNo(raw: string): string | undefined {
  const s = raw.trim().toLowerCase();
  return s === "yes" || s === "y" ? "Yes" : s === "no" || s === "n" ? "No" : undefined;
}

/** One EC as the import will create it: the rows it came from, its fields, and what the check found. */
export type ImportEc = {
  /** Sheet rows (1-based) that make it. */
  rows: number[];
  soNo: string;
  ecNo: string;
  input: NewItemInput;
  /** The SO it goes on, once found. */
  orderId: string | null;
  status: "ok" | "warn" | "skip" | "error";
  errors: string[];
  warnings: string[];
};

export type EcImportPreview = {
  ecs: ImportEc[];
  /** The headers read, and those the import does not use. */
  headers: string[];
  unmapped: string[];
  error?: string;
};

/** The Add-On's pump fields the ERP export does not carry: listed as to fill later. */
const PUMP_LATER: [keyof NewItemInput, string][] = [
  ["pump_type", "Pump Type"],
  ["internal_model", "Internal Model"],
  ["suction", "Suction"],
  ["delivery", "Delivery"],
  ["pump_sno", "Pump Serial No."],
  ["version", "Series Version"],
  ["liquid", "Liquid"],
  ["capacity", "Capacity"],
  ["head", "Head"],
  ["drive_motor_rating", "Drive Motor Rating"],
  ["drive_motor_speed", "Drive Motor Speed"],
  ["pump_speed", "Pump Speed"],
  ["tag_no", "Tag No."],
  ["ec_link", "EC Attachment"],
];

/** Read the workbook and check every EC against the portal. Writes nothing. */
export async function previewEcImport(buffer: ArrayBuffer): Promise<EcImportPreview> {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buffer as never);
  } catch {
    return { ecs: [], headers: [], unmapped: [], error: "That file could not be read as an Excel (.xlsx) workbook." };
  }
  const ws = wb.worksheets[0];
  if (!ws) return { ecs: [], headers: [], unmapped: [], error: "The workbook has no sheet." };

  // The header row: the first of the top rows naming both the SO and the EC No.
  let headRow = 0;
  const cols = new Map<number, Field>();
  const headers: string[] = [];
  const unmapped: string[] = [];
  for (let r = 1; r <= Math.min(10, ws.rowCount) && !headRow; r++) {
    const found = new Map<number, Field>();
    ws.getRow(r).eachCell({ includeEmpty: false }, (cell, c) => {
      const f = HEADERS[norm(cellText(cell.value))];
      if (f && ![...found.values()].includes(f)) found.set(c, f);
    });
    if ([...found.values()].includes("so_no") && [...found.values()].includes("ec_no")) {
      headRow = r;
      found.forEach((f, c) => cols.set(c, f));
      ws.getRow(r).eachCell({ includeEmpty: false }, (cell, c) => {
        const h = cellText(cell.value).trim();
        headers.push(h);
        if (!cols.has(c)) unmapped.push(h);
      });
    }
  }
  if (!headRow) {
    return { ecs: [], headers: [], unmapped: [], error: "No header row with the SO Number and EC No. was found in the first rows." };
  }

  // Each row: its fields, read and checked.
  type Read = { row: number; soNo: string; ecNo: string; input: NewItemInput; errors: string[]; warnings: string[] };
  const read: Read[] = [];
  for (let r = headRow + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const raw: Partial<Record<Field, ExcelJS.CellValue>> = {};
    cols.forEach((f, c) => (raw[f] = row.getCell(c).value));
    const text = (f: Field) => cellText(raw[f] ?? null).trim();
    if (![...cols.values()].some((f) => text(f))) continue;
    const errors: string[] = [];
    const warnings: string[] = [];
    const input: NewItemInput = {};
    const soNo = text("so_no");
    const ecNo = text("ec_no");
    if (!soNo) errors.push("SO Number is blank");
    if (!ecNo) errors.push("EC No. is blank");
    input.ec_no = ecNo;
    const date = raw.ec_date != null && text("ec_date") ? toDate(raw.ec_date) : null;
    if (!text("ec_date")) errors.push("EC Date is blank");
    else if (!date) errors.push(`EC Date "${text("ec_date")}" is not a date`);
    else input.ec_date = date;
    const t = text("item_type").toLowerCase();
    input.item_type = t === "pump" ? "Pump" : t === "spare" ? "Spare" : t === "rolb" ? "ROLB" : undefined;
    if (!t) errors.push("Order type is blank");
    else if (!input.item_type) errors.push(`Order type "${text("item_type")}" is not Pump or Spare`);
    const qty = Number(text("quantity"));
    if (!text("quantity")) errors.push("Quantity is blank");
    else if (!Number.isInteger(qty) || qty < 1) errors.push(`Quantity "${text("quantity")}" is not a whole number of 1 or more`);
    else input.quantity = String(qty);
    input.model_no = text("model_no") || undefined;
    if (!input.model_no) errors.push("Model No. is blank");
    input.internal_model = text("internal_model") || undefined;
    for (const f of ["suction", "delivery", "liquid", "pump_sno", "version", "tag_no", "ec_link"] as const) input[f] = text(f) || undefined;
    // Application is the liquid, unless the sheet has its own.
    input.application = text("application") || input.liquid;
    const pt = text("pump_type").toUpperCase();
    if (pt) {
      if (PUMP_TYPE_OPTIONS.some((o) => o.value === pt)) input.pump_type = pt;
      else warnings.push(`Pump Type "${text("pump_type")}" is not PCP, MMP, RBL or OLB: left blank`);
    }
    const unitField = (f: "capacity" | "head" | "drive_motor_rating", label: string, units: Record<string, string>) => {
      const p = withUnit(text(f), units);
      if (p.value) input[f] = p.value;
      if (p.unit) input[`${f}_unit` as "capacity_unit"] = p.unit;
      if (p.problem) warnings.push(`${label}: ${p.problem}${p.value ? " (the number is kept)" : ""}`);
      else if (p.value && !p.unit) warnings.push(`${label}: no unit given`);
    };
    unitField("capacity", "Capacity", CAPACITY_UNITS);
    unitField("head", "Head", HEAD_UNITS);
    unitField("drive_motor_rating", "Drive Motor Rating", MOTOR_UNITS);
    for (const [f, label] of [["drive_motor_speed", "Drive Motor Speed"], ["pump_speed", "Pump Speed"]] as const) {
      const p = speed(text(f));
      if (p.value) input[f] = p.value;
      if (p.problem) warnings.push(`${label}: ${p.problem}`);
    }
    input.base_plate = yesNo(text("base_plate")) ?? "No";
    input.boi = yesNo(text("boi")) ?? "No";
    read.push({ row: r, soNo, ecNo, input, errors, warnings });
  }

  // Rows sharing an EC No.: one EC, the quantities added; anything else that differs is an error.
  const byEc = new Map<string, Read[]>();
  for (const x of read) {
    const key = x.ecNo ? x.ecNo.toUpperCase() : `row:${x.row}`;
    byEc.set(key, [...(byEc.get(key) ?? []), x]);
  }
  const ecs: ImportEc[] = [];
  for (const group of byEc.values()) {
    const first = group[0];
    const errors = [...new Set(group.flatMap((g) => g.errors.map((e) => (group.length > 1 ? `Row ${g.row}: ${e}` : e))))];
    const warnings = [...new Set(group.flatMap((g) => g.warnings))];
    const sig = (g: Read) => JSON.stringify({ so: g.soNo.toUpperCase(), ...g.input, quantity: undefined });
    if (group.length > 1 && group.some((g) => sig(g) !== sig(first))) {
      const differ = (Object.keys({ so_no: 1, ...first.input }) as Field[]).filter(
        (k) => k !== "quantity" && group.some((g) => (k === "so_no" ? g.soNo.toUpperCase() !== first.soNo.toUpperCase() : g.input[k as keyof NewItemInput] !== first.input[k as keyof NewItemInput]))
      );
      errors.push(`Rows ${group.map((g) => g.row).join(", ")} share this EC No. but differ in: ${differ.join(", ")}`);
    }
    const qty = group.reduce((a, g) => a + (Number(g.input.quantity) || 0), 0);
    ecs.push({
      rows: group.map((g) => g.row),
      soNo: first.soNo,
      ecNo: first.ecNo,
      input: { ...first.input, quantity: qty ? String(qty) : first.input.quantity },
      orderId: null,
      status: "ok",
      errors,
      warnings,
    });
  }

  // Against the portal: the SO (open, not Only Billing, its type), and an EC No. already there.
  const soNos = [...new Set(ecs.map((e) => e.soNo.toUpperCase()).filter(Boolean))];
  const ecNos = [...new Set(ecs.map((e) => e.ecNo.toUpperCase()).filter(Boolean))];
  const [sos, have] = await Promise.all([
    soNos.length
      ? query<{ id: string; so_no: string; order_type: string | null; only_billing: boolean; closed: boolean }>(
          `SELECT o.id::text, o.so_no, o.order_type,
                  (COALESCE(o.only_billing, '') = 'Yes' OR o.bill_mode = 'Only Billing') AS only_billing,
                  ${orderStatusSql("o")} = ANY($2::text[]) AS closed
             FROM orders o WHERE upper(btrim(o.so_no)) = ANY($1::text[])`,
          [soNos, [...CLOSED_ORDER_STATUSES]]
        )
      : Promise.resolve({ rows: [] }),
    ecNos.length
      ? query<{ ec: string; so_no: string | null }>(
          `SELECT upper(btrim(i.ec_no)) AS ec, o.so_no FROM order_items i JOIN orders o ON o.id = i.order_id
            WHERE upper(btrim(i.ec_no)) = ANY($1::text[])`,
          [ecNos]
        )
      : Promise.resolve({ rows: [] }),
  ]);
  const soBy = new Map<string, (typeof sos.rows)[number][]>();
  for (const s of sos.rows) soBy.set(s.so_no.trim().toUpperCase(), [...(soBy.get(s.so_no.trim().toUpperCase()) ?? []), s]);
  const haveBy = new Map(have.rows.map((h) => [h.ec, h.so_no]));
  for (const e of ecs) {
    const found = soBy.get(e.soNo.toUpperCase()) ?? [];
    if (e.soNo && found.length === 0) e.errors.push(`SO ${e.soNo} is not in the portal`);
    else if (found.length > 1) e.errors.push(`SO ${e.soNo} matches more than one SO`);
    else if (found[0]) {
      const so = found[0];
      if (so.only_billing) e.errors.push("An Only Billing SO has no ECs");
      else if (so.closed) e.errors.push("The SO is cancelled or diverted");
      const soPump = PUMP_LIKE.includes(String(so.order_type ?? ""));
      const ecPump = PUMP_LIKE.includes(String(e.input.item_type ?? ""));
      if (e.input.item_type && so.order_type && soPump !== ecPump) e.errors.push(`The SO is a ${so.order_type} SO, this EC a ${e.input.item_type}`);
      // The EC takes its SO's Order Type, as on the Add-On.
      if (so.order_type) e.input.item_type = so.order_type;
      e.orderId = so.id;
    }
    const already = e.ecNo ? haveBy.get(e.ecNo.toUpperCase()) : undefined;
    if (already !== undefined) {
      e.status = "skip";
      e.warnings = [`Already in the portal${already ? ` (on ${already})` : ""}: not imported again`];
      continue;
    }
    if (e.errors.length) {
      e.status = "error";
      continue;
    }
    // A pump's Add-On fields the sheet leaves blank: to fill on the EC later.
    if (PUMP_LIKE.includes(String(e.input.item_type ?? ""))) {
      const later = PUMP_LATER.filter(([f]) => !e.input[f]).map(([, l]) => l);
      if (later.length) e.warnings.push(`To fill later: ${later.join(", ")}`);
    } else {
      // A Spare carries no pump details.
      for (const f of ["pump_type", "suction", "delivery", "pump_sno", "application", "liquid", "capacity", "capacity_unit", "head", "head_unit",
        "drive_motor_rating", "drive_motor_rating_unit", "drive_motor_speed", "pump_speed", "tag_no", "base_plate", "boi", "ec_link"] as const) delete e.input[f];
    }
    e.status = e.warnings.length ? "warn" : "ok";
  }
  return { ecs, headers, unmapped };
}
