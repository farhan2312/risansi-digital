"use client";

// One department's page off the Orders board: its own summary cards as
// figures and charts (each status as its page names it), and every SO of the
// Orders filter in its queue with the department's own status.

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowUpRight, ExternalLink, Search } from "lucide-react";
import { BOARD_DEPTS, cardRole, deptsFor, TONE_STYLE, type BoardDeptKey, type DeptSoRow } from "@/lib/dept-board-keys";
import type { KpiCard } from "@/lib/kpis";
import { ChartCard, Columns, Donut, HBars, VizStyles, type Datum } from "./spare-dashboard/charts";
import { cardHref, DEPT_ICON, splitCards } from "./dept-board";

const nf = new Intl.NumberFormat("en-IN");
/** Colours for a status chart: the palette in its fixed order, never cycled past eight. */
const SERIES = ["var(--viz-blue)", "var(--viz-orange)", "var(--viz-aqua)", "var(--viz-yellow)", "var(--viz-violet)", "var(--viz-red)", "var(--viz-green)", "var(--viz-gray)"];
const fmtDate = (d: string | null) =>
  d ? new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }) : "—";

export function DeptDashboard({
  dept,
  cards,
  rows,
  kind,
  today,
  scope,
  query,
}: {
  dept: BoardDeptKey;
  cards: KpiCard[];
  rows: DeptSoRow[];
  kind: "spare" | "pump";
  today: string;
  scope: string;
  query: string;
}) {
  const meta = BOARD_DEPTS.find((d) => d.key === dept)!;
  const Icon = DEPT_ICON[meta.icon];
  const { totals, overdue, holds, groups } = splitCards(cards);
  const all = totals.find((t) => t.key === "all");
  const withQuery = (path: string) => `${path}${query ? `?${query}` : ""}`;

  // How late the overdue SOs are, from the table's own targets.
  const late = rows.filter((r) => r.late > 0).map((r) => r.late);
  const lateBuckets = (
    [["1–7", 1, 7], ["8–15", 8, 15], ["16–30", 16, 30], ["31–60", 31, 60], ["60+", 61, 1e9]] as [string, number, number][]
  ).map(([label, lo, hi]) => ({ label, count: late.filter((v) => v >= lo && v <= hi).length }));

  return (
    <div className="viz space-y-5">
      <VizStyles />
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-[#1F3864] via-[#26467d] to-[#2F5496] p-5 text-white shadow-md sm:p-6">
        <span className="pointer-events-none absolute -right-16 -top-20 h-64 w-64 rounded-full bg-white/[0.06]" />
        <span className="pointer-events-none absolute -bottom-24 right-40 h-48 w-48 rounded-full bg-white/[0.04]" />
        <div className="relative flex flex-wrap items-center justify-between gap-3">
          <Link href={withQuery("/risansi/orders")} className="inline-flex items-center gap-1.5 text-xs font-medium text-white/75 transition hover:text-white">
            <ArrowLeft className="h-3.5 w-3.5" /> Orders
          </Link>
          <Link
            href={cardHref(meta.page, { params: {} }, kind)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-white/10 px-3 py-1.5 text-xs font-semibold ring-1 ring-white/20 transition hover:bg-white/20"
          >
            Open {meta.label} page <ExternalLink className="h-3.5 w-3.5" />
          </Link>
        </div>
        <div className="relative mt-3 flex flex-wrap items-center gap-4">
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/15 ring-1 ring-white/25">
            <Icon className="h-6 w-6" />
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-semibold tracking-tight">{meta.label}</h1>
            <p className="mt-0.5 text-sm text-white/70">
              {scope || (kind === "pump" ? "Pump" : "Spare")} · as of {fmtDate(today)}
            </p>
          </div>
        </div>
        <nav className="relative mt-5 flex flex-wrap gap-1.5">
          {deptsFor(kind).map((d) => (
            <Link
              key={d.key}
              href={withQuery(`/risansi/orders/board/${d.key}`)}
              className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                d.key === dept ? "bg-white text-[#1F3864] shadow-sm" : "bg-white/10 text-white/80 hover:bg-white/20 hover:text-white"
              }`}
            >
              {d.label}
            </Link>
          ))}
        </nav>
      </div>

      {!all?.count ? (
        <p className="rounded-2xl border border-card-border bg-surface px-6 py-12 text-center text-sm text-muted">
          No SO in this view is on {meta.label}&apos;s page.
        </p>
      ) : (
        <>
          {/* The totals, then overdue and holds: the department's own cards. */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
            {[...totals, ...overdue, ...holds].map((c) => (
              <Tile key={c.key} card={c} href={c.measure ? null : cardHref(meta.page, c, kind)} />
            ))}
          </div>

          {/* Each group of statuses, as the department's page groups its cards. */}
          <div className="grid gap-4 lg:grid-cols-2">
            {groups.map((g) => (
              <StatusGroup key={g.name} name={g.name} cards={g.cards} page={meta.page} kind={kind} />
            ))}
            {late.length > 0 && (
              <ChartCard title="How late" sub={`${late.length} SOs past ${meta.label}'s target, by days`}>
                <Columns data={lateBuckets} xTitle="Days past target" color="var(--viz-red)" />
              </ChartCard>
            )}
          </div>

          <SoTable rows={rows} dept={meta.label} cards={cards} />
        </>
      )}
    </div>
  );
}

