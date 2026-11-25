"use client";

// The Orders page's department board: a column per department, every SO the
// filters select as a card in each, coloured by where it stands there.
// Read when the board is open, and again as the filters change; folding it
// away is remembered on this device. A column's heading opens the
// department's own page.

import Link from "next/link";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import {
  ArrowUpRight,
  CalendarDays,
  ChevronDown,
  FileText,
  Loader2,
  Package,
  Receipt,
  Ruler,
  Search,
  ShieldCheck,
  ShoppingCart,
  SquareKanban,
  Truck,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { loadDeptBoardAction } from "@/app/risansi/orders/board-actions";
import {
  BOARD_DEPTS,
  GROUP_LABEL,
  GROUP_STYLE,
  type BoardCell,
  type BoardData,
  type BoardDeptKey,
  type BoardGroup,
  type BoardSo,
} from "@/lib/dept-board-keys";
import { VizStyles } from "./spare-dashboard/charts";

export const DEPT_ICON: Record<string, LucideIcon> = {
  file: FileText,
  ruler: Ruler,
  cart: ShoppingCart,
  receipt: Receipt,
  wallet: Wallet,
  calendar: CalendarDays,
  shield: ShieldCheck,
  package: Package,
  truck: Truck,
};

/** The groups in the order a column lists its cards, and the filter chips. */
const ORDER: BoardGroup[] = ["overdue", "hold", "progress", "waiting", "done"];
const FOLD_KEY = "risansi.deptBoard.folded";
/** Cards a column draws; the rest are on the department's page. */
const PER_COLUMN = 40;

const fmtDay = (d: string | null) =>
  d ? new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { day: "2-digit", month: "short", timeZone: "UTC" }) : "";

/** A column's cards: worst first (most overdue at the top), then by SO date. */
function sortCards(list: { so: BoardSo; cell: BoardCell }[]) {
  return list.sort((a, b) => {
    const g = ORDER.indexOf(a.cell.group) - ORDER.indexOf(b.cell.group);
    if (g) return g;
    if (a.cell.late !== b.cell.late) return b.cell.late - a.cell.late;
    return (a.so.soDate ?? "").localeCompare(b.so.soDate ?? "");
  });
}

// Folded or not, as this device last left it.
const foldListeners = new Set<() => void>();
const subscribeFold = (cb: () => void) => {
  foldListeners.add(cb);
  window.addEventListener("storage", cb);
  return () => {
    foldListeners.delete(cb);
    window.removeEventListener("storage", cb);
  };
};

