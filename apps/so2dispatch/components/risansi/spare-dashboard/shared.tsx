"use client";

// The parts the Spare and Pump dashboards share: the metric tiles, the By Rep
// table (its stage columns given by the dashboard), the intake, zone and
// client charts, the watchlist and the holds.

import Link from "next/link";
import { useState, type ReactNode } from "react";
import type { Bucket, RepRow } from "@/lib/spare-dashboard";
import { ChartCard, Columns, HBars, StackBar, type Datum } from "./charts";

const inr = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });
/** Rs 2.45 Cr / Rs 12.3 L / Rs 45,000. */
export function money(n: number): string {
  if (n >= 1e7) return `₹${(n / 1e7).toFixed(2)} Cr`;
  if (n >= 1e5) return `₹${(n / 1e5).toFixed(1)} L`;
  return `₹${inr.format(n)}`;
}

/** Dispatch's statuses, ordered so no two neighbours are hard to tell apart (validated). */
export const DISPATCH_COLOR: Record<string, string> = {
  "Fully dispatched": "var(--viz-aqua)",
  "Dispatch hold": "var(--viz-orange)",
  "Lot dispatched": "var(--viz-blue)",
  "To dispatch": "var(--viz-yellow)",
  "Not at Dispatch yet": "var(--viz-seq-2)",
  "Cancelled / Diverted": "var(--viz-gray)",
};
export const DISPATCH_ORDER = ["Fully dispatched", "Dispatch hold", "Lot dispatched", "To dispatch", "Not at Dispatch yet", "Cancelled / Diverted"];

/** The dispatch mix as the donut draws it. */
export function dispatchData(mix: Bucket[]): Datum[] {
  return DISPATCH_ORDER.map((label) => ({
    label,
    count: mix.find((d) => d.label === label)?.count ?? 0,
    color: DISPATCH_COLOR[label],
  }));
}

