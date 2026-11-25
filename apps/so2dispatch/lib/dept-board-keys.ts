// The Orders page's department board: its departments, status groups and the
// shapes the board and each department's page read. Plain module (client and
// server alike).

export const BOARD_DEPTS = [
  { key: "order-making", label: "Order Making", icon: "file" },
  { key: "drawing", label: "Drawing", icon: "ruler" },
  { key: "purchase", label: "Purchase", icon: "cart" },
  { key: "billing", label: "Billing", icon: "receipt" },
  { key: "accounts", label: "Accounts", icon: "wallet" },
  { key: "planning", label: "Planning", icon: "calendar" },
  { key: "quality", label: "Quality", icon: "shield" },
  { key: "assembly", label: "Assembly & Packing", icon: "package" },
  { key: "dispatch", label: "Dispatch", icon: "truck" },
] as const;

export type BoardDeptKey = (typeof BOARD_DEPTS)[number]["key"];

export function boardDept(key: string | undefined | null) {
  return BOARD_DEPTS.find((d) => d.key === key) ?? null;
}

/** Where an SO stands in a department, as a group the board colours. */
export const BOARD_GROUPS = ["overdue", "hold", "progress", "waiting", "done", "na"] as const;
export type BoardGroup = (typeof BOARD_GROUPS)[number];

export const GROUP_LABEL: Record<BoardGroup, string> = {
  overdue: "Overdue",
  hold: "On hold",
  progress: "In progress",
  waiting: "Not started",
  done: "Done",
  na: "Not applicable",
};

/** The group's colour (the chart palette's roles) and its chip's classes. */
export const GROUP_STYLE: Record<BoardGroup, { color: string; chip: string; dot: string }> = {
  overdue: { color: "var(--viz-red)", chip: "bg-rose-50 text-rose-700 ring-rose-200 dark:bg-rose-500/10 dark:text-rose-300 dark:ring-rose-500/30", dot: "bg-rose-500" },
  hold: { color: "var(--viz-yellow)", chip: "bg-amber-50 text-amber-800 ring-amber-200 dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-500/30", dot: "bg-amber-500" },
  progress: { color: "var(--viz-blue)", chip: "bg-sky-50 text-sky-700 ring-sky-200 dark:bg-sky-500/10 dark:text-sky-300 dark:ring-sky-500/30", dot: "bg-sky-500" },
  waiting: { color: "var(--viz-gray)", chip: "bg-slate-100 text-slate-600 ring-slate-200 dark:bg-slate-500/15 dark:text-slate-300 dark:ring-slate-500/30", dot: "bg-slate-400" },
  done: { color: "var(--viz-aqua)", chip: "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-500/30", dot: "bg-emerald-500" },
  na: { color: "var(--viz-grid)", chip: "bg-slate-50 text-slate-400 ring-slate-200 dark:bg-slate-500/10 dark:text-slate-500 dark:ring-slate-500/20", dot: "bg-slate-300" },
};

/** One SO in one department. */
export type BoardCell = {
  group: BoardGroup;
  /** The department's own status, as its page says it. */
  label: string;
  /** What it is due by (YYYY-MM-DD), when the department has a target. */
  target: string | null;
  /** Days past the target, while not done; 0 otherwise. */
  late: number;
  /** ECs done of those the department has, when it works per EC. */
  ecDone?: number;
  ecTotal?: number;
};

export type BoardSo = {
  id: string;
  soNo: string;
  client: string;
  orderType: string;
  soDate: string | null;
  ecs: number;
  /** Central Visibility's hold: a badge, not a status. */
  cvHold: boolean;
  cells: Record<BoardDeptKey, BoardCell>;
};

export type BoardData = { sos: BoardSo[]; today: string };
