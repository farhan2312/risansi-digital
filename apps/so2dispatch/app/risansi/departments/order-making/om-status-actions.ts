"use server";

import { query } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";
import { canAccessOrderMaking, isCentral } from "@/lib/roles";

export type OmStatusEntry = {
  id: string;
  status: string;
  reason: string | null;
  remarks: string | null;
  changed_by_name: string | null;
  created_at: string;
};

const canSee = (role: string) => canAccessOrderMaking(role) || isCentral(role);

/**
 * Keep the SO's Order Making Clear / Hold, as it now stands, in its history —
 * read from the SO itself (just saved), so nothing here can be made up. A
 * save that changed nothing adds nothing.
 */
export async function recordOmStatusAction(orderId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "You are not signed in." };
  if (!canSee(user.role)) return { ok: false, error: "No access." };
  await query(
    `INSERT INTO order_om_status_history (order_id, status, reason, remarks, changed_by, changed_by_role)
     SELECT o.id, COALESCE(o.om_status, 'Clear'),
            CASE WHEN o.om_status = 'Hold' THEN NULLIF(btrim(o.om_hold_reason), '') END,
            NULLIF(btrim(o.om_hold_remarks), ''), $2, $3
       FROM orders o
      WHERE o.id = $1
        AND NOT EXISTS (
          SELECT 1 FROM (
            SELECT h.status, h.reason, h.remarks FROM order_om_status_history h
             WHERE h.order_id = o.id ORDER BY h.created_at DESC LIMIT 1
          ) last
           WHERE last.status = COALESCE(o.om_status, 'Clear')
             AND last.reason IS NOT DISTINCT FROM (CASE WHEN o.om_status = 'Hold' THEN NULLIF(btrim(o.om_hold_reason), '') END)
             AND last.remarks IS NOT DISTINCT FROM NULLIF(btrim(o.om_hold_remarks), ''))`,
    [orderId, user.id, user.role]
  );
  return { ok: true };
}

/** Every Clear / Hold the SO has had, oldest first, with its reason and remarks. */
export async function omStatusHistoryAction(
  orderId: string
): Promise<{ ok: true; rows: OmStatusEntry[] } | { ok: false; error: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "You are not signed in." };
  if (!canSee(user.role)) return { ok: false, error: "No access." };
  const r = await query<OmStatusEntry>(
    `SELECT h.id, h.status, h.reason, h.remarks, u.full_name AS changed_by_name, h.created_at::text AS created_at
       FROM order_om_status_history h
       LEFT JOIN users u ON u.id = h.changed_by
      WHERE h.order_id = $1
      ORDER BY h.created_at`,
    [orderId]
  );
  return { ok: true, rows: r.rows };
}
