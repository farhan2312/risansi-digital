"use server";

import { revalidatePath } from "next/cache";
import { query } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";
import { logAudit } from "@/lib/audit";
import { subjectForItem } from "@/lib/audit-subject";
import { emitNotification } from "@/lib/notifications";
import { getOrderLabel } from "@/lib/orders";
import { canEditChild, canEditSection } from "@/lib/roles";
import { PUMP_LIKE } from "@/lib/order-schema";
import { OTHER_PART_SECTION, partDrawingStatus, type PartListItem } from "@/lib/part-drawings";

export type PartDrawingResult = { ok: true } | { ok: false; error: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type EcFacts = { order_id: string; ec_no: string | null; item_type: string | null; part_drawing: string | null };

async function ecFacts(itemId: string): Promise<EcFacts | null> {
  if (!UUID_RE.test(itemId)) return null;
  const res = await query<EcFacts>(
    `SELECT it.order_id, it.ec_no, it.item_type, pl.part_drawing
       FROM order_items it LEFT JOIN order_planning pl ON pl.item_id = it.id
      WHERE it.id = $1`,
    [itemId]
  );
  return res.rows[0] ?? null;
}

async function partRows(itemId: string): Promise<Record<string, unknown>[]> {
  const res = await query<Record<string, unknown>>(
    `SELECT * FROM order_part_drawings WHERE item_id = $1 ORDER BY seq`,
    [itemId]
  );
  return res.rows;
}

const keyOf = (p: { section?: unknown; part_no?: unknown; part_name?: unknown }) =>
  [p.section, p.part_no, p.part_name].map((v) => String(v ?? "").trim().toLowerCase()).join("|");

function refresh() {
  revalidatePath("/risansi/departments/planning");
  revalidatePath("/risansi/departments/drawing");
}

/**
 * Planning's call on an EC: whether it needs part drawings, and which parts.
 * Parts no longer picked are dropped; those already there keep what Drawing
 * has recorded. Saying No keeps the parts, so a Yes again brings them back.
 */
export async function savePartSelectionAction(
  itemId: string,
  required: string,
  parts: PartListItem[]
): Promise<PartDrawingResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "You are not signed in." };
  if (!canEditSection(user.role, "order_planning")) {
    return { ok: false, error: "Only Planning can choose part drawings." };
  }
  const ec = await ecFacts(itemId);
  if (!ec) return { ok: false, error: "EC not found." };
  if (!PUMP_LIKE.includes(String(ec.item_type ?? ""))) {
    return { ok: false, error: "Part drawings are for pump ECs." };
  }
  const yes = required === "Yes";
  // Each part once, named; an "other" carries its own name.
  const wanted = new Map<string, PartListItem>();
  for (const p of Array.isArray(parts) ? parts : []) {
    const name = String(p?.part_name ?? "").trim().slice(0, 200);
    if (!name) continue;
    const item = {
      section: String(p.section ?? OTHER_PART_SECTION).trim().slice(0, 100) || OTHER_PART_SECTION,
      part_no: String(p.part_no ?? "").trim().slice(0, 50),
      part_name: name,
    };
    wanted.set(keyOf(item), item);
  }
  if (yes && wanted.size === 0) return { ok: false, error: "Pick at least one part." };

  try {
    await query(
      `INSERT INTO order_planning (item_id, part_drawing) VALUES ($1, $2)
       ON CONFLICT (item_id) DO UPDATE SET part_drawing = EXCLUDED.part_drawing`,
      [itemId, yes ? "Yes" : "No"]
    );
    let added = 0;
    let removed = 0;
    if (yes) {
      const existing = await partRows(itemId);
      const have = new Set(existing.map(keyOf));
      const drop = existing.filter((r) => !wanted.has(keyOf(r))).map((r) => String(r.id));
      if (drop.length > 0) {
        await query(`DELETE FROM order_part_drawings WHERE item_id = $1 AND id = ANY($2)`, [itemId, drop]);
        removed = drop.length;
      }
      for (const [k, p] of wanted) {
        if (have.has(k)) continue;
        await query(
          `INSERT INTO order_part_drawings (item_id, section, part_no, part_name) VALUES ($1, $2, NULLIF($3, ''), $4)`,
          [itemId, p.section, p.part_no, p.part_name]
        );
        added++;
      }
    }
    await logAudit({
      actor: { id: user.id, email: user.email, role: user.role },
      action: "order.update",
      category: "activity",
      target: "Part drawing",
      details: yes
        ? `Part drawing: Yes · ${wanted.size} part${wanted.size === 1 ? "" : "s"} (${added} added, ${removed} removed)`
        : "Part drawing: No",
      subject: await subjectForItem(itemId),
    });
    if (yes && (added > 0 || removed > 0)) {
      const so = (await getOrderLabel(ec.order_id)) ?? ec.order_id;
      await emitNotification({
        roles: ["drawing"],
        orderId: ec.order_id,
        itemId,
        type: "dept_update",
        message: `Part drawings for ${so} · EC ${ec.ec_no ?? "—"}: ${wanted.size} part${wanted.size === 1 ? "" : "s"} to draw`,
      });
    }
    refresh();
    return { ok: true };
  } catch (error) {
    console.error("savePartSelection failed:", error);
    return { ok: false, error: "Could not save the parts." };
  }
}

