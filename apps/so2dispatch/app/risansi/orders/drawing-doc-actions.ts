"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/session";
import { logAudit } from "@/lib/audit";
import { emitNotification } from "@/lib/notifications";
import {
  assigneeLabel,
  canManageDrawingDocs,
  isDrawingDocAssignee,
  isDrawingDocType,
  normaliseDocLink,
  type DrawingDocument,
} from "@/lib/drawing-docs";
import {
  deleteDrawingDocument,
  insertDrawingDocument,
  listEcDocuments,
  listRevisionDocuments,
  revisionContext,
} from "@/lib/drawing-docs-db";

export type DrawingDocsResult =
  | { ok: true; docs: DrawingDocument[]; canManage: boolean }
  | { ok: false; error: string };

/** One revision's documents, as this viewer may see them. */
export async function listRevisionDocsAction(revisionId: string): Promise<DrawingDocsResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "You are not signed in." };
  try {
    return {
      ok: true,
      docs: await listRevisionDocuments(revisionId, user.role),
      canManage: canManageDrawingDocs(user.role),
    };
  } catch (error) {
    console.error("listRevisionDocs failed:", error);
    return { ok: false, error: "Could not load the documents." };
  }
}

/** Every document on an EC shared with this viewer — the departments' view. */
export async function listEcDocsAction(itemId: string): Promise<DrawingDocsResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "You are not signed in." };
  try {
    return {
      ok: true,
      docs: await listEcDocuments(itemId, user.role),
      canManage: false,
    };
  } catch (error) {
    console.error("listEcDocs failed:", error);
    return { ok: false, error: "Could not load the documents." };
  }
}

export type SaveDrawingDocResult = { ok: true } | { ok: false; error: string };

function revisionLabel(rev: { revision_no: string | null }): string {
  const no = (rev.revision_no ?? "").trim();
  return no ? `Rev. ${no}` : "first issue";
}

/**
 * Share a document against a drawing revision and tell the departments it is
 * assigned to. Drawing owns the revisions, so Drawing (and Central) add them.
 */
export async function addDrawingDocAction(
  revisionId: string,
  input: { docType: string; link: string; assignedRoles: string[]; remarks: string }
): Promise<SaveDrawingDocResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "You are not signed in." };
  if (!canManageDrawingDocs(user.role)) {
    return { ok: false, error: "Only Drawing can add drawing documents." };
  }

  // Everything below crosses a server-action boundary, so it is checked here
  // whatever the form allowed.
  if (!isDrawingDocType(input.docType)) {
    return { ok: false, error: "Choose which document this is." };
  }
  const link = normaliseDocLink(input.link);
  if (!link) {
    return { ok: false, error: "Enter a valid link (starting with https://)." };
  }
  const roles = [...new Set(input.assignedRoles)].filter(isDrawingDocAssignee);
  if (roles.length === 0) {
    return { ok: false, error: "Assign it to at least one department." };
  }
  const remarks = input.remarks.trim().slice(0, 1000) || null;

  const rev = await revisionContext(revisionId);
  if (!rev) return { ok: false, error: "That revision no longer exists." };

  try {
    await insertDrawingDocument({
      revisionId,
      itemId: rev.item_id,
      docType: input.docType,
      link,
      assignedRoles: roles,
      remarks,
      actorId: user.id,
      actorRole: user.role,
    });

    const where = `${rev.so_no} · EC ${rev.ec_no ?? "—"} · ${revisionLabel(rev)}`;
    const assignedTo = roles.map(assigneeLabel).join(", ");
    await logAudit({
      actor: { id: user.id, email: user.email, role: user.role },
      action: "order.update",
      category: "activity",
      target: "Drawing document",
      details: `Shared ${input.docType} (${revisionLabel(rev)}) with ${assignedTo}${
        remarks ? ` — remarks: ${remarks}` : ""
      }`,
      subject: {
        orderId: rev.order_id,
        itemId: rev.item_id,
        soNo: rev.so_no,
        ecNo: rev.ec_no,
      },
    });

    // Everyone it was assigned to hears about it — except Mitali, when she is
    // the one sharing it, in keeping with every other self-made hand-off.
    const recipients = roles.filter(
      (r) => !(r === "central_visibility" && user.role === "central_visibility")
    );
    if (recipients.length > 0) {
      await emitNotification({
        roles: recipients,
        orderId: rev.order_id,
        itemId: rev.item_id,
        type: "dept_update",
        message: `Drawing shared a ${input.docType} — ${where}${remarks ? ` · ${remarks}` : ""}`,
      });
    }

    revalidatePath(`/risansi/orders/${rev.order_id}/items/${rev.item_id}`);
    revalidatePath("/risansi/departments/drawing");
    revalidatePath("/risansi/departments/planning");
    revalidatePath("/risansi/departments/purchase");
    return { ok: true };
  } catch (error) {
    console.error("addDrawingDoc failed:", error);
    return { ok: false, error: "Could not save the document. Please try again." };
  }
}

export async function deleteDrawingDocAction(id: string): Promise<SaveDrawingDocResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "You are not signed in." };
  if (!canManageDrawingDocs(user.role)) {
    return { ok: false, error: "Only Drawing can remove drawing documents." };
  }
  try {
    const removed = await deleteDrawingDocument(id);
    if (!removed) return { ok: false, error: "That document is already gone." };
    const rev = await revisionContext(removed.revision_id);
    await logAudit({
      actor: { id: user.id, email: user.email, role: user.role },
      action: "order.update",
      category: "activity",
      target: "Drawing document",
      details: `Removed ${removed.doc_type}${rev ? ` (${revisionLabel(rev)})` : ""}`,
      subject: rev
        ? { orderId: rev.order_id, itemId: rev.item_id, soNo: rev.so_no, ecNo: rev.ec_no }
        : null,
    });
    if (rev) revalidatePath(`/risansi/orders/${rev.order_id}/items/${rev.item_id}`);
    revalidatePath("/risansi/departments/drawing");
    revalidatePath("/risansi/departments/planning");
    revalidatePath("/risansi/departments/purchase");
    return { ok: true };
  } catch (error) {
    console.error("deleteDrawingDoc failed:", error);
    return { ok: false, error: "Could not remove the document." };
  }
}
