"use client";

import Link from "next/link";
import { AlertTriangle, CalendarClock, Gauge, IndianRupee, PackageOpen, PauseCircle } from "lucide-react";
import type { DeptRow, PumpDashboard, PumpStage } from "@/lib/pump-dashboard";
import { ChartCard, Donut, HBars, StackBar, VizStyles, type Datum } from "./charts";
import { IntakeCard, Metric, RepCard, WatchHoldCards, ZoneClientCards, dispatchData, money, type RepGroup } from "./shared";

/** The pipeline as one blue ramp, earliest lightest; a hold in orange, lot out in violet. */
const STAGE_COLOR: Record<PumpStage, string> = {
  "No EC yet": "var(--viz-gray)",
  "Date awaited": "var(--viz-seq-1)",
  "In plan": "var(--viz-seq-2)",
  "Partial ready": "var(--viz-seq-3)",
  "Ready, not assembled": "var(--viz-seq-4)",
  "Assembly on": "var(--viz-seq-5)",
  "Assembled, not packed": "var(--viz-seq-6)",
  "Packing on": "var(--viz-seq-7)",
  "Not at Dispatch yet": "var(--viz-seq-7)",
  "On hold": "var(--viz-red)",
  "Packed, to dispatch": "var(--viz-seq-8)",
  "Dispatch hold": "var(--viz-orange)",
  "Lot dispatched": "var(--viz-violet)",
  "Fully dispatched": "var(--viz-aqua)",
  "Cancelled / Diverted": "var(--viz-gray)",
};

/** The By Rep table's columns: Planning, Assembly, Packing, then Dispatch. */
const REP_GROUPS: RepGroup<PumpStage>[] = [
  {
    title: "Planning",
    cols: [
      { stage: "Date awaited", label: "Date awaited" },
      { stage: "In plan", label: "In plan" },
      { stage: "Partial ready", label: "Partial ready" },
      { stage: "Ready, not assembled", label: "Fully ready" },
    ],
  },
  {
    title: "Assembly",
    cols: [
      { stage: "Assembly on", label: "Part assembled" },
      { stage: "Assembled, not packed", label: "Assembled" },
    ],
  },
  {
    title: "Packing",
    cols: [
      { stage: "Packing on", label: "Part packed" },
      { stage: "Packed, to dispatch", label: "Packed, to dispatch" },
    ],
    noSlip: true,
  },
  {
    title: "Dispatch",
    cols: [
      { stage: "Dispatch hold", label: "Hold", tone: "orange" },
      { stage: "Lot dispatched", label: "Lot" },
      { stage: "Fully dispatched", label: "Fully", tone: "aqua" },
      { stage: "Cancelled / Diverted", label: "Cancelled", tone: "rose" },
    ],
  },
];

/** A department's standing, in the order work moves: done, under way, not started, not needed. */
const STANDING = [
  { key: "done", label: "Done", color: "var(--viz-aqua)" },
  { key: "progress", label: "In progress", color: "var(--viz-blue)" },
  { key: "pending", label: "Not started", color: "var(--viz-yellow)" },
  { key: "hold", label: "Hold", color: "var(--viz-red)" },
  { key: "na", label: "Not needed", color: "var(--viz-gray)" },
] as const;

