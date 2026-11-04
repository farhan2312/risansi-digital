import "server-only";
// The Orders list's report as a sheet — what the Excel holds and what the
// pop-up's Excel view shows: every column of the list but Chat, one row per
// SO, Spare and Pump each with the columns its own view has.

import { billModeLabel, PAYMENT_HOLD_VALUE, READY_LOT_LIMIT, termPaymentStatus } from "@/lib/order-schema";
import { CLOSED, assemblyView, ecQuantityOf, orderStatusOf, planningText, reachedAssembly, reachedDepts, reachedDispatch } from "@/lib/order-row-view";
import { PACKED_FOR, PACKING_IN_PROGRESS, lotOnSlip, type SoLot } from "@/lib/ready-lots";
import { day, statusTone, type ReportSheet, type SheetCell, type Tone } from "@/lib/planning-report-sheet";
import { orderInHand } from "@/lib/dept-report-pdf";
import type { OrderListRow, SoDeptStatus } from "@/lib/orders";
import type { PumpSummary } from "@/lib/pump-summary";
import { LOT_PACKING_PENDING, latestPumpLot, type PumpLot } from "@/lib/assembly";

type Row = Record<string, unknown>;
/** An SO's packing slips and dispatches, as the list's Packing Slips … Docket & LR columns read them. */
export type OrderDocs = { packing_slips: Row[]; invoices: Row[] };

const str = (v: unknown) => (v === null || v === undefined ? "" : String(v).trim());
const money = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 });
const amount = (v: unknown): number | null => (str(v) && Number.isFinite(Number(v)) ? Number(v) : null);
const lines = (xs: (string | null | undefined | false)[]) => xs.filter(Boolean).join("\n");
const LOTS = Array.from({ length: READY_LOT_LIMIT }, (_, i) => i + 1);

/** "30% Advance · 15 days". */
function termLabel(t: Row): string {
  const pct = str(t.percent);
  return [[pct ? `${Number(pct)}%` : "", str(t.term) || "—"].filter(Boolean).join(" "), str(t.days) ? `${str(t.days)} days` : ""]
    .filter(Boolean)
    .join(" · ");
}

/** Each payment term with its PI and what came in, as the list's cell reads. */
function paymentText(o: OrderListRow): string {
  if (o.bill_mode === "FR") return "Replacement · no payment terms";
  const terms = (o.term_lines ?? []) as Row[];
  const pis = (o.pi_docs ?? []) as Row[];
  const piFor = new Map(pis.filter((p) => str(p.payment_term_id)).map((p) => [str(p.payment_term_id), p]));
  const unlinked = pis.filter((p) => !str(p.payment_term_id) || !terms.some((t) => str(t.id) === str(p.payment_term_id)));
  const out: string[] = [];
  const paid = (status: string, amt: string, date: string, hold: string) => {
    if (!status && !amt && !date) return;
    out.push([status, amt && `Rs ${money.format(Number(amt))}`, day(date)].filter(Boolean).join(" · "));
    if (status === PAYMENT_HOLD_VALUE && hold) out.push(`  ${hold}`);
  };
  const piLine = (pi: Row) =>
    [`PI ${str(pi.pi_no) || "—"}`, day(pi.pi_date), str(pi.pi_value) && `Rs ${money.format(Number(pi.pi_value))}`].filter(Boolean).join(" · ");
  for (const t of terms) {
    const pi = piFor.get(str(t.id));
    out.push(termLabel(t));
    if (pi) {
      out.push(`  ${piLine(pi)}`);
      paid(str(pi.pi_payment_status), str(pi.pi_amount_received), str(pi.pi_confirmed_date), str(pi.pi_hold_reason));
    } else {
      out.push("  No PI yet");
      paid(termPaymentStatus(t), str(t.term_amount_received), str(t.term_confirmed_date), str(t.term_hold_reason));
    }
  }
  for (const pi of unlinked) {
    out.push("Not linked to a term", `  ${piLine(pi)}`);
    paid(str(pi.pi_payment_status), str(pi.pi_amount_received), str(pi.pi_confirmed_date), str(pi.pi_hold_reason));
  }
  return out.length ? out.join("\n") : "No payment terms yet";
}

