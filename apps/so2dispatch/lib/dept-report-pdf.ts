import "server-only";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage, type RGB } from "pdf-lib";
import { sanitize, wrap } from "@/lib/pdf-text";
import { PACKED_FOR, PACKING_IN_PROGRESS, lotNosLabel, packingLotsFromRows, parseLotNos } from "@/lib/ready-lots";
import { stepsDone } from "@/lib/dispatch-steps";
import { billModeLabel } from "@/lib/order-schema";

// Assembly & Packing's and Dispatch's queues on paper, the way Planning's
// report is: summary tiles, then one line per SO — built from the same rows
// and the same filter as the queue on screen. Assembly & Packing's Spare
// Excel reads the same lines (assemblyReport).

type Row = Record<string, unknown>;

const str = (v: unknown) => (v === null || v === undefined ? "" : String(v).trim());

function day(v: unknown, year = true): string {
  const s = str(v).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return "";
  return new Date(`${s}T00:00:00Z`).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    ...(year ? { year: "2-digit" } : {}),
    timeZone: "UTC",
  });
}

function todayIst(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

function daysLate(date: string): number {
  if (!date) return 0;
  const d = Math.round(
    (new Date(`${todayIst()}T00:00:00Z`).getTime() - new Date(`${date}T00:00:00Z`).getTime()) / 86_400_000
  );
  return d > 0 ? d : 0;
}

export const C = {
  ink: rgb(0.09, 0.11, 0.15),
  muted: rgb(0.42, 0.45, 0.5),
  rule: rgb(0.85, 0.87, 0.9),
  tile: rgb(0.95, 0.96, 0.97),
  red: rgb(0.85, 0.15, 0.2),
  green: rgb(0.05, 0.5, 0.3),
  amber: rgb(0.7, 0.42, 0.02),
  blue: rgb(0.03, 0.45, 0.7),
};

/** One line of a stacked cell: its own colour and weight, smaller when muted detail. */
export type Line = { text: string; color?: RGB; bold?: boolean; small?: boolean };
/** A cell: one text, or several lines stacked (each lot on its own line, say). */
export type Cell = { text: string; color?: RGB; bold?: boolean; lines?: Line[] };
type Column = { label: string; width: number };
export type Report = {
  title: string;
  filterLine: string;
  tiles: { label: string; value: number | string; color?: RGB }[];
  /** A one-line breakdown under the tiles, e.g. SOs by status. */
  breakdown?: { label: string; line: string };
  columns: Column[];
  rows: Cell[][];
  empty: string;
};

// A4 landscape, in points; columns sum to the content width (770).
const PAGE = { w: 842, h: 595 };
const MARGIN = 36;
const WIDTH = PAGE.w - MARGIN * 2;

/** One report: title and filter, tiles, a breakdown, then the table across pages. */
async function buildReport(r: Report): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(r.title);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  let page: PDFPage = pdf.addPage([PAGE.w, PAGE.h]);
  let y = PAGE.h - MARGIN;
  const BOTTOM = MARGIN + 16;
  const text = (s: string, x: number, at: number, size: number, f: PDFFont, color = C.ink) =>
    page.drawText(sanitize(s, f), { x, y: at, size, font: f, color });

  const generated = new Date().toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Kolkata",
  });
  text(r.title, MARGIN, y - 16, 16, bold);
  const sub = wrap(`${r.filterLine || "All SOs in the queue"}  ·  generated ${generated} IST`, font, 8.5, WIDTH);
  sub.forEach((l, n) => text(l, MARGIN, y - 30 - n * 10, 8.5, font, C.muted));
  y -= 40 + (sub.length - 1) * 10;

  const tileW = Math.min(110, (WIDTH - 8 * (r.tiles.length - 1)) / r.tiles.length);
  r.tiles.forEach((t, i) => {
    const x = MARGIN + i * (tileW + 8);
    page.drawRectangle({ x, y: y - 40, width: tileW, height: 40, color: C.tile });
    text(t.label.toUpperCase(), x + 8, y - 13, 6.5, bold, C.muted);
    text(String(t.value), x + 8, y - 32, 15, bold, t.color ?? C.ink);
  });
  y -= 54;
  if (r.breakdown?.line) {
    text(r.breakdown.label.toUpperCase(), MARGIN, y - 7, 6.5, bold, C.muted);
    const lines = wrap(r.breakdown.line, font, 9, WIDTH);
    lines.forEach((l, n) => text(l, MARGIN, y - 20 - n * 11, 9, font));
    y -= 30 + (lines.length - 1) * 11;
  }

  function header() {
    let cx = MARGIN;
    for (const c of r.columns) {
      text(c.label.toUpperCase(), cx, y - 8, 6.5, bold, C.muted);
      cx += c.width;
    }
    y -= 13;
    page.drawLine({ start: { x: MARGIN, y }, end: { x: MARGIN + WIDTH, y }, thickness: 0.75, color: C.rule });
    y -= 2;
  }
  y -= 6;
  header();
  if (r.rows.length === 0) text(r.empty, MARGIN, y - 12, 9, font, C.muted);

  for (const row of r.rows) {
    // Every cell as lines to draw, each wrapped to its column.
    type Drawn = { t: string; f: PDFFont; size: number; color: RGB; dy: number };
    const cells: { out: Drawn[]; h: number }[] = row.map((c, i) => {
      const width = r.columns[i].width - 6;
      const src: Line[] = c.lines?.length ? c.lines : [{ text: c.text, color: c.color, bold: c.bold }];
      const out: Drawn[] = [];
      let dy = 0;
      src.forEach((l, n) => {
        const f = l.bold ? bold : font;
        const size = l.small ? 7.5 : 8.5;
        // A little air between stacked items (a new lot), none inside one.
        if (n > 0 && !l.small) dy += 2;
        const color = !l.text ? C.muted : l.color ?? (l.small ? C.muted : C.ink);
        for (const t of wrap(l.text || "—", f, size, width)) {
          out.push({ t, f, size, color, dy });
          dy += l.small ? 9 : 10.5;
        }
      });
      return { out, h: dy };
    });
    const h = Math.max(...cells.map((c) => c.h)) + 6;
    if (y - h < BOTTOM) {
      page = pdf.addPage([PAGE.w, PAGE.h]);
      y = PAGE.h - MARGIN;
      header();
    }
    let cx = MARGIN;
    cells.forEach((cell, i) => {
      for (const d of cell.out) text(d.t, cx, y - 9 - d.dy, d.size, d.f, d.color);
      cx += r.columns[i].width;
    });
    y -= h;
    page.drawLine({ start: { x: MARGIN, y: y + 2 }, end: { x: MARGIN + WIDTH, y: y + 2 }, thickness: 0.4, color: C.rule });
  }

  const pages = pdf.getPages();
  pages.forEach((p, n) => {
    p.drawText(r.title, { x: MARGIN, y: MARGIN - 10, size: 7, font, color: C.muted });
    const label = `Page ${n + 1} of ${pages.length}`;
    p.drawText(label, { x: PAGE.w - MARGIN - font.widthOfTextAtSize(label, 7), y: MARGIN - 10, size: 7, font, color: C.muted });
  });
  return pdf.save();
}

