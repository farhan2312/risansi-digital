"use server";

import { revalidatePath } from "next/cache";
import { query } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";
import { logAudit } from "@/lib/audit";
import { subjectForOrder } from "@/lib/audit-subject";
import { emitNotification } from "@/lib/notifications";
import { getOrderLabel } from "@/lib/orders";
import { canEditSection } from "@/lib/roles";
import { PUMP_LIKE } from "@/lib/order-schema";
import {
  ecAssembly,
  ecAssemblyStatus,
  plansError,
  plansFromRows,
  soAssemblyStatus,
  type AssemblyPlan,
} from "@/lib/assembly";

export type AssemblyResult = { ok: true } | { ok: false; error: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Assembly & Packing's plan for a pump SO, saved whole: entries no longer
 * listed go, the rest are updated or added. Nothing is planned beyond what
 * Planning has ready on an EC.
 */
export async function saveAssemblyPlansAction(orderId: string, sent: AssemblyPlan[]): Promise<AssemblyResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "You are not signed in." };
  if (!canEditSection(user.role, "order_assembly_dispatch")) {
    return { ok: false, error: "Only Assembly & Packing can plan assembly." };
  }
  if (!UUID_RE.test(orderId)) return { ok: false, error: "SO not found." };
  const plans = plansFromRows(sent);

  const ecRes = await query<{ id: string; ec_no: string | null; quantity: number | null; ready_qty: number | null }>(
    `SELECT it.id, it.ec_no, it.quantity, pl.ready_qty
       FROM order_items it LEFT JOIN order_planning pl ON pl.item_id = it.id
      WHERE it.order_id = $1 AND it.item_type = ANY($2)`,
    [orderId, PUMP_LIKE]
  );
  const ecs = ecRes.rows.map((r) => ({
    id: r.id,
    label: r.ec_no ?? "EC",
    quantity: Number(r.quantity ?? 0) || 0,
    ready: Number(r.ready_qty ?? 0) || 0,
  }));
  const problem = plansError(plans, ecs);
  if (problem) return { ok: false, error: problem };

  try {
    const before = await query<{ id: string; item_id: string; qty: number; assembled: string | null }>(
      `SELECT id, item_id, qty, assembled FROM order_assembly_plans WHERE order_id = $1`,
      [orderId]
    );
    const statusOf = (rows: AssemblyPlan[]) =>
      soAssemblyStatus(ecs.map((e) => ecAssemblyStatus(ecAssembly(rows, e.id).assembled, e.quantity)));
    const was = statusOf(plansFromRows(before.rows));

    const keep = new Set(plans.map((p) => p.id).filter((id): id is string => !!id && UUID_RE.test(id)));
    const drop = before.rows.filter((r) => !keep.has(r.id)).map((r) => r.id);
    if (drop.length > 0) {
      await query(`DELETE FROM order_assembly_plans WHERE order_id = $1 AND id = ANY($2)`, [orderId, drop]);
    }
    const known = new Set(before.rows.map((r) => r.id));
    for (const p of plans) {
      const values = [
        p.item_id,
        p.plan_date || null,
        p.shift || null,
        p.qty,
        p.assembled ? "Yes" : null,
        p.assembled ? p.assembled_date : null,
        p.remarks.trim().slice(0, 1000) || null,
      ];
      if (p.id && known.has(p.id)) {
        await query(
          `UPDATE order_assembly_plans
              SET item_id = $3, plan_date = $4::date, shift = $5, qty = $6,
                  assembled = $7, assembled_date = $8::date, remarks = $9
            WHERE id = $1 AND order_id = $2`,
          [p.id, orderId, ...values]
        );
      } else {
        await query(
          `INSERT INTO order_assembly_plans (order_id, item_id, plan_date, shift, qty, assembled, assembled_date, remarks)
           VALUES ($1, $2, $3::date, $4, $5, $6, $7::date, $8)`,
          [orderId, ...values]
        );
      }
    }
    const now = statusOf(plans);
    await logAudit({
      actor: { id: user.id, email: user.email, role: user.role },
      action: "order.update",
      category: "activity",
      target: "Assembly plan",
      details: `Assembly plan: ${plans.length} entr${plans.length === 1 ? "y" : "ies"} · ${now}`,
      subject: await subjectForOrder(orderId),
    });
    // Planning and Central hear when the SO's assembly moves on.
    if (now !== was && now !== "Assembly pending") {
      const so = (await getOrderLabel(orderId)) ?? orderId;
      await emitNotification({
        roles: ["planning", "central_visibility"],
        orderId,
        type: "dept_update",
        message: `${so}: ${now}`,
      });
    }
    revalidatePath("/risansi/departments/assembly-dispatch");
    return { ok: true };
  } catch (error) {
    console.error("saveAssemblyPlans failed:", error);
    return { ok: false, error: "Could not save the assembly plan." };
  }
}
