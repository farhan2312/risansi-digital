"use server";

import { revalidatePath } from "next/cache";
import { query, withTransaction } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";
import { logAudit } from "@/lib/audit";
import { subjectForOrder } from "@/lib/audit-subject";
import { emitNotification } from "@/lib/notifications";
import { getOrderLabel, saveLotPacking, syncPumpPackedDate, unpackBlockedBySlip } from "@/lib/orders";
import { canEditSection } from "@/lib/roles";
import { PUMP_LIKE } from "@/lib/order-schema";
import {
  BASE_PLATE_STATUSES,
  LOT_PACKED,
  LOT_PACKING_PENDING,
  STAGE_WORDS,
  WOODEN_BOX_SOURCES,
  WOODEN_BOX_STATUSES,
  basePlateFromEcsSql,
  lotAssembly,
  lotStagesError,
  pumpLotsFromEcs,
  soStatuses,
  type AsmEntry,
  type LotStages,
  woodenBoxFromPackingSql,
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
    asm_remarks: t(l.asm_remarks),
    packing_plan_date: t(l.packing_plan_date),
    packing_shift: t(l.packing_shift),
    pdi: t(l.pdi),
    final_alignment: t(l.final_alignment),
    // Actual Packing Pending is not packed, and a packed day is Packed.
    packed_date: t(l.pack_status) === LOT_PACKING_PENDING ? "" : t(l.packed_date),
    pack_status: t(l.pack_status) || (t(l.packed_date) ? LOT_PACKED : ""),
    pack_remarks: t(l.pack_remarks),
    recheck_ok: l.recheck_ok === true,
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
    const blocked = await unpackBlockedBySlip(
      orderId,
      clean.filter((l) => !l.packed_date).flatMap((l) => ecs.flatMap((ec) => (ec.ready_lots[l.n - 1] ? [String(ec.ready_lots[l.n - 1].id)] : [])))
    );
    if (blocked) return { ok: false, error: blocked };
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
      const packing: { id: string; packed_date: string; packing_plan_date: string; packing_shift: string; pdi: string; recheck_ok?: boolean }[] = [];
      for (const l of clean) {
        const row = ec.ready_lots[l.n - 1];
        if (!row || !UUID_RE.test(String(row.id))) continue;
        packing.push({
          id: String(row.id),
          packed_date: l.packed_date,
          packing_plan_date: l.packing_plan_date,
          packing_shift: l.packing_shift,
          pdi: l.pdi,
          // Planning's change checked: the flag clears (as it does on a new packed day).
          recheck_ok: l.recheck_ok,
        });
        await query(
          `UPDATE order_ready_lots SET pump_packing_status = NULLIF($2, ''), packing_remarks = NULLIF($3, ''), assembly_remarks = NULLIF($4, ''), final_alignment = NULLIF($5, '') WHERE id = $1`,
          [row.id, l.pack_status, l.pack_remarks, l.asm_remarks, l.final_alignment]
        );
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

/** A pump SO's base plate: Yes or No, then a status, the day it reached it, and remarks. */
export type BasePlate = {
  required: string;
  status: string;
  /** YYYY-MM-DD. */
  date: string;
  remarks: string;
};

/** One way the SO's wooden boxes come (In house or Bought out), with its own quantities, status and receipt. */
export type WoodenBox = {
  source: string;
  required_qty: string;
  stock_qty: string;
  status: string;
  received_date: string;
  received_qty: string;
  remarks: string;
};

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Who may fill either form, whether the SO is there, and what its ECs and Packing Requirement say. */
async function alignmentGate(orderId: string): Promise<
  | { error: string }
  | { user: NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>; plate: string; box: string | null }
> {
  const user = await getCurrentUser();
  if (!user) return { error: "You are not signed in." };
  if (!canEditSection(user.role, "order_assembly_dispatch")) {
    return { error: "Only Assembly & Packing can set the alignment." };
  }
  if (!UUID_RE.test(orderId)) return { error: "Order not found." };
  const need = await query<{ plate: string; box: string | null }>(
    `SELECT ${basePlateFromEcsSql("o")} AS plate, ${woodenBoxFromPackingSql("o")} AS box FROM orders o WHERE o.id = $1`,
    [orderId]
  );
  if (!need.rows[0]) return { error: "Order not found." };
  return { user, plate: need.rows[0].plate, box: need.rows[0].box };
}

/** Assembly & Packing's word, kept only when it differs from what the SO says on its own. */
const overrideOf = (required: string, natural: string | null) => (required === natural ? null : required);

const text = (v: string) => (v ?? "").trim() || null;

/**
 * Assembly & Packing's base plate on a pump SO: Yes or No, and with Yes where
 * it stands. Saved on its own: the wooden boxes, filled by someone else, are
 * not touched. No keeps what was filled in, for a later Yes.
 */
export async function saveBasePlateAction(orderId: string, p: BasePlate): Promise<AssemblyResult> {
  const gate = await alignmentGate(orderId);
  if ("error" in gate) return { ok: false, error: gate.error };
  if (p.required !== "Yes" && p.required !== "No") return { ok: false, error: "Choose Yes or No for the base plate." };
  const override = overrideOf(p.required, gate.plate);
  if (p.required === "No") {
    try {
      await query(`UPDATE orders SET base_plate_override = $2, updated_at = now() WHERE id = $1`, [orderId, override]);
    } catch (error) {
      console.error("saveBasePlateAction failed:", error);
      return { ok: false, error: "Could not save the base plate." };
    }
    await logAudit({
      actor: { id: gate.user.id, email: gate.user.email, role: gate.user.role },
      action: "order.update",
      category: "activity",
      target: (await getOrderLabel(orderId)) ?? orderId,
      details: "Base plate: No",
      subject: await subjectForOrder(orderId),
    });
    revalidatePath("/risansi/departments/assembly-dispatch");
    return { ok: true };
  }

  // A status, its day once past Pending, and remarks.
  const status = BASE_PLATE_STATUSES.includes(p.status) ? p.status : "Pending";
  const date = (p.date ?? "").trim();
  if (date && !DAY_RE.test(date)) return { ok: false, error: "Enter a valid base plate date." };
  if (status !== "Pending" && !date) return { ok: false, error: `Enter the date the base plate reached ${status}.` };
  const remarks = text(p.remarks);

  try {
    const was = (
      await query<{ status: string | null; date: string | null; remarks: string | null }>(
        `SELECT base_plate_status AS status, to_char(base_plate_date, 'YYYY-MM-DD') AS date, base_plate_remarks AS remarks FROM orders WHERE id = $1`,
        [orderId]
      )
    ).rows[0];
    await query(
      `UPDATE orders SET base_plate_override = $5, base_plate_status = $2, base_plate_date = $3::date, base_plate_remarks = $4, updated_at = now()
        WHERE id = $1`,
      [orderId, status, date || null, remarks, override]
    );
    // Each step kept with its own day: moving on to the next adds to the history.
    if (!was || was.status !== status || (was.date ?? "") !== date || (was.remarks ?? null) !== remarks) {
      await query(
        `INSERT INTO order_base_plate_history (order_id, status, stage_date, remarks, prev_status, prev_date, changed_by, changed_by_name)
         VALUES ($1, $2, NULLIF($3, '')::date, $4, $5, NULLIF($6, '')::date, $7, $8)`,
        [orderId, status, date, remarks, was?.status ?? null, was?.date ?? "", UUID_RE.test(gate.user.id) ? gate.user.id : null, gate.user.full_name || gate.user.email]
      );
    }
  } catch (error) {
    console.error("saveBasePlateAction failed:", error);
    return { ok: false, error: "Could not save the base plate." };
  }
  await logAudit({
    actor: { id: gate.user.id, email: gate.user.email, role: gate.user.role },
    action: "order.update",
    category: "activity",
    target: (await getOrderLabel(orderId)) ?? orderId,
    details: `Base plate: ${status}${date ? ` on ${date}` : ""}${remarks ? ` (${remarks})` : ""}`,
    subject: await subjectForOrder(orderId),
  });
  revalidatePath("/risansi/departments/assembly-dispatch");
  return { ok: true };
}

/**
 * Assembly & Packing's wooden boxes on a pump SO: Yes or No, and with Yes each
 * way (in house, bought out) with how many, its status, and what came in. Saved
 * on its own: the base plate, filled by someone else, is not touched. No keeps
 * what was filled in, for a later Yes.
 */
export async function saveWoodenBoxAction(orderId: string, required: string, sent: WoodenBox[]): Promise<AssemblyResult> {
  const gate = await alignmentGate(orderId);
  if ("error" in gate) return { ok: false, error: gate.error };
  if (required !== "Yes" && required !== "No") return { ok: false, error: "Choose Yes or No for the wooden box." };
  const override = overrideOf(required, gate.box);
  if (required === "No") {
    try {
      await query(`UPDATE orders SET wooden_box_override = $2, updated_at = now() WHERE id = $1`, [orderId, override]);
    } catch (error) {
      console.error("saveWoodenBoxAction failed:", error);
      return { ok: false, error: "Could not save the wooden boxes." };
    }
    await logAudit({
      actor: { id: gate.user.id, email: gate.user.email, role: gate.user.role },
      action: "order.update",
      category: "activity",
      target: (await getOrderLabel(orderId)) ?? orderId,
      details: "Wooden box: No",
      subject: await subjectForOrder(orderId),
    });
    revalidatePath("/risansi/departments/assembly-dispatch");
    return { ok: true };
  }
  const qty = (v: string): number | null | false => {
    const t = (v ?? "").trim();
    if (!t) return null;
    return /^\d+$/.test(t) ? Number(t) : false;
  };

  type Box = { source: string; required: number; stock: number | null; status: string; date: string | null; got: number | null; remarks: string | null };
  const boxes: Box[] = [];
  for (const source of WOODEN_BOX_SOURCES) {
    const w = (sent ?? []).find((x) => x?.source === source);
    if (!w) continue;
    const required = qty(w.required_qty);
    const stock = qty(w.stock_qty);
    const status = WOODEN_BOX_STATUSES.includes(w.status) ? w.status : "Pending";
    const received = status === "Received";
    const date = received ? (w.received_date ?? "").trim() : "";
    const got = received ? qty(w.received_qty) : null;
    if (required === false || stock === false || got === false) return { ok: false, error: `${source}: quantities are whole numbers.` };
    if (required == null) return { ok: false, error: `${source}: enter the wooden boxes required.` };
    if (received && !DAY_RE.test(date)) return { ok: false, error: `${source}: enter the date the wooden boxes were received.` };
    if (received && !got) return { ok: false, error: `${source}: enter the wooden boxes received.` };
    boxes.push({ source, required, stock, status, date: date || null, got, remarks: text(w.remarks) });
  }
  if (boxes.length === 0) return { ok: false, error: "Choose whether the wooden boxes are in house, bought out, or both." };

  try {
    await withTransaction(async (client) => {
      await client.query(`UPDATE orders SET wooden_box_override = $2, updated_at = now() WHERE id = $1`, [orderId, override]);
      // The ways left off go; the rest are as the form leaves them.
      await client.query(`DELETE FROM order_wooden_boxes WHERE order_id = $1 AND NOT (source = ANY($2::text[]))`, [
        orderId,
        boxes.map((b) => b.source),
      ]);
      for (const b of boxes) {
        await client.query(
          `INSERT INTO order_wooden_boxes (order_id, source, required_qty, stock_qty, status, received_date, received_qty, remarks)
           VALUES ($1, $2, $3, $4, $5, $6::date, $7, $8)
           ON CONFLICT (order_id, source) DO UPDATE
             SET required_qty = EXCLUDED.required_qty, stock_qty = EXCLUDED.stock_qty, status = EXCLUDED.status,
                 received_date = EXCLUDED.received_date, received_qty = EXCLUDED.received_qty,
                 remarks = EXCLUDED.remarks, updated_at = now()`,
          [orderId, b.source, b.required, b.stock, b.status, b.date, b.got, b.remarks]
        );
      }
    });
  } catch (error) {
    console.error("saveWoodenBoxAction failed:", error);
    return { ok: false, error: "Could not save the wooden boxes." };
  }
  await logAudit({
    actor: { id: gate.user.id, email: gate.user.email, role: gate.user.role },
    action: "order.update",
    category: "activity",
    target: (await getOrderLabel(orderId)) ?? orderId,
    details: `Wooden box: ${boxes
      .map(
        (b) =>
          `${b.source} ${b.required} required${b.stock ? `, ${b.stock} in stock` : ""}, ${b.status}${
            b.date ? ` ${b.got} on ${b.date}` : ""
          }${b.remarks ? ` (${b.remarks})` : ""}`
      )
      .join(" · ")}`,
    subject: await subjectForOrder(orderId),
  });
  revalidatePath("/risansi/departments/assembly-dispatch");
  return { ok: true };
}

export type BasePlateEvent = {
  status: string;
  stage_date: string | null;
  remarks: string | null;
  prev_status: string | null;
  prev_date: string | null;
  changed_by_name: string | null;
  changed_at: string;
};

/** The base plate's history on a pump SO, newest first. */
export async function basePlateHistoryAction(orderId: string): Promise<BasePlateEvent[]> {
  const user = await getCurrentUser();
  if (!user || !UUID_RE.test(orderId)) return [];
  const r = await query<BasePlateEvent>(
    `SELECT status, to_char(stage_date, 'YYYY-MM-DD') AS stage_date, remarks, prev_status,
            to_char(prev_date, 'YYYY-MM-DD') AS prev_date, changed_by_name, changed_at::text AS changed_at
       FROM order_base_plate_history WHERE order_id = $1 ORDER BY changed_at DESC`,
    [orderId]
  );
  return r.rows;
}