const dispatchColor = (s: string) =>
  s === "Fully dispatch" ? C.green : s === "LOT dispatch" ? C.blue : C.amber;

// ── Assembly & Packing ───────────────────────────────────────────────────

/** Assembly & Packing's queue as one PDF: its lots' packing plan, the slips, where Dispatch is. */
export async function buildAssemblyReportPdf(rows: Row[], filterLine: string, title?: string): Promise<Uint8Array> {
  return buildReport(assemblyReport(rows, filterLine, title));
}

/** Assembly & Packing's report, one line per SO: the PDF's, and the Spare Excel's. */
export function assemblyReport(rows: Row[], filterLine: string, title = "Assembly & Packing report"): Report {
  const groups = new Map<string, Row[]>();
  for (const r of rows) {
    const k = str(r.order_id);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(r);
  }

  const byStatus = new Map<string, number>();
  let ecCount = 0;
  let overdueSos = 0;
  let noSlipLots = 0;
  let inProgress = 0;
  let packedSos = 0;

  const lines: Cell[][] = [...groups.values()].map((ecs) => {
    const head = ecs[0];
    ecCount += ecs.length;
    const slips = (Array.isArray(head.so_child_rows) ? head.so_child_rows : []) as Row[];
    const numbered = slips.filter((s) => str(s.packing_slip_no));
    // Each EC's state: its last lot (In Progress / packed), or a Pump's packing date.
    const ecState = (ec: Row) => {
      const lots = packingLotsFromRows(ec.ready_lots);
      const last = lots[lots.length - 1];
      if (last) return last.packed_date ? PACKED_FOR[last.status] ?? "Packed" : PACKING_IN_PROGRESS;
      return str(ec.actual_packing_date) ? "Fully packed" : "Pending";
    };
    const states = ecs.map(ecState);
    const uniq = [...new Set(states)];
    const status = uniq.length === 1 ? uniq[0] : `Mixed (${uniq.map((s) => `${states.filter((x) => x === s).length} ${s}`).join(", ")})`;
    byStatus.set(uniq.length === 1 ? uniq[0] : "Mixed", (byStatus.get(uniq.length === 1 ? uniq[0] : "Mixed") ?? 0) + 1);
    if (states.includes(PACKING_IN_PROGRESS)) inProgress++;
    if (uniq.length === 1 && uniq[0] === "Fully packed") packedSos++;

    // Lot by lot: plan and packing, and whether a packed lot is on a slip.
    const lotLines: Line[] = [];
    const due: string[] = [];
    const planned: string[] = [];
    const lotNosOnSlips = new Set(numbered.flatMap((s) => parseLotNos(s.lot_nos)));
    const perEc = ecs.map((ec) => packingLotsFromRows(ec.ready_lots));
    const maxLots = Math.max(0, ...perEc.map((l) => l.length));
    for (let n = 1; n <= maxLots; n++) {
      const lots = perEc.map((l) => l[n - 1]).filter(Boolean);
      // "L1 · Fully ready · Packed 13 Oct", and under it the plan: "Plan 12 Oct · Day · PDI No".
      const head = (l: (typeof lots)[number]) =>
        `L${n} · ${l.status || "—"} · ${l.packed_date ? `Packed ${day(l.packed_date, false)}` : PACKING_IN_PROGRESS}`;
      // The plan says nothing new when it is just the day it was packed, with no shift or PDI.
      const plan = (l: (typeof lots)[number]) =>
        l.packed_date && l.packing_plan_date === l.packed_date && !l.packing_shift && !l.pdi
          ? ""
          : [l.packing_plan_date ? `Plan ${day(l.packing_plan_date, false)}` : "", l.packing_shift, l.pdi ? `PDI ${l.pdi}` : ""]
              .filter(Boolean)
              .join(" · ");
      const heads = [...new Set(lots.map(head))];
      const plans = [...new Set(lots.map(plan).filter(Boolean))];
      const packedHere = lots.some((l) => l.packed_date);
      const noSlip = packedHere && !lotNosOnSlips.has(n);
      if (noSlip) noSlipLots++;
      lotLines.push({
        text: `${heads.length === 1 ? heads[0] : `L${n} · ${heads.length} ECs differ`}${noSlip ? " · No slip" : ""}`,
        color: noSlip ? C.red : packedHere ? C.green : C.amber,
        bold: noSlip,
      });
      if (plans.length) lotLines.push({ text: plans.length === 1 ? plans[0] : "Plans differ by EC", small: true });
      for (const l of lots) {
        if (!l.packed_date && l.packing_plan_date) due.push(l.packing_plan_date);
        if (l.packing_plan_date) planned.push(l.packing_plan_date);
      }
    }
    due.sort();
    const late = daysLate(due[0] ?? "");
    if (late > 0) overdueSos++;
    // The next packing date still to come; once all is packed, the last one.
    const next = due[0] ? day(due[0]) : planned.length ? day(planned.sort()[planned.length - 1]) : "";
    // Each slip on its own line: number, date, the lots it carries.
    const slipLines: Line[] = numbered.map((s) => ({
      text: [str(s.packing_slip_no), day(s.packing_slip_date, false), lotNosLabel(s.lot_nos)].filter(Boolean).join(" · "),
    }));
    const dispatch = str(head.so_dispatch_status) || "Pending";

    return [
      { text: str(head.sl_no) },
      { text: str(head.so_no) || `#${str(head.sl_no)}`, bold: true },
      { text: day(head.so_date) },
      { text: [...new Set(ecs.map((e) => str(e.item_type) || str(head.order_type)))].filter(Boolean).join(" / ") },
      { text: String(ecs.length) },
      { text: status, color: status === "Fully packed" ? C.green : status === PACKING_IN_PROGRESS ? C.amber : undefined },
      { text: next },
      { text: late > 0 ? `${late} d` : "", color: C.red, bold: late > 0 },
      { text: lotLines.length ? "lots" : "", lines: lotLines },
      { text: slipLines.length ? "slips" : "", lines: slipLines },
      { text: dispatch, color: dispatchColor(dispatch) },
    ];
  });

  return {
    title,
    filterLine,
    tiles: [
      { label: "SOs", value: groups.size },
      { label: "ECs", value: ecCount },
      { label: "In Progress", value: inProgress, color: C.amber },
      { label: "Fully packed", value: packedSos, color: C.green },
      { label: "Overdue", value: overdueSos, color: C.red },
      { label: "Packed, no slip", value: noSlipLots, color: C.red },
    ],
    breakdown: {
      label: "SOs by status",
      line: [...byStatus.entries()].sort((a, b) => b[1] - a[1]).map(([s, n]) => `${s}: ${n}`).join("   ·   "),
    },
    columns: [
      { label: "Sl.", width: 26 },
      { label: "SO No.", width: 76 },
      { label: "SO date", width: 46 },
      { label: "Type", width: 34 },
      { label: "ECs", width: 22 },
      { label: "Status", width: 78 },
      { label: "Packing date", width: 56 },
      { label: "Overdue", width: 40 },
      { label: "Lots (plan · packed)", width: 202 },
      { label: "Packing slips", width: 126 },
      { label: "Dispatch", width: 64 },
    ],
    rows: lines,
    empty: "No SO matches this filter.",
  };
}