/** Planning's half of a Spare's lot: its status and ready date. */
const planningLot = (l: SoLot | undefined) =>
  l ? lines([l.status || "—", l.ready_date && `Ready ${day(l.ready_date)}`, l.differ && "ECs differ"]) : "";

/** Assembly & Packing's half of a Spare's lot: packed and on which slip, or its plan. */
function packingLot(l: SoLot | undefined, today: string): string {
  if (!l) return "";
  if (l.packed_date) return lines([`${PACKED_FOR[l.status ?? ""] ?? "Packed"} ${day(l.packed_date)}`, l.slips.length ? l.slips.join(", ") : "No slip"]);
  const plan = l.packing_plan_date;
  const extras = [l.packing_shift, l.pdi ? `PDI ${l.pdi}` : "", plan && plan < today ? "overdue" : ""].filter(Boolean).join(" · ");
  return lines([plan ? `Pack ${day(plan)}` : PACKING_IN_PROGRESS, extras]);
}

/** A pump lot's assembly and packing, as the Pump view's lot cell reads. */
function pumpLot(l: PumpLot | undefined, slips: Row[]): string {
  if (!l) return "";
  const qty = l.ecs.reduce((t, e) => t + e.qty, 0);
  const assembled = l.ecs.reduce((t, e) => t + e.assembled, 0);
  const label = l.packed_date ? "Packed" : l.pack_status === LOT_PACKING_PENDING ? LOT_PACKING_PENDING : l.assembled_date ? "Assembled" : assembled > 0 ? "Partially assembled" : l.status || "Pending";
  const stage = (done: string, plan: string, word: string) => (done ? `${word} ${day(done)}` : plan ? `${word} plan ${day(plan)}` : "");
  return lines([
    label,
    qty > 0 && `Qty ${qty} · Assembled ${assembled} · Packed ${l.packed_date ? qty : 0}`,
    stage(l.assembled_date, l.assembly_plan_date, "Assembly"),
    !l.assembled_date && l.asm_remarks && `Assembly pending: ${l.asm_remarks}`,
    stage(l.packed_date, l.packing_plan_date, "Packing"),
    l.pack_remarks,
    l.packed_date && !lotOnSlip(l.n, slips) && "No slip",
  ]);
}

/** A department's summary, then EC by EC: "40266 · Approved by client". */
const withEcs = (head: string, ecs: { ec: string; text: string }[]) => lines([head, ...ecs.map((e) => `${e.ec} · ${e.text}`)]);

/** Packing Slips, Invoice, Dispatch, Docket & LR and Order Pictures, as the list's five cells read. */
function docCells(docs: OrderDocs | undefined): [string, string, string, string, string] {
  const slips = docs?.packing_slips ?? [];
  const invoices = docs?.invoices ?? [];
  const lotsOf = (v: unknown) => (Array.isArray(v) && v.length ? (v as number[]).map((n) => `L${n}`).join("+") : "");
  return [
    slips
      .map((p) => [str(p.packing_slip_no) || "—", day(p.packing_slip_date), str(p.quantity) && `Qty ${str(p.quantity)}`, lotsOf(p.lot_nos)].filter(Boolean).join(" · "))
      .join("\n"),
    invoices
      .map((v) => {
        const no = str(v.invoice_no) || str(v.challan_no);
        const date = str(v.invoice_date) || str(v.challan_date);
        const value = str(v.invoice_value) || str(v.challan_value);
        return no || date ? [no || "—", day(date), value && `Rs ${money.format(Number(value))}`].filter(Boolean).join(" · ") : "Invoice pending";
      })
      .join("\n"),
    invoices
      .map((v) => (str(v.delivery_mode) ? [str(v.delivery_mode), str(v.transporter_name), str(v.courier_mode), str(v.vehicle_no)].filter(Boolean).join(" · ") : "Dispatch pending"))
      .join("\n"),
    invoices
      .map((v) =>
        str(v.docket_no)
          ? [str(v.docket_no), str(v.booking_date) && `Booked ${day(v.booking_date)}`, str(v.delivery_date) && `Delivered ${day(v.delivery_date)}`, str(v.lr_link) && `LR ${str(v.lr_link)}`]
              .filter(Boolean)
              .join(" · ")
          : str(v.delivery_mode)
            ? "Docket pending"
            : "—"
      )
      .join("\n"),
    slips
      .flatMap((p) => {
        const links = ((p.picture_links ?? []) as Row[]).map((l) => str(l.link));
        return links.length ? [`Slip ${str(p.packing_slip_no) || "—"}`, ...links] : [];
      })
      .join("\n"),
  ];
}

