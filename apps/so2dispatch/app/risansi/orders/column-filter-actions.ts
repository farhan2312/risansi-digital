"use server";

import { getCurrentUser } from "@/lib/session";
import { orderListColumnFacets, pumpCardSql, type OrderColumnKey } from "@/lib/orders";
import { ordersKind, parseOrderListFilter, scopeToRep, withOrdersKind } from "@/lib/order-list-filter";

/**
 * What one column of the Orders list holds, for its header's filter: each
 * value with how many SOs of the list — as the page has it filtered — carry
 * it. `query` is the page's own query string.
 */
export async function orderColumnFacetsAction(
  column: OrderColumnKey,
  query: string
): Promise<{ value: string; count: number }[]> {
  const user = await getCurrentUser();
  if (!user) return [];
  const sp = new URLSearchParams(query);
  const get = (k: string) => sp.get(k) ?? undefined;
  const filter = scopeToRep(withOrdersKind(parseOrderListFilter(get, { noDispatchTarget: true }), sp.get("type")), user);
  // The Pump card picked narrows the list, as on the page.
  const extra = ordersKind(sp.get("type")) === "pump" ? pumpCardSql(sp.get("pk") ?? undefined) : null;
  try {
    return await orderListColumnFacets(filter, column, extra);
  } catch (error) {
    console.error("orderColumnFacetsAction failed:", error);
    return [];
  }
}
