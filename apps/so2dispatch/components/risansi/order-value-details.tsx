"use client";

import { Fragment } from "react";
import { isUsd } from "@/lib/order-schema";

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
  gross_value_usd?: unknown;
};

/** What is still to invoice: the gross value less the invoices' (or challans') values. */
export function OrderInHand({
  row,
}: {
  row: { bill_type?: unknown; taxable_value?: unknown; invoiced_value?: unknown; order_currency?: unknown };
}) {
  // A Challan / FR SO is a replacement, at no value: nothing in hand to invoice.
  if (row.bill_type === "Challan") return <span className="text-xs text-muted-foreground">Replacement</span>;
  const gross = row.taxable_value == null ? "" : String(row.taxable_value).trim();
  if (!gross) return <span className="text-muted-foreground">—</span>;
  const invoiced = Number(row.invoiced_value ?? 0) || 0;
  const diff = Number(gross) - invoiced;
  // Invoices are rounded to the rupee: under one either way is all invoiced.
  const left = Math.abs(diff) < 1 ? 0 : diff;
  // A USD order's gross here is its INR figure, as its invoices are.
  const cur = isUsd(row.order_currency) ? " INR" : row.order_currency ? ` ${String(row.order_currency)}` : "";
  return (
    <span className="flex flex-col items-end whitespace-nowrap">
      <span className={`text-sm font-semibold tabular-nums ${left > 0 ? "text-foreground" : "text-emerald-700 dark:text-emerald-400"}`}>
        {numberFmt.format(left)}
        {cur}
      </span>
      <span className="text-[11px] text-muted">Invoiced {numberFmt.format(invoiced)}</span>
    </span>
  );
}

/**
 * How the SO's order value comes to its gross: the value, discount, packing &
 * forwarding, GST, and the gross; a USD order's gross in USD and in INR. Every
 * list with an order value shows it alike.
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
      {isUsd(row.order_currency) ? (
        <>
          <span className="mt-0.5 border-t border-card-border pt-0.5 font-semibold text-foreground">Gross value (USD)</span>
          <span className="mt-0.5 border-t border-card-border pt-0.5 text-right font-semibold tabular-nums text-foreground">
            {money(row.gross_value_usd) ? `${money(row.gross_value_usd)} USD` : "—"}
          </span>
          <span className="font-semibold text-foreground">Gross value (INR)</span>
          <span className="text-right font-semibold tabular-nums text-foreground">
            {money(row.taxable_value) ? `${money(row.taxable_value)} INR` : "—"}
          </span>
        </>
      ) : (
        <>
          <span className="mt-0.5 border-t border-card-border pt-0.5 font-semibold text-foreground">Gross value</span>
          <span className="mt-0.5 border-t border-card-border pt-0.5 text-right font-semibold tabular-nums text-foreground">
            {money(row.taxable_value) ? `${money(row.taxable_value)}${cur}` : "—"}
          </span>
        </>
      )}
    </div>
  );
}
