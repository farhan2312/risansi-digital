"use client";

import {
  DeadlineList,
  DeptStatCards,
  FilterBar,
  Panel,
  StatusBars,
  WorkTable,
  baseColumns,
} from "./parts";
import {
  useDeptDashboard,
  type DeptDashboardProps,
} from "./use-dept-dashboard";

/**
 * Planning's board. Planning works to its own readiness date: an EC is late
 * once that date passes and it is not yet ready (a Spare Fully ready, a Pump
 * Assembled or Packed) — the same rule as its reminders and Overdue filter.
 */
export function PlanningDashboard(props: DeptDashboardProps) {
  const d = useDeptDashboard("planning", props);
  const c = baseColumns(d);

  return (
    <div>
      <DeptStatCards d={d} />

      <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Panel title="Planning status" wide>
          <StatusBars d={d} />
        </Panel>
        <Panel title="Next readiness dates">
          <DeadlineList d={d} />
        </Panel>
      </div>

      <FilterBar d={d} />

      <WorkTable
        d={d}
        columns={[
          c.sl,
          c.so,
          c.ec,
          c.zone,
          c.status,
          { ...c.target, label: "Readiness date" },
          c.signOff,
        ]}
        minWidth={1000}
      />
    </div>
  );
}
