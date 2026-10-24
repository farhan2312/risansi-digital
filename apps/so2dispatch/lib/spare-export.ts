// The Orders list's Export and One Click for Spare SOs, as Spare works now: a
// Spare SO is planned and packed as one — its status, readiness date and
// remarks once per SO, its readiness lots (status, ready date, packing plan,
// packed date, the slips carrying it) — and Accounts records against each PI
// and payment term. Drawing, Purchase and Quality have nothing on a Spare, so
// they are not here; nor are the pump's fields.

import ExcelJS from "exceljs";
import type { OrderExportRow } from "@/lib/orders";
import {
  ADD_ON_SPARE_FIELDS,
  INVOICE_FIELDS,
  PACKING_SLIP_FIELDS,
  SECTION_BY_TABLE,
  type OrderField,
  type OrderFieldType,
} from "@/lib/order-schema";
import { buildSummarySheet, writeSheet, type SheetSpec } from "@/lib/order-export";
import { statusColumn, statusOf, type OneCell, type OneGroup, type OneSheet } from "@/lib/one-click-export";
import type { OneClickDept, OneClickStatuses } from "@/lib/one-click-status";

type Row = Record<string, unknown>;
const str = (v: unknown) => (v == null ? "" : String(v).trim());
const f = (column: string, label: string, type: OrderFieldType = "text"): OrderField => ({ column, label, type });

/** The order's own fields that a Spare has: none of the pump's (BOI, Quality, Drawing, Performance Curve…). */
export function spareOrderFields(): OrderField[] {
  const skip = new Set(["qc_documents", "purchase_target_date", "qc_doc_target_date"]);
  return (SECTION_BY_TABLE.get("orders")?.fields ?? []).filter(
    (x) =>
      x.column !== "so_no" &&
      !skip.has(x.column) &&
      !(x.dependsOn ?? []).some((d) => d.column === "order_type" && d.not && [d.value].flat().includes("Spare"))
  );
}

const ORDER_EXTRA: OrderField[] = [
  f("order_status", "Order Status"),
  f("accounts_hold_status", "Accounts Hold"),
  f("accounts_hold_reason", "Accounts Hold Reason"),
  f("accounts_hold_remarks", "Accounts Hold Remarks"),
];

const EC_FIELDS: OrderField[] = [...ADD_ON_SPARE_FIELDS.filter((x) => x.column !== "ec_no"), f("order_copy_file_name", "Order Copy (file)")];

const PLANNING_FIELDS: OrderField[] = [
  f("actual_spare_status", "Status"),
  f("planning_readiness_date", "Readiness Date", "date"),
  f("spare_readiness_remarks", "Readiness Remarks"),
];

const LOT_FIELDS: OrderField[] = [
  f("lot", "Lot", "int"),
  f("status", "Readiness Status"),
  f("ready_date", "Ready Date", "date"),
  f("ecs", "ECs in the Lot"),
  f("packing_plan_date", "Packing Plan Date", "date"),
  f("packing_shift", "Packing Shift"),
  f("pdi", "PDI"),
  f("packing_status", "Packing Status"),
  f("packed_date", "Packed Date", "date"),
  f("slips", "Packing Slips"),
];

const TERM_FIELDS: OrderField[] = [
  f("term", "Term"),
  f("percent", "Percent", "number"),
  f("days", "Days", "int"),
  f("documents", "Documents"),
  f("term_payment_status", "Payment Status"),
  f("term_confirmed_date", "Payment Confirmed", "date"),
  f("term_amount_received", "Amount Received", "number"),
  f("term_hold_reason", "Hold Reason"),
];

const PI_FIELDS: OrderField[] = [
  f("pi_no", "PI No."),
  f("pi_date", "PI Date", "date"),
  f("pi_value", "PI Value", "number"),
  f("term_label", "Against Term"),
  f("pi_payment_status", "Payment Status"),
  f("pi_confirmed_date", "Payment Confirmed", "date"),
  f("pi_amount_received", "Amount Received", "number"),
  f("pi_hold_reason", "Hold Reason"),
];

