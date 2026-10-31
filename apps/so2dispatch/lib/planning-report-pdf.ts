import "server-only";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { sanitize, wrap } from "@/lib/pdf-text";
import { readinessSummary } from "@/lib/readiness-history";
import type { ReadyLotEvent } from "@/lib/orders";
import { PUMP_LIKE, pumpEcStatus } from "@/lib/order-schema";
import { ecDone, pumpEcStage, pumpLotsFromEcs } from "@/lib/assembly";
import { boiInHand } from "@/lib/dept-view";

// Planning's queue on paper. Spare: one line per SO with where it stands — status,
// readiness date, how late it is, its readiness lots — and a summary on top,
// so the team can see its own progress at a glance. Built from the same rows
// and the same filter as the queue on screen. Pump: one line per pump EC,
// its SO's cells on the first, as the Pump view lays it out.

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

/** An EC's planning status, as the queue shows it. */
const ecStatus = (ec: Row) =>
  str(ec.actual_spare_status) || str(ec.actual_pump_status) || str(ec.planning_status) || "Pending";

/** Ready, as far as Planning is concerned: a Spare fully ready, a Pump assembled or packed. */
const ecReady = (ec: Row) =>
  ["fully ready", "assembled", "packed"].includes(
    (str(ec.actual_spare_status) || str(ec.actual_pump_status)).toLowerCase()
  );

