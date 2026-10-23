"use server";

import { revalidatePath } from "next/cache";
import { query } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";
import { logAudit } from "@/lib/audit";
import { subjectForOrder } from "@/lib/audit-subject";
import { emitNotification } from "@/lib/notifications";
import { getOrderLabel, saveLotPacking, syncPumpPackedDate } from "@/lib/orders";
import { canEditSection } from "@/lib/roles";
import { PUMP_LIKE } from "@/lib/order-schema";
import { STAGE_WORDS, lotStagesError, pumpLotsFromEcs, soStatuses, type LotStages } from "@/lib/assembly";

export type AssemblyResult = { ok: true } | { ok: false; error: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type EcLots = { id: string; ec_no: string | null; quantity: number | null; ready_lots: Record<string, unknown>[] };

async function soEcLots(orderId: string): Promise<EcLots[]> {
  const r = await query<EcLots>(
    `SELECT it.id, it.ec_no, it.quantity,
            COALESCE((SELECT jsonb_agg(to_jsonb(rl) ORDER BY rl.seq) FROM order_ready_lots rl WHERE rl.item_id = it.id),
                     '[]'::jsonb) AS ready_lots
       FROM order_items it
      WHERE it.order_id = $1 AND it.item_type = ANY($2)
      ORDER BY it.seq`,
    [orderId, PUMP_LIKE]
  );
  return r.rows;
}

const statusesOf = (ecs: EcLots[]) =>
  soStatuses(
    ecs.map((e) => ({ id: e.id, quantity: Number(e.quantity ?? 0) || 0 })),
    pumpLotsFromEcs(ecs as unknown as Record<string, unknown>[])
  );

/**
 * Assembly & Packing on a pump SO's lots: each lot's assembly day, shift and
 * the day it was assembled, then its packing day, shift, PDI and the day it
 * was packed — written to every EC's row of that lot. A lot is packed only
 * once it is assembled.
 */
export async function saveLotStagesAction(orderId: string, lots: LotStages[]): Promise<AssemblyResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "You are not signed in." };
  if (!canEditSection(user.role, "order_assembly_dispatch")) {
    return { ok: false, error: "Only Assembly & Packing can record assembly and packing." };
  }
  if (!UUID_RE.test(orderId)) return { ok: false, error: "SO not found." };
  const clean: LotStages[] = (Array.isArray(lots) ? lots : []).map((l) => ({
    n: Math.floor(Number(l.n)) || 0,
    assembly_plan_date: String(l.assembly_plan_date ?? "").trim(),
    assembly_shift: String(l.assembly_shift ?? "").trim(),
    assembled_date: String(l.assembled_date ?? "").trim(),
    packing_plan_date: String(l.packing_plan_date ?? "").trim(),
    packing_shift: String(l.packing_shift ?? "").trim(),
    pdi: String(l.pdi ?? "").trim(),
    packed_date: String(l.packed_date ?? "").trim(),
  }));
  const problem = lotStagesError(clean);
  if (problem) return { ok: false, error: problem };

  try {
    const ecs = await soEcLots(orderId);
    const was = statusesOf(ecs);
    const actor = { id: user.id, role: user.role };
    for (const ec of ecs) {
      const packing: { id: string; packed_date: string; packing_plan_date: string; packing_shift: string; pdi: string }[] = [];
      for (const l of clean) {
        const row = ec.ready_lots[l.n - 1];
        if (!row || !UUID_RE.test(String(row.id))) continue;
        const wasDate = String(row.assembly_plan_date ?? "").slice(0, 10);
        const wasShift = String(row.assembly_shift ?? "");
        if (wasDate !== l.assembly_plan_date || wasShift !== l.assembly_shift) {
          await query(
            `INSERT INTO order_packing_plan_history
               (item_id, lot_id, lot_no, plan_date, prev_plan_date, shift, prev_shift, changed_by, changed_by_role, stage)
             VALUES ($1, $2, $3, NULLIF($4, '')::date, NULLIF($5, '')::date, NULLIF($6, ''), NULLIF($7, ''), $8, $9, 'assembly')`,
            [ec.id, row.id, l.n, l.assembly_plan_date, wasDate, l.assembly_shift, wasShift, user.id, user.role]
          );
        }
        await query(
          `UPDATE order_ready_lots
              SET assembly_plan_date = NULLIF($2, '')::date,
                  assembly_shift = NULLIF($3, ''),
                  assembled_date = NULLIF($4, '')::date
            WHERE id = $1`,
          [row.id, l.assembly_plan_date, l.assembly_shift, l.assembled_date]
        );
        packing.push({
          id: String(row.id),
          packed_date: l.packed_date,
          packing_plan_date: l.packing_plan_date,
          packing_shift: l.packing_shift,
          pdi: l.pdi,
        });
      }
      // The packing columns go through the Spare's own path, so a moved
      // packing date joins the packing plan history as it does there.
      if (packing.length) await saveLotPacking(ec.id, packing, actor);
      // A pump EC is packed once all of it is, not when its lot is Fully ready.
      await syncPumpPackedDate(ec.id);
    }
    const now = statusesOf(await soEcLots(orderId));
    await logAudit({
      actor: { id: user.id, email: user.email, role: user.role },
      action: "order.update",
      category: "activity",
      target: "Assembly & packing",
      details: `Lots: ${now.assembly} · ${now.packing}`,
      subject: await subjectForOrder(orderId),
    });
    // Planning and Central hear when assembly or packing moves on; Dispatch too for packing.
    const so = (await getOrderLabel(orderId)) ?? orderId;
    if (now.assembly !== was.assembly && now.assembly !== STAGE_WORDS.assembly.so[0]) {
      await emitNotification({ roles: ["planning", "central_visibility"], orderId, type: "dept_update", message: `${so}: ${now.assembly}` });
    }
    if (now.packing !== was.packing && now.packing !== STAGE_WORDS.packing.so[0]) {
      await emitNotification({
        roles: ["dispatch", "planning", "central_visibility"],
        orderId,
        type: "dept_update",
        message: `${so}: ${now.packing}`,
      });
    }
    revalidatePath("/risansi/departments/assembly-dispatch");
    return { ok: true };
  } catch (error) {
    console.error("saveLotStages failed:", error);
    return { ok: false, error: "Could not save the lots." };
  }
}