const SLIP_FIELDS: OrderField[] = [f("lots", "Lots"), ...PACKING_SLIP_FIELDS];
const INVOICE_EXPORT: OrderField[] = [f("packing_slip_no", "Packing Slip No."), f("packing_quantity", "Packing Qty", "int"), ...INVOICE_FIELDS];

/** A term as it reads: "30% Advance Against PI, 45 days". */
const termLabel = (t: Row) => [str(t.percent) ? `${str(t.percent)}%` : "", str(t.term), str(t.days) ? `${str(t.days)} days` : ""].filter(Boolean).join(" ");

/** The SO's lots: Lot n is the same on every EC (the first EC that has it stands for all), its ECs and the slips carrying it. */
export function spareLots(so: OrderExportRow): Row[] {
  const per = so.items.map((it) => ({ ec: str(it.item.ec_no) || "EC", lots: (it.order_ready_lots ?? []) as Row[] }));
  const count = Math.max(0, ...per.map((p) => p.lots.length));
  const slips = so.order_packing_slips.filter((p) => str(p.kind) === "actual" && str(p.packing_slip_no));
  const out: Row[] = [];
  for (let i = 0; i < count; i++) {
    const rows = per.map((p) => p.lots[i]).filter(Boolean);
    const pick = (k: string) => rows.map((r) => r[k]).find((v) => v != null && str(v) !== "") ?? null;
    out.push({
      lot: i + 1,
      status: pick("status"),
      ready_date: pick("ready_date"),
      ecs: per
        .filter((p) => p.lots[i])
        .map((p) => (str(p.lots[i].qty) ? `${p.ec} ×${str(p.lots[i].qty)}` : p.ec))
        .join(", "),
      packing_plan_date: pick("packing_plan_date"),
      packing_shift: pick("packing_shift"),
      pdi: pick("pdi"),
      packing_status: pick("packing_status"),
      packed_date: pick("packed_date"),
      slips: slips
        .filter((p) => Array.isArray(p.lot_nos) && (p.lot_nos as number[]).map(Number).includes(i + 1))
        .map((p) => str(p.packing_slip_no))
        .join(", "),
    });
  }
  return out;
}

const orderRow = (so: OrderExportRow): Row => ({
  ...so.order,
  order_status: so.order.status_override ?? so.order.dispatch_status ?? "Pending",
});

