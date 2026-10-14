"use client";

import { PackageCheck } from "lucide-react";
import { billModeLabel } from "@/lib/order-schema";
import {
  DeptStatCards,
  FilterBar,
  Panel,
  SignOffList,
  StatCard,
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
 * Dispatch's board. Work is per SO and comes last: an order reaches this
 * department once Assembly & Packing has packed it, and leaves when it is
 * fully dispatched. The figure that matters here is how much is packed and
 * waiting — work sitting on the floor with nothing stopping it going out.
 */
export function DispatchDashboard(props: DeptDashboardProps) {
  const d = useDeptDashboard("dispatch", props);
  const c = baseColumns(d);

  // Ready but not gone: the SO is packed (a packing slip filed, or an EC
  // packed) and not yet fully dispatched. Dispatch works the SO, not its ECs.
  const readyNotGone = d.mine.filter((r) => r.so_packed && !d.view.done(r)).length;

  return (
    <div>
      <DeptStatCards
        d={d}
        extra={
          <StatCard
            icon={PackageCheck}
            label="Packed, not dispatched"
            value={readyNotGone}
            hint="ready to go out"
            accent="bg-emerald-50 text-emerald-600"
          />
        }
      />

      <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Panel title="Dispatch status" wide>
          <StatusBars d={d} />
        </Panel>
        <Panel title="Recently completed">
          <SignOffList d={d} />
        </Panel>
      </div>

      <FilterBar d={d} />

      <WorkTable
        d={d}
        columns={[
          c.sl,
          c.so,
          c.client,
          c.zone,
          textColumn("bill", "Bill mode", (r) => billModeLabel(null, r.bill_type)),
          textColumn("packed", "Packed", (r) => (r.so_packed ? "Yes" : "—")),
          c.target,
          c.status,
          c.signOff,
        ]}
      />
    </div>
  );
}
