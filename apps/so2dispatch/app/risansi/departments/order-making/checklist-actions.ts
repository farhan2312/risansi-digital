"use server";

import { revalidatePath } from "next/cache";
import { query } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";
import { logAudit } from "@/lib/audit";
import { canAccessOrderMaking, canViewOrderMaking, isCentral, isOrderMaking } from "@/lib/roles";
import { checklistFor, type ChecklistTeam } from "@/lib/so-checklist";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ChecklistAnswer = {
  point_key: string;
  answer: string | null;
  remarks: string | null;
  filled_by_name: string | null;
  filled_at: string;
  /** Order Making PO's check of the point. */
  verified: boolean;
  verifier_remarks: string | null;
  verified_by_name: string | null;
  verified_at: string | null;
};

export type ChecklistData = {
  orderId: string;
  soNo: string | null;
  slNo: number;
  soDate: string | null;
  orderType: string | null;
  versionNo: number;
  /** The SO's own values for the auto points, by the point's column. */
  auto: Record<string, string | null>;
  /** The answers, by version (the current one and any before it). */
  versions: Record<number, ChecklistAnswer[]>;
  /** Which points this user fills: the SO team's (the SO's assignee), the PO team's; and whether they verify (Order Making PO). */
  can: Record<ChecklistTeam | "verify", boolean>;
};

type OrderHead = {
  so_no: string | null;
  sl_no: number;
  so_date: string | null;
  order_type: string | null;
  version_no: number;
  so_assignee_id: string | null;
} & Record<string, string | number | null>;

async function loadHead(orderId: string): Promise<OrderHead | null> {
  const r = await query<OrderHead>(
    `SELECT o.so_no, o.sl_no::int AS sl_no, to_char(o.so_date, 'YYYY-MM-DD') AS so_date, o.order_type,
            COALESCE(o.version_no, 0)::int AS version_no, o.so_assignee_id,
            o.industry_type, o.market_type, o.reps, o.payment_terms,
            to_char(o.delivery_date_as_per_so, 'YYYY-MM-DD') AS delivery_date_as_per_so,
            o.ld, to_char(o.ld_date, 'YYYY-MM-DD') AS ld_date, o.freight_terms, o.packing_requirement, o.boi,
            -- Base plate: Yes when any EC asks for one.
            CASE WHEN EXISTS (SELECT 1 FROM order_items i WHERE i.order_id = o.id AND i.base_plate = 'Yes') THEN 'Yes'
                 WHEN EXISTS (SELECT 1 FROM order_items i WHERE i.order_id = o.id) THEN 'No' END AS base_plate
       FROM orders o WHERE o.id = $1`,
    [orderId]
  );
  return r.rows[0] ?? null;
}

/** Who fills which points: the SO team's, the member it is assigned to; the rest, Order Making PO. Central and Admin, both. Order Making PO (Central, Admin) verifies. */
function teamsFor(user: { id: string; role: string }, assigneeId: string | null): Record<ChecklistTeam | "verify", boolean> {
  const central = isCentral(user.role);
  const may = canAccessOrderMaking(user.role);
  const po = central || isOrderMaking(user.role);
  return {
    SO: may && (central || (!!assigneeId && assigneeId === user.id)),
    PO: po,
    verify: po,
  };
}

