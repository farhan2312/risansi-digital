"use client";

// The Orders page's department board: a column per department, each with the
// department's own summary cards (its statuses, ECs, overdue and holds)
// counted over the SOs the Orders filter selects — as its own page counts
// them. A figure opens the department's page on that status; a column's
// heading opens the department's dashboard. Read when open, and again as the
// filters change; folding it away is remembered on this device.

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
  ShieldCheck,
  ShoppingCart,
  SquareKanban,
  Truck,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { loadDeptBoardAction } from "@/app/risansi/orders/board-actions";
import { BOARD_DEPTS, cardRole, TONE_STYLE, type BoardColumn, type BoardData } from "@/lib/dept-board-keys";
import type { KpiCard } from "@/lib/kpis";
import { VizStyles } from "./spare-dashboard/charts";
import { money } from "./spare-dashboard/shared";

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

const FOLD_KEY = "risansi.deptBoard.folded";
const foldListeners = new Set<() => void>();
const subscribeFold = (cb: () => void) => {
  foldListeners.add(cb);
  window.addEventListener("storage", cb);
  return () => {
    foldListeners.delete(cb);
    window.removeEventListener("storage", cb);
  };
};

const nf = new Intl.NumberFormat("en-IN");

/** The department's own page, on what the card picks (and the Pump view where it has one). */
export function cardHref(page: string, card: Pick<KpiCard, "params">, kind: "spare" | "pump"): string {
  const p = new URLSearchParams(Object.entries(card.params).filter((e): e is [string, string] => e[1] !== null));
  if (kind === "pump" && /planning|assembly-dispatch/.test(page)) p.set("type", "pump");
  return `${page}${p.size ? `?${p}` : ""}`;
}

/** A column's cards split for laying out: totals, status groups (as the page groups them), overdue and holds. */
export function splitCards(cards: KpiCard[]) {
  const totals = cards.filter((c) => cardRole(c) === "total");
  const overdue = cards.filter((c) => cardRole(c) === "overdue");
  const holds = cards.filter((c) => cardRole(c) === "hold");
  const groups: { name: string; cards: KpiCard[] }[] = [];
  for (const c of cards.filter((k) => cardRole(k) === "status")) {
    const name = c.group ?? "Status";
    const g = groups.find((x) => x.name === name) ?? groups[groups.push({ name, cards: [] }) - 1];
    g.cards.push(c);
  }
  return { totals, overdue, holds, groups };
}

export function DeptBoard({ query }: { query: string }) {
  const folded = useSyncExternalStore(subscribeFold, () => localStorage.getItem(FOLD_KEY) === "1", () => false);
  const toggle = () => {
    localStorage.setItem(FOLD_KEY, folded ? "0" : "1");
    foldListeners.forEach((cb) => cb());
  };
  const [data, setData] = useState<BoardData | null>(null);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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
  // A department with none of these SOs (Drawing on Spare) is left off.
  const columns = useMemo(
    () => (data?.columns ?? []).filter((c) => (c.cards.find((k) => k.key === "all")?.count ?? 0) > 0),
    [data]
  );

  return (
    <section className="viz mb-4 overflow-hidden rounded-2xl border border-card-border bg-surface shadow-sm">
      <VizStyles />
      <header className="flex flex-wrap items-center gap-3 border-b border-card-border bg-gradient-to-r from-[#1F3864]/[0.07] via-[#2F5496]/[0.03] to-transparent px-4 py-3">
        <button type="button" onClick={toggle} aria-expanded={!folded} className="flex min-w-0 items-center gap-3 text-left">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[#1F3864] to-[#2F5496] text-white shadow-sm">
            <SquareKanban className="h-[18px] w-[18px]" />
          </span>
          <span className="min-w-0">
            <span className="block text-sm font-semibold text-foreground">Department board</span>
            <span className="block text-xs text-muted">
              Each department&apos;s own statuses over the SOs below · {data?.kind === "pump" ? "Pump" : "Spare"} · follows the filters
            </span>
          </span>
          <ChevronDown className={`h-4 w-4 shrink-0 text-muted transition-transform ${folded ? "-rotate-90" : ""}`} />
        </button>
        {!folded && loading && data && (
          <span className="ml-auto inline-flex items-center gap-1.5 text-[11px] text-muted">
            <Loader2 className="h-3 w-3 animate-spin" /> Updating
          </span>
        )}
      </header>

      {!folded &&
        (error ? (
          <p className="px-4 py-6 text-sm text-rose-600">{error}</p>
        ) : !data ? (
          <BoardSkeleton />
        ) : columns.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted">No SOs match.</p>
        ) : (
          <div className="flex items-start gap-3 overflow-x-auto px-4 py-4 [scrollbar-width:thin]">
            {columns.map((c) => (
              <Column key={c.key} col={c} kind={data.kind} query={query} />
            ))}
          </div>
        ))}
    </section>
  );
}

