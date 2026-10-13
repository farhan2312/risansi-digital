import "server-only";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { sanitize, wrap } from "@/lib/pdf-text";
import { readinessSummary } from "@/lib/readiness-history";
import type { ReadyLotEvent } from "@/lib/orders";

// Planning's queue on paper: one line per SO with where it stands — status,
// readiness date, how late it is, its readiness lots — and a summary on top,
// so the team can see its own progress at a glance. Built from the same rows
// and the same filter as the queue on screen.

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

type SoLine = {
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
  /** How often the readiness date moved, and the dates it went through. */
  history: string;
  dateMoves: number;
  /** For the summary. */
  statusKey: string;
  ready: boolean;
};

function soLines(rows: Row[], histories: Map<string, ReadyLotEvent[]>): SoLine[] {
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
    return {
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
      history,
      dateMoves: summary.dateMoves,
      statusKey: uniq.length === 1 ? uniq[0] : "Mixed",
      ready,
    };
  });
}

// A4 landscape, in points; columns sum to the content width (770).
const PAGE = { w: 842, h: 595 };
const MARGIN = 36;
const WIDTH = PAGE.w - MARGIN * 2;
const COLUMNS: { label: string; width: number; key: keyof SoLine }[] = [
  { label: "Sl.", width: 28, key: "sl" },
  { label: "SO No.", width: 80, key: "so" },
  { label: "SO date", width: 50, key: "soDate" },
  { label: "Type", width: 38, key: "type" },
  { label: "ECs", width: 24, key: "ecs" },
  { label: "Status", width: 92, key: "status" },
  { label: "Readiness date", width: 84, key: "readiness" },
  { label: "Overdue", width: 42, key: "overdue" },
  { label: "Dispatch target", width: 68, key: "dispatchTarget" },
  { label: "LD date", width: 42, key: "ld" },
  { label: "Date moved", width: 118, key: "history" },
  { label: "Lots / remarks", width: 104, key: "notes" },
];

/** Planning's queue as one PDF: a summary, then every SO. */
export async function buildPlanningReportPdf(
  rows: Row[],
  filterLine: string,
  histories: Map<string, ReadyLotEvent[]> = new Map()
): Promise<Uint8Array> {
  const lines = soLines(rows, histories);

  const pdf = await PDFDocument.create();
  pdf.setTitle("Planning progress report");
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const ink = rgb(0.09, 0.11, 0.15);
  const muted = rgb(0.42, 0.45, 0.5);
  const rule = rgb(0.85, 0.87, 0.9);
  const tile = rgb(0.95, 0.96, 0.97);
  const red = rgb(0.85, 0.15, 0.2);
  const green = rgb(0.05, 0.5, 0.3);
  const amber = rgb(0.7, 0.42, 0.02);

  let page: PDFPage = pdf.addPage([PAGE.w, PAGE.h]);
  let y = PAGE.h - MARGIN;
  const BOTTOM = MARGIN + 16;
  const text = (s: string, x: number, at: number, size: number, f: PDFFont, color = ink) =>
    page.drawText(sanitize(s, f), { x, y: at, size, font: f, color });

  // Title.
  const generated = new Date().toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Kolkata",
  });
  text("Planning progress report", MARGIN, y - 16, 16, bold);
  const sub = wrap(`${filterLine}  ·  generated ${generated} IST`, font, 8.5, WIDTH);
  sub.forEach((l, n) => text(l, MARGIN, y - 30 - n * 10, 8.5, font, muted));
  y -= 40 + (sub.length - 1) * 10;

  // Summary tiles: the totals, then SOs by status.
  const ecCount = lines.reduce((n, l) => n + l.ecs, 0);
  const byStatus = new Map<string, number>();
  for (const l of lines) byStatus.set(l.statusKey, (byStatus.get(l.statusKey) ?? 0) + 1);
  const tiles: { label: string; value: string; color?: ReturnType<typeof rgb> }[] = [
    { label: "SOs", value: String(lines.length) },
    { label: "ECs", value: String(ecCount) },
    { label: "Ready", value: String(lines.filter((l) => l.ready).length), color: green },
    { label: "Overdue", value: String(lines.filter((l) => l.overdue > 0).length), color: red },
    { label: "Date moved", value: String(lines.filter((l) => l.dateMoves > 0).length), color: amber },
  ];
  const tileW = 96;
  const tileGap = 8;
  let x = MARGIN;
  for (const t of tiles) {
    page.drawRectangle({ x, y: y - 40, width: tileW, height: 40, color: tile });
    text(t.label, x + 8, y - 13, 7, bold, muted);
    text(t.value, x + 8, y - 32, 15, bold, t.color ?? ink);
    x += tileW + tileGap;
  }
  y -= 54;
  const statusLine = [...byStatus.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([s, n]) => `${s}: ${n}`)
    .join("   ·   ");
  if (statusLine) {
    text("SOs BY STATUS", MARGIN, y - 7, 6.5, bold, muted);
    const sl = wrap(statusLine, font, 9, WIDTH);
    sl.forEach((l, n) => text(l, MARGIN, y - 20 - n * 11, 9, font));
    y -= 30 + (sl.length - 1) * 11;
  }

  function headerRow() {
    let cx = MARGIN;
    for (const c of COLUMNS) {
      text(c.label.toUpperCase(), cx, y - 8, 6.5, bold, muted);
      cx += c.width;
    }
    y -= 13;
    page.drawLine({ start: { x: MARGIN, y }, end: { x: MARGIN + WIDTH, y }, thickness: 0.75, color: rule });
    y -= 2;
  }

  y -= 6;
  headerRow();
  if (lines.length === 0) {
    text("No SO matches this filter.", MARGIN, y - 12, 9, font, muted);
  }

  for (const l of lines) {
    const cells = COLUMNS.map((c) => {
      const raw = l[c.key];
      const v = c.key === "overdue" ? (l.overdue > 0 ? `${l.overdue} d` : "") : String(raw ?? "");
      return wrap(v || "—", font, 8.5, c.width - 6);
    });
    const h = Math.max(...cells.map((c) => c.length)) * 10.5 + 6;
    if (y - h < BOTTOM) {
      page = pdf.addPage([PAGE.w, PAGE.h]);
      y = PAGE.h - MARGIN;
      headerRow();
    }
    let cx = MARGIN;
    cells.forEach((cl, n) => {
      const key = COLUMNS[n].key;
      const color =
        key === "overdue" && l.overdue > 0
          ? red
          : key === "history" && l.dateMoves > 0
            ? amber
          : key === "status" && l.ready
            ? green
            : cl[0] === "—"
              ? muted
              : ink;
      const f = key === "so" || (key === "overdue" && l.overdue > 0) ? bold : font;
      cl.forEach((t, k) => text(t, cx, y - 9 - k * 10.5, 8.5, f, color));
      cx += COLUMNS[n].width;
    });
    y -= h;
    page.drawLine({ start: { x: MARGIN, y: y + 2 }, end: { x: MARGIN + WIDTH, y: y + 2 }, thickness: 0.4, color: rule });
  }

  const pages = pdf.getPages();
  pages.forEach((p, n) => {
    p.drawText("Planning progress report", { x: MARGIN, y: MARGIN - 10, size: 7, font, color: muted });
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
