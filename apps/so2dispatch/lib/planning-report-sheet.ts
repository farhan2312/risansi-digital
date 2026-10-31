import "server-only";
import {
  COLUMNS,
  cellText,
  pumpSummary,
  pumpLines,
  soLines,
  spareSummary,
  spareTone,
} from "@/lib/planning-report-pdf";
import { readinessSummary } from "@/lib/readiness-history";
import { PLANNING_CONTEXT_FIELDS, PUMP_LIKE, READY_LOT_LIMIT, pumpEcStatus, type OrderField } from "@/lib/order-schema";
import { ecDone, pumpEcStage, pumpLotsFromEcs, type PumpLot } from "@/lib/assembly";
import { boiInHand, boiStatus, drawingDocStatus, drawingVersions, versionLabel } from "@/lib/dept-view";
import { partDrawingStatus } from "@/lib/part-drawings";
import { lotOnSlip, lotsFromRows } from "@/lib/ready-lots";
import type { PumpSummary } from "@/lib/pump-summary";
import type { ReadyLotEvent } from "@/lib/orders";

// Planning's report as a sheet — what the Excel holds and what the pop-up's
// Excel view shows, cell for cell. Spare: the PDF's lines, one per SO. Pump:
// every column of the Pump view but Chat, one row per pump EC (its SO's
// columns repeated on each, so the sheet filters cleanly).

type Row = Record<string, unknown>;

export type Tone = "red" | "green" | "amber" | "blue" | "muted";
export type SheetCell = string | number | null;
export type ReportSheet = {
  title: string;
  filterLine: string;
  summary: { tiles: { label: string; value: number; tone?: Tone }[]; counts: { label: string; text: string }[] };
  /** A column's group heads a band above it (the Pump view's SO, EC details…). */
  columns: { label: string; width: number; group?: string; numeric?: boolean }[];
  /** The first n columns are the SO's: repeated, dimmed, on its later EC rows. */
  soColumns?: number;
  rows: { cells: SheetCell[]; tones: (Tone | null)[]; bold: boolean[]; /** A pump SO's later EC rows. */ repeat?: boolean }[];
};

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

const statusTone = (s: string): Tone | null =>
  /hold/i.test(s)
    ? "red"
    : /^(fully|assembled|packed|received|manufactured|issued)/i.test(s)
      ? "green"
      : /^partial/i.test(s)
        ? "blue"
        : /^(pending|date awaited|in plan|not)/i.test(s)
          ? "amber"
          : null;

/** Spare: the PDF's columns and lines. */
export function spareSheet(rows: Row[], filterLine: string, histories: Map<string, ReadyLotEvent[]>): ReportSheet {
  const lines = soLines(rows, histories);
  const widths: Record<string, number> = {
    sl: 7, so: 18, soDate: 12, type: 10, ecs: 7, status: 22, readiness: 22, overdue: 10,
    dispatchTarget: 13, ld: 11, history: 26, lots: 34, remarks: 34, assembly: 22, dispatch: 18,
  };
  return {
    title: "Spare planning report",
    filterLine,
    summary: spareSummary(lines),
    columns: COLUMNS.map((c) => ({ label: c.label, width: widths[c.key] ?? 14, numeric: c.key === "ecs" || c.key === "overdue" })),
    rows: lines.map((l) => ({
      cells: COLUMNS.map((c) =>
        c.key === "ecs" ? l.ecs : c.key === "overdue" ? (l.overdue > 0 ? l.overdue : null) : cellText(l, c.key) || null
      ),
      tones: COLUMNS.map((c) => spareTone(l, c.key) ?? null),
      bold: COLUMNS.map((c) => c.key === "so" || (c.key === "overdue" && l.overdue > 0)),
    })),
  };
}

/** The SO-level context the Pump view shows, as it formats it. */
const SO_FIELDS: OrderField[] = PLANNING_CONTEXT_FIELDS.filter((f) => !["so_date", "order_type"].includes(f.column));
const fieldText = (f: OrderField, v: unknown) => (f.type === "date" ? day(v) : str(v));

const LOTS = Array.from({ length: READY_LOT_LIMIT }, (_, i) => i + 1);

