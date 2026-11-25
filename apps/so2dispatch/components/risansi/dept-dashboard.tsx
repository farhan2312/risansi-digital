"use client";

// One department's page off the Orders board: an analysis of the SOs on its
// page in the Orders filter's view — its own summary cards as figures, what
// they add up to in words, and charts of where the SOs stand, how timely they
// are, where they come from and whom they are for, each with how to read it.
// The SOs themselves are listed on the department's own page.

import Link from "next/link";
import type { ReactNode } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowUpRight,
  BookOpen,
  Clock,
  ExternalLink,
  Gauge,
  Info,
  Layers,
  Lightbulb,
  MapPin,
  PauseCircle,
  Users,
  Wallet,
} from "lucide-react";
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
const pct = (n: number, of: number) => (of ? Math.round((n / of) * 100) : 0);
const sumValue = (list: DeptSoRow[]) => list.reduce((a, r) => a + r.value, 0);
const strip = (l: string) => l.replace(/^(SO|EC|Curve|Part) /, "");

/** What each department does, and so what its page here is about. */
const ABOUT: Record<BoardDeptKey, string> = {
  drawing: "Prepares each pump EC's GAD & base plate drawing, performance curve and part drawings, and issues them to Planning once the client approves.",
  purchase: "Buys the bought-out items (motors, gear boxes, VFDs…) the pump ECs need, from order placed to received.",
  billing: "Raises the Proforma Invoices against each SO's payment terms.",
  accounts: "Clears each SO on payments, or holds it until they come in.",
  planning: "Plans each SO's ECs for production and marks them ready, lot by lot.",
  quality: "Prepares and submits the quality documents the SO asks for.",
  assembly: "Assembles and packs the ready ECs, lot by lot, and files the packing slips.",
  dispatch: "Sends the packed SOs out: invoice, transport, docket and LR.",
};

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
  const total = rows.length;
  const totalValue = sumValue(rows);

  // A card's SOs, and their order value (every SO for All SOs; none for a sum like ECs).
  const rowsOf = (c: KpiCard) =>
    c.key === "all" ? rows : rows.filter((r) => r.statuses.some((s) => s.key === c.key) || r.flags.some((f) => f.key === c.key));
  const valueOf = (c: KpiCard): number | null => (c.measure ? null : sumValue(rowsOf(c)));

  // The department's own statuses (its first group of cards): colours, and each SO's.
  const statusCards = groups[0]?.cards ?? [];
  const colorOf = (key: string | undefined) => {
    const i = statusCards.findIndex((c) => c.key === key);
    return i >= 0 ? SERIES[i % SERIES.length] : "var(--viz-gray)";
  };
  const partsOf = (list: DeptSoRow[]) =>
    statusCards.map((c) => ({ label: strip(c.label), count: list.filter((r) => lead(r)?.key === c.key).length, color: colorOf(c.key) }));
  const legend = (
    <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 border-t border-card-border pt-3 text-[11px] text-muted">
      {statusCards.map((c) => (
        <span key={c.key} className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ background: colorOf(c.key) }} />
          {strip(c.label)}
        </span>
      ))}
    </div>
  );

  // Timeliness: past the department's target, and the age of those not done.
  const lateRows = rows.filter((r) => r.late > 0);
  const lateDays = lateRows.map((r) => r.late);
  const lateBuckets = (
    [["1–7", 1, 7], ["8–15", 8, 15], ["16–30", 16, 30], ["31–60", 31, 60], ["60+", 61, 1e9]] as [string, number, number][]
  ).map(([label, lo, hi]) => {
    const b = lateRows.filter((r) => r.late >= lo && r.late <= hi);
    return { label, count: b.length, value: sumValue(b) };
  });
  const ageOf = (r: DeptSoRow) => (r.soDate ? Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${r.soDate}T00:00:00Z`)) / 86_400_000) : null);
  const notDone = rows.filter((r) => !isDone(r) && ageOf(r) !== null);
  const ageBuckets = (
    [["0–15", 0, 15], ["16–30", 16, 30], ["31–60", 31, 60], ["61–90", 61, 90], ["91–180", 91, 180], ["180+", 181, 1e9]] as [string, number, number][]
  ).map(([label, lo, hi]) => {
    const b = notDone.filter((r) => ageOf(r)! >= lo && ageOf(r)! <= hi);
    return { label, count: b.length, value: sumValue(b) };
  });
  const old = notDone.filter((r) => ageOf(r)! > 90);

  // Where from and for whom.
  const zones = [...new Set(rows.map((r) => r.zone || "No zone"))];
  const inZone = (z: string) => rows.filter((r) => (r.zone || "No zone") === z);
  const months = Array.from({ length: 12 }, (_, i) => {
    const d = new Date(`${today}T00:00:00Z`);
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - (11 - i), 1)).toISOString().slice(0, 7);
  });
  const byMonth = months.map((k) => {
    const m = rows.filter((r) => r.soDate?.startsWith(k));
    return { label: new Date(`${k}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: "short", timeZone: "UTC" }), count: m.length, value: sumValue(m) };
  });
  const top = (keyOf: (r: DeptSoRow) => string[], n: number) => {
    const m = new Map<string, DeptSoRow[]>();
    for (const r of rows) for (const k of keyOf(r)) m.set(k, [...(m.get(k) ?? []), r]);
    return [...m.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, n);
  };
  const reps = top((r) => (r.reps ? r.reps.split(/\s*[,/]\s*/).filter(Boolean) : ["No rep"]), 8);
  const clients = top((r) => [r.client || "—"], 8);
  const valueTip = (d: { label: string; count: number; value?: number }) => (
    <>
      <span className="font-semibold">{d.label}</span> · {d.count} SOs · {money(d.value ?? 0)}
    </>
  );

  // What it all adds up to, in words.
  const insights: { icon: ReactNode; tone: "info" | "good" | "warn" | "bad"; text: ReactNode }[] = [];
  insights.push({
    icon: <Layers className="h-4 w-4" />,
    tone: "info",
    text: (
      <>
        <b>{nf.format(total)} SOs</b> worth <b>{money(totalValue)}</b> are on {meta.label}&apos;s page in this view
        {all?.also || totals.some((t) => t.key !== "all") ? (
          <>
            , holding{" "}
            {totals
              .filter((t) => t.key !== "all")
              .map((t) => `${nf.format(t.count)} ${t.label.replace(/^All /, "")}`)
              .join(" and ")}
          </>
        ) : null}
        .
      </>
    ),
  });
  const biggest = [...statusCards].sort((a, b) => b.count - a.count)[0];
  if (biggest?.count) {
    insights.push({
      icon: <Gauge className="h-4 w-4" />,
      tone: biggest.tone === "done" ? "good" : "info",
      text: (
        <>
          Most of them — <b>{nf.format(biggest.count)}</b> ({pct(biggest.count, total)}%, {money(valueOf(biggest) ?? 0)}) — are at <b>{strip(biggest.label)}</b>.
          {statusCards.some((c) => c.tone === "done") && biggest.tone !== "done" && (
            <> {pct(rows.filter(isDone).length, total)}% are at a finished status.</>
          )}
        </>
      ),
    });
  }
  if (lateRows.length) {
    insights.push({
      icon: <AlertTriangle className="h-4 w-4" />,
      tone: "bad",
      text: (
        <>
          <b>{nf.format(lateRows.length)} SOs</b> ({money(sumValue(lateRows))}) are past {meta.label}&apos;s target — on average{" "}
          <b>{Math.round(lateDays.reduce((a, d) => a + d, 0) / lateDays.length)} days</b> late, the longest {Math.max(...lateDays)} days.
        </>
      ),
    });
  } else if (overdue.length) {
    insights.push({ icon: <Clock className="h-4 w-4" />, tone: "good", text: <>No SO is past {meta.label}&apos;s target.</> });
  }
  const held = [...holds, ...statusCards.filter((c) => c.tone === "danger")].filter((c) => c.count);
  if (held.length) {
    insights.push({
      icon: <PauseCircle className="h-4 w-4" />,
      tone: "warn",
      text: (
        <>
          On hold:{" "}
          {held.map((c, i) => (
            <span key={c.key}>
              {i ? ", " : ""}
              <b>{nf.format(c.count)}</b> {strip(c.label).toLowerCase()} ({money(valueOf(c) ?? 0)})
            </span>
          ))}
          .
        </>
      ),
    });
  }
  if (old.length) {
    insights.push({
      icon: <Clock className="h-4 w-4" />,
      tone: "warn",
      text: (
        <>
          <b>{nf.format(old.length)} SOs</b> not done here are over 90 days old ({money(sumValue(old))}).
        </>
      ),
    });
  }
  const bigZone = [...zones].sort((a, b) => inZone(b).length - inZone(a).length)[0];
  if (bigZone && clients[0]) {
    insights.push({
      icon: <MapPin className="h-4 w-4" />,
      tone: "info",
      text: (
        <>
          <b>{bigZone}</b> brings the most SOs ({pct(inZone(bigZone).length, total)}%, {money(sumValue(inZone(bigZone)))}); the largest client is{" "}
          <b>{clients[0][0]}</b> with {clients[0][1].length} SOs ({money(sumValue(clients[0][1]))}).
        </>
      ),
    });
  }

  const ranked = (list: [string, DeptSoRow[]][]) => {
    const max = Math.max(1, ...list.map(([, l]) => l.length));
    return (
      <ul className="space-y-2">
        {list.map(([name, l], i) => (
          <li key={name} className="grid grid-cols-[1.25rem_minmax(6rem,11rem)_1fr_2.5rem_5.5rem] items-center gap-3 text-sm" title={`${name}: ${l.length} SOs`}>
            <span className="text-[11px] font-semibold tabular-nums text-muted">{i + 1}</span>
            <span className="truncate text-foreground">{name}</span>
            <span className="block" style={{ width: `${Math.max(8, (l.length / max) * 100)}%` }}>
              <StackBar parts={partsOf(l)} title={name} />
            </span>
            <b className="text-right text-xs tabular-nums text-foreground">{l.length}</b>
            <span className="text-right text-xs font-semibold tabular-nums text-[#2F5496] dark:text-sky-300">{money(sumValue(l))}</span>
          </li>
        ))}
      </ul>
    );
  };

  return (
    <div className="viz space-y-6">
      <VizStyles />
      {/* The heading band. */}
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
            Open {meta.label} page — the SO list <ExternalLink className="h-3.5 w-3.5" />
          </Link>
        </div>
        <div className="relative mt-3 flex flex-wrap items-start gap-4">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-white/15 ring-1 ring-white/25">
            <Icon className="h-6 w-6" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/60">Department analysis</p>
            <h1 className="text-2xl font-semibold tracking-tight">{meta.label}</h1>
            <p className="mt-1 max-w-3xl text-sm text-white/80">{ABOUT[dept]}</p>
            <p className="mt-1 text-xs text-white/60">
              {scope || (kind === "pump" ? "Pump" : "Spare")} · as of {fmtDate(today)}
            </p>
          </div>
          {total > 0 && (
            <div className="flex gap-2">
              <HeroFigure label="SOs" value={nf.format(total)} />
              <HeroFigure label="Order value" value={money(totalValue)} />
            </div>
          )}
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
          {/* What it adds up to. */}
          <section className="overflow-hidden rounded-2xl border border-[#2F5496]/20 bg-gradient-to-br from-[#1F3864]/[0.05] to-transparent shadow-sm">
            <header className="flex items-center gap-2 border-b border-[#2F5496]/15 px-5 py-3">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-amber-400 to-orange-500 text-white shadow-sm">
                <Lightbulb className="h-4 w-4" />
              </span>
              <h2 className="text-sm font-semibold text-foreground">Key insights</h2>
              <span className="text-xs text-muted">· worked out from the figures below</span>
            </header>
            <ul className="grid gap-x-6 gap-y-3 px-5 py-4 md:grid-cols-2">
              {insights.map((x, i) => (
                <li key={i} className="flex gap-3 text-sm leading-relaxed text-foreground">
                  <span
                    className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${
                      x.tone === "bad"
                        ? "bg-rose-100 text-rose-600 dark:bg-rose-500/15 dark:text-rose-300"
                        : x.tone === "warn"
                          ? "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300"
                          : x.tone === "good"
                            ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300"
                            : "bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300"
                    }`}
                  >
                    {x.icon}
                  </span>
                  <span>{x.text}</span>
                </li>
              ))}
            </ul>
          </section>

          {/* 1. At a glance. */}
          <Section n={1} icon={<Wallet className="h-4 w-4" />} title="At a glance" about={`${meta.label}'s own summary cards, counted over the SOs in this view, with their order value. Click a figure to open ${meta.label}'s page on those SOs.`}>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
              {[...totals, ...overdue, ...holds].map((c) => (
                <Tile key={c.key} card={c} value={valueOf(c)} share={c.key === "all" || c.measure ? null : pct(c.count, total)} href={c.measure ? null : cardHref(meta.page, c, kind)} />
              ))}
            </div>
          </Section>

          {/* 2. Status. */}
          <Section n={2} icon={<Gauge className="h-4 w-4" />} title="Where the SOs stand" about={`Each group of ${meta.label}'s statuses, as its page names them: how many SOs are at each, their ECs or pumps where the page counts them, and the order value tied up at each.`}>
            <div className="grid gap-4 lg:grid-cols-2">
              {groups.map((g) => (
                <StatusGroup key={g.name} name={g.name} cards={g.cards} page={meta.page} kind={kind} valueOf={valueOf} total={total} />
              ))}
            </div>
          </Section>

          {/* 3. Timeliness. */}
          <Section n={3} icon={<Clock className="h-4 w-4" />} title="Timeliness" about={`How far behind ${meta.label} is: SOs past its target date, and how long the SOs not yet at a finished status have been open since their SO date.`}>
            <div className="grid gap-4 lg:grid-cols-2">
              {overdue.length > 0 && (
                <ChartCard title="Past the target" sub={lateRows.length ? `${lateRows.length} SOs (${money(sumValue(lateRows))}) by days past ${meta.label}'s target` : `Every SO is within ${meta.label}'s target`}>
                  <Columns data={lateBuckets} xTitle="Days past target" color="var(--viz-red)" tooltip={valueTip} />
                  <Note>Taller bars to the right mean SOs that are further behind. An SO counts once it is past the target and not yet done here.</Note>
                </ChartCard>
              )}
              <ChartCard title="Age of SOs not done" sub={`${notDone.length} SOs (${money(sumValue(notDone))}) by days since the SO date`}>
                <Columns data={ageBuckets} xTitle="Days since SO date" color="var(--viz-violet)" tooltip={valueTip} />
                <Note>&ldquo;Not done&rdquo; means not at a finished status of {meta.label}&apos;s first group of cards. Bars on the right are the oldest work; hover a bar for its order value.</Note>
              </ChartCard>
            </div>
          </Section>

          {/* 4. Where from. */}
          <Section n={4} icon={<MapPin className="h-4 w-4" />} title="Where the work comes from" about="The SOs by the sales zone they belong to, and by the month of their SO date — where the load comes from and how it has built up.">
            <div className="grid gap-4 lg:grid-cols-2">
              <ChartCard title="By zone" sub="Each zone's SOs, order value and status mix">
                <div className="grid grid-cols-3 grid-rows-3 gap-2">{zones.filter((z) => ZONE_AT[z]).map((z) => <ZoneTile key={z} zone={z} list={inZone(z)} parts={partsOf(inZone(z))} total={total} />)}</div>
                {zones.some((z) => !ZONE_AT[z]) && (
                  <div className="mt-2 grid grid-cols-2 gap-2">{zones.filter((z) => !ZONE_AT[z]).map((z) => <ZoneTile key={z} zone={z} list={inZone(z)} parts={partsOf(inZone(z))} total={total} />)}</div>
                )}
                {legend}
                <Note>Laid out as a compass (North on top, South below), not a map to scale. Each bar shows the zone&apos;s SOs split by {meta.label}&apos;s statuses.</Note>
              </ChartCard>
              <ChartCard title="SOs by month" sub={`By SO date, the last twelve months · ${money(byMonth.reduce((a, m) => a + m.value, 0))}`}>
                <Columns data={byMonth} color="var(--viz-blue)" tooltip={valueTip} />
                <Note>When the SOs now on {meta.label}&apos;s page were placed. A tall bar in an old month is work that has stayed long; hover a bar for its order value.</Note>
              </ChartCard>
            </div>
          </Section>

          {/* 5. For whom. */}
          <Section n={5} icon={<Users className="h-4 w-4" />} title="Who it is for" about="The representatives and clients with the most SOs here, each bar split by the department's statuses, with their order value.">
            <div className="grid gap-4 lg:grid-cols-2">
              <ChartCard title="By representative" sub="Top eight by SOs">
                {ranked(reps)}
                {legend}
              </ChartCard>
              <ChartCard title="Top clients" sub="Top eight by SOs">
                {ranked(clients)}
                {legend}
              </ChartCard>
            </div>
          </Section>

          {/* How to read it. */}
          <section className="rounded-2xl border border-card-border bg-surface p-5 shadow-sm">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <BookOpen className="h-4 w-4 text-[#2F5496]" /> How to read this page
            </h2>
            <dl className="mt-3 grid gap-x-8 gap-y-2 text-xs text-muted md:grid-cols-2">
              <Term t="SOs in view">The SOs the Orders page&apos;s filters and Spare / Pump toggle select that are on {meta.label}&apos;s own page — the same as its All SOs card.</Term>
              <Term t="Statuses">{meta.label}&apos;s own statuses and cards, counted exactly as its page counts them.</Term>
              <Term t="Order value">The SO&apos;s value in rupees: its INR value, or its order value when the order is in INR.</Term>
              <Term t="CV hold">Central Visibility&apos;s hold on an SO. The SO still counts at its own status; the hold shows beside it.</Term>
              <Term t="Overdue / past target">Not yet done here, and past the target date {meta.label} works to.</Term>
              <Term t="Not done">Not at a finished status (green) of {meta.label}&apos;s first group of cards.</Term>
            </dl>
          </section>
        </>
      )}
    </div>
  );
}

