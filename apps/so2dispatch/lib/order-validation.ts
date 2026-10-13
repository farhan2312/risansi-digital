// Value rules on order fields, shared by the forms (for their input bounds)
// and the server actions (which enforce them — a form is only a convenience,
// the action is a public endpoint). Plain module: safe to import anywhere.

import { BOI_ITEM_OPTIONS, type OrderField } from "@/lib/order-schema";
import type { NewBoiItem } from "@/lib/orders";

const amountFmt = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 });

/** A submitted value as a number: null when blank, NaN when not a number. */
export function numericValue(raw: unknown): number | null {
  if (raw === null || raw === undefined) return null;
  const text = String(raw).replace(/,/g, "").trim();
  if (text === "") return null;
  return Number(text);
}

/**
 * Each field's own lower bound (\`min\`), over the fields a save actually
 * carries. Returns the first problem, worded for the person who made it.
 */
export function checkFieldBounds(
  fields: OrderField[],
  values: Record<string, unknown>
): string | null {
  for (const f of fields) {
    if (f.min === undefined || !(f.column in values)) continue;
    const n = numericValue(values[f.column]);
    if (n === null) continue;
    if (Number.isNaN(n)) return `${f.label} must be a number.`;
    if (n < f.min) {
      return f.min === 0
        ? `${f.label} cannot be negative.`
        : `${f.label} must be at least ${f.min}.`;
    }
  }
  return null;
}

/**
 * The bought-out items filed on an EC form, trimmed and checked: a row is only
 * a row once an item is picked, "Others" has to say what it is, and the item
 * must be one the schema offers. Blank rows are dropped, so leaving a spare
 * row empty is not an error.
 */
export function cleanBoiRows(
  raw: unknown
): { ok: true; rows: NewBoiItem[] } | { ok: false; error: string } {
  if (raw == null) return { ok: true, rows: [] };
  if (!Array.isArray(raw)) return { ok: false, error: "Bought-out items are malformed." };
  const known = new Set(BOI_ITEM_OPTIONS.map((o) => o.value));
  const rows: NewBoiItem[] = [];
  for (const entry of raw) {
    if (entry == null || typeof entry !== "object") continue;
    const get = (k: string) => String((entry as Record<string, unknown>)[k] ?? "").trim();
    const item = get("boi_item");
    const other = get("boi_item_other");
    const make = get("boi_make");
    const description = get("boi_description");
    if (!item && !other && !make && !description) continue;
    if (!item) return { ok: false, error: "Pick an item for each bought-out row." };
    if (!known.has(item)) return { ok: false, error: `"${item}" is not a bought-out item.` };
    if (item === "Others" && !other) {
      return { ok: false, error: "Name the item for a bought-out row set to Others." };
    }
    rows.push({
      boi_item: item,
      boi_item_other: item === "Others" ? other : "",
      boi_make: make,
      boi_description: description,
    });
  }
  return { ok: true, rows };
}

/** The GST rate when Accounts has not set one. */
export const DEFAULT_GST_RATE = 18;

/**
 * An SO's value with GST: the value in INR (a foreign-currency order's
 * conversion) times 1 + the GST rate. Null while there is no value.
 */
export function orderValueWithGst(
  order: { order_value?: unknown; order_currency?: unknown; order_value_inr?: unknown },
  gstRate: unknown
): number | null {
  const inr = String(order.order_currency ?? "INR").trim().toUpperCase() || "INR";
  const raw = inr !== "INR" && order.order_value_inr != null && order.order_value_inr !== ""
    ? order.order_value_inr
    : order.order_value;
  if (raw === null || raw === undefined || String(raw).trim() === "") return null;
  const value = Number(raw);
  if (!Number.isFinite(value)) return null;
  const rate =
    gstRate === null || gstRate === undefined || String(gstRate).trim() === ""
      ? DEFAULT_GST_RATE
      : Number(gstRate);
  return Math.round(value * (1 + (Number.isFinite(rate) ? rate : DEFAULT_GST_RATE) / 100) * 100) / 100;
}

/**
 * The amount received on an SO against its order value. Nothing to compare
 * while either is blank — Accounts may record a receipt before the value is in.
 */
export function checkReceivedWithinValue(
  received: number | null,
  orderValue: number | null,
  side: "received" | "order value"
): string | null {
  if (received === null || orderValue === null) return null;
  if (Number.isNaN(received) || Number.isNaN(orderValue)) return null;
  if (received <= orderValue) return null;
  return side === "received"
    ? `Amount received (${amountFmt.format(received)}) cannot be more than the order value with GST (${amountFmt.format(orderValue)}).`
    : `Order value with GST (${amountFmt.format(orderValue)}) cannot be less than the amount already received (${amountFmt.format(received)}).`;
}