/** An A&P lot, as its cell reads: where it stands, the counts, the days. */
function asmLotText(lot: PumpLot | undefined, slips: Row[]): string {
  if (!lot) return "";
  const qty = lot.ecs.reduce((t, e) => t + e.qty, 0);
  const assembled = lot.ecs.reduce((t, e) => t + e.assembled, 0);
  const packed = lot.packed_date ? qty : 0;
  const label = lot.packed_date ? "Packed" : lot.assembled_date ? "Assembled" : assembled > 0 ? "Partially assembled" : lot.status || "Pending";
  const when = (done: string, plan: string, word: string) =>
    done ? `${word} ${day(done)}` : plan ? `${word} plan ${day(plan)}` : "";
  return [
    label,
    qty > 0 ? `Qty ${qty} · Assembled ${assembled} · Packed ${packed}` : "",
    when(lot.assembled_date, lot.assembly_plan_date, "Assembly"),
    when(lot.packed_date, lot.packing_plan_date, "Packing"),
    lot.packed_date && !lotOnSlip(lot.n, slips) ? "No slip" : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/** Base plate or wooden box, as the Alignment cell reads. */
function alignmentText(a: PumpSummary["alignment"] | undefined, which: "base_plate" | "wooden_box"): string {
  if (!a) return "";
  const yes = str(a[which]);
  if (yes === "No") return "No";
  if (yes !== "Yes") return "";
  const boxes = which === "wooden_box" && Array.isArray(a.wooden_boxes) ? (a.wooden_boxes as Row[]) : [];
  if (boxes.length) {
    return boxes
      .map((b) => {
        const st = str(b.status) || "Pending";
        const n = (v: unknown) => str(v) || "0";
        return `${str(b.source)}: ${st} · Required ${n(b.required_qty)} · Stock ${n(b.stock_qty)} · Received ${n(b.received_qty)}${
          st === "Received" && str(b.received_date) ? ` · ${day(b.received_date)}` : ""
        }`;
      })
      .join("\n");
  }
  const st = str(a[`${which}_status`]) || "Pending";
  return which === "base_plate" && a.base_plate_date ? `${st}\n${day(a.base_plate_date)}` : st;
}

/** Pump: every column of the Pump view but Chat, one row per pump EC. */
export function pumpSheet(
  rows: Row[],
  filterLine: string,
  histories: Map<string, ReadyLotEvent[]>,
  summaries: Record<string, PumpSummary>
): ReportSheet {
  const C = (label: string, width: number, group: string, numeric = false) => ({ label, width, group, numeric });
  const columns = [
    C("Sl.", 7, "SO", true),
    C("SO No.", 18, "SO"),
    C("SO Date", 12, "SO"),
    ...SO_FIELDS.map((f) => C(f.label, f.type === "date" ? 13 : 11, "SO")),
    C("Status", 16, "Planning (SO)"),
    C("Remarks", 30, "Planning (SO)"),
    C("Assembly Readiness Date", 16, "Planning (SO)"),
    C("Overdue (days)", 10, "Planning (SO)", true),
    C("Date moved", 26, "Planning (SO)"),
    ...LOTS.map((n) => C(`Lot ${n}`, 26, "Planning (SO)")),
    C("Base Plate", 16, "Assembly & Packing · Dispatch"),
    C("Wooden Box", 34, "Assembly & Packing · Dispatch"),
    ...LOTS.map((n) => C(`A&P Lot ${n}`, 30, "Assembly & Packing · Dispatch")),
    C("Packing Slips", 30, "Assembly & Packing · Dispatch"),
    C("Dispatch Status", 18, "Assembly & Packing · Dispatch"),
    C("EC No.", 20, "EC details"),
    C("EC Date", 12, "EC details"),
    C("Pump Type", 12, "EC details"),
    C("Model No.", 24, "EC details"),
    C("Internal Model", 24, "EC details"),
    C("Quantity", 9, "EC details", true),
    C("BOI", 7, "EC details"),
    C("BOI Items", 44, "EC details"),
    C("GAD", 22, "Drawing"),
    C("Part Drawing", 18, "Drawing"),
    C("Actual Pump Status", 18, "Planning (EC)"),
    C("Ready Qty", 10, "Planning (EC)"),
    C("Shortage", 30, "Planning (EC)"),
  ];
  const soCount = columns.findIndex((c) => c.label === "EC No.");

  const groups = new Map<string, Row[]>();
  for (const r of rows) {
    if (!PUMP_LIKE.includes(str(r.item_type))) continue;
    const k = str(r.order_id);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(r);
  }
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  const out: ReportSheet["rows"] = [];
  for (const ecs of groups.values()) {
    const head = ecs[0];
    const orderId = str(head.order_id);
    const held = str(head.clearance_status) === "Hold";
    const s = summaries[orderId];
    const lots = pumpLotsFromEcs(ecs);
    const slips = (Array.isArray(head.so_slips) ? head.so_slips : []) as Row[];
    const hist = readinessSummary(histories.get(orderId) ?? []);
    const overdue = (() => {
      if (/^fully ready$/i.test(str(head.actual_spare_status))) return 0;
      const d = str(head.planning_readiness_date).slice(0, 10);
      if (!d) return 0;
      const days = Math.round((new Date(`${today}T00:00:00Z`).getTime() - new Date(`${d}T00:00:00Z`).getTime()) / 86_400_000);
      return days > 0 ? days : 0;
    })();
    const status = held ? "HOLD" : str(head.actual_spare_status) || "Date awaited";
    const planLots = lotsFromRows(head.ready_lots);
    const dispatch = !s ? "" : s.held ? "Hold" : s.sentToDispatch ? s.dispatch : "Not at Dispatch yet";
    const so: [SheetCell, Tone | null][] = [
      [Number(head.sl_no) || str(head.sl_no) || null, null],
      [str(head.so_no) || `#${str(head.sl_no)}`, null],
      [day(head.so_date), null],
      ...SO_FIELDS.map((f): [SheetCell, Tone | null] => [fieldText(f, head[f.column]) || null, null]),
      [status, statusTone(status)],
      [str(head.pump_readiness_remarks) || null, null],
      [
        day(head.planning_readiness_date) +
          (str(head.planning_readiness_date) && str(head.readiness_date_status) ? ` (${str(head.readiness_date_status)})` : ""),
        null,
      ],
      [overdue > 0 ? overdue : null, overdue > 0 ? "red" : null],
      [hist.dateMoves > 0 ? `${hist.dateMoves}× · ${hist.dates.map((d) => day(d, false)).join(" → ")}` : null, hist.dateMoves > 0 ? "amber" : null],
      ...LOTS.map((n): [SheetCell, Tone | null] => {
        const lot = planLots[n - 1];
        if (!lot) return [null, null];
        const shares = ecs
          .map((e) => {
            const lr = Array.isArray(e.ready_lots) ? (e.ready_lots as Row[]) : [];
            const qty = Number(lr[n - 1]?.qty ?? 0) || 0;
            return qty > 0 ? `${str(e.ec_no)} ×${qty}` : "";
          })
          .filter(Boolean);
        return [[lot.status || "—", day(lot.ready_date), ...shares].filter(Boolean).join("\n"), statusTone(lot.status)];
      }),
      ...(["base_plate", "wooden_box"] as const).map((w): [SheetCell, Tone | null] => {
        const t = alignmentText(s?.alignment, w);
        return [t || null, t && t !== "No" ? statusTone(t.replace(/^[^:]*: /, "")) : null];
      }),
      ...LOTS.map((n): [SheetCell, Tone | null] => {
        if (!s) return [null, null];
        if (s.held) return ["Hold", "red"];
        if (!s.sentToAssembly) return [null, null];
        const t = asmLotText(lots.find((l) => l.n === n && l.ecs.length > 0), slips);
        return [t || null, t ? statusTone(t) : null];
      }),
      [
        s?.slips.length
          ? s.slips
              .map((p) => `${p.no ?? ""}${p.date ? ` · ${day(p.date)}` : ""}${p.qty != null ? ` · Qty ${p.qty}` : ""}${p.kind === "tentative" ? " · tentative" : ""}`)
              .join("\n")
          : null,
        null,
      ],
      [dispatch || null, dispatch === "Hold" ? "red" : /^fully|^dispatched/i.test(dispatch) ? "green" : /lot|partial/i.test(dispatch) ? "blue" : dispatch ? "amber" : null],
    ];
    ecs.forEach((r, k) => {
      const ec = (r.ec ?? {}) as Row;
      const quantity = Number(ec.quantity ?? 0) || 0;
      const stage = held ? "HOLD" : pumpEcStage(pumpEcStatus(r.ready_qty, ec.quantity), quantity, ecDone(lots, str(r.id)));
      const boi = (Array.isArray(r.boi_items) ? r.boi_items : []) as Row[];
      const boiText = boi
        .map((b) => {
          const item = str(b.boi_item) === "Others" ? str(b.boi_item_other) || "Others" : str(b.boi_item) || "Item";
          const inHand = boiInHand(b);
          const d = str(inHand ? b.receipt_date : b.expected_receipt_date).slice(0, 10);
          return [`${item}${str(b.boi_qty) ? ` ×${str(b.boi_qty)}` : ""}`, held ? "Hold" : boiStatus(b).label, d ? `${inHand ? "Rcvd" : "Exp"} ${day(d)}` : ""]
            .filter(Boolean)
            .join(" · ");
        })
        .join("\n");
      const versions = (Array.isArray(r.gad_versions) ? r.gad_versions : []) as Row[];
      const gadSt = drawingDocStatus(versions, "GAD");
      const all = drawingVersions(versions, "GAD");
      const last = all[all.length - 1];
      const gad =
        gadSt.label === "Issued to planning"
          ? [`${versionLabel(gadSt.version)} · Issued${str(last?.issued_to_production_date) ? ` ${day(last?.issued_to_production_date)}` : ""}`, str(last?.planning_link)]
              .filter(Boolean)
              .join("\n")
          : `${gadSt.version ? `${versionLabel(gadSt.version)} · ` : ""}${gadSt.label}`;
      const part = partDrawingStatus(r.part_drawing, (Array.isArray(r.part_drawings) ? r.part_drawings : []) as Row[]);
      const partText = part
        ? `${part.label}\n${part.done}/${part.total} part${part.total === 1 ? "" : "s"}`
        : str(r.part_drawing).toLowerCase() === "no"
          ? "No"
          : "Not asked";
      const short = (Array.isArray(r.part_shortages) ? r.part_shortages : []) as Row[];
      const shortText = short.length
        ? `${short.length} short: ${short.map((p) => (str(p.qty) ? `${str(p.part_name)} ×${str(p.qty)}` : str(p.part_name))).join(", ")}`
        : "None";
      const ecCells: [SheetCell, Tone | null][] = [
        [str(r.ec_no) || str(ec.ec_no) || null, null],
        [day(ec.ec_date) || null, null],
        [str(ec.pump_type) || null, null],
        [str(ec.model_no) || null, null],
        [str(ec.internal_model) || null, null],
        [quantity || null, null],
        [str(ec.boi) || null, null],
        [boiText || null, null],
        [gad, gadSt.tone === "done" ? "green" : gadSt.tone === "rework" ? "red" : gadSt.tone === "part" ? "blue" : "amber"],
        [partText, part ? (part.tone === "done" ? "green" : part.tone === "part" ? "blue" : "amber") : "muted"],
        [stage, statusTone(stage)],
        [`${str(r.ready_qty) || "0"} / ${quantity || "—"}`, null],
        [shortText, short.length ? "red" : "muted"],
      ];
      const cells = [...so, ...ecCells];
      out.push({
        cells: cells.map((c) => c[0]),
        tones: cells.map((c) => c[1]),
        bold: columns.map((c, i) => c.label === "SO No." || c.label === "EC No." || cells[i][1] === "red"),
        repeat: k > 0,
      });
    });
  }
  return {
    title: "Pump planning report",
    filterLine,
    summary: pumpSummary(pumpLines(rows, histories)),
    columns,
    rows: out,
    soColumns: soCount,
  };
}