/** The SO's checklist: its points' answers by version, the SO's own values, and what this user fills. */
export async function getChecklistAction(orderId: string): Promise<{ ok: true; data: ChecklistData } | { ok: false; error: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "You are not signed in." };
  if (!canViewOrderMaking(user.role)) return { ok: false, error: "No access." };
  if (!UUID_RE.test(orderId)) return { ok: false, error: "Order not found." };
  const head = await loadHead(orderId);
  if (!head) return { ok: false, error: "Order not found." };
  const r = await query<ChecklistAnswer & { version_no: number }>(
    `SELECT version_no, point_key, answer, remarks, filled_by_name, filled_at::text AS filled_at,
            verified, verifier_remarks, verified_by_name, verified_at::text AS verified_at
       FROM order_so_checklist WHERE order_id = $1 ORDER BY version_no, point_key`,
    [orderId]
  );
  const versions: Record<number, ChecklistAnswer[]> = { [head.version_no]: [] };
  for (const { version_no, ...a } of r.rows) (versions[version_no] ??= []).push(a);
  const auto: Record<string, string | null> = {};
  for (const p of checklistFor(head.order_type)) {
    if (p.auto) auto[p.auto] = head[p.auto] == null || head[p.auto] === "" ? null : String(head[p.auto]);
  }
  return {
    ok: true,
    data: {
      orderId,
      soNo: head.so_no,
      slNo: head.sl_no,
      soDate: head.so_date,
      orderType: head.order_type,
      versionNo: head.version_no,
      auto,
      versions,
      can: teamsFor(user, head.so_assignee_id),
    },
  };
}

type Entry = { key: string; answer?: string; remarks?: string; verified?: boolean; verifier_remarks?: string };

type Saved = {
  point_key: string;
  answer: string | null;
  remarks: string | null;
  filled_by: string | null;
  filled_by_name: string | null;
  filled_at: string;
  verified: boolean;
  verifier_remarks: string | null;
  verified_by: string | null;
  verified_by_name: string | null;
  verified_at: string | null;
};

/**
 * Save the checklist points changed, on the SO's current version. An answer
 * and the preparer's remark only by the point's team (see teamsFor); the tick
 * and the verifier's remark only by Order Making PO, on a point answered (or
 * auto). A changed answer or remark clears the tick. Nothing left: removed.
 */
