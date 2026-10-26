"use client";

import Link from "next/link";
import { AlertTriangle, CalendarClock, Clock, Gauge, IndianRupee, PackageOpen, PauseCircle, Timer } from "lucide-react";
import type { ReactNode } from "react";
import type { RepRow, SpareDashboard, Stage } from "@/lib/spare-dashboard";
import { ChartCard, Columns, Donut, HBars, StackBar, VizStyles, type Datum } from "./charts";

const inr = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });
/** Rs 2.45 Cr / Rs 12.3 L / Rs 45,000. */
function money(n: number): string {
  if (n >= 1e7) return `₹${(n / 1e7).toFixed(2)} Cr`;
  if (n >= 1e5) return `₹${(n / 1e5).toFixed(1)} L`;
  return `₹${inr.format(n)}`;
}

/** Each open stage's colour: the pipeline as one blue ramp, earliest lightest; a hold in orange. */
const STAGE_COLOR: Record<Stage, string> = {
  "Date awaited": "var(--viz-seq-1)",
  "In plan": "var(--viz-seq-2)",
  "Partial ready": "var(--viz-seq-3)",
  "Ready, not packed": "var(--viz-seq-4)",
  "Packed, to dispatch": "var(--viz-seq-5)",
  "Dispatch hold": "var(--viz-orange)",
  "Lot dispatched": "var(--viz-seq-6)",
  "Fully dispatched": "var(--viz-aqua)",
};

/** Dispatch's statuses, ordered so no two neighbours are hard to tell apart (validated). */
const DISPATCH_COLOR: Record<string, string> = {
  "Fully dispatched": "var(--viz-aqua)",
  "Dispatch hold": "var(--viz-orange)",
  "Lot dispatched": "var(--viz-blue)",
  Pending: "var(--viz-yellow)",
  "Cancelled / Diverted": "var(--viz-gray)",
};
const DISPATCH_ORDER = ["Fully dispatched", "Dispatch hold", "Lot dispatched", "Pending", "Cancelled / Diverted"];

