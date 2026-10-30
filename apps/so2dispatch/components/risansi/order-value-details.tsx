"use client";

import { Fragment } from "react";

const numberFmt = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 });
const money = (v: unknown) => {
  const s = v == null ? "" : String(v).trim();
  if (!s) return "";
  const n = Number(s);
  return Number.isFinite(n) ? numberFmt.format(n) : s;
};

/** What a row carries of its order value. */
export type OrderValueRow = {
  order_value?: unknown;
  order_currency?: unknown;
  discount_percent?: unknown;
  packing_forwarding_percent?: unknown;
  gst_percent?: unknown;
  taxable_value?: unknown;
};

/**
 * How the SO's order value comes to its gross: the value, discount, packing &
 * forwarding, GST, and the gross. Dispatch and Accounts show it alike.
 */
export function OrderValueDetails({ row }: { row: OrderValueRow }) {
  const cur = row.order_currency ? ` ${String(row.order_currency)}` : "";
  const pct = (v: unknown) => (v != null && String(v).trim() !== "" ? `${numberFmt.format(Number(v))}%` : "—");
  const lines: [string, string][] = [
    ["Order value", money(row.order_value) ? `${money(row.order_value)}${cur}` : "—"],
    ["Discount", pct(row.discount_percent)],
    ["Packing", pct(row.packing_forwarding_percent)],
    ["GST", pct(row.gst_percent)],
  ];
  return (
    <div className="grid grid-cols-[auto_auto] gap-x-3 text-xs whitespace-nowrap">
      {lines.map(([k, v]) => (
        <Fragment key={k}>
          <span className="text-muted">{k}</span>
          <span className="text-right tabular-nums text-foreground">{v}</span>
        </Fragment>
      ))}
      <span className="mt-0.5 border-t border-card-border pt-0.5 font-semibold text-foreground">Gross value</span>
      <span className="mt-0.5 border-t border-card-border pt-0.5 text-right font-semibold tabular-nums text-foreground">
        {money(row.taxable_value) ? `${money(row.taxable_value)}${cur}` : "—"}
      </span>
    </div>
  );
}
