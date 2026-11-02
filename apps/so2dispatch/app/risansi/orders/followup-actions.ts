"use server";

import { revalidatePath } from "next/cache";
import { query } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";
import { logAudit } from "@/lib/audit";
import { subjectForOrder } from "@/lib/audit-subject";
import { getOrderLabel, getOrderRep } from "@/lib/orders";
import { canAddFollowup, canViewAll, isRep } from "@/lib/roles";
import { repMatches } from "@/lib/dept-view";

export type Followup = {
  id: string;
  followup_date: string;
  remarks: string;
  next_followup_date: string;
  by: string | null;
  at: string;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** A Rep: their own SOs only. */
async function maySee(user: { role: string; rep_names?: string[] }, orderId: string): Promise<boolean> {
  if (!canViewAll(user.role) || !UUID_RE.test(orderId)) return false;
  return !isRep(user.role) || repMatches(await getOrderRep(orderId), user.rep_names);
}

/** Every follow-up of the SO, the latest first. */
export async function listFollowupsAction(orderId: string): Promise<Followup[]> {
  const user = await getCurrentUser();
  if (!user || !(await maySee(user, orderId))) return [];
  const r = await query<Followup>(
    `SELECT id, to_char(followup_date, 'YYYY-MM-DD') AS followup_date, remarks,
            to_char(next_followup_date, 'YYYY-MM-DD') AS next_followup_date,
            created_by_name AS by, to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS at
       FROM order_followups WHERE order_id = $1
      ORDER BY created_at DESC`,
    [orderId]
  );
  return r.rows;
}

/** Add a follow-up. Each one stays as it was entered: a new one is added, none is changed. */
export async function addFollowupAction(
  orderId: string,
  input: { followup_date: string; remarks: string; next_followup_date: string }
): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "You are not signed in." };
  if (!canAddFollowup(user.role)) return { ok: false, error: "You can see the follow-ups but not add one." };
  if (!(await maySee(user, orderId))) return { ok: false, error: "Order not found." };
  const date = String(input.followup_date ?? "").trim();
  const next = String(input.next_followup_date ?? "").trim();
  const remarks = String(input.remarks ?? "").trim();
  if (!ISO.test(date)) return { ok: false, error: "Enter the follow-up date." };
  if (!remarks) return { ok: false, error: "Write the remarks." };
  if (!ISO.test(next)) return { ok: false, error: "Enter the next follow-up date." };
  if (next < date) return { ok: false, error: "The next follow-up cannot be before this one." };
  try {
    await query(
      `INSERT INTO order_followups (order_id, followup_date, remarks, next_followup_date, created_by, created_by_name)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [orderId, date, remarks, next, user.id, user.full_name || user.email]
    );
  } catch (error) {
    console.error("addFollowupAction failed:", error);
    return { ok: false, error: "Could not save the follow-up." };
  }
  await logAudit({
    actor: { id: user.id, email: user.email, role: user.role },
    action: "order.update",
    category: "activity",
    target: (await getOrderLabel(orderId)) ?? orderId,
    details: `Follow-up on ${date}: ${remarks} · next ${next}`,
    subject: await subjectForOrder(orderId),
  });
  revalidatePath("/risansi/orders");
  return { ok: true };
}