function Tile({ card, href }: { card: KpiCard; href: string | null }) {
  const tone = TONE_STYLE[card.tone ?? "neutral"];
  const body = (
    <>
      <span className="absolute inset-x-0 top-0 h-1" style={{ background: tone.color }} />
      <p className="text-xs font-medium text-muted">{card.label}</p>
      <p className={`mt-1 text-3xl font-bold tabular-nums ${card.tone === "danger" && card.count ? "text-rose-600 dark:text-rose-400" : "text-foreground"}`}>
        {nf.format(card.count)}
      </p>
      <p className="mt-0.5 text-[11px] text-muted">
        {card.also ? `${nf.format(card.also.count)} ${card.also.label}` : card.heldCount ? `${card.heldCount} on CV hold` : " "}
      </p>
    </>
  );
  const cls = "relative block overflow-hidden rounded-2xl border border-card-border bg-surface p-4 shadow-sm";
  return href ? (
    <Link href={href} className={`${cls} transition hover:-translate-y-px hover:shadow-md`}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

/** A group of statuses: a donut of its SOs (or a sum: ECs, items) and each status opening the page on it. */
function StatusGroup({ name, cards, page, kind }: { name: string; cards: KpiCard[]; page: string; kind: "spare" | "pump" }) {
  const sum = cards.some((c) => c.measure);
  const strip = (l: string) => (l.startsWith(`${name} `) ? l.slice(name.length + 1) : l.replace(/^(SO|EC|Curve|Part) /, ""));
  const data: Datum[] = cards.map((c, i) => ({ label: strip(c.label), count: c.count, color: SERIES[i % SERIES.length] }));
  const ecs: Datum[] = cards.filter((c) => c.also).map((c, i) => ({ label: strip(c.label), count: c.also!.count, color: SERIES[i % SERIES.length] }));
  const unit = sum ? (name === "BOI" ? "items" : "ECs") : "SOs";
  return (
    <ChartCard title={name === "Status" ? "Status" : name} sub={sum ? `By status, counting ${unit}` : `SOs by status${ecs.length ? `, and their ${cards.find((c) => c.also)!.also!.label}` : ""}`}>
      <Donut data={data.filter((d) => d.count)} centerLabel={unit} format={(n) => nf.format(n)} />
      {ecs.length > 0 && (
        <div className="mt-4 border-t border-card-border pt-3">
          <p className="mb-2 text-xs font-medium text-muted">{cards.find((c) => c.also)?.also?.label === "pumps" ? "Pumps" : "ECs"} at each status</p>
          <HBars data={ecs} />
        </div>
      )}
      {!sum && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {cards.map((c) => (
            <Link
              key={c.key}
              href={cardHref(page, c, kind)}
              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset transition hover:brightness-95 ${TONE_STYLE[c.tone ?? "neutral"].chip}`}
            >
              {strip(c.label)} <b className="tabular-nums">{c.count}</b>
              <ArrowUpRight className="h-3 w-3 opacity-60" />
            </Link>
          ))}
        </div>
      )}
    </ChartCard>
  );
}

/** Rows the table draws at a time. */
const PAGE = 50;

function SoTable({ rows, dept, cards }: { rows: DeptSoRow[]; dept: string; cards: KpiCard[] }) {
  // Filter by any of the department's own cards (its statuses, Overdue, holds).
  const [pick, setPick] = useState<string>("all");
  const [search, setSearch] = useState("");
  const options = cards.filter((c) => cardRole(c) !== "total" && !c.measure);
  const groupsShown = useMemo(() => {
    const names: string[] = [];
    for (const r of rows) for (const s of r.statuses) if (!names.includes(s.group)) names.push(s.group);
    return names;
  }, [rows]);
  // The search applies once typing pauses.
  const [needle, setNeedle] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setNeedle(search.trim().toLowerCase()), 300);
    return () => clearTimeout(t);
  }, [search]);
  const list = rows
    .filter((r) => pick === "all" || r.statuses.some((s) => s.key === pick) || r.flags.some((f) => f.key === pick))
    .filter((r) => !needle || r.soNo.toLowerCase().includes(needle) || r.client.toLowerCase().includes(needle))
    .sort((a, b) => b.late - a.late || (a.soDate ?? "").localeCompare(b.soDate ?? ""));
  // 50 rows at a time, 50 more as the list is scrolled to its end; back to 50 when the filter or search changes.
  const view = `${pick}|${needle}`;
  const [paged, setPaged] = useState({ view, n: PAGE });
  const limit = paged.view === view ? paged.n : PAGE;
  const shown = list.slice(0, limit);
  const boxRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLTableRowElement>(null);
  useEffect(() => {
    const end = endRef.current;
    if (!end || limit >= list.length) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setPaged({ view, n: limit + PAGE });
      },
      { root: boxRef.current, rootMargin: "200px" }
    );
    io.observe(end);
    return () => io.disconnect();
  }, [view, limit, list.length]);
  const hasEc = rows.some((r) => r.ecStatuses?.length);
  const hasTarget = rows.some((r) => r.target);
  const heads = [
    "SO No.",
    "Client",
    "Type",
    "SO Date",
    ...groupsShown.map((g) => (g === "Status" ? "Status" : g)),
    ...(hasEc ? ["ECs by status"] : []),
    ...(hasTarget ? ["Target", "Late"] : []),
    "Overdue / hold",
  ];
  return (
    <section className="overflow-hidden rounded-2xl border border-card-border bg-surface shadow-sm">
      <header className="flex flex-wrap items-center gap-3 border-b border-card-border px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold text-foreground">{dept} · SOs</h2>
          <p className="text-xs text-muted">{shown.length < list.length ? `${shown.length} of ${list.length}` : list.length} shown · most overdue first</p>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <select
            value={pick}
            onChange={(e) => setPick(e.target.value)}
            className="h-8 max-w-[18rem] rounded-lg border border-input-border bg-surface px-2 text-xs text-foreground outline-none focus:border-primary"
            aria-label="Card"
          >
            <option value="all">All SOs ({rows.length})</option>
            {options.map((c) => (
              <option key={c.key} value={c.key}>
                {c.label} ({c.count})
              </option>
            ))}
          </select>
          <label className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="SO or client"
              className="h-8 w-44 rounded-lg border border-input-border bg-surface pl-8 pr-2 text-xs text-foreground outline-none focus:border-primary"
            />
          </label>
        </div>
      </header>
      <div ref={boxRef} className="max-h-[70vh] overflow-auto">
        <table className="w-full min-w-[900px] text-sm">
          <thead className="sticky top-0 z-10">
            <tr className="text-left text-[11px] font-semibold uppercase tracking-wide text-muted">
              {heads.map((h) => (
                <th key={h} className="whitespace-nowrap border-b border-card-border bg-surface px-4 py-2.5">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.id} className="border-b border-card-border/70 transition-colors last:border-0 hover:bg-background/60">
                <td className="whitespace-nowrap px-4 py-2.5">
                  <Link href={`/risansi/orders/${r.id}`} className="group inline-flex items-center gap-1 font-semibold text-foreground hover:text-[#2F5496] dark:hover:text-sky-300">
                    {r.soNo}
                    <ArrowUpRight className="h-3 w-3 opacity-0 transition group-hover:opacity-100" />
                  </Link>
                </td>
                <td className="max-w-[16rem] truncate px-4 py-2.5 text-foreground" title={r.client}>
                  {r.client || "—"}
                </td>
                <td className="px-4 py-2.5 text-muted">{r.orderType || "—"}</td>
                <td className="whitespace-nowrap px-4 py-2.5 tabular-nums text-muted">{fmtDate(r.soDate)}</td>
                {groupsShown.map((g) => {
                  const s = r.statuses.find((x) => x.group === g);
                  const tone = TONE_STYLE[s?.tone ?? "neutral"];
                  const label = s ? (s.label.startsWith(`${g} `) ? s.label.slice(g.length + 1) : s.label.replace(/^(SO|EC|Curve|Part) /, "")) : null;
                  return (
                    <td key={g} className="px-4 py-2.5">
                      {s ? (
                        <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${tone.chip}`}>
                          <span className={`h-1.5 w-1.5 rounded-full ${tone.dot}`} />
                          {label}
                        </span>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>
                  );
                })}
                {hasEc && (
                  <td className="px-4 py-2.5 text-xs text-muted">
                    {r.ecStatuses?.length ? r.ecStatuses.map((e) => `${e.count} ${e.label}`).join(" · ") : "—"}
                  </td>
                )}
                {hasTarget && (
                  <>
                    <td className="whitespace-nowrap px-4 py-2.5 tabular-nums text-muted">{fmtDate(r.target)}</td>
                    <td className="px-4 py-2.5">
                      {r.late > 0 ? (
                        <span className="rounded-full bg-rose-600 px-2 py-0.5 text-[11px] font-bold tabular-nums text-white">{r.late}d</span>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>
                  </>
                )}
                <td className="px-4 py-2.5">
                  <span className="flex flex-wrap gap-1">
                    {r.flags.map((f) => (
                      <span key={f.key} className={`whitespace-nowrap rounded-full px-1.5 py-0.5 text-[10.5px] font-medium ring-1 ring-inset ${TONE_STYLE.danger.chip}`}>
                        {f.label}
                      </span>
                    ))}
                    {!r.flags.length && <span className="text-muted">—</span>}
                  </span>
                </td>
              </tr>
            ))}
            {shown.length < list.length && (
              <tr ref={endRef}>
                <td colSpan={heads.length} className="px-4 py-4 text-center text-xs text-muted">
                  Loading more…
                </td>
              </tr>
            )}
            {!list.length && (
              <tr>
                <td colSpan={heads.length} className="px-4 py-10 text-center text-sm text-muted">
                  No SOs match.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