// ── Dispatch ─────────────────────────────────────────────────────────────

const money = (v: unknown) => {
  const s = str(v);
  if (!s) return "";
  const n = Number(s);
  return Number.isFinite(n) ? n.toLocaleString("en-IN", { maximumFractionDigits: 2 }) : s;
};
const pct = (v: unknown) => (str(v) ? `${money(v)}%` : "—");

/**
 * What is still to invoice of the SO: its gross value less what is invoiced
 * (under a rupee either way is all of it), as the Dispatch page reads it. A
 * Challan / FR SO is a replacement, at no value; null when no gross is set.
 */
export function orderInHand(o: Row): { replacement: true } | { left: number; invoiced: number } | null {
  if (str(o.bill_type) === "Challan") return { replacement: true };
  if (!str(o.taxable_value)) return null;
  const invoiced = Number(o.invoiced_value ?? 0) || 0;
  const diff = Number(o.taxable_value) - invoiced;
  return { left: Math.abs(diff) < 1 ? 0 : diff, invoiced };
}

/** The SO's order value to its gross, as the Order Value Details cell lists it. */
export function orderValueLines(o: Row): [string, string][] {
  const cur = str(o.order_currency) ? ` ${str(o.order_currency)}` : "";
  return [
    ["Order value", money(o.order_value) ? `${money(o.order_value)}${cur}` : "—"],
    ["Discount", pct(o.discount_percent)],
    ["Packing", pct(o.packing_forwarding_percent)],
    ["GST", pct(o.gst_percent)],
    ["Gross value", money(o.taxable_value) ? `${money(o.taxable_value)}${cur}` : "—"],
  ];
}

