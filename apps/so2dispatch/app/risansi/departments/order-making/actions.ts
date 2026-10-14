"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/session";
import { canAssignSo } from "@/lib/roles";
import { assignSo } from "@/lib/so-assignment";
import { logAudit } from "@/lib/audit";

export type AssignSoResult = { ok: true } | { ok: false; error: string };

/**
 * Assign an SO's Sales Order details to an Order Making SO member (or, with
 * null, take them back). Order Making PO, Central Visibility and Admin.
 */
export async function assignSoAction(orderId: string, assigneeId: string | null): Promise<AssignSoResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "You are not signed in." };
  if (!canAssignSo(user.role)) return { ok: false, error: "You don't have permission to assign SOs." };

  const res = await assignSo(orderId, assigneeId || null, { id: user.id, name: user.full_name });
  if (!res.ok) return res;
  await logAudit({
    actor: { id: user.id, email: user.email, role: user.role },
    action: "order.update",
    category: "activity",
    target: "SO details assignment",
    details: res.assigneeName
      ? `Assigned SO details of ${res.label} to ${res.assigneeName}`
      : `Unassigned SO details of ${res.label}`,
    subject: { orderId, soNo: res.label },
  });
  revalidatePath("/risansi/departments/order-making");
  return { ok: true };
}