export function DeptBoard({ query }: { query: string }) {
  const folded = useSyncExternalStore(subscribeFold, () => localStorage.getItem(FOLD_KEY) === "1", () => false);
  const [data, setData] = useState<BoardData | null>(null);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [group, setGroup] = useState<BoardGroup | "all">("all");
  const [search, setSearch] = useState("");

  const toggle = () => {
    localStorage.setItem(FOLD_KEY, folded ? "0" : "1");
    foldListeners.forEach((cb) => cb());
  };

  useEffect(() => {
    if (folded || loadedFor === query) return;
    let live = true;
    loadDeptBoardAction(query)
      .then((r) => {
        if (!live) return;
        if (r.ok) {
          setData(r.data);
          setError(null);
        } else setError(r.error);
        setLoadedFor(query);
      })
      .catch(() => live && setError("Could not load the department board."));
    return () => {
      live = false;
    };
  }, [folded, query, loadedFor]);

  const loading = !folded && loadedFor !== query && !error;
  const needle = search.trim().toLowerCase();
  const sos = useMemo(
    () => (data?.sos ?? []).filter((s) => !needle || s.soNo.toLowerCase().includes(needle) || s.client.toLowerCase().includes(needle)),
    [data, needle]
  );
  // A department none of these SOs go through (Drawing on Spare) is left off.
  const depts = useMemo(() => BOARD_DEPTS.filter((d) => (data?.sos ?? []).some((s) => s.cells[d.key].group !== "na")), [data]);
  const totals = useMemo(() => {
    const t: Record<string, number> = {};
    for (const s of sos) for (const d of depts) t[s.cells[d.key].group] = (t[s.cells[d.key].group] ?? 0) + 1;
    return t;
  }, [sos, depts]);

  const deptHref = (key: string) => `/risansi/orders/board/${key}${query ? `?${query}` : ""}`;

  return (
    <section className="viz mb-4 overflow-hidden rounded-2xl border border-card-border bg-surface shadow-sm">
      <VizStyles />
      <header className="flex flex-wrap items-center gap-3 border-b border-card-border bg-gradient-to-r from-[#1F3864]/[0.06] via-transparent to-transparent px-4 py-3">
        <button type="button" onClick={toggle} aria-expanded={!folded} className="flex min-w-0 items-center gap-3 text-left">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#1F3864] text-white shadow-sm">
            <SquareKanban className="h-[18px] w-[18px]" />
          </span>
          <span className="min-w-0">
            <span className="block text-sm font-semibold text-foreground">Department board</span>
            <span className="block text-xs text-muted">
              {data ? `${sos.length} SOs across ${depts.length} departments · follows the filters above` : "Every SO and where it stands in each department"}
            </span>
          </span>
          <ChevronDown className={`h-4 w-4 shrink-0 text-muted transition-transform ${folded ? "-rotate-90" : ""}`} />
        </button>
        {!folded && data && (
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <div className="flex flex-wrap items-center gap-1 rounded-xl bg-background p-1">
              <GroupChip active={group === "all"} onClick={() => setGroup("all")} label="All" />
              {ORDER.map((g) => (
                <GroupChip key={g} active={group === g} onClick={() => setGroup(group === g ? "all" : g)} label={GROUP_LABEL[g]} count={totals[g] ?? 0} dot={GROUP_STYLE[g].dot} />
              ))}
            </div>
            <label className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="SO or client"
                className="h-8 w-40 rounded-lg border border-input-border bg-surface pl-8 pr-2 text-xs text-foreground outline-none focus:border-primary"
              />
            </label>
          </div>
        )}
      </header>

      {!folded && (
        <div className="relative">
          {error ? (
            <p className="px-4 py-6 text-sm text-rose-600">{error}</p>
          ) : !data ? (
            <BoardSkeleton />
          ) : sos.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-muted">No SOs match.</p>
          ) : (
            <div className="flex gap-3 overflow-x-auto px-4 py-4 [scrollbar-width:thin]">
              {depts.map((d) => (
                <Column key={d.key} dept={d} sos={sos} group={group} href={deptHref(d.key)} today={data.today} />
              ))}
            </div>
          )}
          {loading && data && (
            <div className="absolute right-4 top-2 flex items-center gap-1.5 rounded-full bg-surface/90 px-2.5 py-1 text-[11px] text-muted shadow-sm ring-1 ring-card-border">
              <Loader2 className="h-3 w-3 animate-spin" /> Updating
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function GroupChip({ active, onClick, label, count, dot }: { active: boolean; onClick: () => void; label: string; count?: number; dot?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`inline-flex h-7 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium transition-colors ${
        active ? "bg-surface text-foreground shadow-sm ring-1 ring-card-border" : "text-muted hover:text-foreground"
      }`}
    >
      {dot && <span className={`h-2 w-2 rounded-full ${dot}`} />}
      {label}
      {count !== undefined && <span className="tabular-nums text-muted">{count}</span>}
    </button>
  );
}

function Column({
  dept,
  sos,
  group,
  href,
  today,
}: {
  dept: (typeof BOARD_DEPTS)[number];
  sos: BoardSo[];
  group: BoardGroup | "all";
  href: string;
  today: string;
}) {
  const Icon = DEPT_ICON[dept.icon] ?? FileText;
  const inDept = sos.map((so) => ({ so, cell: so.cells[dept.key as BoardDeptKey] })).filter((x) => x.cell.group !== "na");
  const count: Record<string, number> = {};
  for (const x of inDept) count[x.cell.group] = (count[x.cell.group] ?? 0) + 1;
  const total = inDept.length;
  const donePct = total ? Math.round(((count.done ?? 0) / total) * 100) : 0;
  const cards = sortCards(inDept.filter((x) => group === "all" || x.cell.group === group));
  const shown = cards.slice(0, PER_COLUMN);
  return (
    <div className="flex w-[16.5rem] shrink-0 flex-col rounded-2xl bg-background/70 ring-1 ring-card-border">
      <Link
        href={href}
        className="group m-2 rounded-xl border border-card-border bg-surface px-3 py-2.5 shadow-sm transition hover:-translate-y-px hover:border-[#2F5496]/40 hover:shadow-md"
        title={`Open the ${dept.label} dashboard`}
      >
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#1F3864]/[0.08] text-[#1F3864] dark:bg-white/10 dark:text-white">
            <Icon className="h-4 w-4" />
          </span>
          <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-foreground">{dept.label}</span>
          <ArrowUpRight className="h-4 w-4 text-muted transition group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-foreground" />
        </div>
        <div className="mt-2 flex items-baseline justify-between">
          <span className="text-xl font-bold tabular-nums text-foreground">{total}</span>
          <span className="text-[11px] font-medium text-muted">
            <span className="tabular-nums text-emerald-600 dark:text-emerald-400">{donePct}%</span> done
          </span>
        </div>
        <div className="mt-1.5 flex h-1.5 overflow-hidden rounded-full bg-[var(--viz-grid)]">
          {ORDER.slice()
            .reverse()
            .map((g) =>
              count[g] ? <span key={g} className="h-full border-r border-[var(--viz-surface)] last:border-r-0" style={{ width: `${(count[g] / total) * 100}%`, background: GROUP_STYLE[g].color }} /> : null
            )}
        </div>
        <div className="mt-2 flex flex-wrap gap-x-2.5 gap-y-1">
          {ORDER.filter((g) => count[g]).map((g) => (
            <span key={g} className="inline-flex items-center gap-1 text-[10.5px] text-muted">
              <span className={`h-1.5 w-1.5 rounded-full ${GROUP_STYLE[g].dot}`} />
              <span className="tabular-nums font-semibold text-foreground">{count[g]}</span> {GROUP_LABEL[g].toLowerCase()}
            </span>
          ))}
        </div>
      </Link>
      <div className="flex max-h-[25rem] flex-col gap-1.5 overflow-y-auto px-2 pb-2 [scrollbar-width:thin]">
        {shown.map(({ so, cell }) => (
          <SoCard key={so.id} so={so} cell={cell} today={today} />
        ))}
        {!cards.length && <p className="py-6 text-center text-xs text-muted">None</p>}
        {cards.length > shown.length && (
          <Link href={href} className="rounded-lg py-2 text-center text-xs font-semibold text-[#2F5496] hover:bg-surface dark:text-sky-300">
            View all {cards.length} →
          </Link>
        )}
      </div>
    </div>
  );
}

function SoCard({ so, cell, today }: { so: BoardSo; cell: BoardCell; today: string }) {
  const style = GROUP_STYLE[cell.group];
  const soon = cell.group !== "done" && cell.target && cell.target >= today;
  return (
    <Link
      href={`/risansi/orders/${so.id}`}
      className="group relative block overflow-hidden rounded-xl border border-card-border bg-surface px-3 py-2 pl-3.5 transition hover:border-[#2F5496]/35 hover:shadow-sm"
    >
      <span className="absolute inset-y-0 left-0 w-1" style={{ background: style.color }} />
      <div className="flex items-center gap-1.5">
        <span className="truncate text-[12.5px] font-semibold text-foreground">{so.soNo}</span>
        {so.orderType && so.orderType !== "Spare" && (
          <span className="rounded bg-indigo-50 px-1 text-[9.5px] font-semibold uppercase tracking-wide text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300">{so.orderType}</span>
        )}
        {so.cvHold && (
          <span className="rounded bg-rose-50 px-1 text-[9.5px] font-semibold uppercase tracking-wide text-rose-700 dark:bg-rose-500/15 dark:text-rose-300" title="Central Visibility hold">
            CV hold
          </span>
        )}
        {cell.late > 0 && <span className="ml-auto shrink-0 rounded-full bg-rose-600 px-1.5 text-[10px] font-bold tabular-nums text-white">+{cell.late}d</span>}
      </div>
      <p className="truncate text-[11px] text-muted">{so.client || "—"}</p>
      <div className="mt-1.5 flex items-center gap-1.5">
        <span className={`inline-flex min-w-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[10.5px] font-medium ring-1 ring-inset ${style.chip}`}>
          <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${style.dot}`} />
          <span className="truncate">{cell.label}</span>
        </span>
        {cell.ecTotal && cell.ecTotal > 1 ? (
          <span className="ml-auto shrink-0 text-[10px] tabular-nums text-muted" title="ECs done">
            {cell.ecDone}/{cell.ecTotal} EC
          </span>
        ) : soon ? (
          <span className="ml-auto shrink-0 text-[10px] text-muted" title="Target">
            {fmtDay(cell.target)}
          </span>
        ) : null}
      </div>
    </Link>
  );
}

function BoardSkeleton() {
  return (
    <div className="flex gap-3 overflow-hidden px-4 py-4">
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className="w-[16.5rem] shrink-0 animate-pulse rounded-2xl bg-background/70 p-2 ring-1 ring-card-border">
          <div className="h-[5.5rem] rounded-xl bg-surface" />
          {Array.from({ length: 4 }, (_, k) => (
            <div key={k} className="mt-1.5 h-[4.1rem] rounded-xl bg-surface" />
          ))}
        </div>
      ))}
    </div>
  );
}
