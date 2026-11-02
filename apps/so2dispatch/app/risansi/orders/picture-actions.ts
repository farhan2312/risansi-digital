"use server";

import { revalidatePath } from "next/cache";
import { query } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";
import { logAudit } from "@/lib/audit";
import { subjectForOrder } from "@/lib/audit-subject";
import { getOrderLabel } from "@/lib/orders";
import { canEditChild } from "@/lib/roles";
import { normaliseDocLink } from "@/lib/drawing-docs";

export type PictureResult = { ok: true } | { ok: false; error: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function refresh() {
  revalidatePath("/risansi/departments/dispatch");
  revalidatePath("/risansi/orders");
}

/**
 * Add the order's pictures to a dispatch: SharePoint links, one or several at
 * once (each on its own line). Whoever may edit Dispatch's invoices may. A link
 * the dispatch already has is not added twice.
 */
export async function addDispatchPicturesAction(invoiceId: string, text: string): Promise<PictureResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "You are not signed in." };
  if (!canEditChild(user.role, "order_invoices")) return { ok: false, error: "Only Dispatch can add the order's pictures." };
  if (!UUID_RE.test(invoiceId)) return { ok: false, error: "Dispatch not found." };
  const typed = String(text ?? "").split(/\s+/).filter(Boolean);
  if (typed.length === 0) return { ok: false, error: "Paste the SharePoint link." };
  const links: string[] = [];
  for (const raw of typed) {
    const link = normaliseDocLink(raw);
    if (!link) return { ok: false, error: `Not a web link: ${raw.slice(0, 60)}` };
    links.push(link);
  }
  let orderId: string | undefined;
  try {
    orderId = (await query<{ order_id: string }>(`SELECT order_id FROM order_invoices WHERE id = $1`, [invoiceId])).rows[0]?.order_id;
    if (!orderId) return { ok: false, error: "Dispatch not found." };
    await query(
      `INSERT INTO order_picture_links (invoice_id, link, added_by)
       SELECT $1, l, $3 FROM unnest($2::text[]) AS l
       ON CONFLICT (invoice_id, link) DO NOTHING`,
      [invoiceId, links, user.id]
    );
  } catch (error) {
    console.error("addDispatchPicturesAction failed:", error);
    return { ok: false, error: "Could not save the links." };
  }
  await logAudit({
    actor: { id: user.id, email: user.email, role: user.role },
    action: "order.update",
    category: "activity",
    target: (await getOrderLabel(orderId)) ?? orderId,
    details: `Added ${links.length} order picture link${links.length === 1 ? "" : "s"}`,
    subject: await subjectForOrder(orderId),
  });
  refresh();
  return { ok: true };
}

/** Take one of a dispatch's picture links off. */
export async function removeDispatchPictureAction(id: string): Promise<PictureResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "You are not signed in." };
  if (!canEditChild(user.role, "order_invoices")) return { ok: false, error: "Only Dispatch can remove the order's pictures." };
  if (!UUID_RE.test(id)) return { ok: false, error: "Link not found." };
  let orderId: string | undefined;
  let link: string | undefined;
  try {
    const gone = await query<{ order_id: string; link: string }>(
      `DELETE FROM order_picture_links pl USING order_invoices iv
        WHERE pl.id = $1 AND iv.id = pl.invoice_id
        RETURNING iv.order_id, pl.link`,
      [id]
    );
    orderId = gone.rows[0]?.order_id;
    link = gone.rows[0]?.link;
  } catch (error) {
    console.error("removeDispatchPictureAction failed:", error);
    return { ok: false, error: "Could not remove the link." };
  }
  if (orderId) {
    await logAudit({
      actor: { id: user.id, email: user.email, role: user.role },
      action: "order.update",
      category: "activity",
      target: (await getOrderLabel(orderId)) ?? orderId,
      details: `Removed an order picture link: ${link}`,
      subject: await subjectForOrder(orderId),
    });
  }
  refresh();
  return { ok: true };
}
