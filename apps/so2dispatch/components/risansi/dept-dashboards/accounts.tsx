"use client";

import { useState } from "react";
import { IndianRupee } from "lucide-react";
import { MultiSelectFilter } from "../multi-select-filter";
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

const numberFmt = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });

/**
 * Accounts' board. Work is per SO and has no target date, so the number that
 * matters is money rather than days: what is still to come in, broken down by
 * payment status and payment terms. Challan orders carry no receivable and are
 * excluded from every count here.
 */
export function AccountsDashboard(props: DeptDashboardProps) {
  const [terms, setTerms] = useState<string[]>([]);

  const d = useDeptDashboard("accounts", props, {
    filter: (r) =>
      terms.length === 0 ||
      (r.payment_terms ? terms.includes(r.payment_terms.trim()) : false),
    active: terms.length > 0,
    onClear: () => setTerms([]),
  });
  const c = baseColumns(d);

  // order_value is printed once per SO — on its first EC — and Accounts sees
  // one row per SO, so summing the rows on screen cannot double-count.
  // In INR: a USD order counts at its conversion.
  const outstanding = d.stats.outstanding.reduce(
    (sum, r) => sum + (Number(r.order_value_inr) || 0),
    0
  );

  return (
    <div>
      <DeptStatCards
        d={d}
        extra={
          <StatCard
            icon={IndianRupee}
            label="Value outstanding"
            value={numberFmt.format(outstanding)}
            hint="orders with payment not yet received"
            accent="bg-teal-50 text-teal-600"
          />
        }
      />

      <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Panel title="Payment status" wide>
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
          textColumn("terms", "Payment terms", (r) => r.payment_terms),
          {
            key: "value",
            label: "Order value",
            className: "whitespace-nowrap tabular-nums text-muted",
            cell: (r) =>
              r.order_value ? numberFmt.format(Number(r.order_value)) : "—",
          },
          c.status,
          c.signOff,
        ]}
      />
    </div>
  );
}
