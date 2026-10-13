"use client";

import { FileText } from "lucide-react";
import { billModeLabel } from "@/lib/order-schema";
import { MultiSelectFilter } from "../multi-select-filter";
import { useState } from "react";
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

const same = (v: string | null, s: string) => (v ?? "").trim().toLowerCase() === s;

/**
 * Billing & Operations' board. Work is per SO, not per EC, and there is no
 * target date in the schema for it — so this page counts documents instead of
 * days: how many SOs still have no PI or challan raised against them, and
 * which kind of document each order needs.
 */
export function BillingDashboard(props: DeptDashboardProps) {
  const [terms, setTerms] = useState<string[]>([]);

  const d = useDeptDashboard("billing", props, {
    filter: (r) =>
      terms.length === 0 ||
      (r.payment_terms ? terms.includes(r.payment_terms.trim()) : false),
    active: terms.length > 0,
    onClear: () => setTerms([]),
  });
  const c = baseColumns(d);

  const challan = d.mine.filter((r) => same(r.bill_type, "challan")).length;

  return (
    <div>
      <DeptStatCards
        d={d}
        extra={
          <StatCard
            icon={FileText}
            label="Challan orders"
            value={challan}
            hint="billed on challan, not a tax invoice"
            accent="bg-violet-50 text-violet-600"
          />
        }
      />

      <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Panel title="Document status" wide>
          <StatusBars d={d} />
        </Panel>
        <Panel title="Recently completed">
          <SignOffList d={d} />
        </Panel>
      </div>

      <FilterBar
        d={d}
        extra={
          d.filters.options.terms.length > 0 && (
            <MultiSelectFilter
              label="Term"
              options={d.filters.options.terms}
              selected={terms}
              onChange={setTerms}
            />
          )
        }
      />

      <WorkTable
        d={d}
        columns={[
          c.sl,
          c.so,
          c.client,
          c.zone,
          textColumn("bill", "Bill mode", (r) => billModeLabel(null, r.bill_type)),
          textColumn("terms", "Payment terms", (r) => r.payment_terms),
          c.status,
          c.signOff,
        ]}
      />
    </div>
  );
}