function Metric({
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
  return (
    <div className="flex items-start gap-3 rounded-2xl border border-card-border bg-surface p-4 shadow-sm">
      <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${ring}`}>{icon}</span>
      <div className="min-w-0">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">{label}</p>
        <p className="mt-0.5 font-display text-2xl font-bold tabular-nums text-foreground">{value}</p>
        {sub && <p className="mt-0.5 text-xs text-muted">{sub}</p>}
      </div>
    </div>
  );
}

const PLAN_COLS: { stage: Stage; label: string }[] = [
  { stage: "Date awaited", label: "Date awaited" },
  { stage: "In plan", label: "In plan" },
  { stage: "Partial ready", label: "Partial ready" },
  { stage: "Ready, not packed", label: "Fully ready, not packed" },
];
const PACK_COLS: { stage: Stage; label: string }[] = [{ stage: "Packed, to dispatch", label: "Packed, to dispatch" }];
const DISPATCH_COLS: { stage: Stage; label: string }[] = [
  { stage: "Dispatch hold", label: "Hold" },
  { stage: "Lot dispatched", label: "Lot" },
  { stage: "Fully dispatched", label: "Fully" },
];

/** A count cell: muted at zero, tinted by how much of the column's largest it is. */
function CountCell({ n, max, tone = "blue", strong = false }: { n: number; max: number; tone?: "blue" | "orange" | "rose" | "aqua"; strong?: boolean }) {
  const a = max ? Math.max(0.06, n / max) * 0.22 : 0;
  const bg = { blue: "42,120,214", orange: "235,104,52", rose: "227,73,72", aqua: "27,175,122" }[tone];
  return (
    <td
      className={`px-2 py-2 text-center tabular-nums ${n ? (strong ? "font-semibold text-foreground" : "text-foreground") : "text-muted-foreground"}`}
      style={n ? { background: `rgba(${bg},${a})` } : undefined}
    >
      {n || "·"}
    </td>
  );
}

function RepTable({ reps }: { reps: RepRow[] }) {
  const all = [...PLAN_COLS, ...PACK_COLS, ...DISPATCH_COLS];
  const maxOf = (s: Stage) => Math.max(0, ...reps.map((r) => r.stages[s]));
  const total = (s: Stage) => reps.reduce((a, r) => a + r.stages[s], 0);
  const th = "px-2 py-2 text-center text-[11px] font-semibold uppercase tracking-wide text-muted";
  const group = "border-l border-card-border px-2 pt-2 pb-1 text-center text-[11px] font-semibold uppercase tracking-wider text-foreground";
  const maxSos = Math.max(0, ...reps.map((r) => r.sos));
  const maxLate = Math.max(0, ...reps.map((r) => r.late));
  const maxNoSlip = Math.max(0, ...reps.map((r) => r.noSlip));
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[1100px] border-separate border-spacing-0 text-sm">
        <thead>
          <tr>
            <th colSpan={3} />
            <th colSpan={PLAN_COLS.length} className={group}>Planning</th>
            <th colSpan={PACK_COLS.length + 1} className={group}>Assembly &amp; Packing</th>
            <th colSpan={DISPATCH_COLS.length} className={group}>Dispatch</th>
            <th colSpan={3} className={group}>Delivery</th>
          </tr>
          <tr className="border-b border-card-border">
            <th className={`${th} text-left`}>Rep</th>
            <th className={th}>SOs</th>
            <th className={`${th} text-right`}>Value</th>
            {PLAN_COLS.map((c, i) => (
              <th key={c.stage} className={`${th} ${i === 0 ? "border-l border-card-border" : ""}`}>{c.label}</th>
            ))}
            <th className={`${th} border-l border-card-border`}>Packed, to dispatch</th>
            <th className={th}>No slip</th>
            {DISPATCH_COLS.map((c, i) => (
              <th key={c.stage} className={`${th} ${i === 0 ? "border-l border-card-border" : ""}`}>{c.label}</th>
            ))}
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
                {PLAN_COLS.map((c) => (
                  <CountCell key={c.stage} n={r.stages[c.stage]} max={maxOf(c.stage)} />
                ))}
                <CountCell n={r.stages["Packed, to dispatch"]} max={maxOf("Packed, to dispatch")} />
                <CountCell n={r.noSlip} max={maxNoSlip} tone="rose" />
                <CountCell n={r.stages["Dispatch hold"]} max={maxOf("Dispatch hold")} tone="orange" />
                <CountCell n={r.stages["Lot dispatched"]} max={maxOf("Lot dispatched")} />
                <CountCell n={r.stages["Fully dispatched"]} max={maxOf("Fully dispatched")} tone="aqua" />
                <CountCell n={r.late} max={maxLate} tone="rose" strong />
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
                  <StackBar title={`${r.rep}'s SOs`} parts={all.map((c) => ({ label: c.label, count: r.stages[c.stage], color: STAGE_COLOR[c.stage] }))} />
                </td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="font-semibold">
            <td className="border-t-2 border-card-border px-2 py-2 text-foreground">All Reps</td>
            <td className="border-t-2 border-card-border px-2 py-2 text-center tabular-nums text-foreground">{reps.reduce((a, r) => a + r.sos, 0)}</td>
            <td className="border-t-2 border-card-border px-2 py-2 text-right tabular-nums text-foreground">{money(reps.reduce((a, r) => a + r.value, 0))}</td>
            {[...PLAN_COLS, ...PACK_COLS].map((c) => (
              <td key={c.stage} className="border-t-2 border-card-border px-2 py-2 text-center tabular-nums text-foreground">{total(c.stage)}</td>
            ))}
            <td className="border-t-2 border-card-border px-2 py-2 text-center tabular-nums text-foreground">{reps.reduce((a, r) => a + r.noSlip, 0)}</td>
            {DISPATCH_COLS.map((c) => (
              <td key={c.stage} className="border-t-2 border-card-border px-2 py-2 text-center tabular-nums text-foreground">{total(c.stage)}</td>
            ))}
            <td className="border-t-2 border-card-border px-2 py-2 text-center tabular-nums text-foreground">{reps.reduce((a, r) => a + r.late, 0)}</td>
            <td className="border-t-2 border-card-border px-2 py-2" colSpan={2} />
          </tr>
        </tfoot>
      </table>
      <p className="mt-2 text-[11px] text-muted">
        All SOs except cancelled or diverted; an SO shared by two Reps counts for each. Late: dispatched after its delivery date as per SO, or not
        dispatched and past it. On time: dispatched SOs whose first dispatch was on or before that date.
      </p>
    </div>
  );
}

const day = (v: string | null) =>
  v ? new Date(`${v}T00:00:00Z`).toLocaleDateString("en-GB", { day: "2-digit", month: "short", timeZone: "UTC" }) : "—";

export function SpareDashboardView({ data }: { data: SpareDashboard }) {
  const m = data.metrics;
  const stages: Datum[] = data.stages.map((s) => ({ ...s, color: STAGE_COLOR[s.label as Stage] }));
  const dispatch: Datum[] = DISPATCH_ORDER.map((label) => ({
    label,
    count: data.dispatchMix.find((d) => d.label === label)?.count ?? 0,
    color: DISPATCH_COLOR[label],
  }));
  const ZONE_COLORS = ["var(--viz-blue)", "var(--viz-orange)", "var(--viz-aqua)", "var(--viz-violet)", "var(--viz-yellow)", "var(--viz-gray)"];
  const zones: Datum[] = data.zones.map((z, i) => ({ ...z, color: ZONE_COLORS[Math.min(i, ZONE_COLORS.length - 1)] }));
  const clients: Datum[] = data.clients.map((c) => ({ ...c, count: Math.round(c.value ?? 0), color: "var(--viz-blue)" }));

  return (
    <div className="viz space-y-5">
      <VizStyles />

      {/* Performance at a glance. */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Metric icon={<PackageOpen className="h-5 w-5" />} label="SOs" value={String(m.sos)} sub={`${m.open} not fully dispatched yet`} />
        <Metric
          icon={<Gauge className="h-5 w-5" />}
          label="On-time dispatch"
          value={m.onTimeRate === null ? "—" : `${Math.round(m.onTimeRate * 100)}%`}
          sub={`of ${m.onTimeMeasured} dispatched SOs, vs delivery date`}
          tone={m.onTimeRate === null ? "default" : m.onTimeRate >= 0.7 ? "good" : m.onTimeRate >= 0.4 ? "warn" : "bad"}
        />
        <Metric
          icon={<Timer className="h-5 w-5" />}
          label="SO to first dispatch"
          value={m.avgLead === null ? "—" : `${m.avgLead} days`}
          sub={m.medianLead === null ? undefined : `average · median ${m.medianLead} days`}
        />
        <Metric icon={<Clock className="h-5 w-5" />} label="Average SO age" value={m.avgAge === null ? "—" : `${m.avgAge} days`} sub="since SO date, all SOs" />
        <Metric icon={<AlertTriangle className="h-5 w-5" />} label="Late vs delivery date" value={String(m.late)} sub="dispatched late, or past it and not out" tone={m.late ? "bad" : "good"} />
        <Metric icon={<CalendarClock className="h-5 w-5" />} label="Due in 7 days" value={String(m.dueThisWeek)} sub="delivery date this week" tone={m.dueThisWeek ? "warn" : "default"} />
        <Metric icon={<PauseCircle className="h-5 w-5" />} label="On hold" value={String(m.holds)} sub="Clearance, Accounts or Dispatch" tone={m.holds ? "warn" : "good"} />
        <Metric icon={<IndianRupee className="h-5 w-5" />} label="Order value" value={money(m.value)} sub="all SOs in view, in INR" />
      </div>

      {/* Where the open SOs stand, and how dispatch has gone. */}
      <div className="grid gap-5 lg:grid-cols-5">
        <ChartCard title="SO pipeline" sub="Every SO at its furthest stage" className="lg:col-span-3">
          <HBars data={stages} />
        </ChartCard>
        <ChartCard title="Dispatch status" sub="All SOs in view" className="lg:col-span-2">
          <Donut data={dispatch} centerLabel="SOs" />
        </ChartCard>
      </div>

      <ChartCard title="Order intake" sub="Spare SOs by SO date, last 12 months — hover a month for its value">
        <Columns
          data={data.intake}
          width={1100}
          height={220}
          tooltip={(d) => (
            <>
              <span className="font-semibold">{d.label}</span> · {d.count} SOs · {money(d.value ?? 0)}
            </>
          )}
        />
      </ChartCard>

      <div className="grid gap-5 lg:grid-cols-2">
        <ChartCard title="SO age" sub="Days since SO date, all SOs">
          <Columns data={data.age} color="var(--viz-violet)" xTitle="days" />
        </ChartCard>
        <ChartCard title="SO to first dispatch" sub="Days from SO date to its first dispatch, dispatched SOs">
          <Columns data={data.leadTime} color="var(--viz-aqua)" xTitle="days" />
        </ChartCard>
      </div>

      <ChartCard title="By Rep" sub="Each Rep's SOs by stage, and how their dispatches are going">
        <RepTable reps={data.reps} />
      </ChartCard>

      <div className="grid gap-5 lg:grid-cols-2">
        <ChartCard title="SOs by zone" sub="Count, with order value">
          <HBars data={zones} format={(d) => <><b>{d.count}</b> <span className="text-muted">· {money(d.value ?? 0)}</span></>} />
        </ChartCard>
        <ChartCard title="Top clients" sub="By order value">
          <HBars data={clients} format={(d) => <b>{money(d.count)}</b>} />
        </ChartCard>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <ChartCard title="Watchlist" sub="Most late first, then due in the next 7 days">
          {data.watch.length === 0 ? (
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
                {data.watch.map((s) => (
                  <tr key={s.id} className="border-t border-card-border/70">
                    <td className="py-1.5 pr-2 whitespace-nowrap">
                      <Link href={`/risansi/orders/${s.id}`} className="font-medium text-primary hover:underline">{s.so_no}</Link>
                    </td>
                    <td className="max-w-[12rem] truncate py-1.5 pr-2 text-foreground" title={s.client}>{s.client}</td>
                    <td className="py-1.5 pr-2 whitespace-nowrap text-xs">
                      <span className="mr-1 inline-block h-2 w-2 rounded-full" style={{ background: STAGE_COLOR[s.stage as Stage] ?? "var(--viz-gray)" }} />
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
          {data.holds.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted">No SO is on hold.</p>
          ) : (
            <ul className="divide-y divide-card-border/70">
              {data.holds.map((s) => (
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
    </div>
  );
}
