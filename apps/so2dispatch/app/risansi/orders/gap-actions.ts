"use server";

import { getCurrentUser } from "@/lib/session";
import { isCentral } from "@/lib/roles";
import { GAP_BATCH, listOrderGaps, type OrderGapRow } from "@/lib/order-gaps";

export type OrderGapsResult =
  | { ok: true; rows: OrderGapRow[]; total: number }
  | { ok: false; error: string };

/**
 * One batch of SOs whose order details are still incomplete. The whole-order
 * view is Central Visibility's, and so is this: a department has no business
 * reading another's order book, so the role is checked here rather than
 * trusted to whoever rendered the button.
 */
export async function orderGapsAction(
  offset: number,
  search: string,
  type: string | null = null
): Promise<OrderGapsResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "You are not signed in." };
  if (!isCentral(user.role)) {
    return { ok: false, error: "You don't have access to the order list." };
  }

  try {
    const { rows, total } = await listOrderGaps({
      offset: Math.max(0, Math.floor(offset)),
      limit: GAP_BATCH,
      search: (search ?? "").slice(0, 120),
      type: type === "Pump" || type === "Spare" ? type : null,
    });
    return { ok: true, rows, total };
  } catch (error) {
    console.error("orderGapsAction failed:", error);
    return { ok: false, error: "Could not load the missing details." };
  }
}