/** The Spare Export: a cover, then a sheet per subject — as Spare is worked now. */
export function buildSpareWorkbook(orders: OrderExportRow[], scope: string): ExcelJS.Workbook {
  type Bucket = SheetSpec["rows"];
  const so: Bucket = [], ecs: Bucket = [], planning: Bucket = [], lots: Bucket = [], slips: Bucket = [], terms: Bucket = [], pis: Bucket = [], invoices: Bucket = [];
  for (const o of orders) {
    const key = { slNo: Number(o.order.sl_no ?? null) || null, soNo: str(o.order.so_no) || null, ecNo: null };
    so.push({ ...key, source: orderRow(o) });
    // Planned as one: the SO's status, date and remarks, from its first EC that has them.
    const pl = o.items.map((it) => it.order_planning).find((p) => p && (str(p.actual_spare_status) || str(p.planning_readiness_date))) ?? {};
    planning.push({ ...key, source: pl as Row });
    for (const it of o.items) ecs.push({ ...key, ecNo: str(it.item.ec_no) || null, source: it.item });
    for (const l of spareLots(o)) lots.push({ ...key, source: l });
    for (const p of o.order_packing_slips.filter((x) => str(x.kind) !== "tentative")) {
      slips.push({ ...key, source: { ...p, lots: Array.isArray(p.lot_nos) ? (p.lot_nos as number[]).map((n) => `Lot ${n}`).join(", ") : "" } });
    }
    const termById = new Map(o.order_payment_terms.map((t) => [str(t.id), termLabel(t)]));
    for (const t of o.order_payment_terms) terms.push({ ...key, source: t });
    for (const d of o.order_billing_docs) pis.push({ ...key, source: { ...d, term_label: termById.get(str(d.payment_term_id)) ?? "" } });
    for (const v of o.order_invoices) invoices.push({ ...key, source: v });
  }
  const specs: SheetSpec[] = [
    { name: "Orders", about: "One row per Spare SO — its order details, status and Accounts hold.", perEc: false, fields: [...spareOrderFields(), ...ORDER_EXTRA], rows: so },
    { name: "EC Items", about: "One row per EC — the Spare Add-On.", perEc: true, fields: EC_FIELDS, rows: ecs },
    { name: "Planning", about: "Planning, once per SO (a Spare is planned as one): status, readiness date, remarks.", perEc: false, fields: PLANNING_FIELDS, rows: planning },
    { name: "Readiness lots", about: "Each SO's lots: readiness, the ECs in it, packing plan and packed date, the slips carrying it.", perEc: false, fields: LOT_FIELDS, rows: lots },
    { name: "Packing slips", about: "Assembly & Packing's slips, per SO, with the lots each carries.", perEc: false, fields: SLIP_FIELDS, rows: slips },
    { name: "Payment terms", about: "How each SO is paid — a row per slice, with Accounts' payment on it.", perEc: false, fields: TERM_FIELDS, rows: terms },
    { name: "PIs", about: "Proforma invoices, the term each is against, and Accounts' payment on it.", perEc: false, fields: PI_FIELDS, rows: pis },
    { name: "Invoices", about: "Dispatch's invoices / challans, one per dispatch.", perEc: false, fields: INVOICE_EXPORT, rows: invoices },
  ];
  const wb = new ExcelJS.Workbook();
  buildSummarySheet(wb.addWorksheet("Summary"), specs, `${scope} · Spare`);
  for (const spec of specs) writeSheet(wb, spec);
  return wb;
}

// ---- One Click for Spare: a row per SO.