function HeroFigure({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-white/10 px-4 py-2.5 ring-1 ring-white/15">
      <p className="text-[10.5px] uppercase tracking-wide text-white/65">{label}</p>
      <p className="text-xl font-bold tabular-nums">{value}</p>
    </div>
  );
}

function Section({ n, icon, title, about, children }: { n: number; icon: ReactNode; title: string; about: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <div className="flex items-start gap-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[#1F3864] to-[#2F5496] text-white shadow-sm">{icon}</span>
        <div>
          <h2 className="text-base font-semibold text-foreground">
            <span className="mr-1.5 text-muted">{n}.</span>
            {title}
          </h2>
          <p className="max-w-4xl text-xs leading-relaxed text-muted">{about}</p>
        </div>
      </div>
      {children}
    </section>
  );
}

function Note({ children }: { children: ReactNode }) {
  return (
    <p className="mt-3 flex gap-1.5 rounded-lg bg-background/70 px-2.5 py-2 text-[11px] leading-relaxed text-muted">
      <Info className="mt-px h-3.5 w-3.5 shrink-0 text-[#2F5496]" />
      <span>{children}</span>
    </p>
  );
}

function Term({ t, children }: { t: string; children: ReactNode }) {
  return (
    <div>
      <dt className="font-semibold text-foreground">{t}</dt>
      <dd className="leading-relaxed">{children}</dd>
    </div>
  );
}

