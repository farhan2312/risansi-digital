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
  STAGE_WORDS,
  ecAssembly,
  ecStageStatus,
  plansError,
  plansFromRows,
  soStageStatus,
  type AssemblyPlan,
  type Stage,
} from "@/lib/assembly";

export type AssemblyResult = { ok: true } | { ok: false; error: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Assembly & Packing's plan for a pump SO in one stage, saved whole: entries
 * no longer listed go, the rest are updated or added. Assembly takes no more
 * than Planning has ready, and never less than is already packed; packing
 * takes no more than is assembled.
 */
export async function saveAssemblyPlansAction(
  orderId: string,
  sent: AssemblyPlan[],
  stageArg: string = "assembly"
): Promise<AssemblyResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "You are not signed in." };
  if (!canEditSection(user.role, "order_assembly_dispatch")) {
    return { ok: false, error: "Only Assembly & Packing can plan assembly and packing." };
  }
  if (!UUID_RE.test(orderId)) return { ok: false, error: "SO not found." };
  const stage: Stage = stageArg === "packing" ? "packing" : "assembly";
  const plans = plansFromRows(
    (Array.isArray(sent) ? sent : []).map((p) => ({ ...p, stage })),
    stage
  );

  const [ecRes, allRes] = await Promise.all([
    query<{ id: string; ec_no: string | null; quantity: number | null; ready_qty: number | null }>(
      `SELECT it.id, it.ec_no, it.quantity, pl.ready_qty
         FROM order_items it LEFT JOIN order_planning pl ON pl.item_id = it.id
        WHERE it.order_id = $1 AND it.item_type = ANY($2)`,
      [orderId, PUMP_LIKE]
    ),
    query<Record<string, unknown>>(`SELECT * FROM order_assembly_plans WHERE order_id = $1`, [orderId]),
  ]);
  const assembledNow = plansFromRows(allRes.rows, "assembly");
  const packedNow = plansFromRows(allRes.rows, "packing");
  const ecs = ecRes.rows.map((r) => {
    const quantity = Number(r.quantity ?? 0) || 0;
    const cap =
      stage === "assembly"
        ? Math.min(quantity || Infinity, Number(r.ready_qty ?? 0) || 0)
        : ecAssembly(assembledNow, r.id).assembled;
    return { id: r.id, label: r.ec_no ?? "EC", quantity, cap };
  });
  const problem = plansError(plans, ecs, stage);
  if (problem) return { ok: false, error: problem };
  if (stage === "assembly") {
    for (const ec of ecs) {
      const packed = ecAssembly(packedNow, ec.id).planned;
      if (ecAssembly(plans, ec.id).assembled < packed) {
        return { ok: false, error: `${ec.label}: ${packed} already planned for packing, more than would be assembled.` };
      }
    }
  }

  try {
    const before = allRes.rows.filter((r) => (r.stage ?? "assembly") === stage) as { id: string }[];
    const statusOf = (rows: AssemblyPlan[]) =>
      soStageStatus(
        ecs.map((e) => ecStageStatus(ecAssembly(rows, e.id).assembled, e.quantity, stage)),
        stage
      );
    const was = statusOf(stage === "assembly" ? assembledNow : packedNow);

    const keep = new Set(plans.map((p) => p.id).filter((id): id is string => !!id && UUID_RE.test(id)));
    const drop = before.filter((r) => !keep.has(r.id)).map((r) => r.id);
    if (drop.length > 0) {
      await query(`DELETE FROM order_assembly_plans WHERE order_id = $1 AND stage = $2 AND id = ANY($3)`, [
        orderId,
        stage,
        drop,
      ]);
    }
    const known = new Set(before.map((r) => r.id));
    for (const p of plans) {
      const values = [
        p.item_id,
        p.plan_date || null,
        p.shift || null,
        p.qty,
        p.assembled ? "Yes" : null,
        p.assembled ? p.assembled_date : null,
        p.remarks.trim().slice(0, 1000) || null,
        stage === "packing" ? p.pdi || null : null,
      ];
      if (p.id && known.has(p.id)) {
        await query(
          `UPDATE order_assembly_plans
              SET item_id = $3, plan_date = $4::date, shift = $5, qty = $6,
                  assembled = $7, assembled_date = $8::date, remarks = $9, pdi = $10
            WHERE id = $1 AND order_id = $2`,
          [p.id, orderId, ...values]
        );
      } else {
        await query(
          `INSERT INTO order_assembly_plans
             (order_id, item_id, plan_date, shift, qty, assembled, assembled_date, remarks, pdi, stage)
           VALUES ($1, $2, $3::date, $4, $5, $6, $7::date, $8, $9, $10)`,
          [orderId, ...values, stage]
        );
      }
    }
    // A pump EC fully packed takes its Actual Material Packing Date from its
    // last packed entry — what Dispatch and the packed rules read.
    if (stage === "packing") {
      for (const ec of ecs) {
        const done = plans.filter((p) => p.item_id === ec.id && p.assembled);
        const packed = done.reduce((n, p) => n + p.qty, 0);
        const date =
          ec.quantity > 0 && packed >= ec.quantity
            ? done.map((p) => p.assembled_date).sort().pop() ?? null
            : null;
        await query(
          `INSERT INTO order_assembly_dispatch (item_id, actual_packing_date) VALUES ($1, $2::date)
           ON CONFLICT (item_id) DO UPDATE SET actual_packing_date = EXCLUDED.actual_packing_date`,
          [ec.id, date]
        );
      }
    }
    const now = statusOf(plans);
    const words = STAGE_WORDS[stage];
    await logAudit({
      actor: { id: user.id, email: user.email, role: user.role },
      action: "order.update",
      category: "activity",
      target: `${words.title} plan`,
      details: `${words.title} plan: ${plans.length} entr${plans.length === 1 ? "y" : "ies"} · ${now}`,
      subject: await subjectForOrder(orderId),
    });
    // Planning and Central hear when it moves on; Dispatch too once packing does.
    if (now !== was && now !== words.so[0]) {
      const so = (await getOrderLabel(orderId)) ?? orderId;
      await emitNotification({
        roles: stage === "packing" ? ["dispatch", "planning", "central_visibility"] : ["planning", "central_visibility"],
        orderId,
        type: "dept_update",
        message: `${so}: ${now}`,
      });
    }
    revalidatePath("/risansi/departments/assembly-dispatch");
    return { ok: true };
  } catch (error) {
    console.error("saveAssemblyPlans failed:", error);
    return { ok: false, error: `Could not save the ${STAGE_WORDS[stage].title.toLowerCase()} plan.` };
  }
}
