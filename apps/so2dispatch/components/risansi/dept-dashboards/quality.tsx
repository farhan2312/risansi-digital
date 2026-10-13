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
 * Quality's board. The order says whether QC documents are required at all;
 * where they are, the date they were actually submitted is the whole job, so
 * "required but not submitted" is what this page exists to surface.
 */
export function QualityDashboard(props: DeptDashboardProps) {
  const [required, setRequired] = useState<string | null>(null);

  const d = useDeptDashboard("quality", props, {
    filter: (r) =>
      !required ||
      (required === "Required") !==
        ((r.qc_required ?? "").trim().toLowerCase() === "no"),
    active: !!required,
    onClear: () => setRequired(null),
  });
  const c = baseColumns(d);

  return (
    <div>
      <DeptStatCards d={d} />

      <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Panel title="Document submission" wide>
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
            label="QC"
            allLabel="All ECs"
            options={[
              { value: "Required", label: "QC required" },
              { value: "Not required", label: "Not required" },
            ]}
            selected={required}
            onChange={setRequired}
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
          textColumn("req", "QC required", (r) => r.qc_required),
          c.status,
          c.target,
          c.signOff,
        ]}
      />
    </div>
  );
}
