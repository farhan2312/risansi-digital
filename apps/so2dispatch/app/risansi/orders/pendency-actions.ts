"use server";

import { revalidatePath } from "next/cache";
import { query } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";
import { logAudit } from "@/lib/audit";
import { emitNotification } from "@/lib/notifications";
import { subjectForOrder } from "@/lib/audit-subject";
import { getOrderLabel } from "@/lib/orders";
import { canEditChild } from "@/lib/roles";
import { OTHERS, PENDENCY, type PendencyDept } from "@/lib/pendency";

export type PendencyResult = { ok: true } | { ok: false; error: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Who may say why: the department itself (by what it edits there), Central Visibility and Admin. */
const EDITS: Record<PendencyDept, Parameters<typeof canEditChild>[1]> = {
  billing: "order_billing_docs",
  drawing: "order_drawing_revisions",
  purchase: "order_boi_items",
};
const PAGE: Record<PendencyDept, string> = {
  billing: "/risansi/departments/billing",
  drawing: "/risansi/departments/drawing",
  purchase: "/risansi/departments/purchase",
};
const NAME: Record<PendencyDept, string> = { billing: "Proforma Invoice", drawing: "Drawing", purchase: "Purchase" };

/**
 * Why the SO is still pending with a department: one of its reasons, with
 * remarks. A blank reason clears it — the reason and remarks are kept, as
 * the latest pendency, until a new one is given.
 */
export async function savePendencyAction(
  orderId: string,
  dept: PendencyDept,
  reason: string,
  remarks: string
): Promise<PendencyResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "You are not signed in." };
  if (!(dept in PENDENCY)) return { ok: false, error: "Unknown department." };
  if (!canEditChild(user.role, EDITS[dept])) return { ok: false, error: `Only ${NAME[dept]} can set the pendency reason.` };
  if (!UUID_RE.test(orderId)) return { ok: false, error: "Order not found." };
  const why = (reason ?? "").trim();
  if (why && !PENDENCY[dept].reasons.includes(why)) return { ok: false, error: "Choose a reason from the list." };
  const note = (remarks ?? "").trim();
  // Others says nothing on its own: its remarks say what it is.
  if (why === OTHERS && !note) return { ok: false, error: "Others: write what it is in the remarks." };
  try {
    if (why) {
      await query(
        `INSERT INTO order_pendency (order_id, dept, reason, remarks, set_by)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (order_id, dept) DO UPDATE
           SET reason = EXCLUDED.reason, remarks = EXCLUDED.remarks, set_by = EXCLUDED.set_by, updated_at = now(),
               cleared_at = NULL, cleared_by = NULL`,
        [orderId, dept, why, note || null, user.full_name || user.email]
      );
    } else {
      await query(
        `UPDATE order_pendency SET cleared_at = now(), cleared_by = $3
          WHERE order_id = $1 AND dept = $2 AND cleared_at IS NULL`,
        [orderId, dept, user.full_name || user.email]
      );
    }
  } catch (error) {
    console.error("savePendencyAction failed:", error);
    return { ok: false, error: "Could not save the reason." };
  }
  const label = (await getOrderLabel(orderId)) ?? orderId;
  // Central Visibility hears why it is pending, and when the reason is cleared.
  if (user.role !== "central_visibility") {
    await emitNotification({
      roles: ["central_visibility"],
      orderId,
      type: "dept_update",
      message: why
        ? `${NAME[dept]} pendency — ${label}: ${why}${note ? ` · ${note}` : ""}`
        : `${NAME[dept]} pendency cleared — ${label}`,
    });
  }
  await logAudit({
    actor: { id: user.id, email: user.email, role: user.role },
    action: "order.update",
    category: "activity",
    target: label,
    details: why ? `${NAME[dept]} pendency — ${why}${note ? ` · ${note}` : ""}` : `${NAME[dept]} pendency cleared`,
    subject: await subjectForOrder(orderId),
  });
  revalidatePath(PAGE[dept]);
  return { ok: true };
}