export function Metric({
  icon,
  label,
  value,
  sub,
  tone = "default",
}: {
  icon: ReactNode;
  label: string;
  value: string;
  sub?: string;
  tone?: "default" | "good" | "warn" | "bad";
}) {
  const ring =
    tone === "good"
      ? "text-emerald-600 bg-emerald-50 dark:bg-emerald-500/10 dark:text-emerald-400"
      : tone === "warn"
        ? "text-amber-600 bg-amber-50 dark:bg-amber-500/10 dark:text-amber-400"
        : tone === "bad"
          ? "text-rose-600 bg-rose-50 dark:bg-rose-500/10 dark:text-rose-400"
          : "text-primary bg-primary/10";
  // The figure carries its status too; a plain one stays in ink.
  const ink =
    tone === "good"
      ? "text-emerald-700 dark:text-emerald-400"
      : tone === "warn"
        ? "text-amber-700 dark:text-amber-400"
        : tone === "bad"
          ? "text-rose-700 dark:text-rose-400"
          : "text-foreground";
  return (
    <div className="flex min-w-0 flex-col rounded-2xl border border-card-border bg-surface p-3.5 shadow-sm">
      <div className="flex items-start gap-2">
        <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${ring} [&>svg]:h-4 [&>svg]:w-4`}>{icon}</span>
        {/* Two lines at most, never cut off: the tiles are narrow six to a row. */}
        <p className="line-clamp-2 min-h-[2.4em] pt-px text-[11px] font-semibold uppercase leading-tight tracking-wide text-muted">{label}</p>
      </div>
      <p className={`mt-2.5 font-display text-[1.75rem] font-bold leading-none tabular-nums ${ink}`}>{value}</p>
      {sub && <p className="mt-1.5 line-clamp-2 text-[11px] leading-snug text-muted">{sub}</p>}
    </div>
  );
}

type Tone = "blue" | "orange" | "rose" | "aqua";

/** A count (or amount) cell: muted at zero, tinted by how much of the column's largest it is. */
export function CountCell({
  n,
  max,
  tone = "blue",
  strong = false,
  fmt = String,
}: {
  n: number;
  max: number;
  tone?: Tone;
  strong?: boolean;
  fmt?: (n: number) => string;
}) {
  const a = max ? Math.max(0.06, n / max) * 0.22 : 0;
  const bg = { blue: "42,120,214", orange: "235,104,52", rose: "227,73,72", aqua: "27,175,122" }[tone];
  return (
    <td
      className={`px-2 py-2 text-center tabular-nums ${n ? (strong ? "font-semibold text-foreground" : "text-foreground") : "text-muted-foreground"}`}
      style={n ? { background: `rgba(${bg},${a})` } : undefined}
    >
      {n ? fmt(n) : "·"}
    </td>
  );
}

/** A column group of the By Rep table: its stages, and whether No slip closes it. */
export type RepGroup<S extends string> = {
  title: string;
  cols: { stage: S; label: string; tone?: Tone }[];
  noSlip?: boolean;
};

/** The By Rep table's two views: how many SOs, or how much order value. */
type RepView = "sos" | "value";

function RepTable<S extends string>({
  reps,
  view,
  groups,
  colors,
}: {
  reps: RepRow<S>[];
  view: RepView;
  groups: RepGroup<S>[];
  colors: Record<S, string>;
}) {
  const all = groups.flatMap((g) => g.cols);
  const byValue = view === "value";
  // Each figure in the chosen view.
  const st = (r: RepRow<S>, s: S) => (byValue ? r.stageValues[s] : r.stages[s]);
  const noSlip = (r: RepRow<S>) => (byValue ? r.noSlipValue : r.noSlip);
  const late = (r: RepRow<S>) => (byValue ? r.lateValue : r.late);
  const fmt = byValue ? money : String;
  const maxOf = (s: S) => Math.max(0, ...reps.map((r) => st(r, s)));
  const total = (s: S) => reps.reduce((a, r) => a + st(r, s), 0);
  const th = "px-2 py-2 text-center text-[11px] font-semibold uppercase tracking-wide text-muted";
  const group = "border-l border-card-border px-2 pt-2 pb-1 text-center text-[11px] font-semibold uppercase tracking-wider text-foreground";
  const foot = "border-t-2 border-card-border px-2 py-2 text-center tabular-nums text-foreground";
  const maxSos = Math.max(0, ...reps.map((r) => r.sos));
  const maxLate = Math.max(0, ...reps.map(late));
  const maxNoSlip = Math.max(0, ...reps.map(noSlip));
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[1100px] border-separate border-spacing-0 text-sm">
        <thead>
          <tr>
            <th colSpan={3} />
            {groups.map((g) => (
              <th key={g.title} colSpan={g.cols.length + (g.noSlip ? 1 : 0)} className={group}>
                {g.title}
              </th>
            ))}
            <th colSpan={3} className={group}>Delivery</th>
          </tr>
          <tr className="border-b border-card-border">
            <th className={`${th} text-left`}>Rep</th>
            <th className={th}>SOs</th>
            <th className={`${th} text-right`}>Value</th>
            {groups.map((g) => [
              ...g.cols.map((c, i) => (
                <th key={c.stage} className={`${th} ${i === 0 ? "border-l border-card-border" : ""}`}>{c.label}</th>
              )),
              g.noSlip ? <th key={`${g.title}-noslip`} className={th}>No slip</th> : null,
            ])}
            <th className={`${th} border-l border-card-border`}>Late</th>
            <th className={th}>On time</th>
            <th className={`${th} text-left`}>Pipeline</th>
          </tr>
        </thead>
        <tbody>
          {reps.map((r) => {
            const onTime = r.dispatchedMeasured ? Math.round((r.dispatchedOnTime / r.dispatchedMeasured) * 100) : null;
            return (
              <tr key={r.rep} className="border-b border-card-border/60 hover:bg-background/60 [&>td]:border-b [&>td]:border-card-border/60">
                <td className="whitespace-nowrap px-2 py-2 font-medium text-foreground">{r.rep}</td>
                <CountCell n={r.sos} max={maxSos} strong />
                <td className="px-2 py-2 text-right tabular-nums text-foreground">{r.value ? money(r.value) : "—"}</td>
                {groups.map((g) => [
                  ...g.cols.map((c) => <CountCell key={c.stage} n={st(r, c.stage)} max={maxOf(c.stage)} tone={c.tone} fmt={fmt} />),
                  g.noSlip ? <CountCell key={`${g.title}-noslip`} n={noSlip(r)} max={maxNoSlip} tone="rose" fmt={fmt} /> : null,
                ])}
                <CountCell n={late(r)} max={maxLate} tone="rose" strong fmt={fmt} />
                <td className="px-2 py-2 text-center tabular-nums">
                  {onTime === null ? (
                    <span className="text-muted-foreground">—</span>
                  ) : (
                    <span className={onTime >= 70 ? "font-semibold text-emerald-600 dark:text-emerald-400" : onTime >= 40 ? "font-semibold text-amber-600 dark:text-amber-400" : "font-semibold text-rose-600 dark:text-rose-400"}>
                      {onTime}%
                    </span>
                  )}
                </td>
                <td className="px-2 py-2">
                  <StackBar
                    title={byValue ? `${r.rep}'s order value` : `${r.rep}'s SOs`}
                    parts={all.map((c) => ({ label: c.label, count: st(r, c.stage), color: colors[c.stage] }))}
                    fmt={fmt}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="font-semibold">
            <td className="border-t-2 border-card-border px-2 py-2 text-foreground">All Reps</td>
            <td className={foot}>{reps.reduce((a, r) => a + r.sos, 0)}</td>
            <td className={`${foot} text-right`}>{money(reps.reduce((a, r) => a + r.value, 0))}</td>
            {groups.map((g) => [
              ...g.cols.map((c) => <td key={c.stage} className={foot}>{fmt(total(c.stage))}</td>),
              g.noSlip ? <td key={`${g.title}-noslip`} className={foot}>{fmt(reps.reduce((a, r) => a + noSlip(r), 0))}</td> : null,
            ])}
            <td className={foot}>{fmt(reps.reduce((a, r) => a + late(r), 0))}</td>
            <td className="border-t-2 border-card-border px-2 py-2" colSpan={2} />
          </tr>
        </tfoot>
      </table>
      <p className="mt-2 text-[11px] text-muted">
        {byValue ? "Order value in INR, each SO's in full under its stage. " : ""}All SOs, cancelled and diverted included; an SO shared by two Reps counts for each. Late: dispatched after its delivery date as per SO, or not
        dispatched and past it. On time: dispatched SOs whose first dispatch was on or before that date.
      </p>
    </div>
  );
}

/** The By Rep card, with its SO count / Order value toggle. */
export function RepCard<S extends string>({ reps, groups, colors }: { reps: RepRow<S>[]; groups: RepGroup<S>[]; colors: Record<S, string> }) {
  const [view, setView] = useState<RepView>("sos");
  return (
    <ChartCard
      title="By Rep"
      sub={view === "value" ? "Each Rep's order value by stage, and how their dispatches are going" : "Each Rep's SOs by stage, and how their dispatches are going"}
      right={
        <div className="inline-flex shrink-0 rounded-lg border border-input-border bg-background p-0.5 text-xs font-medium" role="group" aria-label="By Rep view">
          {(
            [
              ["sos", "SO count"],
              ["value", "Order value"],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              type="button"
              onClick={() => setView(k)}
              aria-pressed={view === k}
              className={`rounded-md px-2.5 py-1 transition-colors ${view === k ? "bg-primary text-primary-foreground shadow-sm" : "text-muted hover:text-foreground"}`}
            >
              {label}
            </button>
          ))}
        </div>
      }
    >
      <RepTable reps={reps} view={view} groups={groups} colors={colors} />
    </ChartCard>
  );
}

/** Order intake by SO date, last 12 months. */
export function IntakeCard({ intake, kind }: { intake: Bucket[]; kind: string }) {
  return (
    <ChartCard title="Order intake" sub={`${kind} SOs by SO date, last 12 months — hover a month for its value`}>
      <Columns
        data={intake}
        width={1100}
        height={220}
        tooltip={(d) => (
          <>
            <span className="font-semibold">{d.label}</span> · {d.count} SOs · {money(d.value ?? 0)}
          </>
        )}
      />
    </ChartCard>
  );
}

/** SOs by zone, and the top clients by value. */
export function ZoneClientCards({ zones, clients }: { zones: Bucket[]; clients: Bucket[] }) {
  const ZONE_COLORS = ["var(--viz-blue)", "var(--viz-orange)", "var(--viz-aqua)", "var(--viz-violet)", "var(--viz-yellow)", "var(--viz-gray)"];
  const z: Datum[] = zones.map((x, i) => ({ ...x, color: ZONE_COLORS[Math.min(i, ZONE_COLORS.length - 1)] }));
  const c: Datum[] = clients.map((x) => ({ ...x, count: Math.round(x.value ?? 0), color: "var(--viz-blue)" }));
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <ChartCard title="SOs by zone" sub="Count, with order value">
        <HBars data={z} format={(d) => <><b>{d.count}</b> <span className="text-muted">· {money(d.value ?? 0)}</span></>} />
      </ChartCard>
      <ChartCard title="Top clients" sub="By order value">
        <HBars data={c} format={(d) => <b>{money(d.count)}</b>} />
      </ChartCard>
    </div>
  );
}

type ListedSo = {
  id: string;
  so_no: string;
  client: string;
  stage: string;
  delivery_date: string | null;
  holds: { by: string; reason: string }[];
};

const day = (v: string | null) =>
  v ? new Date(`${v}T00:00:00Z`).toLocaleDateString("en-GB", { day: "2-digit", month: "short", timeZone: "UTC" }) : "—";

/** The watchlist (late, then due this week) and the SOs on hold. */
export function WatchHoldCards({
  watch,
  holds,
  colors,
}: {
  watch: (ListedSo & { daysLate: number })[];
  holds: ListedSo[];
  colors: Record<string, string>;
}) {
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <ChartCard title="Watchlist" sub="Most late first, then due in the next 7 days">
        {watch.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted">Nothing late or due this week.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] font-semibold uppercase tracking-wide text-muted">
                <th className="py-1.5 pr-2">SO</th>
                <th className="py-1.5 pr-2">Client</th>
                <th className="py-1.5 pr-2">Stage</th>
                <th className="py-1.5 pr-2 text-right">Delivery</th>
              </tr>
            </thead>
            <tbody>
              {watch.map((s) => (
                <tr key={s.id} className="border-t border-card-border/70">
                  <td className="py-1.5 pr-2 whitespace-nowrap">
                    <Link href={`/risansi/orders/${s.id}`} className="font-medium text-primary hover:underline">{s.so_no}</Link>
                  </td>
                  <td className="max-w-[12rem] truncate py-1.5 pr-2 text-foreground" title={s.client}>{s.client}</td>
                  <td className="py-1.5 pr-2 whitespace-nowrap text-xs">
                    <span className="mr-1 inline-block h-2 w-2 rounded-full" style={{ background: colors[s.stage] ?? "var(--viz-gray)" }} />
                    {s.stage}
                  </td>
                  <td className="py-1.5 pr-2 text-right whitespace-nowrap">
                    <span className="text-foreground">{day(s.delivery_date)}</span>
                    <span className={`ml-1.5 rounded px-1.5 py-0.5 text-[10.5px] font-semibold ${s.daysLate > 0 ? "bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:text-rose-300" : "bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300"}`}>
                      {s.daysLate > 0 ? `${s.daysLate}d late` : s.daysLate === 0 ? "today" : `in ${-s.daysLate}d`}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </ChartCard>
      <ChartCard title="On hold" sub="Held by Clearance, Accounts or Dispatch, with why">
        {holds.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted">No SO is on hold.</p>
        ) : (
          <ul className="divide-y divide-card-border/70">
            {holds.map((s) => (
              <li key={s.id} className="flex flex-wrap items-baseline justify-between gap-2 py-2 text-sm">
                <span className="min-w-0">
                  <Link href={`/risansi/orders/${s.id}`} className="font-medium text-primary hover:underline">{s.so_no}</Link>
                  <span className="ml-2 text-muted">{s.client}</span>
                </span>
                <span className="flex flex-wrap gap-1">
                  {s.holds.map((h) => (
                    <span
                      key={h.by}
                      className={`rounded-md px-1.5 py-0.5 text-[11px] font-medium ${h.by === "Dispatch" ? "bg-orange-50 text-orange-700 dark:bg-orange-500/10 dark:text-orange-300" : "bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:text-rose-300"}`}
                    >
                      {h.by}{h.reason ? ` · ${h.reason}` : ""}
                    </span>
                  ))}
                </span>
              </li>
            ))}
          </ul>
        )}
      </ChartCard>
    </div>
  );
}
