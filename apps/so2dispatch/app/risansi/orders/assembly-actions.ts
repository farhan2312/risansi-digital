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
import {
  STAGE_WORDS,
  lotAssembly,
  lotStagesError,
  pumpLotsFromEcs,
  soStatuses,
  type AsmEntry,
  type LotStages,
} from "@/lib/assembly";

export type AssemblyResult = { ok: true } | { ok: false; error: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type EcLots = { id: string; ec_no: string | null; quantity: number | null; ready_lots: Record<string, unknown>[] };

async function soEcLots(orderId: string): Promise<EcLots[]> {
  const r = await query<EcLots>(
    `SELECT it.id, it.ec_no, it.quantity,
            COALESCE((SELECT jsonb_agg(to_jsonb(rl) || jsonb_build_object('asm', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', la.id, 'qty', la.qty,
                         'plan_date', la.plan_date, 'shift', la.shift, 'assembled_date', la.assembled_date) ORDER BY la.seq)
                       FROM order_lot_assembly la WHERE la.lot_row_id = rl.id), '[]'::jsonb)) ORDER BY rl.seq)
                        FROM order_ready_lots rl WHERE rl.item_id = it.id),
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
 * Assembly & Packing on a pump SO's lots. Assembly, EC by EC: the entries
 * picking an EC of a lot and how many of it, on a day and shift, ticked
 * Assembled with the day — added, changed or removed as sent. Packing, lot
 * by lot once all of the lot is assembled: its day, shift, PDI and the day it
 * was packed, written to every EC's row of the lot.
 */
export async function saveLotStagesAction(orderId: string, lots: LotStages[], entries: AsmEntry[]): Promise<AssemblyResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "You are not signed in." };
  if (!canEditSection(user.role, "order_assembly_dispatch")) {
    return { ok: false, error: "Only Assembly & Packing can record assembly and packing." };
  }
  if (!UUID_RE.test(orderId)) return { ok: false, error: "SO not found." };
  const t = (v: unknown) => String(v ?? "").trim();
  const clean: LotStages[] = (Array.isArray(lots) ? lots : []).map((l) => ({
    n: Math.floor(Number(l.n)) || 0,
    packing_plan_date: t(l.packing_plan_date),
    packing_shift: t(l.packing_shift),
    pdi: t(l.pdi),
    packed_date: t(l.packed_date),
  }));
  const sent: AsmEntry[] = (Array.isArray(entries) ? entries : []).map((e) => ({
    id: UUID_RE.test(t(e.id)) ? t(e.id) : "",
    lot_row_id: t(e.lot_row_id),
    item_id: t(e.item_id),
    qty: Number(e.qty),
    plan_date: t(e.plan_date),
    shift: t(e.shift),
    assembled_date: t(e.assembled_date),
  }));

  try {
    const ecs = await soEcLots(orderId);
    const before = pumpLotsFromEcs(ecs as unknown as Record<string, unknown>[]);
    const problem = lotStagesError(before, clean, sent);
    if (problem) return { ok: false, error: problem };
    const was = statusesOf(ecs);
    const actor = { id: user.id, role: user.role };
    const lotOf = (rowId: string) => before.find((l) => l.ecs.some((x) => x.row_id === rowId));
    const existing = new Map(before.flatMap((l) => l.entries).map((e) => [e.id, e]));
    if (sent.some((e) => e.id && !existing.has(e.id))) return { ok: false, error: "An assembly entry was changed elsewhere — reopen the lots." };

    // A plan's day or shift moved: kept in the plan history, as a lot's packing is.
    const history = (e: AsmEntry, prev: AsmEntry | null) =>
      query(
        `INSERT INTO order_packing_plan_history
           (item_id, lot_id, lot_no, plan_date, prev_plan_date, shift, prev_shift, changed_by, changed_by_role, stage)
         VALUES ($1, $2, $3, NULLIF($4, '')::date, NULLIF($5, '')::date, NULLIF($6, ''), NULLIF($7, ''), $8, $9, 'assembly')`,
        [e.item_id, e.lot_row_id, lotOf(e.lot_row_id)?.n ?? 0, e.plan_date, prev?.plan_date ?? "", e.shift, prev?.shift ?? "", user.id, user.role]
      );
    for (const e of sent) {
      const prev = e.id ? existing.get(e.id)! : null;
      if (prev) {
        await query(
          `UPDATE order_lot_assembly
              SET qty = $2, plan_date = NULLIF($3, '')::date, shift = NULLIF($4, ''),
                  assembled_date = NULLIF($5, '')::date, updated_at = now()
            WHERE id = $1`,
          [e.id, e.qty, e.plan_date, e.shift, e.assembled_date]
        );
        if (prev.plan_date !== e.plan_date || prev.shift !== e.shift) await history(e, prev);
      } else {
        await query(
          `INSERT INTO order_lot_assembly (lot_row_id, item_id, qty, plan_date, shift, assembled_date)
           VALUES ($1, $2, $3, NULLIF($4, '')::date, NULLIF($5, ''), NULLIF($6, '')::date)`,
          [e.lot_row_id, e.item_id, e.qty, e.plan_date, e.shift, e.assembled_date]
        );
        if (e.plan_date) await history(e, null);
      }
    }
    const kept = new Set(sent.map((e) => e.id).filter(Boolean));
    const gone = [...existing.keys()].filter((id) => !kept.has(id));
    if (gone.length) await query(`DELETE FROM order_lot_assembly WHERE id = ANY($1::uuid[])`, [gone]);

    // Each lot's summary on every EC's row of it: the next planned day and
    // shift, and its assembled day once all of it is.
    for (const l of before) {
      const asm = lotAssembly(l.ecs, sent.filter((e) => l.ecs.some((x) => x.row_id === e.lot_row_id)));
      const rows = l.ecs.map((x) => x.row_id).filter((id) => UUID_RE.test(id));
      if (rows.length === 0) continue;
      await query(
        `UPDATE order_ready_lots
            SET assembly_plan_date = NULLIF($2, '')::date, assembly_shift = NULLIF($3, ''), assembled_date = NULLIF($4, '')::date
          WHERE id = ANY($1::uuid[])`,
        [rows, asm.plan_date, asm.shift, asm.assembled_date]
      );
    }

    for (const ec of ecs) {
      const packing: { id: string; packed_date: string; packing_plan_date: string; packing_shift: string; pdi: string }[] = [];
      for (const l of clean) {
        const row = ec.ready_lots[l.n - 1];
        if (!row || !UUID_RE.test(String(row.id))) continue;
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
  /** When the base plate was manufactured (YYYY-MM-DD), once it is. */
  base_plate_date: string;
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
  // Manufactured on a day: the date goes with it, and only with it.
  const plateDate = plateStatus === "Manufactured" ? (a.base_plate_date ?? "").trim() : "";
  if (plateStatus === "Manufactured" && !/^\d{4}-\d{2}-\d{2}$/.test(plateDate)) {
    return { ok: false, error: "Enter the date the base plate was manufactured." };
  }
  try {
    await query(
      `UPDATE orders SET base_plate = $2, base_plate_status = $3, base_plate_date = $6::date,
                         wooden_box = $4, wooden_box_status = $5, updated_at = now()
        WHERE id = $1`,
      [orderId, plate, plateStatus, box, boxStatus, plateDate || null]
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
    details: `Alignment — ${part("Base plate", plate, plateStatus)}${plateDate ? ` on ${plateDate}` : ""}; ${part("Wooden box", box, boxStatus)}`,
    subject: await subjectForOrder(orderId),
  });
  revalidatePath("/risansi/departments/assembly-dispatch");
  return { ok: true };
}
