import "server-only";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage, type RGB } from "pdf-lib";
import { sanitize, wrap } from "@/lib/pdf-text";
import { billModeLabel, PAYMENT_HOLD_VALUE } from "@/lib/order-schema";
import { CLOSED, READY, assemblyView, planningText, reachedAssembly, reachedDepts, reachedDispatch } from "@/lib/order-row-view";
import type { BillingQueueRow, DeptCell, OrderListRow, SoDeptStatus } from "@/lib/orders";
import type { KpiCard, KpiTone } from "@/lib/kpis";
import { PACKED_FOR, PACKING_IN_PROGRESS, type SoLot } from "@/lib/ready-lots";
import type { PumpStage as SummaryStage, PumpSummary } from "@/lib/pump-summary";
import { stageOf as pumpStageOf, type PumpStage } from "@/lib/pump-dashboard";

// The Orders list on paper: the same columns as the list on screen, every SO
// on one line, with summary cards on top. A3 landscape, so all seventeen
// columns fit across without shrinking the text below reading size. The
// Spare list goes lot by lot; the Pump list department by department, as the
// Orders list's Pump view reads them (lib/pump-summary).

type Row = Record<string, unknown>;

const str = (v: unknown) => (v === null || v === undefined ? "" : String(v).trim());
const money = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 });

function day(v: unknown): string {
  const s = str(v).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return "";
  return new Date(`${s}T00:00:00Z`).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "2-digit",
    timeZone: "UTC",
  });
}
const dayOrBlank = (v: string | null) => day(v);

/** Rs 2.45 Cr / Rs 12.3 L / Rs 45,000 — the order book at a glance. */
function shortInr(n: number): string {
  if (n >= 1e7) return `Rs ${(n / 1e7).toFixed(2)} Cr`;
  if (n >= 1e5) return `Rs ${(n / 1e5).toFixed(1)} L`;
  return `Rs ${money.format(n)}`;
}

