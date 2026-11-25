"use client";

// One department's page off the Orders board: its own summary cards as
// figures and charts (each status as its page names it), and every SO of the
// Orders filter in its queue with the department's own status.

import Link from "next/link";
import { ArrowLeft, ArrowUpRight, ExternalLink } from "lucide-react";
import { BOARD_DEPTS, deptsFor, TONE_STYLE, type BoardDeptKey, type DeptSoRow } from "@/lib/dept-board-keys";
import type { KpiCard } from "@/lib/kpis";
import { ChartCard, Columns, Donut, HBars, StackBar, VizStyles, type Datum } from "./spare-dashboard/charts";
import { money } from "./spare-dashboard/shared";
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
  // A card's order value: of the SOs it counts (every SO for All SOs; none for a sum like ECs).
  const valueOf = (c: KpiCard): number | null =>
    c.key === "all"
      ? rows.reduce((a, r) => a + r.value, 0)
      : c.measure
        ? null
        : rows.filter((r) => r.statuses.some((s) => s.key === c.key) || r.flags.some((f) => f.key === c.key)).reduce((a, r) => a + r.value, 0);
  const lateValue = rows.filter((r) => r.late > 0).reduce((a, r) => a + r.value, 0);

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
              <Tile key={c.key} card={c} value={valueOf(c)} href={c.measure ? null : cardHref(meta.page, c, kind)} />
            ))}
          </div>

          {/* Each group of statuses, as the department's page groups its cards. */}
          <div className="grid gap-4 lg:grid-cols-2">
            {groups.map((g) => (
              <StatusGroup key={g.name} name={g.name} cards={g.cards} page={meta.page} kind={kind} valueOf={valueOf} />
            ))}
            {late.length > 0 && (
              <ChartCard title="How late" sub={`${late.length} SOs (${money(lateValue)}) past ${meta.label}'s target, by days`}>
                <Columns data={lateBuckets} xTitle="Days past target" color="var(--viz-red)" />
              </ChartCard>
            )}
          </div>

          <Breakdowns rows={rows} today={today} cards={cards} />
        </>
      )}
    </div>
  );
}

function Tile({ card, href, value }: { card: KpiCard; href: string | null; value: number | null }) {
  const tone = TONE_STYLE[card.tone ?? "neutral"];
  const body = (
    <>
      <span className="absolute inset-x-0 top-0 h-1" style={{ background: tone.color }} />
      <p className="text-xs font-medium text-muted">{card.label}</p>
      <p className={`mt-1 text-3xl font-bold tabular-nums ${card.tone === "danger" && card.count ? "text-rose-600 dark:text-rose-400" : "text-foreground"}`}>
        {nf.format(card.count)}
      </p>
      {value !== null && <p className="mt-1 text-sm font-semibold tabular-nums text-[#2F5496] dark:text-sky-300">{money(value)}</p>}
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
function StatusGroup({
  name,
  cards,
  page,
  kind,
  valueOf,
}: {
  name: string;
  cards: KpiCard[];
  page: string;
  kind: "spare" | "pump";
  valueOf: (c: KpiCard) => number | null;
}) {
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
        <div className="mt-4 border-t border-card-border pt-3">
          <p className="mb-2 text-xs font-medium text-muted">Order value at each status</p>
          <HBars
            data={cards.map((c, i) => ({ label: strip(c.label), count: valueOf(c) ?? 0, color: SERIES[i % SERIES.length] }))}
            format={(d) => <b>{money(d.count)}</b>}
          />
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
              <span className="tabular-nums opacity-75">· {money(valueOf(c) ?? 0)}</span>
              <ArrowUpRight className="h-3 w-3 opacity-60" />
            </Link>
          ))}
        </div>
      )}
    </ChartCard>
  );
}

/** The SO's status in the department's first group of cards, and whether that is a finished one. */
const lead = (r: DeptSoRow) => r.statuses[0];
const isDone = (r: DeptSoRow) => lead(r)?.tone === "done";

/** Zones laid out as on a map: North on top, West and East either side, South below; Export apart. */
const ZONE_AT: Record<string, string> = {
  North: "col-start-2 row-start-1",
  West: "col-start-1 row-start-2",
  Central: "col-start-2 row-start-2",
  East: "col-start-3 row-start-2",
  South: "col-start-2 row-start-3",
};

/**
 * The department's SOs summed up every way the page can: on a zone map, by
 * month, by age, by representative and by client — each split by the
 * department's own statuses (its first group of cards), never a list.
 */
