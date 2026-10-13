"use client";

import { formatDate } from "./dates";
import {
  DeadlineList,
  DeptStatCards,
  FilterBar,
  Panel,
  StatusBars,
  WorkTable,
  baseColumns,
  textColumn,
} from "./parts";
import {
  useDeptDashboard,
  type DeptDashboardProps,
} from "./use-dept-dashboard";

/**
 * Assembly & Packing's board. Their own deadline is the packing team's target
 * date, but what happens after them — the SO's dispatch status — is the reason
 * the date matters, so both are on the row. The order's dispatch date sits
 * beside the packing date because packing has to land before it.
 */
export function AssemblyDashboard(props: DeptDashboardProps) {
  const d = useDeptDashboard("assembly", props);
  const c = baseColumns(d);

  return (
    <div>
      <DeptStatCards d={d} />

      <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Panel title="Packing status" wide>
          <StatusBars d={d} />
        </Panel>
        <Panel title="Next deadlines">
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
          { ...c.target, label: "Packing target" },
          {
            key: "dispatchDate",
            label: "Dispatch by",
            className: "whitespace-nowrap text-muted",
            cell: (r) =>
              formatDate(r.dispatch_target_revised_date ?? r.dispatch_target_date),
          },
          // Where the SO went after packing — dispatched, part-dispatched, or
          // still waiting.
          textColumn("dispatch", "Dispatch", (r) => r.dispatch_status),
          c.signOff,
        ]}
        minWidth={1060}
      />
    </div>
  );
}