export function ordersSheet(opts: {
  rows: OrderListRow[];
  statuses: Map<string, SoDeptStatus>;
  docs: Map<string, OrderDocs>;
  /** The Pump view: each SO's departments in detail. Absent, the Spare view's columns. */
  pump?: Map<string, PumpSummary>;
  filterLine: string;
}): ReportSheet {
  const { rows, statuses, docs, pump, filterLine } = opts;
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  const Col = (label: string, width: number, group: string, numeric = false) => ({ label, width, group, numeric });
  const lead = [
    Col("Sl.", 7, "SO", true),
    Col("SO No.", 18, "SO"),
    Col("Clearance", 16, "SO"),
    Col("Accounts Hold", 18, "SO"),
    Col("SO Date", 12, "SO"),
    ...(pump ? [] : [Col("Type", 10, "SO")]),
    Col("Client Name", 30, "SO"),
    Col("Client Code", 12, "SO"),
    Col("Rep", 18, "SO"),
    Col("Zone", 10, "SO"),
    Col("Bill Mode", 14, "SO"),
    Col("Order Status", 13, "SO"),
    Col("Order Value", 14, "SO", true),
    Col("Currency", 9, "SO"),
    Col("Order Value (INR)", 14, "SO", true),
    Col("Discount %", 10, "SO", true),
    Col("Packing %", 10, "SO", true),
    Col("GST %", 8, "SO", true),
    Col("Gross Value (USD)", 14, "SO", true),
    Col("Gross Value (INR)", 14, "SO", true),
    Col("Order in Hand", 14, "SO", true),
    ...(pump ? [Col("Quantity", 9, "SO", true)] : []),
    Col("Departments", 30, "SO"),
    Col("Payment terms, PIs & payment", 40, "SO"),
  ];
  const middle = pump
    ? [
        Col("GAD", 30, "Drawing"),
        Col("Perf. Curve", 28, "Drawing"),
        Col("Part Drawing", 26, "Drawing"),
        Col("Drawing Readiness", 14, "Drawing"),
        Col("BOI", 44, "Purchase"),
        Col("QC Docs", 32, "Quality"),
        Col("Planning Status", 16, "Planning"),
        Col("Assembly Readiness", 14, "Planning"),
        ...LOTS.map((n) => Col(`Planning Lot ${n}`, 20, "Planning")),
        Col("Planning Latest Lot", 20, "Planning"),
        Col("Alignment", 26, "Assembly & Packing"),
        ...LOTS.map((n) => Col(`Assembly & Packing Lot ${n}`, 32, "Assembly & Packing")),
        Col("Assembly & Packing Latest Lot", 32, "Assembly & Packing"),
      ]
    : [
        Col("Readiness Date", 14, "Planning"),
        Col("Packing Date", 13, "Assembly & Packing"),
        ...LOTS.map((n) => Col(`Planning Lot ${n}`, 20, "Planning")),
        ...LOTS.map((n) => Col(`Assembly & Packing Lot ${n}`, 24, "Assembly & Packing")),
      ];
  const tail = [
    Col("Packing Slips", 30, "Dispatch"),
    Col("Invoice", 28, "Dispatch"),
    Col("Dispatch", 26, "Dispatch"),
    Col("Docket & LR", 30, "Dispatch"),
    Col("Order Pictures", 40, "Dispatch"),
    Col("Dispatch Status", 16, "Dispatch"),
    Col("ECs", 7, "Dispatch", true),
    Col("Follow Up", 40, "Follow Up"),
  ];
  const columns = [...lead, ...middle, ...tail];

  const out: ReportSheet["rows"] = rows.map((o) => {
    const status = statuses.get(o.id);
    const dispatch = o.dispatch_status || "Pending";
    const closed = CLOSED.includes(dispatch);
    const held = !closed && o.clearance_status === "Hold";
    const hand = closed ? null : orderInHand(o as unknown as Record<string, unknown>);
    const left = hand && !("replacement" in hand) ? hand : null;
    const onlyBilling = o.only_billing === "Yes";
    const s = pump?.get(o.id);
    const currency = o.order_currency || "INR";
    const depts = closed
      ? dispatch
      : onlyBilling
        ? "Only billing"
        : reachedDepts(o, status).map((t) => `${t.name}: ${t.cell.label}`).join("\n");

    const leadCells: [SheetCell, Tone | null][] = [
      [Number(o.sl_no) || str(o.sl_no) || null, null],
      [str(o.so_no) || `#${o.sl_no}`, null],
      o.clearance_status === "Hold" ? [`Hold${o.clearance_hold_reason ? `: ${o.clearance_hold_reason}` : ""}`, "red"] : ["Clear", "green"],
      o.accounts_hold_status === "Hold"
        ? [lines([`Hold${o.accounts_hold_reason ? `: ${o.accounts_hold_reason}` : ""}`, o.accounts_hold_remarks]), "red"]
        : [null, null],
      [day(o.so_date) || null, null],
      ...(pump ? [] : [[str(o.order_type) || null, null] as [SheetCell, Tone | null]]),
      [str(o.client_name) || null, null],
      [str(o.client_code) || null, null],
      [str(o.reps) || null, null],
      [str(o.zone) || null, null],
      [billModeLabel(o.bill_mode, o.bill_type) || null, null],
      [orderStatusOf(o), statusTone(orderStatusOf(o))],
      [amount(o.order_value), null],
      [o.order_value ? currency : null, null],
      [currency.toUpperCase() === "INR" ? amount(o.order_value) : amount(o.order_value_inr), null],
      [amount(o.discount_percent), null],
      [amount(o.packing_forwarding_percent), null],
      [amount(o.gst_percent), null],
      [amount(o.gross_value_usd), null],
      [amount(o.taxable_value), null],
      // A cancelled or diverted SO has nothing left to invoice.
      "replacement" in (hand ?? {}) ? ["Replacement", "muted"] : [left ? Math.round(left.left) : null, left && left.left <= 0 ? "green" : null],
      ...(pump ? [[ecQuantityOf(o.items), null] as [SheetCell, Tone | null]] : []),
      [depts || null, null],
      [paymentText(o), null],
    ];

    // The departments' columns: an Only Billing or closed SO is nobody's work.
    const blank = (text: string | null, tone: Tone | null = null): [SheetCell, Tone | null][] => [
      [text, tone],
      ...Array.from({ length: middle.length - 1 }, (): [SheetCell, Tone | null] => [null, null]),
    ];
    let middleCells: [SheetCell, Tone | null][];
    if (onlyBilling) middleCells = blank("Only billing · no department works on this SO", "muted");
    else if (closed) middleCells = blank(dispatch, "red");
    else if (pump) {
      if (!s || !s.hasEcs) middleCells = blank(s ? "No EC yet" : null, "muted");
      else {
        const d = s.drawing;
        const hold = (text: string) => (s.held ? "Hold" : text);
        const slips = s.slips.map((p) => ({ packing_slip_no: p.no, lot_nos: p.lot_nos }));
        const soLots = (o.lots ?? []) as SoLot[];
        const align = (name: string, yes: string | null, st: string | null, date?: string | null) =>
          yes === "Yes" ? `${name}: ${st ?? "Pending"}${date ? ` ${day(date)}` : ""}` : yes === "No" ? `${name}: No` : null;
        const gad = d.gad.total ? withEcs(`${hold(d.gad.label)} · ${d.gad.done}/${d.gad.total} issued`, d.ecs.map((e) => ({ ec: e.ec, text: e.gad }))) : "—";
        const curve = d.curve
          ? withEcs(`${hold(d.curve.label)} · ${d.curve.done}/${d.curve.total} approved`, d.ecs.filter((e) => e.curve !== "Not required").map((e) => ({ ec: e.ec, text: e.curve })))
          : "Not required";
        const part = d.part
          ? withEcs(`${hold(d.part.label)} · ${d.part.done}/${d.part.total} complete`, d.ecs.filter((e) => e.part !== "Not required").map((e) => ({ ec: e.ec, text: e.part })))
          : "Not required";
        const boi = s.purchase.required
          ? lines([
              `${hold(s.purchase.state)} · ${s.purchase.items ? `${s.purchase.received}/${s.purchase.items} received` : "No items yet"}`,
              ...s.purchase.list.map((b) =>
                [`${b.ec} · ${b.item}`, b.qty != null && `Qty ${b.qty}`, b.status, b.expected && `Exp ${day(b.expected)}`, b.received && `Rcvd ${day(b.received)}`]
                  .filter(Boolean)
                  .join(" · ")
              ),
            ])
          : "Not required";
        const qc = s.quality.required
          ? withEcs(
              `${hold(s.quality.state)} · ${s.quality.total ? `${s.quality.submitted}/${s.quality.total} ECs submitted` : "No ECs yet"}`,
              s.quality.ecs.map((e) => ({
                ec: e.ec,
                text: [e.total ? `${e.label} ${e.done}/${e.total}` : e.label, e.last && day(e.last), e.missing.length && `to give: ${e.missing.join(", ")}`]
                  .filter(Boolean)
                  .join(" · "),
              }))
            )
          : "Not required";
        middleCells = [
          [gad, statusTone(s.held ? "Hold" : d.gad.label)],
          [curve, d.curve ? statusTone(s.held ? "Hold" : d.curve.label) : "muted"],
          [part, d.part ? statusTone(s.held ? "Hold" : d.part.label) : "muted"],
          [d.closed ? lines(["Closed", d.readiness && `Readiness ${day(d.readiness)}`]) : day(d.readiness) || null, d.closed ? "green" : d.readiness && d.readiness < today ? "red" : null],
          [boi, s.purchase.required ? (s.held ? "red" : s.purchase.state === "Closed" ? "green" : "amber") : "muted"],
          [qc, s.quality.required ? (s.held ? "red" : s.quality.state === "Closed" ? "green" : "amber") : "muted"],
          [hold(s.planning.status), statusTone(hold(s.planning.status))],
          [day(s.planning.readiness) || null, null],
          ...LOTS.map((n): [SheetCell, Tone | null] => {
            const t = planningLot(soLots[n - 1]);
            return [t || null, t ? statusTone(t) : null];
          }),
          // The latest, however many lots there are: which it is, then as any lot.
          ((): [SheetCell, Tone | null] => {
            const last = soLots[soLots.length - 1];
            const t = planningLot(last);
            return [t ? `Lot ${last.n}\n${t}` : null, t ? statusTone(t) : null];
          })(),
          [
            lines([
              align("Base plate", s.alignment.base_plate, s.alignment.base_plate_status, s.alignment.base_plate_date),
              align(
                "Wooden box",
                s.alignment.wooden_box,
                s.alignment.wooden_box_status,
                s.alignment.wooden_box_status === "Received" ? s.alignment.wooden_box_received_date : null
              ),
            ]) || null,
            null,
          ],
          ...LOTS.map((n): [SheetCell, Tone | null] => {
            if (s.held) return ["Hold", "red"];
            if (!s.sentToAssembly) return [null, null];
            const t = pumpLot(s.lots.find((l) => l.n === n && l.ecs.length > 0), slips);
            return [t || null, t ? (t.includes("No slip") ? "red" : statusTone(t)) : null];
          }),
          ((): [SheetCell, Tone | null] => {
            if (s.held) return ["Hold", "red"];
            if (!s.sentToAssembly) return [null, null];
            const last = latestPumpLot(s.lots);
            const t = pumpLot(last, slips);
            return [t && last ? `Lot ${last.n}\n${t}` : null, t ? (t.includes("No slip") ? "red" : statusTone(t)) : null];
          })(),
        ];
      }
    } else {
      const lots = (o.lots ?? []) as SoLot[];
      const planning = planningText(o, status);
      const asm = assemblyView(o, status, (v) => day(v));
      const readiness = o.readiness_from
        ? o.readiness_to && o.readiness_to !== o.readiness_from
          ? `${day(o.readiness_from)} – ${day(o.readiness_to)}`
          : day(o.readiness_from)
        : "";
      const planDate =
        o.packing_plan?.date ??
        lots.reduce<string | null>((latest, l) => (l.packing_plan_date && (!latest || l.packing_plan_date > latest) ? l.packing_plan_date : latest), null);
      const lotted = lots.length > 0 && !held;
      const asmText = reachedAssembly(status) ? lines([asm.text, asm.line]) : "";
      middleCells = [
        [readiness || null, null],
        [planDate ? lines([day(planDate), o.packing_plan?.shift && `${o.packing_plan.shift} shift`]) : null, null],
        ...LOTS.map((n, i): [SheetCell, Tone | null] => {
          if (!lotted) return i === 0 ? [held ? "Hold" : planning, held ? "red" : planning ? statusTone(planning) : null] : [null, null];
          const t = planningLot(lots[n - 1]);
          return [t || null, t ? statusTone(t) : null];
        }),
        ...LOTS.map((n, i): [SheetCell, Tone | null] => {
          if (!lotted) return i === 0 ? [held ? "Hold" : asmText || null, held ? "red" : asmText ? statusTone(asmText) : null] : [null, null];
          const t = packingLot(lots[n - 1], today);
          return [t || null, t ? (t.includes("No slip") || t.includes("overdue") ? "red" : statusTone(t)) : null];
        }),
      ];
    }

    const atDispatch = closed || (s ? s.sentToDispatch : reachedDispatch(o));
    const dispatchText = closed ? dispatch : onlyBilling ? null : held || dispatch === "Hold" ? "Hold" : atDispatch ? dispatch : "Not at Dispatch yet";
    const tailCells: [SheetCell, Tone | null][] = [
      ...docCells(docs.get(o.id)).map((t): [SheetCell, Tone | null] => [t || null, /pending/i.test(t) ? "amber" : null]),
      [
        dispatchText,
        !dispatchText ? null : dispatchText === "Hold" || closed ? "red" : !atDispatch ? "muted" : dispatch.toLowerCase() === "pending" ? "amber" : "green",
      ],
      [Number(o.ec_count ?? 0), null],
      [
        o.last_followup
          ? lines([`${day(o.last_followup.followup_date)}: ${o.last_followup.remarks}`, `Next ${day(o.last_followup.next_followup_date)}`])
          : null,
        null,
      ],
    ];
    const cells = [...leadCells, ...middleCells, ...tailCells];
    return {
      cells: cells.map((c) => c[0]),
      tones: cells.map((c) => c[1]),
      bold: columns.map((c) => c.label === "SO No."),
    };
  });

  return {
    title: pump ? "Pump order report" : "Spare order report",
    filterLine,
    summary: {
      // No summary tiles: the sheet is the list itself.
      tiles: [],
      counts: [],
    },
    columns,
    rows: out,
  };
}