function cell(source: Row | null | undefined, x: OrderField): OneCell {
  const raw = source?.[x.column];
  if (raw == null || raw === "") return null;
  if (x.type === "date") {
    const d = new Date(String(raw).slice(0, 10));
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (x.type === "int" || x.type === "number") {
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  }
  return String(raw);
}

const day = (v: unknown) => {
  const s = str(v).slice(0, 10);
  if (!s) return "";
  const d = new Date(`${s}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? s : d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
};
const money = (v: unknown) => (str(v) === "" ? "" : Number(v).toLocaleString("en-IN", { maximumFractionDigits: 2 }));
const join = (...p: string[]) => p.filter(Boolean).join(" · ");
const lines = (xs: string[]) => (xs.length ? xs.join("\n") : null);
const MAX_LOTS = 3;

/** Every detail of each Spare SO on one row: the order, its ECs, Planning, Lot 1–3, slips, terms, PIs, invoices. */
export function buildSpareOneSheet(orders: OrderExportRow[], statuses?: OneClickStatuses): OneSheet {
  const order = [...spareOrderFields(), ...ORDER_EXTRA];
  const lotCols = ["Status", "Ready Date", "ECs", "Packing Plan", "Packed", "Slips"];
  const groups: OneGroup[] = [
    { name: "SO", columns: [{ label: "Sl. No.", type: "int" }, { label: "SO No.", type: "text" }] },
    { name: "Order details", columns: order.map((x) => ({ label: x.label, type: x.type })) },
    { name: "ECs", columns: [{ label: "ECs", type: "int" }, { label: "EC details", type: "list" }] },
    // Planning's own Status is the SO's planning status: no second one here.
    { name: "Planning", columns: PLANNING_FIELDS.map((x) => ({ label: x.label, type: x.type })) },
    ...Array.from({ length: MAX_LOTS }, (_, i) => ({
      name: `Lot ${i + 1}`,
      columns: lotCols.map((c) => ({ label: `L${i + 1} ${c}`, type: (c === "Ready Date" ? "date" : "text") as OrderFieldType })),
    })),
    { name: "Assembly & Packing", columns: [statusColumn("Packing"), { label: "Packing slips", type: "list" }] },
    {
      name: "Proforma Invoice & Accounts",
      columns: [statusColumn("Billing"), statusColumn("Accounts"), { label: "Payment terms", type: "list" }, { label: "PIs", type: "list" }],
    },
    { name: "Dispatch", columns: [statusColumn("Dispatch"), { label: "Invoices", type: "list" }] },
  ];
  const rows: OneCell[][] = [];
  for (const o of orders) {
    const so = orderRow(o);
    const pl = (o.items.map((it) => it.order_planning).find((p) => p && (str(p.actual_spare_status) || str(p.planning_readiness_date))) ?? {}) as Row;
    const lots = spareLots(o);
    const st = (dept: OneClickDept) => statusOf(statuses, so.id, dept);
    const termById = new Map(o.order_payment_terms.map((t) => [str(t.id), termLabel(t)]));
    const paid = (status: unknown, date: unknown, amount: unknown, hold: unknown) =>
      join(str(status), day(date) ? `on ${day(date)}` : "", money(amount) ? `₹${money(amount)} recd` : "", str(hold) ? `Hold: ${str(hold)}` : "");
    rows.push([
      Number(so.sl_no ?? null) || null,
      str(so.so_no) || null,
      ...order.map((x) => cell(so, x)),
      o.items.length,
      lines(o.items.map((it) => join(str(it.item.ec_no), day(it.item.ec_date), str(it.item.model_no), str(it.item.quantity) ? `Qty ${str(it.item.quantity)}` : ""))),
      ...PLANNING_FIELDS.map((x) => cell(pl, x)),
      ...Array.from({ length: MAX_LOTS }, (_, i) => {
        const l = lots[i];
        if (!l) return [null, null, null, null, null, null];
        return [
          str(l.status) || null,
          cell(l, f("ready_date", "", "date")),
          str(l.ecs) || null,
          join(day(l.packing_plan_date), str(l.packing_shift), str(l.pdi) ? `PDI ${str(l.pdi)}` : "") || null,
          day(l.packed_date) || (str(l.packing_status) || null),
          str(l.slips) || null,
        ];
      }).flat(),
      st("packing"),
      lines(
        o.order_packing_slips
          .filter((p) => str(p.kind) !== "tentative" && str(p.packing_slip_no))
          .map((p) => join(str(p.packing_slip_no), day(p.packing_slip_date), Array.isArray(p.lot_nos) ? (p.lot_nos as number[]).map((n) => `L${n}`).join("+") : "", str(p.quantity) ? `Qty ${str(p.quantity)}` : ""))
      ),
      st("billing"),
      st("accounts"),
      lines(o.order_payment_terms.map((t) => join(termLabel(t), paid(t.term_payment_status, t.term_confirmed_date, t.term_amount_received, t.term_hold_reason)))),
      lines(
        o.order_billing_docs.map((d) =>
          join(str(d.pi_no), day(d.pi_date), money(d.pi_value), termById.get(str(d.payment_term_id)) ?? "", paid(d.pi_payment_status, d.pi_confirmed_date, d.pi_amount_received, d.pi_hold_reason))
        )
      ),
      st("dispatch"),
      lines(
        o.order_invoices.map((v) =>
          join(str(v.invoice_no) || str(v.challan_no), day(v.invoice_date) || day(v.challan_date), money(v.invoice_value) || money(v.challan_value), str(v.packing_slip_no) ? `Slip ${str(v.packing_slip_no)}` : "", str(v.docket_no) ? `Docket ${str(v.docket_no)}` : "")
        )
      ),
    ]);
  }
  return { groups, rows, rowLabel: "one per SO" };
}
