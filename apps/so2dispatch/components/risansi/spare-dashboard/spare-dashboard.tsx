"use client";

import { AlertTriangle, CalendarClock, Gauge, IndianRupee, PackageOpen, PauseCircle } from "lucide-react";
import type { SpareDashboard, Stage } from "@/lib/spare-dashboard";
import { ChartCard, Donut, HBars, VizStyles, type Datum } from "./charts";
import { IntakeCard, Metric, RepCard, WatchHoldCards, ZoneClientCards, dispatchData, money, type RepGroup } from "./shared";

/** Each open stage's colour: the pipeline as one blue ramp, earliest lightest; a hold in orange. */
const STAGE_COLOR: Record<Stage, string> = {
  "No EC yet": "var(--viz-gray)",
  "Date awaited": "var(--viz-seq-1)",
  "In plan": "var(--viz-seq-2)",
  "Partial ready": "var(--viz-seq-3)",
  "Ready, not packed": "var(--viz-seq-4)",
  "Not at Dispatch yet": "var(--viz-seq-5)",
  "On hold": "var(--viz-red)",
  "Packed, to dispatch": "var(--viz-seq-6)",
  "Dispatch hold": "var(--viz-orange)",
  "Lot dispatched": "var(--viz-seq-6)",
  "Fully dispatched": "var(--viz-aqua)",
  "Cancelled / Diverted": "var(--viz-gray)",
};

/** The By Rep table's columns: Planning, then Assembly & Packing, then Dispatch. */
const REP_GROUPS: RepGroup<Stage>[] = [
  {
    title: "Planning",
    cols: [
      { stage: "Date awaited", label: "Date awaited" },
      { stage: "In plan", label: "In plan" },
      { stage: "Partial ready", label: "Partial ready" },
      { stage: "Ready, not packed", label: "Fully ready, not packed" },
    ],
  },
  { title: "Assembly & Packing", cols: [{ stage: "Packed, to dispatch", label: "Packed, to dispatch" }], noSlip: true },
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

export function SpareDashboardView({ data }: { data: SpareDashboard }) {
  const m = data.metrics;
  const stages: Datum[] = data.stages.map((s) => ({ ...s, color: STAGE_COLOR[s.label as Stage] }));

  return (
    <div className="viz space-y-5">
      <VizStyles />

      {/* Performance at a glance. */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        <Metric
          icon={<PackageOpen className="h-5 w-5" />}
          label="SOs"
          value={String(m.sos)}
          sub={`${m.open} not fully dispatched · ${m.closed} cancelled / diverted`}
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

      {/* Where the open SOs stand, and how dispatch has gone. */}
      <div className="grid gap-5 lg:grid-cols-5">
        <ChartCard title="SO pipeline" sub="Every SO at its furthest stage" className="lg:col-span-3">
          <HBars data={stages} />
        </ChartCard>
        <ChartCard title="Dispatch status" sub="All SOs in view" className="lg:col-span-2">
          <Donut data={dispatchData(data.dispatchMix)} centerLabel="SOs" />
        </ChartCard>
      </div>

      <IntakeCard intake={data.intake} kind="Spare" />
      <RepCard reps={data.reps} groups={REP_GROUPS} colors={STAGE_COLOR} />
      <ZoneClientCards zones={data.zones} clients={data.clients} />
      <WatchHoldCards watch={data.watch} holds={data.holds} colors={STAGE_COLOR} />
    </div>
  );
}
