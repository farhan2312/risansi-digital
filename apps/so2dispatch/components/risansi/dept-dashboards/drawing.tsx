"use client";

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
 * Drawing's board. Work is per EC and its status comes off the revision list —
 * issued to Operations, then to the client, then approved — so the drawing
 * that has gone out but not come back approved is what this page has to make
 * obvious.
 */
export function DrawingDashboard(props: DeptDashboardProps) {
  const d = useDeptDashboard("drawing", props);
  const c = baseColumns(d);

  return (
    <div>
      <DeptStatCards d={d} />

      <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Panel title="Drawing status" wide>
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
          c.client,
          c.zone,
          // What is being drawn matters as much as whose it is.
          textColumn("item", "Item type", (r) => r.item_type),
          c.status,
          c.target,
          c.signOff,
        ]}
      />
    </div>
  );
}
