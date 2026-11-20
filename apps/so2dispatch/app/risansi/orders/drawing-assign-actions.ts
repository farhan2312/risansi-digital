"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/session";
import { canEditChild } from "@/lib/roles";
import { assignDrawing } from "@/lib/drawing-assignment";
import { logAudit } from "@/lib/audit";

/**
 * Assign an SO to a Drawing member (or, with null, take it off them).
 * Drawing, Central Visibility and Admin — whoever edits Drawing's work.
 */
export async function assignDrawingAction(
  orderId: string,
  assigneeId: string | null
): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "You are not signed in." };
  if (!canEditChild(user.role, "order_drawing_revisions")) {
    return { ok: false, error: "You don't have permission to assign Drawing's SOs." };
  }
  const res = await assignDrawing(orderId, assigneeId || null, { id: user.id, name: user.full_name });
  if (!res.ok) return res;
  await logAudit({
    actor: { id: user.id, email: user.email, role: user.role },
    action: "order.update",
    category: "activity",
    target: "Drawing assignment",
    details: res.assigneeName ? `Assigned Drawing of ${res.label} to ${res.assigneeName}` : `Unassigned Drawing of ${res.label}`,
    subject: { orderId, soNo: res.label },
  });
  revalidatePath("/risansi/departments/drawing");
  return { ok: true };
}
