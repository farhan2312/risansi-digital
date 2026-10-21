import "server-only";
import { query } from "@/lib/db";
import { SO_DETAILS_FILLED_SQL } from "@/lib/order-gaps";
import { orderOpenSql } from "@/lib/dept-view";
import { listApprovedUsersByRole } from "@/lib/users";
import { emitNotification, emitToUser } from "@/lib/notifications";
import { isCentral } from "@/lib/roles";

// Order Making's split: Order Making PO opens an SO and assigns its Sales
// Order details to one Order Making SO member, who fills them. Central
// Visibility hears once they are all in.

export { SO_DETAILS_FILLED_SQL };

/**
 * An SO still to be assigned: open (not cancelled or diverted) and nothing
 * dispatched yet — a lot or fully dispatched SO needs no one to fill it now.
 */
export function assignableSql(o = "o"): string {
  return `${orderOpenSql(o)} AND lower(COALESCE(NULLIF(${o}.dispatch_status, ''), 'Pending')) NOT IN ('fully dispatch', 'lot dispatch')`;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type SoMember = { id: string; full_name: string; email: string; team: "SO" | "PO" };

/**
 * Who an SO's Sales Order details can be assigned to: the Order Making SO
 * members, and the Order Making PO members too (a PO member can take an SO
 * on themselves).
 */
export async function listSoMembers(): Promise<SoMember[]> {
  const [so, po] = await Promise.all([listApprovedUsersByRole("order_making_so"), listApprovedUsersByRole("order_making")]);
  return [...so.map((m) => ({ ...m, team: "SO" as const })), ...po.map((m) => ({ ...m, team: "PO" as const }))];
}

/** Who an SO's Sales Order details are assigned to, if anyone. */
export async function getSoAssignee(orderId: string): Promise<string | null> {
  if (!UUID_RE.test(orderId)) return null;
  const r = await query<{ so_assignee_id: string | null }>(
    `SELECT so_assignee_id FROM orders WHERE id = $1`,
    [orderId]
  );
  return r.rows[0]?.so_assignee_id ?? null;
}

/** Whether this Order Making SO member is the one an SO is assigned to. */
export async function isAssignedTo(orderId: string, userId: string): Promise<boolean> {
  return (await getSoAssignee(orderId)) === userId;
}

/**
 * Assign (or, with null, unassign) an SO's Sales Order details. The assignee
 * must be an approved Order Making SO member. Tells the new assignee.
 */
export async function assignSo(
  orderId: string,
  assigneeId: string | null,
  by: { id: string; name: string }
): Promise<{ ok: true; label: string; assigneeName: string | null } | { ok: false; error: string }> {
  if (!UUID_RE.test(orderId)) return { ok: false, error: "Order not found." };
  if (assigneeId) {
    const ok = await query(`SELECT 1 FROM orders o WHERE o.id = $1 AND ${assignableSql("o")}`, [orderId]);
    if (ok.rows.length === 0) return { ok: false, error: "This SO is dispatched, cancelled or diverted: nothing to assign." };
  }
  let assigneeName: string | null = null;
  if (assigneeId) {
    const member = (await listSoMembers()).find((m) => m.id === assigneeId);
    if (!member) return { ok: false, error: "Choose an active Order Making member." };
    assigneeName = member.full_name;
  }
  const r = await query<{ so_no: string | null; sl_no: number; client_name: string | null; changed: boolean }>(
    `UPDATE orders o
        SET so_assignee_id = $2,
            so_assigned_at = CASE WHEN $2::uuid IS NULL THEN NULL ELSE now() END,
            so_assigned_by = CASE WHEN $2::uuid IS NULL THEN NULL ELSE $3::uuid END
       FROM (SELECT so_assignee_id AS was FROM orders WHERE id = $1) prev
      WHERE o.id = $1
      RETURNING o.so_no, o.sl_no::int AS sl_no, o.client_name,
                prev.was IS DISTINCT FROM $2::uuid AS changed`,
    [orderId, assigneeId, by.id]
  );
  const row = r.rows[0];
  if (!row) return { ok: false, error: "Order not found." };
  const label = (row.so_no ?? "").trim() || `#${row.sl_no}`;
  if (assigneeId && row.changed) {
    await emitToUser({
      userId: assigneeId,
      orderId,
      type: "dept_update",
      message: `SO ${label}${row.client_name ? ` (${row.client_name})` : ""} assigned to you by ${by.name} — fill its SO details`,
    });
  }
  return { ok: true, label, assigneeName };
}

/**
 * After a save: stamp when the SO's Sales Order details were first all in
 * (or clear the stamp if one was blanked again). The first time they are all
 * in, Central Visibility is told — unless it was Central itself — and so is
 * whoever assigned them, when the assignee filled them.
 */
export async function markSoDetails(orderId: string, actor: { id: string; role: string; name: string }): Promise<void> {
  try {
    const r = await query<{ so_no: string | null; sl_no: number; client_name: string | null; so_assigned_by: string | null; so_assignee_id: string | null }>(
      `UPDATE orders o SET so_details_filled_at = now()
        WHERE o.id = $1 AND o.so_details_filled_at IS NULL AND ${SO_DETAILS_FILLED_SQL}
        RETURNING o.so_no, o.sl_no::int AS sl_no, o.client_name, o.so_assigned_by, o.so_assignee_id`,
      [orderId]
    );
    await query(
      `UPDATE orders o SET so_details_filled_at = NULL
        WHERE o.id = $1 AND o.so_details_filled_at IS NOT NULL AND NOT ${SO_DETAILS_FILLED_SQL}`,
      [orderId]
    );
    const row = r.rows[0];
    if (!row) return;
    const label = (row.so_no ?? "").trim() || `#${row.sl_no}`;
    const client = row.client_name ? ` for ${row.client_name}` : "";
    await Promise.all([
      isCentral(actor.role)
        ? null
        : emitNotification({
            roles: ["central_visibility"],
            orderId,
            type: "dept_update",
            message: `SO ${label}${client}: SO details filled by Order Making — fill its terms, target dates and ECs`,
          }),
      row.so_assigned_by && row.so_assignee_id === actor.id && row.so_assigned_by !== actor.id
        ? emitToUser({
            userId: row.so_assigned_by,
            orderId,
            type: "dept_update",
            message: `SO ${label}${client}: SO details filled by ${actor.name}`,
          })
        : null,
    ]);
  } catch (error) {
    console.error("markSoDetails failed:", error instanceof Error ? error.message : String(error));
  }
}

export type SoMemberSummary = {
  members: { id: string; full_name: string; team: "SO" | "PO"; assigned: number; pending: number; filled: number }[];
  unassigned: { total: number; pending: number };
};

/** The assignment cards and PDF: today's (the default), or all time. */
export type AssignPeriod = "daily" | "all";
export function parseAssignPeriod(v: string | undefined): AssignPeriod {
  return v === "all" ? "all" : "daily";
}

/**
 * Per Order Making SO member: open SOs assigned, still pending, filled. And
 * what nobody has yet. Daily: SOs assigned today, and the unassigned ones
 * made today; all time: every open SO.
 */
export async function soMemberSummary(period: AssignPeriod = "daily"): Promise<SoMemberSummary> {
  const today = `(now() AT TIME ZONE 'Asia/Kolkata')::date`;
  const assignedToday = period === "daily" ? `AND (o.so_assigned_at AT TIME ZONE 'Asia/Kolkata')::date = ${today}` : "";
  const madeToday = period === "daily" ? `AND (o.created_at AT TIME ZONE 'Asia/Kolkata')::date = ${today}` : "";
  const [members, counts, unassigned] = await Promise.all([
    listSoMembers(),
    query<{ id: string; assigned: number; filled: number }>(
      `SELECT o.so_assignee_id AS id, count(*)::int AS assigned,
              count(*) FILTER (WHERE ${SO_DETAILS_FILLED_SQL})::int AS filled
         FROM orders o
        WHERE o.so_assignee_id IS NOT NULL AND ${orderOpenSql("o")} ${assignedToday}
        GROUP BY 1`
    ),
    query<{ total: number; pending: number }>(
      `SELECT count(*)::int AS total, count(*) FILTER (WHERE NOT ${SO_DETAILS_FILLED_SQL})::int AS pending
         FROM orders o WHERE o.so_assignee_id IS NULL AND ${assignableSql("o")} ${madeToday}`
    ),
  ]);
  const by = new Map(counts.rows.map((c) => [c.id, c]));
  return {
    members: members.map((m) => {
      const c = by.get(m.id);
      const assigned = c?.assigned ?? 0;
      const filled = c?.filled ?? 0;
      return { id: m.id, full_name: m.full_name, team: m.team, assigned, filled, pending: assigned - filled };
    }),
    unassigned: unassigned.rows[0] ?? { total: 0, pending: 0 },
  };
}