function Column({ col, kind, query }: { col: BoardColumn; kind: "spare" | "pump"; query: string }) {
  const dept = BOARD_DEPTS.find((d) => d.key === col.key)!;
  const Icon = DEPT_ICON[dept.icon] ?? FileText;
  const { totals, overdue, holds, groups } = splitCards(col.cards);
  const all = totals.find((t) => t.key === "all");
  const others = totals.filter((t) => t.key !== "all");
  return (
    <div className="flex h-[30rem] w-[17rem] shrink-0 flex-col overflow-hidden rounded-2xl bg-surface shadow-sm ring-1 ring-card-border">
      {/* The heading: the department, its SOs and its totals; opens its dashboard. */}
      <Link
        href={`/risansi/orders/board/${col.key}${query ? `?${query}` : ""}`}
        className="group relative shrink-0 overflow-hidden bg-gradient-to-br from-[#1F3864] to-[#2F5496] px-3.5 pb-3 pt-3 text-white"
        title={`Open the ${dept.label} dashboard`}
      >
        <span className="pointer-events-none absolute -right-6 -top-8 h-24 w-24 rounded-full bg-white/[0.07]" />
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/15 ring-1 ring-white/20">
            <Icon className="h-4 w-4" />
          </span>
          <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">{dept.label}</span>
          <ArrowUpRight className="h-4 w-4 text-white/60 transition group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-white" />
        </div>
        <div className="mt-2.5 flex flex-wrap items-end gap-x-3 gap-y-2">
          <div>
            <p className="text-[26px] font-bold leading-none tabular-nums">{nf.format(all?.count ?? 0)}</p>
            <p className="mt-1 text-[10.5px] uppercase tracking-wide text-white/65">{all?.label ?? "SOs"}</p>
            {col.values.all !== undefined && <p className="mt-1 text-[13px] font-semibold tabular-nums text-[#9fd3ff]">{money(col.values.all)}</p>}
          </div>
          {others.map((t) => (
            <div key={t.key} className="border-l border-white/15 pl-3">
              <p className="text-base font-semibold leading-none tabular-nums">{nf.format(t.count)}</p>
              <p className="mt-1 text-[10.5px] uppercase tracking-wide text-white/65">{t.label}</p>
            </div>
          ))}
        </div>
      </Link>

      {/* The statuses scroll inside the column: every column the same height. */}
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3 [scrollbar-width:thin]">
        {groups.map((g) => {
          // Bars against the group's whole: the SOs, or for a sum (ECs, items) their total.
          const sum = g.cards.some((c) => c.measure);
          const base = sum ? Math.max(1, g.cards.reduce((a, c) => a + c.count, 0)) : Math.max(1, all?.count ?? 1);
          return (
            <div key={g.name}>
              {(groups.length > 1 || g.name !== "Status") && (
                <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">{g.name}</p>
              )}
              <ul className="space-y-1">
                {g.cards.map((c) => (
                  <Metric key={c.key} card={c} base={base} href={c.measure ? null : cardHref(dept.page, c, kind)} group={g.name} value={c.measure ? undefined : col.values[c.key]} />
                ))}
              </ul>
            </div>
          );
        })}
        {(overdue.length > 0 || holds.length > 0) && (
          <div className="flex flex-wrap gap-1.5 border-t border-card-border pt-2.5">
            {[...overdue, ...holds].map((c) => (
              <Link
                key={c.key}
                href={cardHref(dept.page, c, kind)}
                className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset transition hover:brightness-95 ${
                  c.count ? TONE_STYLE.danger.chip : TONE_STYLE.neutral.chip
                }`}
              >
                {c.label}
                <span className="font-bold tabular-nums">{c.count}</span>
                {col.values[c.key] !== undefined && c.count > 0 && <span className="tabular-nums opacity-80">· {money(col.values[c.key])}</span>}
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** One status: its name, its count (and its ECs), a bar of its share; opens the department on it. */
function Metric({ card, base, href, group, value }: { card: KpiCard; base: number; href: string | null; group: string; value?: number }) {
  const tone = TONE_STYLE[card.tone ?? "neutral"];
  // "GAD & Base Plate Pending" reads "Pending" under its group's heading.
  const label = card.label.startsWith(`${group} `) ? card.label.slice(group.length + 1) : card.label.replace(/^(SO|EC|Curve|Part) /, "");
  const body = (
    <>
      <div className="flex items-center gap-2">
        <span className={`h-2 w-2 shrink-0 rounded-full ${tone.dot}`} />
        <span className={`min-w-0 flex-1 truncate text-[12px] ${card.count ? "text-foreground" : "text-muted"}`} title={card.label}>
          {label}
        </span>
        {!!card.heldCount && (
          <span className="rounded bg-rose-50 px-1 text-[9.5px] font-semibold text-rose-700 dark:bg-rose-500/15 dark:text-rose-300" title="Of them on Central Visibility's hold">
            {card.heldCount} CV
          </span>
        )}
        <span className={`text-[13px] font-bold tabular-nums ${card.count ? "text-foreground" : "text-muted/60"}`}>{nf.format(card.count)}</span>
        {card.also && (
          <span className="whitespace-nowrap rounded-md bg-background px-1.5 py-px text-[10.5px] tabular-nums text-muted ring-1 ring-card-border" title={`${card.also.count} ${card.also.label}`}>
            {nf.format(card.also.count)} {card.also.label}
          </span>
        )}
      </div>
      <div className="ml-4 mt-1 flex items-center gap-2">
        <div className="h-1 flex-1 overflow-hidden rounded-full bg-[var(--viz-grid)]">
        <span className="block h-full rounded-full transition-[width] duration-500" style={{ width: `${Math.min(100, (card.count / base) * 100)}%`, background: tone.color }} />
        </div>
        {/* Its SOs' order value. */}
        {value !== undefined && (
          <span className={`text-[10.5px] font-semibold tabular-nums ${card.count ? "text-[#2F5496] dark:text-sky-300" : "text-muted/60"}`}>{money(value)}</span>
        )}
      </div>
    </>
  );
  return (
    <li>
      {href ? (
        <Link href={href} className="block rounded-lg px-1.5 py-1 transition-colors hover:bg-background" title={`Open ${card.label}`}>
          {body}
        </Link>
      ) : (
        <div className="px-1.5 py-1">{body}</div>
      )}
    </li>
  );
}

function BoardSkeleton() {
  return (
    <div className="flex gap-3 overflow-hidden px-4 py-4">
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className="w-[17rem] shrink-0 animate-pulse overflow-hidden rounded-2xl ring-1 ring-card-border">
          <div className="h-[6.2rem] bg-[#1F3864]/20" />
          <div className="space-y-2.5 p-3">
            {Array.from({ length: 5 }, (_, k) => (
              <div key={k} className="h-6 rounded bg-background" />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
