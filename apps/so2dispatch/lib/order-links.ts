import { PUMP_LIKE } from "@/lib/order-schema";

/**
 * An SO on the Orders list: its Pump or Spare list, searched to its SO No.,
 * the row picked out (focus). Where a notification or an escalation opens
 * for those who can read the Orders list, instead of the SO's summary page.
 */
export function ordersFocusHref(o: { id: string; so_no?: string | null; order_type?: string | null }): string {
  const p = new URLSearchParams();
  if (PUMP_LIKE.includes(String(o.order_type ?? ""))) p.set("type", "pump");
  const so = String(o.so_no ?? "").trim();
  if (so) p.set("q", so);
  p.set("focus", o.id);
  return `/risansi/orders?${p}`;
}