function Tile({ card, href, value, share }: { card: KpiCard; href: string | null; value: number | null; share: number | null }) {
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
        {share !== null ? `${share}% of SOs` : card.also ? `${nf.format(card.also.count)} ${card.also.label}` : card.measure ? "a total, not a filter" : "every SO in view"}
        {card.heldCount ? ` · ${card.heldCount} on CV hold` : ""}
      </p>
      {href && <ArrowUpRight className="absolute right-3 top-3 h-3.5 w-3.5 text-muted" />}
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

/** A group of statuses: a donut of its SOs (or a sum: ECs, items), the order value at each, each status opening the page on it. */
function StatusGroup({
  name,
  cards,
  page,
  kind,
  valueOf,
  total,
}: {
  name: string;
  cards: KpiCard[];
  page: string;
  kind: "spare" | "pump";
  valueOf: (c: KpiCard) => number | null;
  total: number;
}) {
  const sum = cards.some((c) => c.measure);
  const lbl = (l: string) => (l.startsWith(`${name} `) ? l.slice(name.length + 1) : strip(l));
  const data: Datum[] = cards.map((c, i) => ({ label: lbl(c.label), count: c.count, color: SERIES[i % SERIES.length] }));
  const alsoLabel = cards.find((c) => c.also)?.also?.label;
  const ecs: Datum[] = cards.filter((c) => c.also).map((c, i) => ({ label: lbl(c.label), count: c.also!.count, color: SERIES[i % SERIES.length] }));
  const unit = sum ? (name === "BOI" ? "items" : "ECs") : "SOs";
  const lead = [...cards].sort((a, b) => b.count - a.count)[0];
  return (
    <ChartCard
      title={name === "Status" ? "Status" : name}
      sub={sum ? `By status, counting ${unit}` : `SOs by status${alsoLabel ? `, and their ${alsoLabel}` : ""}`}
    >
      <Donut data={data.filter((d) => d.count)} centerLabel={unit} format={(n) => nf.format(n)} />
      {ecs.length > 0 && (
        <div className="mt-4 border-t border-card-border pt-3">
          <p className="mb-2 text-xs font-medium text-muted">{alsoLabel === "pumps" ? "Pumps" : "ECs"} at each status</p>
          <HBars data={ecs} />
        </div>
      )}
      {!sum && (
        <div className="mt-4 border-t border-card-border pt-3">
          <p className="mb-2 text-xs font-medium text-muted">Order value at each status</p>
          <HBars data={cards.map((c, i) => ({ label: lbl(c.label), count: valueOf(c) ?? 0, color: SERIES[i % SERIES.length] }))} format={(d) => <b>{money(d.count)}</b>} />
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
              {lbl(c.label)} <b className="tabular-nums">{c.count}</b>
              <span className="tabular-nums opacity-75">· {money(valueOf(c) ?? 0)}</span>
              <ArrowUpRight className="h-3 w-3 opacity-60" />
            </Link>
          ))}
        </div>
      )}
      {lead?.count ? (
        <Note>
          {sum ? (
            <>
              The most {unit} are at <b>{lbl(lead.label)}</b> ({nf.format(lead.count)}).
            </>
          ) : (
            <>
              <b>{lbl(lead.label)}</b> holds the most SOs: {nf.format(lead.count)} of {nf.format(total)} ({pct(lead.count, total)}%), {money(valueOf(lead) ?? 0)}. Click a status to open those SOs.
            </>
          )}
        </Note>
      ) : null}
    </ChartCard>
  );
}

