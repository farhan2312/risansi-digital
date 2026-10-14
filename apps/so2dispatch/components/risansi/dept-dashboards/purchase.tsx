"use client";

import { useState } from "react";
import { SingleSelectFilter } from "../multi-select-filter";
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
 * Purchase's board. Only orders carrying bought-out items are theirs at all,
 * and an order is finished only once every BOI line has a receipt date — so
 * the BOI flag is both the first filter and a column of its own.
 */
export function PurchaseDashboard(props: DeptDashboardProps) {
  const [boi, setBoi] = useState<string | null>(null);

  const d = useDeptDashboard("purchase", props, {
    filter: (r) =>
      !boi || (boi === "With BOI") === ((r.boi ?? "").trim().toLowerCase() === "yes"),
    active: !!boi,
    onClear: () => setBoi(null),
  });
  const c = baseColumns(d);

  return (
    <div>
      <DeptStatCards d={d} />

      <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Panel title="Bought-out item status" wide>
          <StatusBars d={d} />
        </Panel>
        <Panel title="Next deadlines">
          <DeadlineList d={d} />
        </Panel>
      </div>

      <FilterBar
        d={d}
        extra={
          <SingleSelectFilter
            label="BOI"
            allLabel="All orders"
            options={[
              { value: "With BOI", label: "With BOI" },
              { value: "No BOI", label: "No BOI" },
            ]}
            selected={boi}
            onChange={setBoi}
          />
        }
      />

      <WorkTable
        d={d}
        columns={[
          c.sl,
          c.so,
          c.ec,
          c.client,
          c.zone,
          textColumn("boi", "BOI", (r) => r.boi),
          c.status,
          c.target,
          c.signOff,
        ]}
      />
    </div>
  );
}
