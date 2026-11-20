import "server-only";
import { query } from "@/lib/db";
import { listApprovedUsersByRole } from "@/lib/users";
import { emitToUser } from "@/lib/notifications";

// Drawing's Assigned to: each SO goes to one Drawing member, who does its
// drawings. Drawing, Central Visibility and Admin assign it.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

import { DRAWING_UNASSIGNED, type DrawingAssignee, type DrawingMember } from "@/lib/drawing-assignee-keys";

export { DRAWING_ASSIGNEE_KEY, DRAWING_UNASSIGNED, type DrawingAssignee, type DrawingMember } from "@/lib/drawing-assignee-keys";

/** Who an SO can be assigned to: the approved Drawing members. */
export async function listDrawingMembers(): Promise<DrawingMember[]> {
  return (await listApprovedUsersByRole("drawing")).map((m) => ({ id: m.id, full_name: m.full_name }));
}

/** Who each SO is assigned to, and since when. */
export async function drawingAssignees(orderIds: string[]): Promise<Record<string, DrawingAssignee>> {
  if (!orderIds.length) return {};
  const r = await query<{ id: string; assignee: string; name: string | null; at: string | null }>(
    `SELECT o.id::text, o.drg_assignee_id::text AS assignee, u.full_name AS name,
            to_char(o.drg_assigned_at AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD') AS at
       FROM orders o LEFT JOIN users u ON u.id = o.drg_assignee_id
      WHERE o.id = ANY($1::uuid[]) AND o.drg_assignee_id IS NOT NULL`,
    [orderIds]
  );
  return Object.fromEntries(r.rows.map((x) => [x.id, { id: x.assignee, name: x.name ?? "Former member", at: x.at }]));
}

/** The filter from the URL: member ids, and "none" for Unassigned. */
export function parseDrawingAssigneeFilter(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((v) => v.trim())
    .filter((v) => v === DRAWING_UNASSIGNED || UUID_RE.test(v));
}

/** SQL over an orders alias for the filter; TRUE when none is picked. Values are checked above. */
export function drawingAssigneeSql(picked: string[], o = "o"): string {
  if (!picked.length) return "TRUE";
  const ids = picked.filter((v) => v !== DRAWING_UNASSIGNED);
  const parts: string[] = [];
  if (ids.length) parts.push(`${o}.drg_assignee_id IN (${ids.map((v) => `'${v}'::uuid`).join(", ")})`);
  if (picked.includes(DRAWING_UNASSIGNED)) parts.push(`${o}.drg_assignee_id IS NULL`);
  return `(${parts.join(" OR ")})`;
}

/**
 * Assign (or, with null, unassign) an SO to a Drawing member. Tells the new
 * assignee, and whoever had it.
 */
export async function assignDrawing(
  orderId: string,
  assigneeId: string | null,
  by: { id: string; name: string }
): Promise<{ ok: true; label: string; assigneeName: string | null } | { ok: false; error: string }> {
  if (!UUID_RE.test(orderId)) return { ok: false, error: "Order not found." };
  let assigneeName: string | null = null;
  if (assigneeId) {
    const member = (await listDrawingMembers()).find((m) => m.id === assigneeId);
    if (!member) return { ok: false, error: "Choose an active Drawing member." };
    assigneeName = member.full_name;
  }
  const r = await query<{ so_no: string | null; sl_no: number; client_name: string | null; changed: boolean; was: string | null }>(
    `UPDATE orders o
        SET drg_assignee_id = $2,
            drg_assigned_at = CASE WHEN $2::uuid IS NULL THEN NULL ELSE now() END,
            drg_assigned_by = CASE WHEN $2::uuid IS NULL THEN NULL ELSE $3::uuid END
       FROM (SELECT drg_assignee_id AS was FROM orders WHERE id = $1) prev
      WHERE o.id = $1
      RETURNING o.so_no, o.sl_no::int AS sl_no, o.client_name,
                prev.was IS DISTINCT FROM $2::uuid AS changed, prev.was::text AS was`,
    [orderId, assigneeId, by.id]
  );
  const row = r.rows[0];
  if (!row) return { ok: false, error: "Order not found." };
  const label = (row.so_no ?? "").trim() || `#${row.sl_no}`;
  if (row.changed && row.was && row.was !== assigneeId && row.was !== by.id) {
    await emitToUser({
      userId: row.was,
      orderId,
      type: "dept_update",
      message: assigneeName
        ? `Drawing of SO ${label} reassigned to ${assigneeName} by ${by.name}`
        : `Drawing of SO ${label} unassigned from you by ${by.name}`,
    });
  }
  if (assigneeId && row.changed && assigneeId !== by.id) {
    await emitToUser({
      userId: assigneeId,
      orderId,
      type: "dept_update",
      message: `Drawing of SO ${label}${row.client_name ? ` (${row.client_name})` : ""} assigned to you by ${by.name}`,
    });
  }
  return { ok: true, label, assigneeName };
}
