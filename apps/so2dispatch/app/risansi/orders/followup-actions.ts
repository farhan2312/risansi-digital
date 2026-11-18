"use server";

import { revalidatePath } from "next/cache";
import { query } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";
import { logAudit } from "@/lib/audit";
import { subjectForOrder } from "@/lib/audit-subject";
import { getOrderLabel, getOrderRep } from "@/lib/orders";
import { canAddFollowup, canViewAll, isRep } from "@/lib/roles";
import { orderOpenSql, repMatches } from "@/lib/dept-view";

export type Followup = {
  id: string;
  followup_date: string;
  remarks: string;
  /** None: no further follow-up needed. */
  next_followup_date: string | null;
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
  input: { followup_date: string; remarks: string; next_needed: string; next_followup_date: string }
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
  // Another follow-up: Yes needs its date; No, none (the SO is not due again).
  const needed = String(input.next_needed ?? "").trim();
  if (needed !== "Yes" && needed !== "No") return { ok: false, error: "Say whether a next follow-up is needed." };
  if (needed === "Yes" && !ISO.test(next)) return { ok: false, error: "Enter the next follow-up date." };
  if (needed === "Yes" && next < date) return { ok: false, error: "The next follow-up cannot be before this one." };
  try {
    await query(
      `INSERT INTO order_followups (order_id, followup_date, remarks, next_followup_date, created_by, created_by_name)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [orderId, date, remarks, needed === "Yes" ? next : null, user.id, user.full_name || user.email]
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
    details: `Follow-up on ${date}: ${remarks} · ${needed === "Yes" ? `next ${next}` : "no further follow-up"}`,
    subject: await subjectForOrder(orderId),
  });
  revalidatePath("/risansi/orders");
  return { ok: true };
}

/** An SO whose next follow-up has come: its latest follow-up, and how late it is. */
export type FollowupDue = {
  id: string;
  so_no: string | null;
  so_date: string | null;
  client_name: string | null;
  order_type: string | null;
  spare_type: string | null;
  reps: string | null;
  followup_date: string;
  remarks: string;
  next_followup_date: string;
  by: string | null;
  count: number;
  /** Days since the next follow-up fell due (0: due today). */
  days_late: number;
};

/**
 * The SOs due a follow-up: an open SO whose latest follow-up's next date is
 * today or past (India time). A Rep: their own SOs (a Rep Manager's team too).
 */
async function followupsDue(user: { role: string; rep_names?: string[] }, countOnly: boolean) {
  if (!canViewAll(user.role)) return { rows: [] as FollowupDue[], count: 0 };
  const params: unknown[] = [];
  let rep = "";
  if (isRep(user.role)) {
    params.push((user.rep_names ?? []).map((n) => n.trim().toLowerCase()));
    rep = `AND LOWER(TRIM(COALESCE(o.reps, ''))) = ANY($1::text[])`;
  }
  const base = `
      FROM orders o
      JOIN LATERAL (SELECT fu.followup_date, fu.remarks, fu.next_followup_date, fu.created_by_name
                      FROM order_followups fu WHERE fu.order_id = o.id
                     ORDER BY fu.created_at DESC LIMIT 1) l ON true
     WHERE ${orderOpenSql("o")} ${rep}
       AND l.next_followup_date <= (now() AT TIME ZONE 'Asia/Kolkata')::date`;
  if (countOnly) {
    const r = await query<{ n: number }>(`SELECT count(*)::int AS n ${base}`, params);
    return { rows: [], count: r.rows[0]?.n ?? 0 };
  }
  const r = await query<FollowupDue>(
    `SELECT o.id, o.so_no, to_char(o.so_date, 'YYYY-MM-DD') AS so_date, o.client_name,
            o.order_type, o.spare_type, o.reps,
            to_char(l.followup_date, 'YYYY-MM-DD') AS followup_date, l.remarks,
            to_char(l.next_followup_date, 'YYYY-MM-DD') AS next_followup_date, l.created_by_name AS by,
            (SELECT count(*)::int FROM order_followups c WHERE c.order_id = o.id) AS count,
            ((now() AT TIME ZONE 'Asia/Kolkata')::date - l.next_followup_date)::int AS days_late
     ${base}
     ORDER BY l.next_followup_date, o.so_no`,
    params
  );
  return { rows: r.rows, count: r.rows.length };
}

/** How many SOs are due a follow-up, for the Orders page's button. */
export async function countFollowupsDue(): Promise<number> {
  const user = await getCurrentUser();
  if (!user) return 0;
  return (await followupsDue(user, true)).count;
}

/** The SOs due a follow-up, the longest waiting first. */
export async function listFollowupsDueAction(): Promise<FollowupDue[]> {
  const user = await getCurrentUser();
  if (!user) return [];
  return (await followupsDue(user, false)).rows;
}