/** Dispatch's queue as one PDF: slips waiting, each dispatch's three steps, the SO's stage and status. */
export async function buildDispatchReportPdf(rows: Row[], filterLine: string): Promise<Uint8Array> {
  return buildReport(dispatchReport(rows, filterLine));
}

/** Dispatch's report, one line per SO: the PDF's, and what the Excel reads. */
export function dispatchReport(rows: Row[], filterLine: string): Report {
  const stageCount = new Map<string, number>();
  let waitingSlips = 0;
  let full = 0;
  let lot = 0;

  const lines: Cell[][] = rows.map((o) => {
    const challan = str(o.bill_type) === "Challan";
    const slips = (Array.isArray(o.packing_slips) ? o.packing_slips : []) as Row[];
    const invoices = (Array.isArray(o.invoices) ? o.invoices : []) as Row[];
    const waiting = slips.filter((s) => !str(s.invoice_id));
    waitingSlips += waiting.length;
    // "1703/1 · 08 Oct · Lot 1": the slip, its date, the lots it carries.
    const slipName = (s: Row) =>
      [str(s.packing_slip_no) || "—", day(s.packing_slip_date, false), lotNosLabel(s.lot_nos)].filter(Boolean).join(" · ");
    const dispatches = invoices.map((inv, i) => {
      const done = stepsDone(inv, o.bill_type);
      const doc = challan ? str(inv.challan_no) : str(inv.invoice_no);
      const date = day(challan ? inv.challan_date : inv.invoice_date, false);
      const own = (Array.isArray(inv.slips) ? inv.slips : []) as Row[];
      // "#1 · Inv 26-27/1PD/000814 · 12 Sept", then its slips and how it went, small.
      const main: Line = {
        text: `#${i + 1} · ${done.invoice ? `${challan ? "Challan" : "Invoice"} ${doc} · ${date}` : `${challan ? "Challan" : "Invoice"} pending`}`,
        color: done.invoice && done.dispatch && done.docket ? C.green : C.amber,
      };
      const detail: Line = {
        text: [
          own.length ? `Slip ${own.map(slipName).join(", ")}` : "",
          done.dispatch ? str(inv.delivery_mode) : "dispatch pending",
          done.docket ? `Docket ${str(inv.docket_no)}` : "docket pending",
        ]
          .filter(Boolean)
          .join(" · "),
        small: true,
      };
      return [main, detail];
    });
    const stage = str(o.dispatch_stage);
    stageCount.set(stage || "—", (stageCount.get(stage || "—") ?? 0) + 1);
    const status = str(o.dispatch_status) || "Pending";
    if (status === "Fully dispatch") full++;
    if (status === "LOT dispatch") lot++;
    const cur = str(o.order_currency) ? ` ${str(o.order_currency)}` : "";
    const details: Line[] = orderValueLines(o).map(([k, v], i, all) => ({ text: `${k}: ${v}`, bold: i === all.length - 1, small: i < all.length - 1 }));
    const hand = orderInHand(o);
    const inHand: Line[] = !hand
      ? []
      : "replacement" in hand
        ? [{ text: "Replacement", color: C.muted }]
        : [
            { text: `${money(hand.left)}${cur}`, bold: true, color: hand.left > 0 ? undefined : C.green },
            { text: `Invoiced ${money(hand.invoiced)}`, small: true },
          ];
    return [
      { text: str(o.sl_no) },
      { text: str(o.so_no) || `#${str(o.sl_no)}`, bold: true },
      { text: day(o.so_date) },
      { text: str(o.client_name) },
      { text: billModeLabel(o.bill_mode as string | null, o.bill_type as string | null) || "" },
      { text: waiting.length ? "waiting" : "", lines: waiting.map((w) => ({ text: slipName(w), color: C.amber })) },
      { text: dispatches.length ? "dispatches" : "", lines: dispatches.flat() },
      { text: stage, color: stage === "Docket & LR done" ? C.green : stage ? C.amber : undefined },
      { text: status, color: dispatchColor(status), bold: status === "Fully dispatch" },
      { text: "details", lines: details },
      { text: inHand.length ? "in hand" : "", lines: inHand },
    ];
  });

  return {
    title: "Dispatch report",
    filterLine,
    tiles: [
      { label: "SOs", value: rows.length },
      { label: "Slips waiting", value: waitingSlips, color: C.amber },
      { label: "Fully dispatch", value: full, color: C.green },
      { label: "LOT dispatch", value: lot, color: C.blue },
      { label: "Pending", value: rows.length - full - lot, color: C.amber },
    ],
    breakdown: {
      label: "SOs by stage",
      line: [...stageCount.entries()].sort((a, b) => b[1] - a[1]).map(([s, n]) => `${s}: ${n}`).join("   ·   "),
    },
    columns: [
      { label: "Sl.", width: 26 },
      { label: "SO No.", width: 72 },
      { label: "SO date", width: 46 },
      { label: "Client", width: 80 },
      { label: "Bill mode", width: 52 },
      { label: "Slips waiting", width: 72 },
      { label: "Dispatches", width: 150 },
      { label: "Stage", width: 62 },
      { label: "Dispatch", width: 54 },
      { label: "Order details", width: 92 },
      { label: "Order in hand", width: 64 },
    ],
    rows: lines,
    empty: "No SO matches this filter.",
  };
}