/** Each department on the open SOs: a bar of where they stand, and the counts. */
function DeptProgress({ depts, open }: { depts: DeptRow[]; open: number }) {
  const th = "px-2 py-2 text-right text-[11px] font-semibold uppercase tracking-wide text-muted";
  return (
    <div className="overflow-x-auto">
      <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
        {STANDING.map((s) => (
          <span key={s.key} className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ background: s.color }} />
            {s.label}
          </span>
        ))}
      </div>
      <table className="w-full min-w-[720px] text-sm">
        <thead>
          <tr className="border-b border-card-border">
            <th className={`${th} text-left`}>Department</th>
            <th className={`${th} w-[38%] text-left`}>Open SOs</th>
            {STANDING.map((s) => (
              <th key={s.key} className={th}>{s.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {depts.map((d) => (
            <tr key={d.key} className="border-b border-card-border/60 hover:bg-background/60">
              <td className="whitespace-nowrap px-2 py-2.5 font-medium text-foreground">
                {d.href ? (
                  <Link href={d.href} className="hover:text-primary hover:underline">
                    {d.label}
                  </Link>
                ) : (
                  d.label
                )}
              </td>
              <td className="px-2 py-2.5">
                <StackBar title={d.label} parts={STANDING.map((s) => ({ label: s.label, count: d[s.key], color: s.color }))} />
              </td>
              {STANDING.map((s) => (
                <td key={s.key} className={`px-2 py-2.5 text-right tabular-nums ${d[s.key] ? "text-foreground" : "text-muted-foreground"}`}>
                  {d[s.key] || "·"}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-[11px] text-muted">
        The {open} SOs not yet fully dispatched (cancelled and diverted left out), each department read as on its own page. Purchase and Quality have no work on an SO
        without BOI or Quality.
      </p>
    </div>
  );
}

export function PumpDashboardView({ data }: { data: PumpDashboard }) {
  const m = data.metrics;
  const stages: Datum[] = data.stages.map((s) => ({ ...s, color: STAGE_COLOR[s.label as PumpStage] }));
  const GAD_COLORS = ["var(--viz-yellow)", "var(--viz-orange)", "var(--viz-blue)", "var(--viz-violet)", "var(--viz-aqua)"];
  const gad: Datum[] = data.gad.map((g, i) => ({ ...g, color: GAD_COLORS[Math.min(i, GAD_COLORS.length - 1)] }));
  const boi: Datum[] = [
    { label: "Received", count: data.boi.received, color: "var(--viz-aqua)" },
    { label: "To come", count: data.boi.pending, color: "var(--viz-yellow)" },
  ];
  const qc: Datum[] = [
    { label: "Submitted", count: data.qc.submitted, color: "var(--viz-aqua)" },
    { label: "Pending", count: data.qc.pending, color: "var(--viz-yellow)" },
  ];

  return (
    <div className="viz space-y-5">
      <VizStyles />

      {/* Performance at a glance. */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        <Metric
          icon={<PackageOpen className="h-5 w-5" />}
          label="SOs"
          value={String(m.sos)}
          sub={`${m.ecs} pump ECs · ${m.pumps} pumps · ${m.open} not fully dispatched · ${m.closed} cancelled / diverted`}
        />
        <Metric
          icon={<Gauge className="h-5 w-5" />}
          label="On-time dispatch"
          value={m.onTimeRate === null ? "—" : `${Math.round(m.onTimeRate * 100)}%`}
          sub={`of ${m.onTimeMeasured} dispatched SOs, vs delivery date`}
          tone={m.onTimeRate === null ? "default" : m.onTimeRate >= 0.7 ? "good" : m.onTimeRate >= 0.4 ? "warn" : "bad"}
        />
        <Metric icon={<AlertTriangle className="h-5 w-5" />} label="Late vs delivery date" value={String(m.late)} sub="dispatched late, or past it and not out" tone={m.late ? "bad" : "good"} />
        <Metric icon={<CalendarClock className="h-5 w-5" />} label="Due in 7 days" value={String(m.dueThisWeek)} sub="delivery date this week" tone={m.dueThisWeek ? "warn" : "default"} />
        <Metric icon={<PauseCircle className="h-5 w-5" />} label="On hold" value={String(m.holds)} sub="Clearance, Accounts or Dispatch" tone={m.holds ? "warn" : "good"} />
        <Metric icon={<IndianRupee className="h-5 w-5" />} label="Order value" value={money(m.value)} sub="all SOs, cancelled included, in INR" />
      </div>

      {/* Every department on the open SOs. */}
      <ChartCard title="Department progress" sub="Where each department stands on the open pump SOs">
        <DeptProgress depts={data.depts} open={m.open} />
      </ChartCard>

      {/* Where the SOs stand, and how dispatch has gone. */}
      <div className="grid gap-5 lg:grid-cols-5">
        <ChartCard title="SO pipeline" sub="Every SO at its furthest stage" className="lg:col-span-3">
          <HBars data={stages} />
        </ChartCard>
        <ChartCard title="Dispatch status" sub="All SOs in view" className="lg:col-span-2">
          <Donut data={dispatchData(data.dispatchMix)} centerLabel="SOs" />
        </ChartCard>
      </div>

      {/* Before Planning: drawings, bought-out items and Quality's documents. */}
      <div className="grid gap-5 lg:grid-cols-3">
        <ChartCard title="Drawing" sub="Open SOs not closed by Drawing, by the GAD stage holding them back">
          {gad.length === 0 ? <p className="py-6 text-center text-sm text-muted">Every open SO&apos;s drawings are done.</p> : <HBars data={gad} />}
        </ChartCard>
        <ChartCard title="Purchase · BOI items" sub="Bought-out items on the open SOs with BOI">
          <Donut data={boi} centerLabel="items" />
        </ChartCard>
        <ChartCard title="Quality · documents" sub="Pump ECs on the open SOs needing Quality">
          <Donut data={qc} centerLabel="ECs" />
        </ChartCard>
      </div>

      <IntakeCard intake={data.intake} kind="Pump" />
      <RepCard reps={data.reps} groups={REP_GROUPS} colors={STAGE_COLOR} />
      <ZoneClientCards zones={data.zones} clients={data.clients} />
      <WatchHoldCards watch={data.watch} holds={data.holds} colors={STAGE_COLOR} />
    </div>
  );
}