function termLabel(t: Row): string {
  const pct = str(t.percent);
  return [
    [pct ? `${Number(pct)}%` : "", str(t.term) || "—"].filter(Boolean).join(" "),
    str(t.days) ? `${str(t.days)} days` : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

// ── Palette ─────────────────────────────────────────────────────────────
const C = {
  ink: rgb(0.09, 0.11, 0.15),
  muted: rgb(0.42, 0.45, 0.5),
  rule: rgb(0.87, 0.89, 0.92),
  white: rgb(1, 1, 1),
  primary: rgb(0.11, 0.37, 0.84),
  primarySoft: rgb(0.8, 0.87, 1),
  head: rgb(0.13, 0.17, 0.25),
  zebra: rgb(0.975, 0.98, 0.987),
  green: rgb(0.02, 0.5, 0.32),
  greenBg: rgb(0.92, 0.98, 0.95),
  greenLine: rgb(0.65, 0.88, 0.76),
  blue: rgb(0.03, 0.45, 0.7),
  blueBg: rgb(0.92, 0.96, 1),
  blueLine: rgb(0.65, 0.82, 0.95),
  amber: rgb(0.66, 0.4, 0.02),
  amberBg: rgb(1, 0.97, 0.9),
  amberLine: rgb(0.98, 0.84, 0.55),
  red: rgb(0.8, 0.15, 0.22),
  redBg: rgb(1, 0.94, 0.95),
  redLine: rgb(0.98, 0.76, 0.79),
  slate: rgb(0.4, 0.45, 0.52),
  slateBg: rgb(0.94, 0.95, 0.96),
};

const TONE: Record<DeptCell["state"] | "hold", { fg: RGB; bg: RGB; line: RGB }> = {
  done: { fg: C.green, bg: C.greenBg, line: C.greenLine },
  pending: { fg: C.amber, bg: C.amberBg, line: C.amberLine },
  na: { fg: C.slate, bg: C.slateBg, line: C.rule },
  hold: { fg: C.red, bg: C.redBg, line: C.redLine },
};

/** Central Visibility holds the SO: every department reads Hold until cleared (as on the Orders list). */
const cvHeld = (o: OrderListRow) => !CLOSED.includes(o.dispatch_status ?? "") && o.clearance_status === "Hold";
const HOLD: Line[] = [{ text: "Hold", bold: true, color: C.red }];
const NOT_YET: Line[] = [{ text: "—", color: C.muted }];

function paymentColor(status: string): RGB {
  if (status === PAYMENT_HOLD_VALUE) return C.red;
  if (status === "Payment Rcvd") return C.green;
  if (status.startsWith("Advance")) return C.amber;
  return C.slate;
}

// ── Page geometry: A3 landscape, in points ──────────────────────────────
const PAGE = { w: 1191, h: 842 };
const MARGIN = 28;
const WIDTH = PAGE.w - MARGIN * 2; // 1135
const BOTTOM = MARGIN + 18;
const SIZE = 7.5;
const LEAD = 9.5;
const PAD = 4;

type Key =
  | "sl" | "so" | "soDate" | "type" | "client" | "code" | "rep" | "zone" | "bill"
  | "value" | "depts" | "pay" | "readiness" | "planning" | "assembly" | "dispatch" | "ecs"
  | "p1" | "p2" | "p3" | "a1" | "a2" | "a3" | "slips" | "invoice" | "sent" | "docket"
  | "gad" | "curve" | "part" | "drgReady" | "boi" | "qc" | "plan" | "planDate" | "align" | "asm" | "pack" | "pslips";

/** group: a heading over several columns (Planning over its Lot 1, Lot 2, Lot 3). */
type Column = { key: Key; label: string; width: number; align?: "right" | "center"; group?: string };

const PUMP_OR_ALL_COLUMNS: Column[] = [
  { key: "sl", label: "Sl. No.", width: 26 },
  { key: "so", label: "SO No.", width: 78 },
  { key: "soDate", label: "SO Date", width: 50 },
  { key: "type", label: "Type", width: 34 },
  { key: "client", label: "Client Name", width: 100 },
  { key: "code", label: "Client Code", width: 60 },
  { key: "rep", label: "Rep", width: 64 },
  { key: "zone", label: "Zone", width: 36 },
  { key: "bill", label: "Bill Mode", width: 61 },
  { key: "value", label: "Order Value", width: 70, align: "right" },
  { key: "depts", label: "Departments", width: 122 },
  { key: "pay", label: "Payment terms, PIs & payment", width: 165 },
  { key: "readiness", label: "Readiness Date", width: 62 },
  { key: "planning", label: "Planning", width: 62 },
  { key: "assembly", label: "Assembly & Packing", width: 66 },
  { key: "dispatch", label: "Dispatch", width: 55 },
  { key: "ecs", label: "ECs", width: 24, align: "center" },
];

/**
 * The Spare list: Planning and Assembly & Packing lot by lot, then each
 * dispatch's packing slips, invoice, how it went, and its docket & LR.
 */
const SPARE_COLUMNS: Column[] = [
  { key: "sl", label: "Sl. No.", width: 24 },
  // The SO Date sits under the SO No.
  { key: "so", label: "SO No. & Date", width: 74 },
  { key: "client", label: "Client Name", width: 86 },
  { key: "rep", label: "Rep", width: 48 },
  { key: "zone", label: "Zone", width: 34 },
  { key: "bill", label: "Bill Mode", width: 50 },
  { key: "value", label: "Order Value", width: 60, align: "right" },
  { key: "pay", label: "Payment terms, PIs & payment", width: 104 },
  { key: "p1", label: "Lot 1", width: 50, group: "Planning" },
  { key: "p2", label: "Lot 2", width: 50, group: "Planning" },
  { key: "p3", label: "Lot 3", width: 50, group: "Planning" },
  { key: "a1", label: "Lot 1", width: 54, group: "Assembly & Packing" },
  { key: "a2", label: "Lot 2", width: 54, group: "Assembly & Packing" },
  { key: "a3", label: "Lot 3", width: 54, group: "Assembly & Packing" },
  { key: "slips", label: "Packing Slips", width: 68 },
  { key: "invoice", label: "Invoice", width: 74 },
  { key: "sent", label: "Dispatch", width: 72 },
  { key: "docket", label: "Docket & LR", width: 78 },
  { key: "dispatch", label: "Dispatch Status", width: 51 },
];

/** The Pump list: every department on the SO, as the Orders list's Pump view shows it. */
const PUMP_COLUMNS: Column[] = [
  { key: "sl", label: "Sl. No.", width: 22 },
  // The SO Date sits under the SO No.
  { key: "so", label: "SO No. & Date", width: 70 },
  { key: "client", label: "Client Name", width: 88 },
  { key: "rep", label: "Rep", width: 46 },
  { key: "value", label: "Order Value", width: 58, align: "right" },
  { key: "pay", label: "Payment terms, PIs & payment", width: 100 },
  { key: "gad", label: "GAD", width: 64, group: "Drawing" },
  { key: "curve", label: "Perf. Curve", width: 54, group: "Drawing" },
  { key: "part", label: "Part Drawing", width: 50, group: "Drawing" },
  { key: "drgReady", label: "Readiness", width: 46, group: "Drawing" },
  { key: "boi", label: "BOI", width: 52, group: "Purchase" },
  { key: "qc", label: "QC Docs", width: 54, group: "Quality" },
  { key: "plan", label: "Status", width: 50, group: "Planning" },
  { key: "planDate", label: "Assembly Readiness", width: 50, group: "Planning" },
  { key: "align", label: "Alignment", width: 66, group: "Assembly & Packing" },
  { key: "asm", label: "Assembly", width: 60, group: "Assembly & Packing" },
  { key: "pack", label: "Packing", width: 60, group: "Assembly & Packing" },
  { key: "pslips", label: "Packing Slips", width: 70, group: "Dispatch" },
  { key: "dispatch", label: "Status", width: 54, group: "Dispatch" },
  { key: "ecs", label: "ECs", width: 21, align: "center" },
];

/** A stage across the SO's ECs, as the Pump view colours it: its status and how many are through. */
function pumpStage(s: SummaryStage, doneLabel: string, through: string): Line[] {
  if (!s.total) return [{ text: "—", color: C.muted }];
  const color = s.done === s.total ? C.green : s.label === "Resubmit" ? C.red : s.done > 0 || (s.label !== "Pending" && s.label !== doneLabel) ? C.blue : C.ink;
  return [
    { text: s.label, bold: true, color },
    { text: `${s.done}/${s.total} ${through}`, color: C.muted, size: 6.5 },
  ];
}

/** Assembly or packing on a pump SO: its status, and its next plan (red once past) or the last done. */
function pumpStep(st: { status: string; next: string | null; last: string | null }, today: string): Line[] {
  const full = /^fully/i.test(st.status);
  const late = !full && !!st.next && st.next < today;
  const line = !full && st.next ? `Plan ${day(st.next)}${late ? " · overdue" : ""}` : st.last ? `Done ${day(st.last)}` : "";
  return [
    { text: st.status, bold: true, color: full ? C.green : /^partial/i.test(st.status) ? C.blue : C.ink },
    ...(line ? [{ text: line, color: late ? C.red : C.muted, size: 6.5 }] : []),
  ];
}

/** The Pump columns past the SO's own: Drawing, Purchase, Quality, Planning, Assembly & Packing, the slips. */
function pumpCells(s: PumpSummary, today: string, held = false): Partial<Record<Key, Line[]>> {
  const cells = pumpOwnCells(s, today);
  // No EC yet: it has reached none of Drawing, Purchase, Quality and Planning.
  if (!s.hasEcs) {
    for (const k of ["gad", "curve", "part", "drgReady", "boi", "qc", "plan", "planDate"] as const) cells[k] = NOT_YET;
  }
  if (held) {
    for (const k of ["gad", "curve", "part", "boi", "qc", "plan", "asm", "pack"] as const) {
      // What is not required stays so.
      if (cells[k]?.[0]?.text !== "Not required" && cells[k] !== NOT_YET) cells[k] = HOLD;
    }
  } else if (!s.sentToAssembly) {
    cells.asm = NOT_YET;
    cells.pack = NOT_YET;
  }
  return cells;
}

function pumpOwnCells(s: PumpSummary, today: string): Partial<Record<Key, Line[]>> {
  const notNeeded: Line[] = [{ text: "Not required", color: C.muted, size: 6.5 }];
  const d = s.drawing;
  const drgLate = !!d.readiness && !d.closed && d.readiness < today;
  const a = s.alignment;
  const part = (name: string, yes: string | null, status: string | null, date?: string | null): Line | null =>
    yes === "Yes"
      ? { text: `${name}: ${status ?? "Yes"}${date ? ` ${day(date)}` : ""}`, color: status === "Pending" ? C.amber : C.ink }
      : yes === "No"
        ? { text: `${name}: No`, color: C.muted }
        : null;
  const align = [part("Base plate", a.base_plate, a.base_plate_status, a.base_plate_date), part("Wooden box", a.wooden_box, a.wooden_box_status)].filter(
    (x): x is Line => !!x
  );
  return {
    gad: pumpStage(d.gad, "Issued to planning", "issued"),
    curve: d.curve ? pumpStage(d.curve, "Approved by client", "approved") : notNeeded,
    part: d.part ? pumpStage(d.part, "Fully complete", "complete") : notNeeded,
    drgReady: d.closed
      ? [{ text: "Closed", bold: true, color: C.green }, ...(d.readiness ? [{ text: day(d.readiness), color: C.muted, size: 6.5 }] : [])]
      : d.readiness
        ? [{ text: day(d.readiness), bold: true, color: drgLate ? C.red : C.ink }, ...(drgLate ? [{ text: "Overdue", color: C.red, size: 6.5 }] : [])]
        : [],
    boi: s.purchase.required
      ? [
          { text: s.purchase.state, bold: true, color: s.purchase.state === "Closed" ? C.green : C.ink },
          { text: s.purchase.items ? `${s.purchase.received}/${s.purchase.items} received` : "No items yet", color: C.muted, size: 6.5 },
        ]
      : notNeeded,
    qc: s.quality.required
      ? [
          { text: s.quality.state, bold: true, color: s.quality.state === "Closed" ? C.green : s.quality.submitted > 0 ? C.blue : C.ink },
          { text: s.quality.total ? `${s.quality.submitted}/${s.quality.total} ECs submitted` : "No ECs yet", color: C.muted, size: 6.5 },
        ]
      : notNeeded,
    plan: [
      {
        text: s.planning.status,
        bold: true,
        color: s.planning.status === "Fully ready" ? C.green : s.planning.status === "Partial ready" ? C.blue : C.ink,
      },
    ],
    planDate: s.planning.readiness ? [{ text: day(s.planning.readiness) }] : [],
    align,
    asm: pumpStep(s.assembly, today),
    pack: pumpStep(s.packing, today),
    pslips: s.slips.map((p, n) => ({
      text: [p.no, day(p.date), p.qty != null ? `Qty ${p.qty}` : "", p.kind === "tentative" ? "tentative" : ""].filter(Boolean).join(" · "),
      color: p.kind === "tentative" ? C.amber : C.ink,
      gapBefore: n ? 2 : 0,
    })),
  };
}

/** A pump SO's stage, as its Rep's card names it: the earlier ones in pairs, the later ones a row each. */
const PUMP_REP_LABEL: Record<PumpStage, string | null> = {
  "Date awaited": "Date awaited",
  "In plan": "In plan",
  "Partial ready": "Partial ready",
  "Ready, not assembled": "Fully ready, not assembled",
  "Assembly on": "Part assembled",
  "Assembled, not packed": "Assembled, not packed",
  "Packing on": "Part packed",
  "Packed, to dispatch": "Fully packed, not dispatched",
  "Dispatch hold": "Dispatch hold",
  "Lot dispatched": "Lot dispatched",
  "Fully dispatched": "Fully dispatched",
  "Cancelled / Diverted": null,
};

/** A Spare lot's Planning half: its status and ready date. */
function planningLot(l: SoLot | undefined): Line[] {
  if (!l) return [];
  return [
    { text: l.status || "—", bold: true, color: l.status === "Fully ready" ? C.green : C.ink },
    { text: l.ready_date ? `Ready ${day(l.ready_date)}` : "", color: C.muted, size: 6.5 },
    ...(l.differ ? [{ text: "ECs differ", color: C.amber, size: 6.5 }] : []),
  ];
}

/** …and its Assembly & Packing half: packed (on which slip), or its packing plan. */
function packingLot(l: SoLot | undefined, today: string): Line[] {
  if (!l) return [];
  if (l.packed_date) {
    return [
      { text: `${PACKED_FOR[l.status ?? ""] ?? "Packed"} ${day(l.packed_date)}`, bold: true, color: C.green },
      l.slips.length ? { text: l.slips.join(", "), color: C.muted, size: 6.5 } : { text: "No slip", color: C.red, size: 6.5 },
    ];
  }
  const plan = l.packing_plan_date;
  const late = !!plan && plan < today;
  const extras = [l.packing_shift, l.pdi ? `PDI ${l.pdi}` : "", late ? "overdue" : ""].filter(Boolean).join(" · ");
  return [
    plan ? { text: `Pack ${day(plan)}`, bold: true, color: late ? C.red : C.ink } : { text: PACKING_IN_PROGRESS, bold: true, color: C.amber },
    ...(extras ? [{ text: extras, color: late ? C.red : C.muted, size: 6.5 }] : []),
  ];
}

/** The Spare columns past Planning: the slips, and each dispatch's invoice, mode and docket. */
function dispatchCells(b: BillingQueueRow | undefined): Partial<Record<Key, Line[]>> {
  if (!b) return {};
  const slips = (b.packing_slips ?? []) as Row[];
  const invoices = (b.invoices ?? []) as Row[];
  const lots = (v: unknown) => (Array.isArray(v) && v.length ? (v as number[]).map((n) => `L${n}`).join("+") : "");
  const each = (f: (inv: Row) => Line[]) =>
    invoices.flatMap((inv, n) => f(inv).map((l, k) => (k === 0 && n ? { ...l, gapBefore: 3 } : l)));
  return {
    slips: slips.map((p, n) => ({
      text: [str(p.packing_slip_no) || "—", day(p.packing_slip_date), str(p.quantity) && `Qty ${str(p.quantity)}`, lots(p.lot_nos)]
        .filter(Boolean)
        .join(" · "),
      color: str(p.invoice_id) ? C.ink : C.amber,
      gapBefore: n ? 2 : 0,
    })),
    invoice: each((inv) => {
      const no = str(inv.invoice_no) || str(inv.challan_no);
      if (!no && !str(inv.invoice_date) && !str(inv.challan_date)) return [{ text: "Invoice pending", color: C.amber }];
      const value = str(inv.invoice_value) || str(inv.challan_value);
      return [
        { text: no || "—", bold: true },
        { text: [day(inv.invoice_date) || day(inv.challan_date), value && `Rs ${money.format(Number(value))}`].filter(Boolean).join(" · "), color: C.muted, size: 6.5 },
      ];
    }),
    sent: each((inv) => {
      const mode = str(inv.delivery_mode);
      if (!mode) return [{ text: "Dispatch pending", color: C.amber }];
      const by = [str(inv.transporter_name), str(inv.courier_mode), str(inv.vehicle_no)].filter(Boolean).join(" · ");
      return [{ text: mode, bold: true }, ...(by ? [{ text: by, color: C.muted, size: 6.5 }] : [])];
    }),
    docket: each((inv) => {
      const docket = str(inv.docket_no);
      if (!docket) return [{ text: str(inv.delivery_mode) ? "Docket pending" : "—", color: str(inv.delivery_mode) ? C.amber : C.muted }];
      const sub = [day(inv.booking_date) && `Booked ${day(inv.booking_date)}`, day(inv.delivery_date) && `Delivered ${day(inv.delivery_date)}`, str(inv.lr_link) ? "LR" : ""]
        .filter(Boolean)
        .join(" · ");
      return [{ text: docket, bold: true }, ...(sub ? [{ text: sub, color: C.muted, size: 6.5 }] : [])];
    }),
  };
}

/** Planning's Fully ready, counted only while not packed — what still waits on Assembly & Packing. */
const READY_NOT_PACKED = "Fully ready, not packed";

/**
 * Where Planning has a Spare SO, for the cards: its status, with Fully ready
 * as "Ready, not packed" until its latest lot is packed (no lots: until it has
 * gone out); null once packed, or when closed.
 */
function sparePlanBucket(o: OrderListRow, status: SoDeptStatus | undefined): string | null {
  if (CLOSED.includes(o.dispatch_status ?? "")) return null;
  const plan = sparePlanning(o, status);
  if (plan !== "Fully ready") return plan;
  const lots = o.lots ?? [];
  const packed = lots.length
    ? !!lots[lots.length - 1].packed_date
    : ["fully dispatch", "lot dispatch"].includes((o.dispatch_status ?? "").toLowerCase());
  return packed ? null : READY_NOT_PACKED;
}

const PACKED_NOT_DISPATCHED = "Fully packed, not dispatched";
const FULLY_DISPATCHED = "Fully dispatched";

/**
 * Where a Spare SO stands, for its Rep's card: Fully dispatched, else its
 * Planning bucket, else (fully ready and packed) Fully packed, not dispatched.
 */
function spareRepBucket(o: OrderListRow, status: SoDeptStatus | undefined): string | null {
  if (CLOSED.includes(o.dispatch_status ?? "")) return null;
  if (cvHeld(o) || (o.dispatch_status ?? "") === "Hold") return "Hold";
  if ((o.dispatch_status ?? "").toLowerCase() === "fully dispatch") return FULLY_DISPATCHED;
  return sparePlanBucket(o, status) ?? PACKED_NOT_DISPATCHED;
}

/** A Spare SO's planning status: its latest lot's, else what the list says. */
function sparePlanning(o: OrderListRow, status: SoDeptStatus | undefined): string {
  const lots = o.lots ?? [];
  return (lots.length ? lots[lots.length - 1].status : null) || planningText(o, status) || "Date awaited";
}

type Line = { text: string; bold?: boolean; color?: RGB; size?: number; gapBefore?: number };
type Pill = { name: string; label: string; tone: DeptCell["state"] | "hold" };

/** Every SO's cells, ready to draw. */
type SoRow = {
  cells: Partial<Record<Key, Line[]>>;
  pills: Pill[];
  tone: "closed" | "full" | "lot" | null;
};

function buildRow(o: OrderListRow, status: SoDeptStatus | undefined, billing?: BillingQueueRow, today = "", pump?: PumpSummary): SoRow {
  const dispatch = o.dispatch_status || "Pending";
  const closed = CLOSED.includes(dispatch);
  const planning = planningText(o, status);
  const assembly = assemblyView(o, status, dayOrBlank);
  const held = cvHeld(o);
  // Not reached Dispatch yet (nothing packed, no status set): "—".
  const atDispatch = closed || (pump ? pump.sentToDispatch : reachedDispatch(o));

  // SO No. with its clearance and any Accounts hold beneath.
  const so: Line[] = [{ text: str(o.so_no) || `#${o.sl_no}`, bold: true }];
  if (o.clearance_status === "Hold") {
    so.push({ text: `Hold${o.clearance_hold_reason ? `: ${o.clearance_hold_reason}` : ""}`, color: C.red, size: 6.5 });
  } else so.push({ text: "Clear", color: C.green, size: 6.5 });
  if (o.accounts_hold_status === "Hold") {
    so.push({ text: `Accounts hold${o.accounts_hold_reason ? `: ${o.accounts_hold_reason}` : ""}`, color: C.red, size: 6.5 });
  }

  // Value with its unit; a USD order adds its INR figure.
  const value: Line[] = [];
  if (o.order_value) {
    value.push({ text: `${money.format(Number(o.order_value))} ${o.order_currency || "INR"}` });
    if ((o.order_currency ?? "INR").toUpperCase() !== "INR" && o.order_value_inr) {
      value.push({ text: `${money.format(Number(o.order_value_inr))} INR`, color: C.muted, size: 6.5 });
    }
  }

  // Payment terms, each with its PI and what came in.
  const terms = (o.term_lines ?? []) as Row[];
  const pis = (o.pi_docs ?? []) as Row[];
  const piFor = new Map(pis.filter((p) => str(p.payment_term_id)).map((p) => [str(p.payment_term_id), p]));
  const unlinked = pis.filter((p) => !str(p.payment_term_id) || !terms.some((t) => str(t.id) === str(p.payment_term_id)));
  const pay: Line[] = [];
  const payment = (status: string, amount: string, date: string, hold: string) => {
    if (!status && !amount && !date) return;
    pay.push({
      text: [status, amount && `Rs ${money.format(Number(amount))}`, day(date)].filter(Boolean).join(" · "),
      color: paymentColor(status),
      bold: !!status,
    });
    if (status === PAYMENT_HOLD_VALUE && hold) pay.push({ text: hold, color: C.red, size: 6.5 });
  };
  const piLine = (pi: Row) =>
    [`PI ${str(pi.pi_no) || "—"}`, day(pi.pi_date), str(pi.pi_value) && `Rs ${money.format(Number(pi.pi_value))}`]
      .filter(Boolean)
      .join(" · ");
  terms.forEach((t, n) => {
    const pi = piFor.get(str(t.id));
    pay.push({ text: termLabel(t), bold: true, gapBefore: n ? 3 : 0 });
    if (pi) {
      pay.push({ text: piLine(pi), color: C.muted });
      payment(str(pi.pi_payment_status), str(pi.pi_amount_received), str(pi.pi_confirmed_date), str(pi.pi_hold_reason));
    } else {
      pay.push({ text: "No PI yet", color: C.muted });
      payment(str(t.term_payment_status), str(t.term_amount_received), str(t.term_confirmed_date), str(t.term_hold_reason));
    }
  });
  unlinked.forEach((pi, n) => {
    pay.push({ text: "Not linked to a term", color: C.muted, gapBefore: n || terms.length ? 3 : 0 });
    pay.push({ text: piLine(pi), color: C.muted });
    payment(str(pi.pi_payment_status), str(pi.pi_amount_received), str(pi.pi_confirmed_date), str(pi.pi_hold_reason));
  });
  if (o.bill_mode === "FR") pay.splice(0, pay.length, { text: "Replacement · no payment terms", color: C.muted });
  else if (!pay.length) pay.push({ text: "No payment terms yet", color: C.muted });

  const readiness =
    !closed && o.readiness_from
      ? o.readiness_to && o.readiness_to !== o.readiness_from
        ? `${day(o.readiness_from)} – ${day(o.readiness_to)}`
        : day(o.readiness_from)
      : "";

  const dispatchKey = dispatch.toLowerCase();
  return {
    cells: {
      sl: [{ text: String(o.sl_no) }],
      so,
      soDate: [{ text: day(o.so_date), color: C.muted }],
      type: [{ text: str(o.order_type) }],
      client: [{ text: str(o.client_name) }],
      code: [{ text: str(o.client_code) }],
      rep: [{ text: str(o.reps) }],
      zone: [{ text: str(o.zone) }],
      bill: [{ text: billModeLabel(o.bill_mode, o.bill_type) || "" }],
      value,
      pay,
      readiness: [{ text: readiness, color: C.muted }],
      planning: held ? HOLD : closed || !planning ? [] : [{ text: planning, bold: true, color: READY.includes(planning.toLowerCase()) ? C.green : C.ink }],
      assembly: held
        ? HOLD
        : closed || !assembly.text || !reachedAssembly(status)
          ? []
          : [
              { text: assembly.text, bold: true, color: assembly.cell?.state === "done" ? C.green : C.ink },
              ...(assembly.line ? [{ text: assembly.line, color: C.muted, size: 6.5 }] : []),
            ],
      dispatch: held || dispatch === "Hold" ? HOLD : !atDispatch ? NOT_YET : [
        {
          text: dispatch,
          bold: true,
          color: closed ? C.red : dispatchKey === "fully dispatch" ? C.green : dispatchKey === "lot dispatch" ? C.blue : C.amber,
        },
      ],
      ecs: [{ text: String(o.ec_count ?? 0) }],
      // The Spare layout's lots, slips and dispatches.
      ...(billing
        ? {
            // The SO Date under the SO No., in the one column.
            so: [so[0], ...(day(o.so_date) ? [{ text: day(o.so_date), color: C.muted, size: 6.5 }] : []), ...so.slice(1)],
            p1: held ? HOLD : closed ? [] : planningLot(o.lots?.[0]),
            p2: held || closed ? [] : planningLot(o.lots?.[1]),
            p3: held || closed ? [] : planningLot(o.lots?.[2]),
            a1: held ? HOLD : closed ? [] : packingLot(o.lots?.[0], today),
            a2: held || closed ? [] : packingLot(o.lots?.[1], today),
            a3: held || closed ? [] : packingLot(o.lots?.[2], today),
            ...dispatchCells(billing),
          }
        : {}),
      // The Pump layout's departments.
      ...(pump
        ? {
            so: [so[0], ...(day(o.so_date) ? [{ text: day(o.so_date), color: C.muted, size: 6.5 }] : []), ...so.slice(1)],
            ...(closed ? {} : pumpCells(pump, today, held)),
          }
        : {}),
    },
    pills: closed
      ? [{ name: dispatch, label: "", tone: "na" }]
      : reachedDepts(o, status).map((t) => ({ name: t.name, label: t.cell.label, tone: t.cell.label === "Hold" ? "hold" : t.cell.state })),
    tone: closed ? "closed" : dispatchKey === "fully dispatch" ? "full" : dispatchKey === "lot dispatch" ? "lot" : null,
  };
}

/** The Orders list as one PDF: summary cards, the dispatch mix, then every SO. */
export async function buildOrdersListPdf(
  orders: OrderListRow[],
  statuses: Map<string, SoDeptStatus>,
  filterLine: string,
  opts: {
    capped?: boolean;
    total?: number;
    /** The Spare list: its lots, slips and dispatches by SO id, and cards by Rep. */
    spare?: Map<string, BillingQueueRow>;
    /** Sorted by Rep: a band naming each Rep above their SOs. */
    byRep?: boolean;
    /** The Pump list: each SO's departments by SO id, and cards by Rep. */
    pump?: Map<string, PumpSummary>;
    /** The Orders page's summary cards, as counted there: the PDF's cards match them. */
    kpis?: KpiCard[];
  } = {}
): Promise<Uint8Array> {
  const spare = opts.spare;
  const pump = spare ? undefined : opts.pump;
  const COLUMNS = spare ? SPARE_COLUMNS : pump ? PUMP_COLUMNS : PUMP_OR_ALL_COLUMNS;
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  const pdf = await PDFDocument.create();
  pdf.setTitle("Orders — Master tracker");
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  let page: PDFPage = pdf.addPage([PAGE.w, PAGE.h]);
  let y = PAGE.h - MARGIN;
  const text = (s: string, x: number, at: number, size: number, f: PDFFont, color: RGB = C.ink) =>
    page.drawText(sanitize(s, f), { x, y: at, size, font: f, color });
  /** A rounded rectangle, top-left at (x, top). */
  const box = (x: number, top: number, w: number, h: number, r: number, fill: RGB, border?: RGB) => {
    const rr = Math.min(r, w / 2, h / 2);
    page.drawSvgPath(
      `M ${rr},0 H ${w - rr} Q ${w},0 ${w},${rr} V ${h - rr} Q ${w},${h} ${w - rr},${h} H ${rr} Q 0,${h} 0,${h - rr} V ${rr} Q 0,0 ${rr},0 Z`,
      { x, y: top, color: fill, ...(border ? { borderColor: border, borderWidth: 0.6 } : {}) }
    );
  };

  const generated = new Date().toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Kolkata",
  });

  // ── Title band ─────────────────────────────────────────────────────────
  const scope = filterLine || "All orders";
  const scopeLines = wrap(scope, font, 8.5, WIDTH - 260);
  const bandH = 44 + scopeLines.length * 11;
  box(MARGIN, y, WIDTH, bandH, 8, C.primary);
  text("Orders", MARGIN + 16, y - 24, 18, bold, C.white);
  text("Master Order-to-Dispatch tracker", MARGIN + 16 + bold.widthOfTextAtSize("Orders", 18) + 10, y - 24, 10, font, C.primarySoft);
  scopeLines.forEach((l, n) => text(l, MARGIN + 16, y - 40 - n * 11, 8.5, font, C.white));
  const gen = `Generated ${generated} IST`;
  text(gen, MARGIN + WIDTH - 16 - font.widthOfTextAtSize(gen, 8), y - 22, 8, font, C.primarySoft);
  const countLine = `${orders.length} ${orders.length === 1 ? "SO" : "SOs"}${opts.capped ? ` of ${opts.total} (first ${orders.length})` : ""}`;
  text(countLine, MARGIN + WIDTH - 16 - bold.widthOfTextAtSize(countLine, 11), y - 37, 11, bold, C.white);
  y -= bandH + 12;

  // ── Summary cards ──────────────────────────────────────────────────────
  const rows = orders.map((o) => ({
    o,
    r: buildRow(o, statuses.get(o.id), spare?.get(o.id) ?? (spare ? ({} as BillingQueueRow) : undefined), today, pump?.get(o.id)),
  }));
  const n = orders.length;
  const dispatchOf = (o: OrderListRow) => (o.dispatch_status || "Pending").toLowerCase();
  const count = (f: (o: OrderListRow) => boolean) => orders.filter(f).length;
  const closedN = count((o) => CLOSED.includes(o.dispatch_status ?? ""));
  const fullN = count((o) => dispatchOf(o) === "fully dispatch" && !cvHeld(o));
  const lotN = count((o) => dispatchOf(o) === "lot dispatch" && !cvHeld(o));
  // A held SO (Central Visibility's, or Dispatch's own) is Hold, not pending.
  const heldDispatchN = count((o) => !CLOSED.includes(o.dispatch_status ?? "") && (cvHeld(o) || dispatchOf(o) === "hold"));
  const pendingN = count((o) => dispatchOf(o) === "pending" && !cvHeld(o));
  const pumpN = count((o) => str(o.order_type).toLowerCase() === "pump");
  const spareN = count((o) => str(o.order_type).toLowerCase() === "spare");
  const ecN = orders.reduce((s, o) => s + Number(o.ec_count ?? 0), 0);
  const valueInr = orders
    .filter((o) => !CLOSED.includes(o.dispatch_status ?? ""))
    .reduce((s, o) => s + (Number(o.order_value_inr ?? ((o.order_currency ?? "INR").toUpperCase() === "INR" ? o.order_value : 0)) || 0), 0);
  const readyN = count((o) => {
    const p = planningText(o, statuses.get(o.id));
    return !!p && READY.includes(p.toLowerCase());
  });
  // SO hold, as the Orders list counts it: Central Visibility's, Order Making's or Dispatch's.
  const soHoldN = count(
    (o) => !CLOSED.includes(o.dispatch_status ?? "") && (o.clearance_status === "Hold" || o.om_status === "Hold" || dispatchOf(o) === "hold")
  );
  const acctHoldN = count((o) => o.accounts_hold_status === "Hold");
  const pct = (k: number) => (n ? `${Math.round((k / n) * 100)}% of SOs` : "");

  const cards: { label: string; value: string; sub: string; color: RGB }[] = [
    { label: "SOs", value: String(n), sub: `${pumpN} Pump · ${spareN} Spare`, color: C.primary },
    // (Not on the Spare PDF: its SOs are what count there.)
    ...(spare ? [] : [{ label: "ECs", value: String(ecN), sub: n ? `${(ecN / n).toFixed(1)} per SO` : "", color: C.primary }]),
    { label: "Order value", value: shortInr(valueInr), sub: "Open SOs, in INR", color: C.ink },
    { label: "Fully dispatched", value: String(fullN), sub: pct(fullN), color: C.green },
    { label: "LOT dispatch", value: String(lotN), sub: pct(lotN), color: C.blue },
    { label: "Dispatch pending", value: String(pendingN), sub: pct(pendingN), color: C.amber },
    { label: "Dispatch hold", value: String(heldDispatchN), sub: pct(heldDispatchN), color: C.red },
    ...(spare
      ? (() => {
          const plan = (p: string) => count((o) => !cvHeld(o) && sparePlanBucket(o, statuses.get(o.id)) === p);
          return [
            { label: "Date awaited", value: String(plan("Date awaited")), sub: "Planning", color: C.amber },
            { label: "In plan", value: String(plan("In plan")), sub: "Planning", color: C.ink },
            { label: "Partial ready", value: String(plan("Partial ready")), sub: "Planning", color: C.blue },
            { label: "Fully ready, not packed", value: String(plan(READY_NOT_PACKED)), sub: "Waiting on Packing", color: C.green },
          ];
        })()
      : pump
        ? (() => {
            // Each department on the open SOs: how many it still has open.
            // A held SO is Hold in every department, so in none of these.
            const open = orders.filter((o) => !CLOSED.includes(o.dispatch_status ?? "") && dispatchOf(o) !== "fully dispatch" && !cvHeld(o));
            const sum = (o: OrderListRow) => pump.get(o.id);
            const k = (f: (s: PumpSummary) => boolean) => open.filter((o) => { const s = sum(o); return !!s && f(s); }).length;
            return [
              { label: "Drawing open", value: String(k((s) => !s.drawing.closed)), sub: "Not closed by Drawing", color: C.amber },
              { label: "BOI open", value: String(k((s) => s.purchase.required && s.purchase.state !== "Closed")), sub: "Items to come", color: C.amber },
              { label: "QC open", value: String(k((s) => s.quality.required && s.quality.state !== "Closed")), sub: "Documents due", color: C.amber },
              { label: "Fully ready", value: String(k((s) => s.planning.status === "Fully ready")), sub: "Planning", color: C.green },
              { label: "Fully assembled", value: String(k((s) => s.assembly.status === "Fully assembled")), sub: "Assembly", color: C.green },
              { label: "Fully packed", value: String(k((s) => s.packing.status === "Fully packed")), sub: "Waiting on Dispatch", color: C.primary },
            ];
          })()
        : [{ label: "Ready / packed", value: String(readyN), sub: "Planning says ready", color: C.green }]),
    { label: "SO hold", value: String(soHoldN), sub: "Central, Order Making or Dispatch", color: C.red },
    { label: "Accounts hold", value: String(acctHoldN), sub: "Held by Accounts", color: C.red },
    { label: "Cancelled / Diverted", value: String(closedN), sub: pct(closedN), color: C.slate },
  ];
  // The Orders page's own cards when given — the same counts as on screen —
  // with the open order value beside its Orders cards.
  if (opts.kpis?.length) {
    const TONE_COLOR: Record<KpiTone, RGB> = { neutral: C.primary, pending: C.amber, part: C.blue, done: C.green, danger: C.red };
    const shown = opts.kpis.map((k) => ({ label: k.label, value: String(k.count), sub: k.group ?? "", color: TONE_COLOR[k.tone ?? "neutral"] }));
    const lastOrders = shown.map((c) => c.sub).lastIndexOf("Orders");
    shown.splice(lastOrders + 1, 0, { label: "Order value", value: shortInr(valueInr), sub: "Open SOs, in INR", color: C.ink });
    cards.splice(0, cards.length, ...shown);
  }
  const gap = 8;
  // Up to twelve to a row, the rows even.
  const perCardRow = Math.ceil(cards.length / Math.ceil(cards.length / 12));
  const cardW = (WIDTH - gap * (perCardRow - 1)) / perCardRow;
  const cardH = 52;
  cards.forEach((c, i) => {
    if (i && i % perCardRow === 0) y -= cardH + gap;
    const x = MARGIN + (i % perCardRow) * (cardW + gap);
    box(x, y, cardW, cardH, 6, C.white, C.rule);
    page.drawRectangle({ x: x + 0.6, y: y - cardH + 8, width: 2.6, height: cardH - 16, color: c.color });
    // A long label shrinks to fit its card.
    const labelSize = Math.min(6.3, (6.3 * (cardW - 14)) / bold.widthOfTextAtSize(c.label.toUpperCase(), 6.3));
    text(c.label.toUpperCase(), x + 10, y - 13, labelSize, bold, C.muted);
    const size = bold.widthOfTextAtSize(c.value, 17) > cardW - 16 ? 13 : 17;
    text(c.value, x + 10, y - 33, size, bold, c.color);
    if (c.sub) text(c.sub, x + 10, y - 45, 6.3, font, C.muted);
  });
  y -= cardH + 12;

  // ── Spare / Pump: a card per Rep, with their SOs and where they stand ──
  if ((spare || pump) && n) {
    // The later states, each on a row of its own; the earlier ones two to a row.
    const LAST = spare
      ? [READY_NOT_PACKED, PACKED_NOT_DISPATCHED, FULLY_DISPATCHED]
      : ["Fully ready, not assembled", "Assembled, not packed", "Fully packed, not dispatched", FULLY_DISPATCHED];
    const EARLY = spare
      ? ["Date awaited", "In plan", "Partial ready"]
      : ["Date awaited", "In plan", "Partial ready", "Part assembled", "Part packed", "Dispatch hold", "Lot dispatched"];
    const PLAN = [...EARLY, ...LAST];
    const bucketOf = (o: OrderListRow) =>
      spare ? spareRepBucket(o, statuses.get(o.id)) : PUMP_REP_LABEL[pumpStageOf(o.dispatch_status ?? "", pump!.get(o.id))];
    const byRep = new Map<string, Map<string, number>>();
    for (const o of orders) {
      if (CLOSED.includes(o.dispatch_status ?? "")) continue;
      const plan = bucketOf(o);
      // An SO shared by two Reps counts for each.
      const reps = str(o.reps).split(",").map((r) => r.trim()).filter(Boolean);
      for (const rep of reps.length ? reps : ["No Rep"]) {
        const m = byRep.get(rep) ?? new Map<string, number>();
        m.set("", (m.get("") ?? 0) + 1);
        if (plan) m.set(plan, (m.get(plan) ?? 0) + 1);
        byRep.set(rep, m);
      }
    }
    const reps = [...byRep].sort((a, b) => (b[1].get("") ?? 0) - (a[1].get("") ?? 0) || a[0].localeCompare(b[0]));
    text("BY REP — SOs (not cancelled / diverted) and where they stand", MARGIN, y - 7, 6.5, bold, C.muted);
    y -= 13;
    const perRow = 8;
    const rw = (WIDTH - gap * (perRow - 1)) / perRow;
    // Each card: the three earlier states two to a row (and any other), then
    // the later ones a row each.
    const layoutOf = (m: Map<string, number>) => {
      const pairs = EARLY.concat([...m.keys()].filter((k) => k && !PLAN.includes(k)));
      return { pairs, rows: Math.ceil(pairs.length / 2) + LAST.length };
    };
    const rh = 30 + Math.max(...reps.map(([, m]) => layoutOf(m).rows)) * 10 + 4;
    reps.forEach(([rep, m], i) => {
      if (i && i % perRow === 0) y -= rh + 6;
      const x = MARGIN + (i % perRow) * (rw + gap);
      box(x, y, rw, rh, 6, C.white, C.rule);
      page.drawRectangle({ x: x + 0.6, y: y - rh + 8, width: 2.6, height: rh - 16, color: C.primary });
      let name = sanitize(rep, bold);
      while (name.length > 1 && bold.widthOfTextAtSize(name, 7.5) > rw - 60) name = name.slice(0, -1);
      text(name, x + 10, y - 13, 7.5, bold, C.ink);
      const sos = String(m.get("") ?? 0);
      text(sos, x + rw - 10 - bold.widthOfTextAtSize(sos, 15), y - 18, 15, bold, C.primary);
      text("SOs", x + rw - 10 - font.widthOfTextAtSize("SOs", 6), y - 26, 6, font, C.muted);
      const { pairs } = layoutOf(m);
      [...pairs, ...LAST].forEach((p, k) => {
        const v = m.get(p) ?? 0;
        const last = LAST.indexOf(p);
        const col = last >= 0 ? 0 : k % 2;
        const row = last >= 0 ? Math.ceil(pairs.length / 2) + last : Math.floor(k / 2);
        const lx = x + 10 + col * ((rw - 14) / 2);
        const ly = y - 34 - row * 10;
        const color =
          p === FULLY_DISPATCHED ? C.green
          : p === PACKED_NOT_DISPATCHED || p === "Fully packed, not dispatched" ? C.primary
          : p === READY_NOT_PACKED || p === "Fully ready, not assembled" || p === "Assembled, not packed" ? C.green
          : p === "Partial ready" || p === "Part assembled" || p === "Part packed" || p === "Lot dispatched" ? C.blue
          : p === "Dispatch hold" ? C.red
          : p === "In plan" ? C.ink
          : C.amber;
        // A long label shrinks to fit the card.
        const room = (last >= 0 ? rw - 14 : (rw - 14) / 2) - bold.widthOfTextAtSize(String(v), 6.2) - 2;
        const size = Math.min(6.2, (6.2 * room) / font.widthOfTextAtSize(`${p} `, 6.2));
        text(`${p} `, lx, ly, size, font, C.muted);
        text(String(v), lx + font.widthOfTextAtSize(`${p} `, size), ly, 6.2, bold, v ? color : C.muted);
      });
    });
    y -= rh + 12;
  }

  // ── Dispatch mix: one stacked bar with its legend ──────────────────────
  if (n) {
    const kpi = (label: string, own: number) => opts.kpis?.find((k) => k.group === "Dispatch" && k.label === label)?.count ?? own;
    const segs = [
      { label: "Fully dispatch", k: kpi("Dispatched", fullN), color: C.green },
      { label: "LOT dispatch", k: kpi("Part dispatched", lotN), color: C.blue },
      { label: "Pending", k: kpi("To dispatch", pendingN), color: rgb(0.96, 0.7, 0.2) },
      { label: "Hold", k: kpi("Dispatch hold", heldDispatchN), color: C.red },
      { label: "Cancelled / Diverted", k: closedN, color: rgb(0.75, 0.78, 0.82) },
    ];
    text("DISPATCH MIX", MARGIN, y - 7, 6.5, bold, C.muted);
    const barX = MARGIN + 62;
    const legendW = 430;
    const barW = WIDTH - 62 - legendW - 12;
    box(barX, y - 1, barW, 8, 4, C.slateBg);
    let bx = barX;
    for (const s of segs) {
      if (!s.k) continue;
      const w = (s.k / n) * barW;
      page.drawRectangle({ x: bx, y: y - 9, width: w, height: 8, color: s.color });
      bx += w;
    }
    let lx = barX + barW + 14;
    for (const s of segs) {
      page.drawRectangle({ x: lx, y: y - 8, width: 7, height: 7, color: s.color });
      const t = `${s.label} ${s.k}`;
      text(t, lx + 10, y - 7.5, 7, font, C.ink);
      lx += 10 + font.widthOfTextAtSize(t, 7) + 14;
    }
    y -= 22;
  }

  // ── The table ──────────────────────────────────────────────────────────
  const headerLines = COLUMNS.map((c) => wrap(c.label.toUpperCase(), bold, 6.2, c.width - PAD * 2));
  // A grouped header: the group's name once across its columns, a line under
  // it, and each column's own label below; the other labels take the full height.
  const grouped = COLUMNS.some((c) => c.group);
  const GROUP_H = grouped ? 12 : 0;
  const labelRows = Math.max(...headerLines.map((l) => l.length));
  const headH = GROUP_H + labelRows * 7.5 + 9;
  function tableHeader() {
    box(MARGIN, y, WIDTH, headH, 4, C.head);
    let cx = MARGIN;
    COLUMNS.forEach((c, i) => {
      // A grouped column's label sits under its group; the others start at the top, spanning both.
      const top = c.group ? y - GROUP_H - 9.5 : y - 9.5;
      headerLines[i].forEach((l, k) => {
        const w = bold.widthOfTextAtSize(l, 6.2);
        const x = c.group || c.align === "center" ? cx + (c.width - w) / 2 : c.align === "right" ? cx + c.width - PAD - w : cx + PAD;
        text(l, x, top - k * 7.5, 6.2, bold, c.group ? C.primarySoft : C.white);
      });
      // The group's name, once, over its first column to its last.
      if (c.group && COLUMNS[i - 1]?.group !== c.group) {
        let span = 0;
        for (let j = i; j < COLUMNS.length && COLUMNS[j].group === c.group; j++) span += COLUMNS[j].width;
        const label = c.group.toUpperCase();
        const w = bold.widthOfTextAtSize(label, 6.6);
        text(label, cx + (span - w) / 2, y - 9.5, 6.6, bold, C.white);
        page.drawLine({ start: { x: cx + PAD, y: y - GROUP_H - 1 }, end: { x: cx + span - PAD, y: y - GROUP_H - 1 }, thickness: 0.6, color: C.primarySoft });
        // A faint rule between groups and their neighbours.
        page.drawLine({ start: { x: cx, y: y - 3 }, end: { x: cx, y: y - headH + 3 }, thickness: 0.4, color: C.slate });
        page.drawLine({ start: { x: cx + span, y: y - 3 }, end: { x: cx + span, y: y - headH + 3 }, thickness: 0.4, color: C.slate });
      }
      cx += c.width;
    });
    y -= headH;
  }
  function newPage() {
    page = pdf.addPage([PAGE.w, PAGE.h]);
    y = PAGE.h - MARGIN;
    text("Orders", MARGIN, y - 10, 11, bold, C.primary);
    text(scope, MARGIN + 46, y - 10, 7.5, font, C.muted);
    y -= 18;
    tableHeader();
  }

  tableHeader();
  if (!n) text("No orders match these filters.", MARGIN + PAD, y - 14, 9, font, C.muted);

  // Pills flow inside the Departments column.
  // (The Spare layout has no Departments column, and so no pills.)
  const deptCol = COLUMNS.find((c) => c.key === "depts") ?? { width: 0 };
  const PILL_H = 10.5;
  const pillW = (p: Pill) => {
    const nameW = bold.widthOfTextAtSize(p.name, 6.3);
    const labelW = p.label ? font.widthOfTextAtSize(p.label, 6.3) + 3 : 0;
    return Math.min(nameW + labelW + 8, deptCol.width - PAD * 2);
  };
  const layoutPills = (pills: Pill[]) => {
    if (!deptCol.width) return { placed: [], height: 0 };
    const maxW = deptCol.width - PAD * 2;
    const placed: { p: Pill; x: number; row: number; w: number }[] = [];
    let x = 0;
    let row = 0;
    for (const p of pills) {
      const w = pillW(p);
      if (x > 0 && x + w > maxW) {
        row++;
        x = 0;
      }
      placed.push({ p, x, row, w });
      x += w + 3;
    }
    return { placed, height: pills.length ? (row + 1) * (PILL_H + 2.5) : 0 };
  };

  // Sorted by Rep: how many SOs each Rep has, for their bands.
  const repOf = (o: OrderListRow) => str(o.reps).trim() || "No Rep";
  const repCount = new Map<string, number>();
  if (opts.byRep) for (const o of orders) repCount.set(repOf(o), (repCount.get(repOf(o)) ?? 0) + 1);
  let lastRep: string | null = null;

  rows.forEach(({ o, r }, idx) => {
    // A band naming the Rep above their first SO (kept with that SO).
    if (opts.byRep && repOf(o) !== lastRep) {
      lastRep = repOf(o);
      const BAND = 15;
      if (y - BAND - 30 < BOTTOM) newPage();
      page.drawRectangle({ x: MARGIN, y: y - BAND, width: WIDTH, height: BAND, color: C.slateBg });
      page.drawRectangle({ x: MARGIN, y: y - BAND, width: 2.6, height: BAND, color: C.primary });
      text(lastRep, MARGIN + 8, y - 10.5, 8, bold, C.primary);
      const k = repCount.get(lastRep) ?? 0;
      text(`${k} ${k === 1 ? "SO" : "SOs"}`, MARGIN + 14 + bold.widthOfTextAtSize(sanitize(lastRep, bold), 8), y - 10.5, 7, font, C.muted);
      y -= BAND;
    }
    // Wrap every cell to its column first, to know the row's height.
    const wrapped = COLUMNS.map((c) => {
      const lines = r.cells[c.key] ?? [];
      const out: { t: string; f: PDFFont; size: number; color: RGB; dy: number }[] = [];
      let dy = 0;
      if (!lines.length || lines.every((l) => !l.text)) {
        if (c.key !== "depts") out.push({ t: "—", f: font, size: SIZE, color: C.muted, dy });
        return { out, h: c.key === "depts" ? 0 : LEAD };
      }
      for (const l of lines) {
        if (!l.text) continue;
        const f = l.bold ? bold : font;
        const size = l.size ?? SIZE;
        dy += l.gapBefore ?? 0;
        for (const t of wrap(l.text, f, size, c.width - PAD * 2)) {
          out.push({ t, f, size, color: l.color ?? C.ink, dy });
          dy += size < SIZE ? LEAD - 1.5 : LEAD;
        }
      }
      return { out, h: dy };
    });
    const pills = layoutPills(r.pills);
    const h = Math.max(LEAD, pills.height, ...wrapped.map((w) => w.h)) + PAD * 2 + 1;
    if (y - h < BOTTOM) newPage();

    const bg =
      r.tone === "closed" ? C.redBg : r.tone === "full" ? C.greenBg : r.tone === "lot" ? C.blueBg : idx % 2 ? C.zebra : C.white;
    page.drawRectangle({ x: MARGIN, y: y - h, width: WIDTH, height: h, color: bg });
    if (r.tone) {
      const accent = r.tone === "closed" ? C.red : r.tone === "full" ? C.green : C.blue;
      page.drawRectangle({ x: MARGIN, y: y - h, width: 2.2, height: h, color: accent });
    }

    let cx = MARGIN;
    COLUMNS.forEach((c, i) => {
      if (c.key === "depts") {
        for (const { p, x, row, w } of pills.placed) {
          const tone = TONE[p.tone];
          const top = y - PAD - row * (PILL_H + 2.5);
          box(cx + PAD + x, top, w, PILL_H, 2.5, tone.bg, tone.line);
          const nameW = bold.widthOfTextAtSize(p.name, 6.3);
          text(p.name, cx + PAD + x + 4, top - 7.5, 6.3, bold, tone.fg);
          if (p.label) {
            // Cut the label to fit what is left of the pill.
            let label = sanitize(p.label, font);
            const room = w - nameW - 11;
            while (label.length > 1 && font.widthOfTextAtSize(label, 6.3) > room) label = label.slice(0, -1);
            if (label !== sanitize(p.label, font)) label = label.slice(0, -1) + "…";
            text(label, cx + PAD + x + 4 + nameW + 3, top - 7.5, 6.3, font, tone.fg);
          }
        }
      } else {
        for (const l of wrapped[i].out) {
          const w = l.f.widthOfTextAtSize(l.t, l.size);
          const x = c.align === "right" ? cx + c.width - PAD - w : c.align === "center" ? cx + (c.width - w) / 2 : cx + PAD;
          text(l.t, x, y - PAD - 6.5 - l.dy, l.size, l.f, l.color);
        }
      }
      cx += c.width;
    });
    y -= h;
    page.drawLine({ start: { x: MARGIN, y }, end: { x: MARGIN + WIDTH, y }, thickness: 0.4, color: C.rule });
  });

  // ── Footer on every page ───────────────────────────────────────────────
  const pages = pdf.getPages();
  pages.forEach((p, i) => {
    p.drawText("Risansi · Orders — Master Order-to-Dispatch tracker", { x: MARGIN, y: MARGIN - 8, size: 7, font, color: C.muted });
    const label = `Page ${i + 1} of ${pages.length}`;
    p.drawText(label, { x: PAGE.w - MARGIN - font.widthOfTextAtSize(label, 7), y: MARGIN - 8, size: 7, font, color: C.muted });
  });

  return pdf.save();
}