/** Drawing marks parts drawn: each part's Complete, date and remarks. */
export async function savePartProgressAction(
  itemId: string,
  rows: { id: string; completed: string; completed_date: string; remarks: string }[]
): Promise<PartDrawingResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "You are not signed in." };
  if (!canEditChild(user.role, "order_drawing_revisions")) {
    return { ok: false, error: "Only Drawing can mark part drawings." };
  }
  const ec = await ecFacts(itemId);
  if (!ec) return { ok: false, error: "EC not found." };
  for (const r of rows) {
    if (r.completed === "Yes" && r.completed_date && !/^\d{4}-\d{2}-\d{2}$/.test(r.completed_date)) {
      return { ok: false, error: "A completed date is not a date." };
    }
  }
  try {
    const before = partDrawingStatus(ec.part_drawing, await partRows(itemId));
    for (const r of rows) {
      if (!UUID_RE.test(String(r.id))) continue;
      const done = r.completed === "Yes";
      await query(
        `UPDATE order_part_drawings
            SET completed = $3, completed_date = $4::date, remarks = NULLIF($5, '')
          WHERE id = $1 AND item_id = $2`,
        [r.id, itemId, done ? "Yes" : null, done && r.completed_date ? r.completed_date : null, String(r.remarks ?? "").trim().slice(0, 1000)]
      );
    }
    const after = partDrawingStatus(ec.part_drawing, await partRows(itemId));
    await logAudit({
      actor: { id: user.id, email: user.email, role: user.role },
      action: "order.update",
      category: "activity",
      target: "Part drawing",
      details: `Part drawings: ${after ? `${after.done}/${after.total} complete` : "updated"}`,
      subject: await subjectForItem(itemId),
    });
    // Planning hears when the EC's part drawings are all done.
    if (after?.label === "Fully complete" && before?.label !== "Fully complete") {
      const so = (await getOrderLabel(ec.order_id)) ?? ec.order_id;
      await emitNotification({
        roles: ["planning", "central_visibility"],
        orderId: ec.order_id,
        itemId,
        type: "dept_update",
        message: `Part drawings complete for ${so} · EC ${ec.ec_no ?? "—"}`,
      });
    }
    refresh();
    return { ok: true };
  } catch (error) {
    console.error("savePartProgress failed:", error);
    return { ok: false, error: "Could not save the part drawings." };
  }
}

/** Planning marks the parts a pump EC is short of, and how many of each; the list replaces the last. */
export async function saveShortageAction(
  itemId: string,
  parts: (PartListItem & { qty?: number | string | null })[]
): Promise<PartDrawingResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "You are not signed in." };
  if (!canEditSection(user.role, "order_planning")) {
    return { ok: false, error: "Only Planning can mark shortages." };
  }
  const ec = await ecFacts(itemId);
  if (!ec) return { ok: false, error: "EC not found." };
  if (!PUMP_LIKE.includes(String(ec.item_type ?? ""))) {
    return { ok: false, error: "Shortages are for pump ECs." };
  }
  const wanted = new Map<string, PartListItem & { qty: number }>();
  for (const p of Array.isArray(parts) ? parts : []) {
    const name = String(p?.part_name ?? "").trim().slice(0, 200);
    if (!name) continue;
    // How many are short: a whole number above nought, for every part.
    const qty = Number(String(p.qty ?? "").trim());
    if (!Number.isInteger(qty) || qty <= 0) return { ok: false, error: `Enter how many ${name} are short.` };
    const item = {
      section: String(p.section ?? OTHER_PART_SECTION).trim().slice(0, 100) || OTHER_PART_SECTION,
      part_no: String(p.part_no ?? "").trim().slice(0, 50),
      part_name: name,
      qty,
    };
    wanted.set(keyOf(item), item);
  }
  try {
    const existing = await query<Record<string, unknown>>(
      `SELECT * FROM order_part_shortages WHERE item_id = $1 ORDER BY seq`,
      [itemId]
    );
    const have = new Map(existing.rows.map((r) => [keyOf(r), r]));
    const drop = existing.rows.filter((r) => !wanted.has(keyOf(r))).map((r) => String(r.id));
    if (drop.length > 0) {
      await query(`DELETE FROM order_part_shortages WHERE item_id = $1 AND id = ANY($2)`, [itemId, drop]);
    }
    let added = 0;
    for (const [k, p] of wanted) {
      const row = have.get(k);
      if (row) {
        // Already short: only its qty may have changed.
        if (Number(row.qty) !== p.qty) {
          await query(`UPDATE order_part_shortages SET qty = $2 WHERE id = $1`, [row.id, p.qty]);
          added++;
        }
        continue;
      }
      await query(
        `INSERT INTO order_part_shortages (item_id, section, part_no, part_name, qty) VALUES ($1, $2, NULLIF($3, ''), $4, $5)`,
        [itemId, p.section, p.part_no, p.part_name, p.qty]
      );
      added++;
    }
    if (added > 0 || drop.length > 0) {
      await logAudit({
        actor: { id: user.id, email: user.email, role: user.role },
        action: "order.update",
        category: "activity",
        target: "Shortage",
        details: wanted.size
          ? `Shortage: ${[...wanted.values()].map((p) => `${p.part_name} ×${p.qty}`).join(", ")}`
          : "Shortage cleared",
        subject: await subjectForItem(itemId),
      });
    }
    refresh();
    return { ok: true };
  } catch (error) {
    console.error("saveShortage failed:", error);
    return { ok: false, error: "Could not save the shortage." };
  }
}
