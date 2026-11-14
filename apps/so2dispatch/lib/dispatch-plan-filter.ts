// The Dispatch Plan's filters, date range and sort, read from the URL. Plain
// module: the filter bar (browser) and the page (server) read one definition.

import { BASE_PLATE_STATUSES, SO_ASSEMBLY_STATUSES, SO_PACKING_STATUSES, WOODEN_BOX_STATUSES } from "@/lib/assembly";
import type { DispatchPlanRow } from "@/lib/dispatch-plan";

export const NOT_SET = "Not set";

export const DP_OPTIONS = {
  rdy: ["Fully ready", "In plan", "In plan · overdue"],
  boi: ["No BOI", "All in hand", "To arrive"],
  hold: ["Dispatch hold", "Not held"],
  asm: SO_ASSEMBLY_STATUSES,
  pkg: SO_PACKING_STATUSES,
  bp: ["No", NOT_SET, ...BASE_PLATE_STATUSES],
  wb: ["No", NOT_SET, ...WOODEN_BOX_STATUSES],
} as const;

/** The dates the range can read, the first the default. */
export const DP_DATE_FIELDS = [
  { value: "dispatch_target", label: "Dispatch Target" },
  { value: "final_target", label: "Final Dispatch Target" },
  { value: "readiness", label: "Readiness" },
  { value: "so_date", label: "SO Date" },
  { value: "ppc", label: "SO Sent to PPC" },
] as const;

/** Every URL key the bar sets: Clear all clears them. */
export const DP_KEYS = ["rdy", "boi", "hold", "asm", "pkg", "bp", "wb", "rep", "zone", "st", "df", "from", "to"] as const;

export type DispatchPlanFilter = {
  rdy: string[];
  boi: string[];
  hold: string[];
  asm: string[];
  pkg: string[];
  bp: string[];
  wb: string[];
  rep: string[];
  zone: string[];
  st: string[];
  df: string;
  from: string | null;
  to: string | null;
};

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const list = (v: string | undefined, allowed?: readonly string[]) =>
  (v ?? "")
    .split(",")
    .map((x) => x.trim())
    .filter((x) => x && (!allowed || allowed.includes(x)));

export function parseDispatchPlanFilter(get: (key: string) => string | undefined): DispatchPlanFilter {
  const df = get("df");
  const from = get("from") ?? "";
  const to = get("to") ?? "";
  return {
    rdy: list(get("rdy"), DP_OPTIONS.rdy),
    boi: list(get("boi"), DP_OPTIONS.boi),
    hold: list(get("hold"), DP_OPTIONS.hold),
    asm: list(get("asm"), DP_OPTIONS.asm),
    pkg: list(get("pkg"), DP_OPTIONS.pkg),
    bp: list(get("bp"), DP_OPTIONS.bp),
    wb: list(get("wb"), DP_OPTIONS.wb),
    rep: list(get("rep")),
    zone: list(get("zone")),
    st: list(get("st")),
    df: DP_DATE_FIELDS.some((f) => f.value === df) ? (df as string) : DP_DATE_FIELDS[0].value,
    from: DAY.test(from) ? from : null,
    to: DAY.test(to) ? to : null,
  };
}

/** The readiness date the row reads: a Fully ready SO's readiness date, else its In plan date. */
const readinessOf = (r: DispatchPlanRow) => (r.fully_ready ? r.ready_date : r.plan_date);

/** A row's date by its key — for the range and for sorting. */
export function dateOf(r: DispatchPlanRow, key: string): string | null {
  switch (key) {
    case "dispatch_target":
      return r.dispatch_target;
    case "final_target":
      return r.final_dispatch_target;
    case "readiness":
      return readinessOf(r);
    case "so_date":
      return r.so_date;
    case "po_date":
      return r.po_date;
    case "ppc":
      return r.ppc_date;
    // Assembly and packing: the next plan, else when it was done.
    case "asm":
      return r.assembly.next ?? r.assembly.last;
    case "pkg":
      return r.packing.next ?? r.packing.last;
    default:
      return null;
  }
}

export const DP_SORT_KEYS = ["so_date", "po_date", "ppc", "readiness", "asm", "pkg", "dispatch_target", "final_target"];

const readinessWord = (r: DispatchPlanRow, today: string) =>
  r.fully_ready ? "Fully ready" : r.plan_date && r.plan_date < today ? "In plan · overdue" : "In plan";
const boiWord = (r: DispatchPlanRow) => (r.boi_total === 0 ? "No BOI" : r.boi_in_hand >= r.boi_total ? "All in hand" : "To arrive");
const plateWord = (r: DispatchPlanRow) =>
  r.alignment.base_plate === "Yes" ? r.alignment.base_plate_status || "Pending" : r.alignment.base_plate === "No" ? "No" : NOT_SET;
/** The SO's wooden box: all received, all pending, else in plan (as Assembly & Packing reads it). */
const boxWord = (r: DispatchPlanRow) => {
  if (r.alignment.wooden_box === "No") return "No";
  if (r.alignment.wooden_box !== "Yes") return NOT_SET;
  const st = (r.alignment.wooden_boxes ?? []).map((b) => b.status || "Pending");
  if (st.length === 0 || st.every((s) => s === "Pending")) return "Pending";
  return st.every((s) => s === "Received") ? "Received" : "In plan";
};

export function applyDispatchPlanFilter(rows: DispatchPlanRow[], f: DispatchPlanFilter, today: string): DispatchPlanRow[] {
  const any = (picked: string[], v: string | null) => picked.length === 0 || (v != null && picked.includes(v));
  return rows.filter((r) => {
    if (!any(f.rdy, readinessWord(r, today))) return false;
    if (!any(f.boi, boiWord(r))) return false;
    if (!any(f.hold, r.dispatch_hold ? "Dispatch hold" : "Not held")) return false;
    if (!any(f.asm, r.assembly.status)) return false;
    if (!any(f.pkg, r.packing.status)) return false;
    if (!any(f.bp, plateWord(r))) return false;
    if (!any(f.wb, boxWord(r))) return false;
    if (!any(f.rep, r.reps)) return false;
    if (!any(f.zone, r.zone)) return false;
    if (!any(f.st, r.dispatch_hold ? "Dispatch hold" : r.status)) return false;
    if (f.from || f.to) {
      const d = dateOf(r, f.df);
      if (!d) return false;
      if (f.from && d < f.from) return false;
      if (f.to && d > f.to) return false;
    }
    return true;
  });
}

/** Sorted by a date column (key, or -key descending); no date last either way. */
export function sortDispatchPlan(rows: DispatchPlanRow[], sort: string | undefined): DispatchPlanRow[] {
  const desc = !!sort?.startsWith("-");
  const key = sort?.replace(/^-/, "") ?? "";
  if (!DP_SORT_KEYS.includes(key)) return rows;
  return [...rows].sort((a, b) => {
    const x = dateOf(a, key);
    const y = dateOf(b, key);
    if (!x && !y) return a.sl_no - b.sl_no;
    if (!x) return 1;
    if (!y) return -1;
    return (desc ? y.localeCompare(x) : x.localeCompare(y)) || a.sl_no - b.sl_no;
  });
}

export function dispatchPlanFiltered(f: DispatchPlanFilter): boolean {
  return (
    [f.rdy, f.boi, f.hold, f.asm, f.pkg, f.bp, f.wb, f.rep, f.zone, f.st].some((l) => l.length > 0) || !!f.from || !!f.to
  );
}
