/**
 * The Spares report's filter: a date range, which SOs it covers, and the three
 * status selections. A plain module — the page, its filter bar and the PDF
 * route all read the same URL the same way.
 */

export type SparesScope = "all" | "created";

export type SparesReportFilter = {
  /** YYYY-MM-DD, inclusive. */
  from: string;
  to: string;
  /** Every active Spare SO, or only those whose SO date falls in the range. */
  scope: SparesScope;
  planning: string[];
  assembly: string[];
  dispatch: string[];
};

/** Where an SO is on its way out — what the report groups SOs by. */
export type SpareStage = "not_ready" | "to_pack" | "packed" | "dispatched";

export const SPARE_STAGES: { key: SpareStage; label: string; hint: string }[] = [
  { key: "to_pack", label: "Ready, waiting to pack", hint: "Planning has it ready; Assembly & Packing has not packed it" },
  { key: "packed", label: "Packed, waiting to dispatch", hint: "Packed (all that is ready); not fully dispatched" },
  { key: "not_ready", label: "Not ready yet", hint: "No readiness lot from Planning yet" },
  { key: "dispatched", label: "Fully dispatched", hint: "Dispatch status Fully dispatch" },
];

/** Dispatch's statuses, in the order an SO moves through them. */
export const SPARE_DISPATCH_STATUSES = ["Pending", "LOT dispatch", "Fully dispatch"];

const ISO = /^\d{4}-\d{2}-\d{2}$/;

function isoDate(value: string | undefined | null): string | null {
  if (!value || !ISO.test(value)) return null;
  const d = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== value ? null : value;
}

export function todayIst(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** The quick ranges above the date pickers. */
export function rangePresets(today = todayIst()): { key: string; label: string; from: string; to: string }[] {
  const [y, m] = today.split("-").map(Number);
  const monthStart = `${today.slice(0, 7)}-01`;
  const lastMonthEnd = addDays(monthStart, -1);
  const fyStartYear = m >= 4 ? y : y - 1;
  return [
    { key: "7d", label: "Last 7 days", from: addDays(today, -6), to: today },
    { key: "30d", label: "Last 30 days", from: addDays(today, -29), to: today },
    { key: "month", label: "This month", from: monthStart, to: today },
    { key: "last_month", label: "Last month", from: `${lastMonthEnd.slice(0, 7)}-01`, to: lastMonthEnd },
    { key: "fy", label: "This FY", from: `${fyStartYear}-04-01`, to: today },
  ];
}

const list = (value: string | undefined | null) =>
  (value ?? "")
    .split(",")
    .map((v) => v.trim())
    .filter((v) => v && v.length <= 60)
    .slice(0, 20);

/** Read the filter off the URL; the last 30 days by default. */
export function parseSparesReportFilter(get: (key: string) => string | undefined | null): SparesReportFilter {
  const today = todayIst();
  let from = isoDate(get("from")) ?? addDays(today, -29);
  let to = isoDate(get("to")) ?? today;
  // Picked backwards, the two dates still mean the span between them.
  if (from > to) [from, to] = [to, from];
  return {
    from,
    to,
    scope: get("scope") === "created" ? "created" : "all",
    planning: list(get("pst")),
    assembly: list(get("ast")),
    dispatch: list(get("dst")).filter((v) => SPARE_DISPATCH_STATUSES.includes(v)),
  };
}

/** The filter as URL params, for the PDF link. */
export function sparesReportQuery(f: SparesReportFilter): string {
  const p = new URLSearchParams();
  p.set("from", f.from);
  p.set("to", f.to);
  if (f.scope === "created") p.set("scope", "created");
  if (f.planning.length) p.set("pst", f.planning.join(","));
  if (f.assembly.length) p.set("ast", f.assembly.join(","));
  if (f.dispatch.length) p.set("dst", f.dispatch.join(","));
  return p.toString();
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "02 Sep 2026"; "02 Sep 26" with a short year; "02 Sep" without one. */
export function shortDate(v: string | null | undefined, year: boolean | "short" = true): string {
  const s = (v ?? "").slice(0, 10);
  if (!ISO.test(s)) return "";
  const [y, m, d] = s.split("-");
  const base = `${d} ${MONTHS[Number(m) - 1]}`;
  return year === "short" ? `${base} ${y.slice(2)}` : year ? `${base} ${y}` : base;
}

/** "Sep 26" — a month bucket. */
export function shortMonth(v: string): string {
  const [y, m] = v.split("-");
  return `${MONTHS[Number(m) - 1]} ${y.slice(2)}`;
}

/** One line saying what the report covers — the subtitle and the PDF's header. */
export function describeSparesReportFilter(f: SparesReportFilter): string {
  return [
    `${shortDate(f.from)} – ${shortDate(f.to)}`,
    f.scope === "created" ? "SOs created in this period" : "All active Spare SOs",
    f.planning.length ? `Planning: ${f.planning.join(", ")}` : "",
    f.assembly.length ? `Assembly: ${f.assembly.join(", ")}` : "",
    f.dispatch.length ? `Dispatch: ${f.dispatch.join(", ")}` : "",
  ]
    .filter(Boolean)
    .join("  ·  ");
}

/** Colours per status, shared by the page and the PDF so the two read alike. */
export const STATUS_COLORS: Record<string, string> = {
  "planning:Fully ready": "#10b981",
  "planning:Partial ready": "#f59e0b",
  "planning:In plan": "#fcd34d",
  "planning:Date awaited": "#94a3b8",
  "assembly:Fully packed": "#10b981",
  "assembly:Partially packed": "#6ee7b7",
  "assembly:Fully ready": "#f59e0b",
  "assembly:Partial ready": "#fcd34d",
  "assembly:Not ready yet": "#cbd5e1",
  "dispatch:Fully dispatch": "#10b981",
  "dispatch:LOT dispatch": "#6ee7b7",
  "dispatch:Pending": "#cbd5e1",
};
export const OTHER_STATUS_COLOR = "#a78bfa";

/** The activity series, in the order work moves. */
export const ACTIVITY_SERIES = [
  { key: "created", label: "SOs created", color: "#94a3b8" },
  { key: "pis", label: "PIs raised", color: "#8b5cf6" },
  { key: "ready", label: "Made ready", color: "#f59e0b" },
  { key: "packed", label: "Packed", color: "#10b981" },
  { key: "dispatched", label: "Dispatched", color: "#0ea5e9" },
] as const;