function Breakdowns({ rows, today, cards }: { rows: DeptSoRow[]; today: string; cards: KpiCard[] }) {
  // The department's statuses, each its colour, in its cards' order.
  const statusCards = splitCards(cards).groups[0]?.cards ?? [];
  const color = (key: string | undefined) => {
    const i = statusCards.findIndex((c) => c.key === key);
    return i >= 0 ? SERIES[i % SERIES.length] : "var(--viz-gray)";
  };
  const strip = (l: string) => l.replace(/^(SO|EC|Curve|Part) /, "");
  const partsOf = (list: DeptSoRow[]) =>
    statusCards.map((c) => ({ label: strip(c.label), count: list.filter((r) => lead(r)?.key === c.key).length, color: color(c.key) }));
  const legend = (
    <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted">
      {statusCards.map((c) => (
        <span key={c.key} className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ background: color(c.key) }} />
          {strip(c.label)}
        </span>
      ))}
    </div>
  );

  // Zones.
  const zones = [...new Set(rows.map((r) => r.zone || "No zone"))];
  const zoneTile = (z: string) => {
    const list = rows.filter((r) => (r.zone || "No zone") === z);
    const open = list.filter((r) => !isDone(r)).length;
    return (
      <div key={z} className={`relative overflow-hidden rounded-xl border border-card-border bg-surface p-3 shadow-sm ${ZONE_AT[z] ?? ""}`}>
        <span className="pointer-events-none absolute -right-5 -top-5 h-14 w-14 rounded-full bg-[#2F5496]/[0.07]" aria-hidden />
        <p className="text-[11px] font-bold uppercase tracking-[0.1em] text-[#2F5496] dark:text-sky-300">{z}</p>
        <p className="mt-1 flex items-baseline gap-2">
          <b className="text-2xl tabular-nums text-foreground">{list.length}</b>
          <span className="text-[11px] text-muted">{open} not done</span>
        </p>
        <p className="text-xs font-semibold tabular-nums text-[#2F5496] dark:text-sky-300">{money(list.reduce((a, r) => a + r.value, 0))}</p>
        <div className="mt-2">
          <StackBar parts={partsOf(list)} title={z} />
        </div>
      </div>
    );
  };
  const mapped = zones.filter((z) => ZONE_AT[z]);
  const apart = zones.filter((z) => !ZONE_AT[z]);

  // The last twelve SO months.
  const months = Array.from({ length: 12 }, (_, i) => {
    const d = new Date(`${today}T00:00:00Z`);
    const m = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - (11 - i), 1));
    return m.toISOString().slice(0, 7);
  });
  const byMonth = months.map((k) => ({
    label: new Date(`${k}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: "short", timeZone: "UTC" }),
    count: rows.filter((r) => r.soDate?.startsWith(k)).length,
    value: rows.filter((r) => r.soDate?.startsWith(k)).reduce((a, r) => a + r.value, 0),
  }));
  const valueTip = (d: { label: string; count: number; value?: number }) => (
    <>
      <span className="font-semibold">{d.label}</span> · {d.count} SOs · {money(d.value ?? 0)}
    </>
  );

  // How long the ones not done have been open, from the SO date.
  const ageOf = (r: DeptSoRow) => (r.soDate ? Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${r.soDate}T00:00:00Z`)) / 86_400_000) : null);
  const notDone = rows.filter((r) => !isDone(r) && ageOf(r) !== null);
  const ages = notDone.map((r) => ageOf(r)!);
  const ageBuckets = (
    [["0–15", 0, 15], ["16–30", 16, 30], ["31–60", 31, 60], ["61–90", 61, 90], ["91–180", 91, 180], ["180+", 181, 1e9]] as [string, number, number][]
  ).map(([label, lo, hi]) => {
    const inBucket = notDone.filter((r) => ageOf(r)! >= lo && ageOf(r)! <= hi);
    return { label, count: inBucket.length, value: inBucket.reduce((a, r) => a + r.value, 0) };
  });

  // Representatives and clients, most SOs first, each split by status.
  const top = (keyOf: (r: DeptSoRow) => string[], n: number) => {
    const m = new Map<string, DeptSoRow[]>();
    for (const r of rows) for (const k of keyOf(r)) m.set(k, [...(m.get(k) ?? []), r]);
    return [...m.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, n);
  };
  const reps = top((r) => (r.reps ? r.reps.split(/\s*[,/]\s*/).filter(Boolean) : ["No rep"]), 8);
  const clients = top((r) => [r.client || "—"], 8);
  const ranked = (list: [string, DeptSoRow[]][]) => {
    const max = Math.max(1, ...list.map(([, l]) => l.length));
    return (
      <ul className="space-y-2">
        {list.map(([name, l]) => (
          <li key={name} className="grid grid-cols-[minmax(6rem,11rem)_1fr_2.5rem_5.5rem] items-center gap-3 text-sm" title={`${name}: ${l.length} SOs`}>
            <span className="truncate text-foreground">{name}</span>
            <span className="block" style={{ width: `${Math.max(8, (l.length / max) * 100)}%` }}>
              <StackBar parts={partsOf(l)} title={name} />
            </span>
            <b className="text-right text-xs tabular-nums text-foreground">{l.length}</b>
            <span className="text-right text-xs font-semibold tabular-nums text-[#2F5496] dark:text-sky-300">{money(l.reduce((a, r) => a + r.value, 0))}</span>
          </li>
        ))}
      </ul>
    );
  };

  return (
    <>
      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="By zone" sub="SOs on the map, each split by status">
          <div className="grid grid-cols-3 grid-rows-3 gap-2">{mapped.map(zoneTile)}</div>
          {apart.length > 0 && <div className="mt-2 grid grid-cols-2 gap-2">{apart.map(zoneTile)}</div>}
          {legend}
        </ChartCard>
        <ChartCard title="SOs by month" sub={`SO date, the last twelve months · ${money(byMonth.reduce((a, m) => a + m.value, 0))}`}>
          <Columns data={byMonth} color="var(--viz-blue)" tooltip={valueTip} />
        </ChartCard>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="Age of SOs not done" sub={`${ages.length} SOs (${money(notDone.reduce((a, r) => a + r.value, 0))}), days since the SO date`}>
          <Columns data={ageBuckets} xTitle="Days since SO date" color="var(--viz-violet)" tooltip={valueTip} />
        </ChartCard>
        <ChartCard title="By representative" sub="Top eight, each split by status">
          {ranked(reps)}
          {legend}
        </ChartCard>
      </div>
      <ChartCard title="Top clients" sub="Most SOs here, each split by status">
        {ranked(clients)}
        {legend}
      </ChartCard>
    </>
  );
}