function todayIst(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

/** Days past the earliest readiness date of an EC not yet ready; 0 when none. */
function overdueDays(ecs: Row[]): number {
  const dates = ecs
    .filter((ec) => !ecReady(ec))
    .map((ec) => str(ec.planning_readiness_date).slice(0, 10))
    .filter(Boolean)
    .sort();
  if (!dates.length) return 0;
  const days = Math.round(
    (new Date(`${todayIst()}T00:00:00Z`).getTime() - new Date(`${dates[0]}T00:00:00Z`).getTime()) /
      86_400_000
  );
  return days > 0 ? days : 0;
}

export type SoLine = {
  sl: string;
  so: string;
  soDate: string;
  type: string;
  ecs: number;
  status: string;
  readiness: string;
  overdue: number;
  dispatchTarget: string;
  ld: string;
  notes: string;
  /** The readiness lots, and Planning's remarks — each its own column. */
  lots: string;
  remarks: string;
  /** How often the readiness date moved, and the dates it went through. */
  history: string;
  dateMoves: number;
  /** Where Assembly & Packing and Dispatch have got to on the SO. */
  assembly: string;
  dispatch: string;
  /** For the summary. */
  statusKey: string;
  ready: boolean;
};

/** One line per SO, as the report reads it — the PDF's and the Excel's alike. */
export function soLines(rows: Row[], histories: Map<string, ReadyLotEvent[]>): SoLine[] {
  const groups = new Map<string, Row[]>();
  for (const r of rows) {
    const k = str(r.order_id);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(r);
  }
  return [...groups.values()].map((ecs) => {
    const head = ecs[0];
    const statuses = ecs.map(ecStatus);
    const uniq = [...new Set(statuses)];
    const status =
      uniq.length === 1
        ? uniq[0]
        : `Mixed (${uniq.map((s) => `${statuses.filter((x) => x === s).length} ${s}`).join(", ")})`;
    const dates = [...new Set(ecs.map((ec) => str(ec.planning_readiness_date).slice(0, 10)).filter(Boolean))].sort();
    // A Fully ready EC without its own date shows the one it had, and from when.
    const dateStatus = [...new Set(ecs.map((ec) => str(ec.readiness_date_status)).filter(Boolean))];
    const readiness =
      (dates.length === 0 ? "" : dates.length === 1 ? day(dates[0]) : `${day(dates[0])} – ${day(dates[dates.length - 1])}`) +
      (dates.length && dateStatus.length === 1 ? ` (${dateStatus[0]})` : "");
    const types = [...new Set(ecs.map((ec) => str(ec.item_type) || str(head.order_type)).filter(Boolean))];

    // Lots, once per SO when its ECs share them; remarks likewise.
    // Once an EC is Fully ready its lots are history: the statuses stay, the
    // dates go — the Readiness date column already says when.
    const lotText = (ec: Row) => {
      const lots = Array.isArray(ec.ready_lots) ? (ec.ready_lots as Row[]) : [];
      const done = str(ec.actual_spare_status).toLowerCase() === "fully ready";
      return lots
        .map((l, i) => {
          const d = done ? "" : day(l.ready_date, false);
          return `L${i + 1} ${str(l.status)}${d ? ` ${d}` : ""}`;
        })
        .join(", ");
    };
    const lotSets = [...new Set(ecs.map(lotText).filter(Boolean))];
    const lots =
      lotSets.length <= 1
        ? lotSets[0] ?? ""
        : ecs.map((ec) => lotText(ec) && `${str(ec.ec_no) || "EC"}: ${lotText(ec)}`).filter(Boolean).join("; ");
    const remarks = [
      ...new Set(ecs.map((ec) => str(ec.spare_readiness_remarks) || str(ec.pump_readiness_remarks)).filter(Boolean)),
    ].join("; ");

    const ready = ecs.every(ecReady);
    // The same reading as the history popup: "2× · 03 Oct → 06 Oct → 18 Sept".
    const summary = readinessSummary(histories.get(str(head.order_id)) ?? []);
    const history =
      summary.dateMoves > 0
        ? `${summary.dateMoves}× · ${summary.dates.map((d) => day(d, false)).join(" → ")}`
        : "";
    // Assembly & Packing across the ECs: one state, or how they split.
    const asm = ecs.map((ec) => str(ec.assembly_state) || "Pending");
    const asmUniq = [...new Set(asm)];
    const assembly =
      asmUniq.length === 1 ? asmUniq[0] : asmUniq.map((s) => `${asm.filter((x) => x === s).length} ${s}`).join(", ");
    return {
      assembly,
      dispatch: str(head.so_dispatch_status) || "Pending",
      sl: str(head.sl_no),
      so: str(head.so_no) || `#${str(head.sl_no)}`,
      soDate: day(head.so_date),
      type: types.join(" / "),
      ecs: ecs.length,
      status,
      readiness,
      overdue: overdueDays(ecs),
      dispatchTarget: day(head.dispatch_target_date),
      ld: str(head.ld).toLowerCase() === "yes" ? day(head.ld_date) || "Yes" : "",
      notes: [lots, remarks].filter(Boolean).join(" · "),
      lots,
      remarks,
      history,
      dateMoves: summary.dateMoves,
      statusKey: uniq.length === 1 ? uniq[0] : "Mixed",
      ready,
    };
  });
}

/** The SO's lot, as the Pump view reads it: status, day, and each EC's share. */
function pumpLotText(ecs: Row[]): string {
  const head = Array.isArray(ecs[0].ready_lots) ? (ecs[0].ready_lots as Row[]) : [];
  return head
    .map((l, i) => {
      const d = day(l.ready_date, false);
      const shares = ecs
        .map((e) => {
          const rows = Array.isArray(e.ready_lots) ? (e.ready_lots as Row[]) : [];
          const qty = Number(rows[i]?.qty ?? 0) || 0;
          return qty > 0 ? `${str(e.ec_no) || "EC"}×${qty}` : "";
        })
        .filter(Boolean);
      return `L${i + 1} ${str(l.status)}${d ? ` ${d}` : ""}${shares.length ? ` (${shares.join(", ")})` : ""}`;
    })
    .join("; ");
}

/** A pump EC's bought-out items: how many are in hand, of how many. */
function boiText(items: unknown): string {
  const list = Array.isArray(items) ? (items as Row[]) : [];
  if (!list.length) return "";
  return `${list.filter((b) => boiInHand(b)).length}/${list.length} in hand`;
}

/** Planning's Pump report: one line per pump EC, its SO's cells on the first. */
export type PumpLine = {
  /** The SO's — the same on each of its EC lines. */
  sl: string;
  so: string;
  soDate: string;
  dispatchTarget: string;
  ld: string;
  soStatus: string;
  readiness: string;
  overdue: number;
  history: string;
  dateMoves: number;
  lots: string;
  remarks: string;
  dispatch: string;
  /** The EC's own. */
  ec: string;
  pump: string;
  qty: number | null;
  ready: string;
  ecStatus: string;
  boi: string;
  /** The first EC line of its SO; the SO's own state, for the summary. */
  first: boolean;
  held: boolean;
  soReady: boolean;
  ecDone: boolean;
};

export function pumpLines(rows: Row[], histories: Map<string, ReadyLotEvent[]>): PumpLine[] {
  const groups = new Map<string, Row[]>();
  for (const r of rows) {
    if (!PUMP_LIKE.includes(str(r.item_type))) continue;
    const k = str(r.order_id);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(r);
  }
  return [...groups.values()].flatMap((ecs) => {
    const head = ecs[0];
    const held = str(head.clearance_status) === "Hold";
    const soStatus = held ? "HOLD" : str(head.actual_spare_status) || "Date awaited";
    const summary = readinessSummary(histories.get(str(head.order_id)) ?? []);
    const lots = pumpLotsFromEcs(ecs);
    const so = {
      sl: str(head.sl_no),
      so: str(head.so_no) || `#${str(head.sl_no)}`,
      soDate: day(head.so_date),
      dispatchTarget: day(head.dispatch_target_date),
      ld: str(head.ld).toLowerCase() === "yes" ? day(head.ld_date) || "Yes" : "",
      soStatus,
      readiness:
        day(head.planning_readiness_date) +
        (str(head.planning_readiness_date) && str(head.readiness_date_status) ? ` (${str(head.readiness_date_status)})` : ""),
      overdue: overdueDays(ecs),
      history:
        summary.dateMoves > 0 ? `${summary.dateMoves}× · ${summary.dates.map((d) => day(d, false)).join(" → ")}` : "",
      dateMoves: summary.dateMoves,
      lots: pumpLotText(ecs),
      remarks: str(head.pump_readiness_remarks),
      dispatch: str(head.so_dispatch_status) || "Pending",
      held,
      soReady: str(head.actual_spare_status).toLowerCase() === "fully ready",
    };
    return ecs.map((r, k) => {
      const ec = (r.ec ?? {}) as Row;
      const quantity = Number(ec.quantity ?? 0) || 0;
      const stage = pumpEcStage(pumpEcStatus(r.ready_qty, ec.quantity), quantity, ecDone(lots, str(r.id)));
      return {
        ...so,
        ec: str(r.ec_no) || str(ec.ec_no),
        // The pump, its Model No., then its Internal Model after a slash.
        pump: [[str(ec.pump_type), str(ec.model_no)].filter(Boolean).join(" · "), str(ec.internal_model)].filter(Boolean).join(" / "),
        qty: quantity || null,
        ready: `${str(r.ready_qty) || "0"} / ${quantity || "—"}`,
        ecStatus: held ? "HOLD" : stage,
        boi: boiText(r.boi_items),
        first: k === 0,
        ecDone: /^fully/i.test(stage),
      };
    });
  });
}

// A4 landscape, in points; each layout's columns sum to the content width (770).
const PAGE = { w: 842, h: 595 };
const MARGIN = 36;
const WIDTH = PAGE.w - MARGIN * 2;

type Tone = "red" | "green" | "amber" | "blue" | "muted";
type Column<L> = { label: string; width: number; key: keyof L & string };

export const COLUMNS: Column<SoLine>[] = [
  { label: "Sl.", width: 24, key: "sl" },
  { label: "SO No.", width: 70, key: "so" },
  { label: "SO date", width: 46, key: "soDate" },
  { label: "Type", width: 32, key: "type" },
  { label: "ECs", width: 22, key: "ecs" },
  { label: "Status", width: 70, key: "status" },
  { label: "Readiness date", width: 68, key: "readiness" },
  { label: "Overdue", width: 40, key: "overdue" },
  { label: "Dispatch target", width: 50, key: "dispatchTarget" },
  { label: "LD date", width: 36, key: "ld" },
  { label: "Date moved", width: 70, key: "history" },
  { label: "Lots", width: 64, key: "lots" },
  { label: "Remarks", width: 64, key: "remarks" },
  { label: "Assembly & Packing", width: 62, key: "assembly" },
  { label: "Dispatch", width: 52, key: "dispatch" },
];

/** The Pump report's columns: the SO's, then the EC's, then Dispatch. */
export const PUMP_COLUMNS: Column<PumpLine>[] = [
  { label: "Sl.", width: 22, key: "sl" },
  { label: "SO No.", width: 62, key: "so" },
  { label: "Dispatch target", width: 42, key: "dispatchTarget" },
  { label: "LD date", width: 32, key: "ld" },
  { label: "SO status", width: 50, key: "soStatus" },
  { label: "Readiness date", width: 48, key: "readiness" },
  { label: "Overdue", width: 32, key: "overdue" },
  { label: "Date moved", width: 52, key: "history" },
  { label: "Lots", width: 82, key: "lots" },
  { label: "Remarks", width: 56, key: "remarks" },
  { label: "EC No.", width: 50, key: "ec" },
  { label: "Pump · Model / Internal", width: 60, key: "pump" },
  { label: "Qty", width: 22, key: "qty" },
  { label: "Ready", width: 28, key: "ready" },
  { label: "EC status", width: 50, key: "ecStatus" },
  { label: "BOI", width: 30, key: "boi" },
  { label: "Dispatch", width: 52, key: "dispatch" },
];
/** The Pump report's SO columns: shown on an SO's first EC line only. */
export const PUMP_SO_KEYS = new Set<string>(["sl", "so", "dispatchTarget", "ld", "soStatus", "readiness", "overdue", "history", "lots", "remarks", "dispatch"]);

const dispatchTone = (d: string): Tone => (d === "Fully dispatch" ? "green" : d === "LOT dispatch" ? "blue" : "amber");

/** The colour a cell reads in, on paper and in Excel alike. */
export function spareTone(l: SoLine, key: string): Tone | undefined {
  if (key === "overdue" && l.overdue > 0) return "red";
  if (key === "history" && l.dateMoves > 0) return "amber";
  if (key === "status" && l.ready) return "green";
  if (key === "assembly") return /fully packed/i.test(l.assembly) && !/,/.test(l.assembly) ? "green" : "amber";
  if (key === "dispatch") return dispatchTone(l.dispatch);
}
export function pumpTone(l: PumpLine, key: string): Tone | undefined {
  if (key === "overdue" && l.overdue > 0) return "red";
  if (key === "history" && l.dateMoves > 0) return "amber";
  if ((key === "soStatus" || key === "ecStatus") && l.held) return "red";
  if (key === "soStatus" && l.soReady) return "green";
  if (key === "ecStatus") return l.ecDone ? "green" : /partial/i.test(l.ecStatus) ? "amber" : undefined;
  if (key === "boi" && l.boi) return /^(\d+)\/\1 /.test(l.boi) ? "green" : "amber";
  if (key === "dispatch") return dispatchTone(l.dispatch);
}

/** The text a cell holds. */
export function cellText<L>(l: L, key: keyof L & string): string {
  const v = l[key];
  if (key === "overdue") return Number(v) > 0 ? `${v} d` : "";
  return v === null || v === undefined ? "" : String(v);
}

type Tile = { label: string; value: number; tone?: Tone };

/** The summary on top: tiles, then a line or two of counts. */
export function spareSummary(lines: SoLine[]): { tiles: Tile[]; counts: { label: string; text: string }[] } {
  const byStatus = new Map<string, number>();
  for (const l of lines) byStatus.set(l.statusKey, (byStatus.get(l.statusKey) ?? 0) + 1);
  return {
    tiles: [
      { label: "SOs", value: lines.length },
      { label: "ECs", value: lines.reduce((n, l) => n + l.ecs, 0) },
      { label: "Ready", value: lines.filter((l) => l.ready).length, tone: "green" },
      { label: "Overdue", value: lines.filter((l) => l.overdue > 0).length, tone: "red" },
      { label: "Date moved", value: lines.filter((l) => l.dateMoves > 0).length, tone: "amber" },
    ],
    counts: [{ label: "SOs by status", text: countLine(byStatus) }],
  };
}
export function pumpSummary(lines: PumpLine[]): { tiles: Tile[]; counts: { label: string; text: string }[] } {
  const sos = lines.filter((l) => l.first);
  const bySo = new Map<string, number>();
  for (const l of sos) bySo.set(l.soStatus, (bySo.get(l.soStatus) ?? 0) + 1);
  const byEc = new Map<string, number>();
  for (const l of lines) byEc.set(l.ecStatus, (byEc.get(l.ecStatus) ?? 0) + 1);
  return {
    tiles: [
      { label: "SOs", value: sos.length },
      { label: "Pump ECs", value: lines.length },
      { label: "Pumps", value: lines.reduce((n, l) => n + (l.qty ?? 0), 0) },
      { label: "ECs done", value: lines.filter((l) => l.ecDone).length, tone: "green" },
      { label: "Overdue SOs", value: sos.filter((l) => l.overdue > 0).length, tone: "red" },
      { label: "Date moved", value: sos.filter((l) => l.dateMoves > 0).length, tone: "amber" },
    ],
    counts: [
      { label: "SOs by status", text: countLine(bySo) },
      { label: "ECs by status", text: countLine(byEc) },
    ],
  };
}
const countLine = (m: Map<string, number>) =>
  [...m.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([s, n]) => `${s}: ${n}`)
    .join("   ·   ");

/** Planning's report as one PDF: a summary, then every line — Spare by SO, Pump by EC. */
export async function buildPlanningReportPdf(
  rows: Row[],
  filterLine: string,
  histories: Map<string, ReadyLotEvent[]> = new Map(),
  kind: "spare" | "pump" = "spare"
): Promise<Uint8Array> {
  if (kind === "pump") {
    const lines = pumpLines(rows, histories);
    return renderPdf({
      title: "Pump planning report",
      filterLine,
      summary: pumpSummary(lines),
      columns: PUMP_COLUMNS,
      lines,
      tone: pumpTone,
      empty: "No pump EC matches this filter.",
      // The SO's cells once, on its first EC line (and again atop a new page).
      group: { first: (l) => l.first, keys: PUMP_SO_KEYS },
    });
  }
  const lines = soLines(rows, histories);
  return renderPdf({
    title: "Spare planning report",
    filterLine,
    summary: spareSummary(lines),
    columns: COLUMNS,
    lines,
    tone: spareTone,
    empty: "No SO matches this filter.",
  });
}

async function renderPdf<L>(spec: {
  title: string;
  filterLine: string;
  summary: { tiles: Tile[]; counts: { label: string; text: string }[] };
  columns: Column<L>[];
  lines: L[];
  tone: (l: L, key: string) => Tone | undefined;
  empty: string;
  group?: { first: (l: L) => boolean; keys: Set<string> };
}): Promise<Uint8Array> {
  const { columns, lines, group } = spec;
  const pdf = await PDFDocument.create();
  pdf.setTitle(spec.title);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const ink = rgb(0.09, 0.11, 0.15);
  const muted = rgb(0.42, 0.45, 0.5);
  const rule = rgb(0.85, 0.87, 0.9);
  const tile = rgb(0.95, 0.96, 0.97);
  const navy = rgb(0.12, 0.22, 0.39);
  const tones: Record<Tone, ReturnType<typeof rgb>> = {
    red: rgb(0.85, 0.15, 0.2),
    green: rgb(0.05, 0.5, 0.3),
    amber: rgb(0.7, 0.42, 0.02),
    blue: rgb(0.03, 0.45, 0.7),
    muted,
  };

  let page: PDFPage = pdf.addPage([PAGE.w, PAGE.h]);
  let y = PAGE.h - MARGIN;
  const BOTTOM = MARGIN + 16;
  const text = (s: string, x: number, at: number, size: number, f: PDFFont, color = ink) =>
    page.drawText(sanitize(s, f), { x, y: at, size, font: f, color });

  // Title, on a band.
  const generated = new Date().toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Kolkata",
  });
  page.drawRectangle({ x: MARGIN, y: y - 34, width: WIDTH, height: 34, color: navy });
  text("RISANSI · PLANNING", MARGIN + 12, y - 12, 6.5, bold, rgb(0.75, 0.8, 0.9));
  text(spec.title, MARGIN + 12, y - 27, 13, bold, rgb(1, 1, 1));
  y -= 34;
  const sub = wrap(`${spec.filterLine}  ·  generated ${generated} IST`, font, 8.5, WIDTH);
  sub.forEach((l, n) => text(l, MARGIN, y - 12 - n * 10, 8.5, font, muted));
  y -= 20 + (sub.length - 1) * 10;

  // Summary tiles, then the counts.
  const tileGap = 8;
  const tileW = Math.min(110, (WIDTH - tileGap * (spec.summary.tiles.length - 1)) / spec.summary.tiles.length);
  let x = MARGIN;
  for (const t of spec.summary.tiles) {
    page.drawRectangle({ x, y: y - 40, width: tileW, height: 40, color: tile });
    page.drawRectangle({ x, y: y - 40, width: 2.5, height: 40, color: t.tone ? tones[t.tone] : navy });
    text(t.label.toUpperCase(), x + 9, y - 13, 6.5, bold, muted);
    text(String(t.value), x + 9, y - 32, 15, bold, t.tone ? tones[t.tone] : ink);
    x += tileW + tileGap;
  }
  y -= 52;
  for (const c of spec.summary.counts) {
    if (!c.text) continue;
    text(c.label.toUpperCase(), MARGIN, y - 7, 6.5, bold, muted);
    const sl = wrap(c.text, font, 9, WIDTH);
    sl.forEach((l, n) => text(l, MARGIN, y - 19 - n * 11, 9, font));
    y -= 26 + (sl.length - 1) * 11;
  }

  // Long labels wrap onto a second line rather than running into the next column.
  const headLines = columns.map((c) => wrap(c.label.toUpperCase(), bold, 6.5, c.width - 5));
  const headH = Math.max(...headLines.map((l) => l.length)) * 7.5 + 7;
  function headerRow() {
    page.drawRectangle({ x: MARGIN, y: y - headH, width: WIDTH, height: headH, color: tile });
    let cx = MARGIN;
    columns.forEach((c, i) => {
      headLines[i].forEach((l, k) => text(l, cx + 2, y - 9 - k * 7.5, 6.5, bold, muted));
      cx += c.width;
    });
    y -= headH;
    page.drawLine({ start: { x: MARGIN, y }, end: { x: MARGIN + WIDTH, y }, thickness: 0.75, color: rule });
    y -= 2;
  }

  y -= 4;
  headerRow();
  if (lines.length === 0) text(spec.empty, MARGIN, y - 12, 9, font, muted);

  // Where the SO's columns end, to rule only the EC's between ECs of one SO.
  const groupEnd = group ? columns.findIndex((c) => !group.keys.has(c.key)) : -1;
  const ecX = MARGIN + columns.slice(0, Math.max(0, groupEnd)).reduce((t, c) => t + c.width, 0);
  let fresh = true;
  lines.forEach((l, li) => {
    const build = (showSo: boolean) =>
      columns.map((c) => {
        if (group && !showSo && group.keys.has(c.key)) return [] as string[];
        return wrap(cellText(l, c.key) || "—", font, 8.5, c.width - 6);
      });
    const showSo = !group || group.first(l) || fresh;
    let cells = build(showSo);
    let h = Math.max(1, ...cells.map((c) => c.length)) * 10.5 + 6;
    if (y - h < BOTTOM) {
      page = pdf.addPage([PAGE.w, PAGE.h]);
      y = PAGE.h - MARGIN;
      headerRow();
      // An SO carried onto a new page shows its cells again.
      cells = build(true);
      h = Math.max(1, ...cells.map((c) => c.length)) * 10.5 + 6;
    }
    fresh = false;
    let cx = MARGIN;
    cells.forEach((cl, n) => {
      const key = columns[n].key;
      const t = spec.tone(l, key);
      const color = t ? tones[t] : cl[0] === "—" ? muted : ink;
      const f = key === "so" || key === "ec" || t === "red" ? bold : font;
      cl.forEach((s, k) => text(s, cx + 2, y - 9 - k * 10.5, 8.5, f, color));
      cx += columns[n].width;
    });
    y -= h;
    // Between ECs of one SO, a rule under the EC's columns only.
    const next = lines[li + 1];
    const within = group && next && !group.first(next);
    page.drawLine({
      start: { x: within ? ecX : MARGIN, y: y + 2 },
      end: { x: MARGIN + WIDTH, y: y + 2 },
      thickness: within ? 0.3 : 0.5,
      color: rule,
    });
  });

  const pages = pdf.getPages();
  pages.forEach((p, n) => {
    p.drawText(spec.title, { x: MARGIN, y: MARGIN - 10, size: 7, font, color: muted });
    const label = `Page ${n + 1} of ${pages.length}`;
    p.drawText(label, {
      x: PAGE.w - MARGIN - font.widthOfTextAtSize(label, 7),
      y: MARGIN - 10,
      size: 7,
      font,
      color: muted,
    });
  });

  return pdf.save();
}
