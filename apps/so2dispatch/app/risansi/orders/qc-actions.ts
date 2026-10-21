"use server";

import { revalidatePath } from "next/cache";
import { query } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";
import { logAudit } from "@/lib/audit";
import { subjectForItem } from "@/lib/audit-subject";
import { emitNotification } from "@/lib/notifications";
import { getOrderLabel } from "@/lib/orders";
import { canEditQcDocuments } from "@/lib/roles";
import { QC_DOC_TYPES, cleanLink, qcDocsStatus, requiredQcDocs, linksFromRows, type QcLink } from "@/lib/qc-docs";

export type QcResult = { ok: true } | { ok: false; error: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Quality's documents on one EC: each needed document's SharePoint link, the
 * day it was submitted and remarks. Once every needed one is in, the EC's
 * Actual Date of Doc. Submission is the last of those days (what the
 * reminders, escalations and status filters read); until then, none.
 */
export async function saveQcLinksAction(itemId: string, sent: QcLink[]): Promise<QcResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "You are not signed in." };
  if (!canEditQcDocuments(user.role)) return { ok: false, error: "Only Quality can give the QC documents." };
  if (!UUID_RE.test(itemId)) return { ok: false, error: "EC not found." };

  const ec = await query<Record<string, unknown>>(
    `SELECT it.order_id, it.ec_no, o.qc_documents
       FROM order_items it JOIN orders o ON o.id = it.order_id WHERE it.id = $1`,
    [itemId]
  );
  const row = ec.rows[0];
  if (!row) return { ok: false, error: "EC not found." };
  const required = requiredQcDocs(row);

  const links = linksFromRows(sent).filter((l) => (QC_DOC_TYPES as readonly string[]).includes(l.doc_type));
  for (const l of links) {
    if (l.link.trim() && !cleanLink(l.link)) return { ok: false, error: `${l.doc_type}: the link must start with https://` };
    if (l.submitted_date && !ISO.test(l.submitted_date)) return { ok: false, error: `${l.doc_type}: enter a valid date.` };
  }

  try {
    const before = linksFromRows(
      (await query(`SELECT doc_type, link, submitted_date::text AS submitted_date, remarks FROM order_qc_doc_links WHERE item_id = $1`, [itemId])).rows
    );
    for (const l of links) {
      const link = cleanLink(l.link);
      await query(
        `INSERT INTO order_qc_doc_links (item_id, doc_type, link, submitted_date, remarks, updated_by)
         VALUES ($1, $2, NULLIF($3, ''), $4::date, NULLIF($5, ''), $6)
         ON CONFLICT (item_id, doc_type) DO UPDATE
            SET link = EXCLUDED.link, submitted_date = EXCLUDED.submitted_date,
                remarks = EXCLUDED.remarks, updated_by = EXCLUDED.updated_by`,
        [itemId, l.doc_type, link, link ? l.submitted_date || null : null, l.remarks.trim().slice(0, 1000), user.id]
      );
    }
    const after = linksFromRows(
      (await query(`SELECT doc_type, link, submitted_date::text AS submitted_date, remarks FROM order_qc_doc_links WHERE item_id = $1`, [itemId])).rows
    );
    const was = qcDocsStatus(required, before);
    const now = qcDocsStatus(required, after);
    // The EC's submission date follows its documents.
    const last =
      now.label === "Submitted"
        ? after
            .filter((l) => (required as string[]).includes(l.doc_type))
            .map((l) => l.submitted_date || new Date().toISOString().slice(0, 10))
            .sort()
            .pop() ?? null
        : null;
    await query(
      `INSERT INTO order_qc (item_id, qc_doc_actual_date) VALUES ($1, $2::date)
       ON CONFLICT (item_id) DO UPDATE SET qc_doc_actual_date = EXCLUDED.qc_doc_actual_date`,
      [itemId, last]
    );
    await logAudit({
      actor: { id: user.id, email: user.email, role: user.role },
      action: "order.update",
      category: "activity",
      target: "QC documents",
      details: `QC documents: ${now.done}/${now.total} submitted`,
      subject: await subjectForItem(itemId),
    });
    if (now.label === "Submitted" && was.label !== "Submitted") {
      const orderId = String(row.order_id);
      const so = (await getOrderLabel(orderId)) ?? orderId;
      await emitNotification({
        roles: ["central_visibility"],
        orderId,
        itemId,
        type: "dept_update",
        message: `QC documents submitted for ${so} · EC ${String(row.ec_no ?? "—")}`,
      });
    }
    revalidatePath("/risansi/departments/qc");
    return { ok: true };
  } catch (error) {
    console.error("saveQcLinks failed:", error);
    return { ok: false, error: "Could not save the QC documents." };
  }
}