export async function saveChecklistAction(
  orderId: string,
  versionNo: number,
  entries: Entry[]
): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "You are not signed in." };
  if (!canAccessOrderMaking(user.role)) return { ok: false, error: "No access." };
  if (!UUID_RE.test(orderId)) return { ok: false, error: "Order not found." };
  if (!Array.isArray(entries) || entries.length === 0) return { ok: true };
  const head = await loadHead(orderId);
  if (!head) return { ok: false, error: "Order not found." };
  if (head.version_no !== versionNo) {
    return { ok: false, error: "A new version of this SO was made: close and open its checklist again." };
  }
  const can = teamsFor(user, head.so_assignee_id);
  const points = new Map(checklistFor(head.order_type).map((p) => [p.key, p]));
  const existing = new Map(
    (
      await query<Saved>(
        `SELECT point_key, answer, remarks, filled_by, filled_by_name, filled_at::text AS filled_at,
                verified, verifier_remarks, verified_by, verified_by_name, verified_at::text AS verified_at
           FROM order_so_checklist WHERE order_id = $1 AND version_no = $2`,
        [orderId, versionNo]
      )
    ).rows.map((r) => [r.point_key, r])
  );
  const who = user.full_name ?? user.email;
  const rows: (Omit<Saved, "filled_at" | "verified_at"> & { filled_at: string | null; verified_at: string | null; note: string })[] = [];
  for (const e of entries) {
    const p = points.get(String(e?.key ?? ""));
    if (!p) return { ok: false, error: "Unknown checklist point." };
    const old = existing.get(p.key);
    const prep = e.answer !== undefined || e.remarks !== undefined;
    const ver = e.verified !== undefined || e.verifier_remarks !== undefined;
    if (prep && !can[p.team]) {
      return {
        ok: false,
        error: p.team === "SO" ? "The green points are for the member this SO is assigned to." : "These points are for Order Making PO.",
      };
    }
    if (ver && !can.verify) return { ok: false, error: "Only Order Making PO verifies the checklist." };
    const answer = prep ? (p.auto ? "" : String(e.answer ?? old?.answer ?? "").trim()) || null : (old?.answer ?? null);
    if (answer && !(p.options ?? []).includes(answer)) return { ok: false, error: `Pick an answer for "${p.label}".` };
    const remarks = prep
      ? (e.remarks !== undefined ? String(e.remarks ?? "").trim().slice(0, 1000) : (old?.remarks ?? "")) || null
      : (old?.remarks ?? null);
    const prepChanged = answer !== (old?.answer ?? null) || remarks !== (old?.remarks ?? null);
    let verified = ver && e.verified !== undefined ? !!e.verified : prepChanged ? false : !!old?.verified;
    let vRemarks = ver && e.verifier_remarks !== undefined
      ? String(e.verifier_remarks ?? "").trim().slice(0, 1000) || null
      : prepChanged && !ver ? null : (old?.verifier_remarks ?? null);
    if (verified && !p.auto && !answer) return { ok: false, error: `"${p.label}" is not answered yet: nothing to verify.` };
    if (!ver && prepChanged) {
      verified = false;
      vRemarks = null;
    }
    const verChanged = verified !== !!old?.verified || vRemarks !== (old?.verifier_remarks ?? null);
    if (!prepChanged && !verChanged) continue;
    rows.push({
      point_key: p.key,
      answer,
      remarks,
      filled_by: prepChanged ? user.id : (old?.filled_by ?? null),
      filled_by_name: prepChanged ? who : (old?.filled_by_name ?? null),
      filled_at: prepChanged ? null : (old?.filled_at ?? null),
      verified,
      verifier_remarks: vRemarks,
      verified_by: verChanged ? (verified || vRemarks ? user.id : null) : (old?.verified_by ?? null),
      verified_by_name: verChanged ? (verified || vRemarks ? who : null) : (old?.verified_by_name ?? null),
      verified_at: verChanged ? null : (old?.verified_at ?? null),
      note: [
        prepChanged ? answer ?? (remarks ? "remark" : "cleared") : "",
        verChanged ? (verified ? "verified" : vRemarks ? "verifier's remark" : "unverified") : "",
      ]
        .filter(Boolean)
        .join(", "),
    });
  }
  if (rows.length === 0) return { ok: true };
  for (const r of rows) {
    if (!r.answer && !r.remarks && !r.verified && !r.verifier_remarks) {
      await query(`DELETE FROM order_so_checklist WHERE order_id = $1 AND version_no = $2 AND point_key = $3`, [
        orderId,
        versionNo,
        r.point_key,
      ]);
      continue;
    }
    // A null time: stamped now (the part just changed).
    await query(
      `INSERT INTO order_so_checklist (order_id, version_no, point_key, answer, remarks, filled_by, filled_by_name, filled_at,
                                       verified, verifier_remarks, verified_by, verified_by_name, verified_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, COALESCE($8::timestamptz, now()), $9, $10, $11, $12,
               CASE WHEN $11::uuid IS NULL THEN NULL ELSE COALESCE($13::timestamptz, now()) END)
       ON CONFLICT (order_id, version_no, point_key)
       DO UPDATE SET answer = EXCLUDED.answer, remarks = EXCLUDED.remarks, filled_by = EXCLUDED.filled_by,
                     filled_by_name = EXCLUDED.filled_by_name, filled_at = EXCLUDED.filled_at,
                     verified = EXCLUDED.verified, verifier_remarks = EXCLUDED.verifier_remarks,
                     verified_by = EXCLUDED.verified_by, verified_by_name = EXCLUDED.verified_by_name,
                     verified_at = EXCLUDED.verified_at`,
      [
        orderId,
        versionNo,
        r.point_key,
        r.answer,
        r.remarks,
        r.filled_by,
        r.filled_by_name,
        r.filled_at,
        r.verified,
        r.verifier_remarks,
        r.verified_by,
        r.verified_by_name,
        r.verified_at,
      ]
    );
  }
  const label = head.so_no || `Sl. ${head.sl_no}`;
  await logAudit({
    actor: { id: user.id, email: user.email, role: user.role },
    action: "order.update",
    category: "activity",
    target: label,
    details: `Checklist (v${versionNo}): ${rows
      .map((r) => `${points.get(r.point_key)!.label} — ${r.note}`)
      .join("; ")
      .slice(0, 900)}`,
    subject: { orderId, soNo: head.so_no },
  });
  revalidatePath("/risansi/departments/order-making");
  return { ok: true };
}
