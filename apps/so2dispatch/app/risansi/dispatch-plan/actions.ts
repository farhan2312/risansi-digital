"use server";

import { revalidatePath } from "next/cache";
import { query } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";
import { isCentral } from "@/lib/roles";
import { logAudit } from "@/lib/audit";
import { subjectForOrder } from "@/lib/audit-subject";
import { getOrderLabel } from "@/lib/orders";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Central Visibility's Final Dispatch Target Date on an SO (blank clears it). */
export async function setFinalDispatchTargetAction(orderId: string, date: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "You are not signed in." };
  if (!isCentral(user.role)) return { ok: false, error: "Only Central Visibility sets the Final Dispatch Target." };
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
  await logAudit({
    actor: { id: user.id, email: user.email, role: user.role },
    action: "order.update",
    category: "activity",
    target: (await getOrderLabel(orderId)) ?? orderId,
    details: `Final Dispatch Target: ${prev ?? "—"} → ${day || "—"}`,
    subject: await subjectForOrder(orderId),
  });
  revalidatePath("/risansi/dispatch-plan");
  return { ok: true };
}