/** An SO's Alignment as Assembly & Packing sets it: base plate and wooden box, each with its status. */
export type Alignment = {
  base_plate: string;
  base_plate_status: string;
  wooden_box: string;
  wooden_box_status: string;
};

/**
 * Assembly & Packing's Alignment on a pump SO. A status only means something
 * once its item is Yes, so a No (or blank) clears it. Assembly & Packing,
 * Central Visibility and Admin.
 */
export async function saveAlignmentAction(orderId: string, a: Alignment): Promise<AssemblyResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "You are not signed in." };
  if (!canEditSection(user.role, "order_assembly_dispatch")) {
    return { ok: false, error: "Only Assembly & Packing can set the alignment." };
  }
  const yn = (v: string) => (v === "Yes" || v === "No" ? v : null);
  const plate = yn(a.base_plate);
  const box = yn(a.wooden_box);
  const plateStatus = plate === "Yes" && ["Manufactured", "Pending"].includes(a.base_plate_status) ? a.base_plate_status : null;
  const boxStatus = box === "Yes" && ["In House", "Bought out"].includes(a.wooden_box_status) ? a.wooden_box_status : null;
  if (plate === "Yes" && !plateStatus) return { ok: false, error: "Choose whether the base plate is manufactured or pending." };
  if (box === "Yes" && !boxStatus) return { ok: false, error: "Choose whether the wooden box is in house or bought out." };
  try {
    await query(
      `UPDATE orders SET base_plate = $2, base_plate_status = $3, wooden_box = $4, wooden_box_status = $5, updated_at = now()
        WHERE id = $1`,
      [orderId, plate, plateStatus, box, boxStatus]
    );
  } catch (error) {
    console.error("saveAlignmentAction failed:", error);
    return { ok: false, error: "Could not save the alignment." };
  }
  const label = (await getOrderLabel(orderId)) ?? orderId;
  const part = (name: string, v: string | null, st: string | null) => `${name}: ${v ?? "—"}${st ? ` (${st})` : ""}`;
  await logAudit({
    actor: { id: user.id, email: user.email, role: user.role },
    action: "order.update",
    category: "activity",
    target: label,
    details: `Alignment — ${part("Base plate", plate, plateStatus)}; ${part("Wooden box", box, boxStatus)}`,
    subject: await subjectForOrder(orderId),
  });
  revalidatePath("/risansi/departments/assembly-dispatch");
  return { ok: true };
}
