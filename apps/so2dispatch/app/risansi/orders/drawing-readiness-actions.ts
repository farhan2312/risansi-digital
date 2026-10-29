"use server";

import { revalidatePath } from "next/cache";
import { query } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";
import { logAudit } from "@/lib/audit";
import { canEditChild, canViewDepartment } from "@/lib/roles";
import { spareEcSql } from "@/lib/dept-view";
import { addOrderChildAction, updateOrderChildAction } from "./actions";

export type ReadinessEntry = {
  id: string;
  readiness_date: string | null;
  reason: string | null;
  changed_by_name: string | null;
  created_at: string;
};

const DAY = /^\d{4}-\d{2}-\d{2}$/;

function formatDay(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
}

/**
 * Drawing's readiness date for an SO — when its drawings will be ready. Each
 * value it is set to joins the SO's readiness history, with why it moved.
 * Drawing (and Central Visibility / Admin) only; an empty date clears it.
 */
export async function setDrawingReadinessAction(
  orderId: string,
  date: string,
  reason: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "You are not signed in." };
  if (!canEditChild(user.role, "order_drawing_revisions")) {
    return { ok: false, error: "You don't have permission to set Drawing's readiness date." };
  }
  const day = date.trim();
  if (day && !DAY.test(day)) return { ok: false, error: "Choose a date." };
  const why = reason.trim() || null;

  const cur = await query<{ so_no: string | null; sl_no: number; drg_readiness_date: string | null }>(
    `SELECT so_no, sl_no, to_char(drg_readiness_date, 'YYYY-MM-DD') AS drg_readiness_date FROM orders WHERE id = $1`,
    [orderId]
  );
  const order = cur.rows[0];
  if (!order) return { ok: false, error: "SO not found." };
  const before = order.drg_readiness_date ?? "";
  if (before === day) return { ok: true };
  // A date that moves needs its reason; the first one does not.
  if (before && !why) return { ok: false, error: "Say why the readiness date is changing." };

  try {
    await query(`UPDATE orders SET drg_readiness_date = $2, updated_at = now() WHERE id = $1`, [orderId, day || null]);
    await query(
      `INSERT INTO order_drawing_readiness_history (order_id, readiness_date, reason, changed_by, changed_by_role)
       VALUES ($1, $2, $3, $4, $5)`,
      [orderId, day || null, why, user.id, user.role]
    );
  } catch (error) {
    console.error("setDrawingReadinessAction failed:", error);
    return { ok: false, error: "Could not save the readiness date." };
  }

  const label = order.so_no ?? `#${order.sl_no}`;
  const what = day
    ? before
      ? `Drawing readiness for ${label} moved from ${formatDay(before)} to ${formatDay(day)}`
      : `Drawing readiness for ${label} set to ${formatDay(day)}`
    : `Drawing readiness for ${label} cleared`;
  await Promise.all([
    logAudit({
      actor: { id: user.id, email: user.email, role: user.role },
      action: "order.update",
      category: "activity",
      target: label,
      details: `${what}${why ? ` — reason: ${why}` : ""}`,
      subject: { orderId, soNo: label },
    }),
  ]);
  revalidatePath("/risansi/departments/drawing");
  return { ok: true };
}

/** Every value the SO's Drawing readiness date has held, oldest first. */
export async function drawingReadinessHistoryAction(
  orderId: string
): Promise<{ ok: true; rows: ReadinessEntry[] } | { ok: false; error: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "You are not signed in." };
  if (!canViewDepartment(user.role, "order_drawing")) return { ok: false, error: "No access." };
  const r = await query<ReadinessEntry>(
    `SELECT h.id, to_char(h.readiness_date, 'YYYY-MM-DD') AS readiness_date, h.reason,
            u.full_name AS changed_by_name, h.created_at::text AS created_at
       FROM order_drawing_readiness_history h
       LEFT JOIN users u ON u.id = h.changed_by
      WHERE h.order_id = $1
      ORDER BY h.created_at`,
    [orderId]
  );
  return { ok: true, rows: r.rows };
}

/**
 * One GAD / Performance Curve version, the same on every pump EC of the SO:
 * the version with this number on each other EC takes these values — and an
 * EC one version short gets that version started first. An EC further behind
 * (or ahead) is left as it is and reported.
 */
export async function applyDrawingVersionToSoAction(
  itemId: string,
  doc: string,
  number: number,
  values: Record<string, string>
): Promise<{ ok: true; applied: number; skipped: string[] } | { ok: false; error: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "You are not signed in." };
  if (!canEditChild(user.role, "order_drawing_revisions")) {
    return { ok: false, error: "You don't have permission to edit drawings." };
  }
  if (doc !== "GAD" && doc !== "Performance Curve") return { ok: false, error: "Unknown document." };
  if (!Number.isInteger(number) || number < 1) return { ok: false, error: "Unknown version." };

  const siblings = await query<{ id: string; ec_no: string | null }>(
    `SELECT s.id, s.ec_no
       FROM order_items s
       JOIN orders o ON o.id = s.order_id
      WHERE s.order_id = (SELECT order_id FROM order_items WHERE id = $1)
        AND s.id <> $1
        AND NOT (${spareEcSql("s", "o")})
      ORDER BY s.seq NULLS LAST, s.ec_no`,
    [itemId]
  );
  let applied = 0;
  const skipped: string[] = [];
  for (const ec of siblings.rows) {
    const name = ec.ec_no || "an EC";
    const versions = await query<{ id: string }>(
      `SELECT id FROM order_drawing_revisions WHERE item_id = $1 AND doc_type = $2 ORDER BY seq`,
      [ec.id, doc]
    );
    let target = versions.rows[number - 1]?.id ?? null;
    if (!target && versions.rows.length === number - 1) {
      const added = await addOrderChildAction(ec.id, "order_drawing_revisions", doc);
      if (!added.ok || !added.id) {
        skipped.push(`${name} (${added.ok ? "could not start the version" : added.error})`);
        continue;
      }
      target = added.id;
    }
    if (!target) {
      skipped.push(`${name} (has ${versions.rows.length} version${versions.rows.length === 1 ? "" : "s"})`);
      continue;
    }
    const res = await updateOrderChildAction(target, "order_drawing_revisions", values, ec.id);
    if (res.ok) applied++;
    else skipped.push(`${name} (${res.error})`);
  }
  revalidatePath("/risansi/departments/drawing");
  return { ok: true, applied, skipped };
}
