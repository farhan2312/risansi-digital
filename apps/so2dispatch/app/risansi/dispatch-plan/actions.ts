"use server";

import { revalidatePath } from "next/cache";
import { query } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";
import { canSeeDispatchPlan, isCentral } from "@/lib/roles";
import { logAudit } from "@/lib/audit";
import { subjectForOrder } from "@/lib/audit-subject";
import { getOrderLabel } from "@/lib/orders";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

export type DispatchDateChange = { id: string; prev_date: string | null; new_date: string | null; by: string | null; at: string };

/** Every change to the SO's To Be Dispatch Date, the latest first. */
export async function listDispatchDateHistoryAction(orderId: string): Promise<DispatchDateChange[]> {
  const user = await getCurrentUser();
  if (!user || !canSeeDispatchPlan(user.role) || !UUID_RE.test(orderId)) return [];
  const r = await query<DispatchDateChange>(
    `SELECT id, to_char(prev_date, 'YYYY-MM-DD') AS prev_date, to_char(new_date, 'YYYY-MM-DD') AS new_date,
            changed_by_name AS by, to_char(changed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS at
       FROM order_dispatch_date_history WHERE order_id = $1
      ORDER BY changed_at DESC`,
    [orderId]
  );
  return r.rows;
}

/** Central Visibility's To Be Dispatch Date on an SO (blank clears it). */
export async function setFinalDispatchTargetAction(orderId: string, date: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "You are not signed in." };
  if (!isCentral(user.role)) return { ok: false, error: "Only Central Visibility sets the To Be Dispatch Date." };
  if (!UUID_RE.test(orderId)) return { ok: false, error: "SO not found." };
  const day = (date ?? "").trim();
  if (day && !DAY_RE.test(day)) return { ok: false, error: "Enter a valid date." };
  const r = await query<{ prev: string | null }>(
    `WITH old AS (SELECT to_char(final_dispatch_target_date, 'YYYY-MM-DD') AS prev FROM orders WHERE id = $1)
     UPDATE orders SET final_dispatch_target_date = NULLIF($2, '')::date,
                       final_dispatch_target_by = $3, final_dispatch_target_at = now(), updated_at = now()
      WHERE id = $1
     RETURNING (SELECT prev FROM old)`,
    [orderId, day, user.full_name || user.email]
  );
  if (r.rows.length === 0) return { ok: false, error: "SO not found." };
  const prev = r.rows[0].prev;
  // Its history: each change, from what to what, by whom.
  if ((prev ?? "") !== day) {
    await query(
      `INSERT INTO order_dispatch_date_history (order_id, prev_date, new_date, changed_by, changed_by_name, changed_at)
       VALUES ($1, $2::date, NULLIF($3, '')::date, $4, $5, clock_timestamp())`,
      [orderId, prev, day, user.id, user.full_name || user.email]
    );
  }
  await logAudit({
    actor: { id: user.id, email: user.email, role: user.role },
    action: "order.update",
    category: "activity",
    target: (await getOrderLabel(orderId)) ?? orderId,
    details: `To Be Dispatch Date: ${prev ?? "—"} → ${day || "—"}`,
    subject: await subjectForOrder(orderId),
  });
  revalidatePath("/risansi/dispatch-plan");
  return { ok: true };
}
