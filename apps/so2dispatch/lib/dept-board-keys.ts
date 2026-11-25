// The Orders page's department board: its departments and the shapes the
// board and each department's page read. Every figure is the department's
// own: its page's summary cards, its own statuses. Plain module (client and
// server alike).

import type { KpiCard, KpiTone } from "@/lib/kpis";

export const BOARD_DEPTS = [
  { key: "drawing", label: "Drawing", icon: "ruler", page: "/risansi/departments/drawing" },
  { key: "purchase", label: "Purchase", icon: "cart", page: "/risansi/departments/purchase" },
  { key: "billing", label: "Proforma Invoice", icon: "receipt", page: "/risansi/departments/billing" },
  { key: "accounts", label: "Accounts", icon: "wallet", page: "/risansi/departments/accounts" },
  { key: "planning", label: "Planning", icon: "calendar", page: "/risansi/departments/planning" },
  { key: "quality", label: "Quality", icon: "shield", page: "/risansi/departments/qc" },
  { key: "assembly", label: "Assembly & Packing", icon: "package", page: "/risansi/departments/assembly-dispatch" },
  { key: "dispatch", label: "Dispatch", icon: "truck", page: "/risansi/departments/dispatch" },
] as const;

export type BoardDeptKey = (typeof BOARD_DEPTS)[number]["key"];

export function boardDept(key: string | undefined | null) {
  return BOARD_DEPTS.find((d) => d.key === key) ?? null;
}

/** A department's summary cards, as its own page counts them, over the Orders filter. */
export type BoardColumn = { key: BoardDeptKey; cards: KpiCard[] };

export type BoardData = { columns: BoardColumn[]; kind: "spare" | "pump" };

/** What a card is, for laying it out: a total, a status, overdue or a hold. */
export type CardRole = "total" | "status" | "overdue" | "hold";

export function cardRole(c: Pick<KpiCard, "key" | "measure" | "tone">): CardRole {
  if (c.key === "all" || c.key === "ecs" || c.key === "pumps" || c.key === "boi") return "total";
  if (c.key === "overdue") return "overdue";
  // Accounts Hold is Accounts' own status (Clear / Hold / Not set), not a hold card.
  if (c.key.startsWith("hold") || c.key === "omhold") return "hold";
  return "status";
}

/** The portal's card tones as colours (the chart palette's roles) and chip classes. */
export const TONE_STYLE: Record<KpiTone, { color: string; chip: string; dot: string; text: string }> = {
  done: { color: "var(--viz-aqua)", chip: "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-500/30", dot: "bg-emerald-500", text: "text-emerald-700 dark:text-emerald-300" },
  part: { color: "var(--viz-blue)", chip: "bg-sky-50 text-sky-700 ring-sky-200 dark:bg-sky-500/10 dark:text-sky-300 dark:ring-sky-500/30", dot: "bg-sky-500", text: "text-sky-700 dark:text-sky-300" },
  pending: { color: "var(--viz-yellow)", chip: "bg-amber-50 text-amber-800 ring-amber-200 dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-500/30", dot: "bg-amber-500", text: "text-amber-700 dark:text-amber-300" },
  danger: { color: "var(--viz-red)", chip: "bg-rose-50 text-rose-700 ring-rose-200 dark:bg-rose-500/10 dark:text-rose-300 dark:ring-rose-500/30", dot: "bg-rose-500", text: "text-rose-700 dark:text-rose-300" },
  neutral: { color: "var(--viz-gray)", chip: "bg-slate-100 text-slate-600 ring-slate-200 dark:bg-slate-500/15 dark:text-slate-300 dark:ring-slate-500/30", dot: "bg-slate-400", text: "text-slate-600 dark:text-slate-300" },
};

/** One SO in one department, for the department page's table: its own status. */
export type DeptSoRow = {
  id: string;
  soNo: string;
  client: string;
  orderType: string;
  soDate: string | null;
  /** The department's status cards the SO counts in (one per group of cards), as its page counts them. */
  statuses: { key: string; label: string; group: string; tone: KpiTone }[];
  /** The other cards it counts in: Overdue, and the holds. */
  flags: { key: string; label: string }[];
  /** Per EC: each status and how many of the SO's ECs are at it. */
  ecStatuses?: { label: string; count: number }[];
  target: string | null;
  /** Days past the target while the department is not done; 0 otherwise. */
  late: number;
  cvHold: boolean;
};