function ZoneTile({ zone, list, parts, total }: { zone: string; list: DeptSoRow[]; parts: { label: string; count: number; color: string }[]; total: number }) {
  const open = list.filter((r) => !isDone(r)).length;
  return (
    <div className={`relative overflow-hidden rounded-xl border border-card-border bg-surface p-3 shadow-sm ${ZONE_AT[zone] ?? ""}`}>
      <span className="pointer-events-none absolute -right-5 -top-5 h-14 w-14 rounded-full bg-[#2F5496]/[0.07]" aria-hidden />
      <p className="flex items-center justify-between text-[11px] font-bold uppercase tracking-[0.1em] text-[#2F5496] dark:text-sky-300">
        {zone}
        <span className="font-semibold normal-case tracking-normal text-muted">{pct(list.length, total)}%</span>
      </p>
      <p className="mt-1 flex items-baseline gap-2">
        <b className="text-2xl tabular-nums text-foreground">{list.length}</b>
        <span className="text-[11px] text-muted">{open} not done</span>
      </p>
      <p className="text-xs font-semibold tabular-nums text-[#2F5496] dark:text-sky-300">{money(sumValue(list))}</p>
      <div className="mt-2">
        <StackBar parts={parts} title={zone} />
      </div>
    </div>
  );
}
