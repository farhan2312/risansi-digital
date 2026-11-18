import { and, eq } from "drizzle-orm";

import { error, json } from "@/lib/api";
import { logAudit } from "@/lib/audit";
import { AuthError, decodeToken } from "@/lib/auth";
import { SPARE_GROUP } from "@/lib/commercial";
import { projectDriveGroups } from "@/lib/commercial-server";
import { db } from "@/lib/db";
import { projects, quotation, quotationVersion, techDocVersion } from "@/lib/db/schema";
import { viewDenied, workDenied } from "@/lib/enquiry-access";
import { SAVED_DOC_KINDS, operationDocKinds, type SavedDocKind } from "@/lib/saved-docs";
import { docLinksOrNull, missingDocLinks, ungeneratedDocsProblem, type DocLinkKind } from "@/lib/doc-links";
import { loadSavedDocs } from "@/lib/saved-docs-server";
import { techDocGroups, techDocSheet } from "@/lib/tech-doc";
import { loadTechDocData } from "@/lib/tech-doc-server";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f-]{36}$/i;

/** Statuses set to Completed by hand on the Edit form: that step needs no Save Version
 *  (user, 2026-11-19) - its documents go as SharePoint links instead. */
type HandDone = { technical: boolean; commercial: boolean };
const handDoneOf = (p: { technicalOverride: string | null; commercialOverride: string | null }): HandDone => ({
  technical: p.technicalOverride === "Completed",
  commercial: p.commercialOverride === "Completed",
});

/** The documents generated for this version: a Technical Data Sheet saved, a client
 *  quotation saved (Techno-Commercial needs both). */
async function generatedKinds(projectId: string, orderType: string): Promise<DocLinkKind[]> {
  const [quoted] = await db
    .select({ id: quotationVersion.id })
    .from(quotationVersion)
    .innerJoin(quotation, eq(quotation.id, quotationVersion.quotationId))
    .where(and(eq(quotation.projectId, projectId), eq(quotationVersion.track, "client")))
    .limit(1);
  if (orderType === "spare") return quoted ? ["commercial"] : [];
  const [sheet] = await db.select({ id: techDocVersion.id }).from(techDocVersion).where(eq(techDocVersion.projectId, projectId)).limit(1);
  return [...(sheet ? (["technical"] as const) : []), ...(quoted ? (["commercial"] as const) : []), ...(sheet && quoted ? (["techno"] as const) : [])];
}

/** What still needs Save Version before this enquiry version can be reviewed, or null.
 *  A step completed by hand is skipped. */
async function notSaved(projectId: string, orderType: string, hand: HandDone): Promise<string | null> {
  const saved = await db
    .selectDistinct({ group: quotation.driveGroup })
    .from(quotation)
    .innerJoin(quotationVersion, eq(quotationVersion.quotationId, quotation.id))
    .where(and(eq(quotation.projectId, projectId), eq(quotationVersion.track, "client")));
  const quoted = (g: string) => saved.some((s) => s.group === g);
  if (orderType === "spare") return hand.commercial || quoted(SPARE_GROUP) ? null : "Save Version on the quotation first.";

  // Every sheet that has confirmed tags. A pump other than PCP may have none to save.
  const data = hand.technical ? null : await loadTechDocData(projectId);
  if (data) {
    const sheets = await db.selectDistinct({ group: techDocVersion.driveGroup }).from(techDocVersion).where(eq(techDocVersion.projectId, projectId));
    const needed = techDocGroups(data).filter((g) => techDocSheet(data, g).tags.length > 0);
    if (!needed.every((g) => sheets.some((s) => s.group === g))) return "Save Version on the Technical Data Sheet first.";
  }
  if (hand.commercial) return null;
  const groups = await projectDriveGroups(projectId);
  return groups.length > 0 && groups.every(quoted) ? null : "Save Version on Commercial first.";
}

// GET /api/projects/[id]/review — the saved documents, and what still needs saving
// before it can be reviewed.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return error("Invalid project id", 400);
  const notYours = await viewDenied(req, { projectId: id });
  if (notYours) return notYours;
  const [p] = await db
    .select({ orderType: projects.orderType, technicalOverride: projects.technicalStatusOverride, commercialOverride: projects.commercialStatusOverride })
    .from(projects)
    .where(eq(projects.id, id))
    .limit(1);
  if (!p) return error("Project not found", 404);
  const [missing, docs] = await Promise.all([notSaved(id, p.orderType, handDoneOf(p)), loadSavedDocs(id)]);
  return json({ missing, docs });
}

// POST /api/projects/[id]/review {action: "reviewed" | "send", docs?} — marks the saved
// versions as reviewed, then records them as sent to operation. Only who can work on
// the enquiry (the assigned person, the managers). Sending puts them on Operation's Pump
// Docs / Spare Docs (/api/operation-docs); nothing is e-mailed. A Save Version clears both
// (REVIEW_CLEARED), so what was reviewed is what they see. Audited.
// docs (a pump's): which of technical / commercial / techno go to operation (user,
// 2026-11-17), picked on Review and kept on projects.operation_docs; left out = as
// picked before (else all). A spare has only its quotation.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  let claims;
  try {
    claims = await decodeToken(req);
  } catch (e) {
    if (e instanceof AuthError) return error(e.message, e.statusCode);
    throw e;
  }
  const { id } = await params;
  if (!UUID.test(id)) return error("Invalid project id", 400);
  const noWork = await workDenied(req, { projectId: id });
  if (noWork) return noWork;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return error("Request body must be JSON", 400);
  }
  const action = body.action;
  if (action !== "reviewed" && action !== "send") return error("'action' must be reviewed or send", 400);
  let docs: SavedDocKind[] | undefined;
  if (body.docs !== undefined) {
    if (!Array.isArray(body.docs) || body.docs.some((d) => !SAVED_DOC_KINDS.includes(d as SavedDocKind))) {
      return error("'docs' must list technical, commercial or techno", 400);
    }
    docs = SAVED_DOC_KINDS.filter((k) => (body.docs as unknown[]).includes(k));
    if (docs.length === 0) return error("Pick at least one document to send to operation.", 400);
  }

  const [p] = await db
    .select({
      code: projects.projectCode,
      orderType: projects.orderType,
      reviewedAt: projects.reviewedAt,
      releasedAt: projects.releasedToOperationAt,
      operationDocs: projects.operationDocs,
      links: projects.docLinks,
      technicalOverride: projects.technicalStatusOverride,
      commercialOverride: projects.commercialStatusOverride,
    })
    .from(projects)
    .where(eq(projects.id, id))
    .limit(1);
  if (!p) return error("Project not found", 404);

  const who = UUID.test(claims.sub) ? claims.sub : null;
  const now = new Date();
  // A spare's one document always goes.
  const picked = p.orderType === "spare" ? null : (docs ?? operationDocKinds(p.operationDocs));
  const pickedSet = docs && p.orderType !== "spare" ? { operationDocs: docs } : {};
  // Client's own format: every document to send needs its SharePoint link.
  const links = docLinksOrNull(p.links);
  const toSend: DocLinkKind[] = p.orderType === "spare" ? ["commercial"] : (picked ?? SAVED_DOC_KINDS);
  if (links) {
    const noLink = missingDocLinks(p.orderType, toSend, links);
    if (noLink) return error(noLink, 409);
  } else {
    // Completed by hand, nothing generated: it can go only as a SharePoint link.
    const none = ungeneratedDocsProblem(p.orderType, toSend, await generatedKinds(id, p.orderType), links);
    if (none) return error(none, 409);
  }
  if (action === "reviewed") {
    if (p.reviewedAt) return error("This version is already reviewed.", 409);
    const missing = await notSaved(id, p.orderType, handDoneOf(p));
    if (missing) return error(missing, 409);
    await db.update(projects).set({ reviewedAt: now, reviewedBy: who, ...pickedSet }).where(eq(projects.id, id));
  } else {
    if (!p.reviewedAt) return error("Review this version before sending it to operation.", 409);
    if (p.releasedAt) return error("This version is already sent to operation.", 409);
    await db.update(projects).set({ releasedToOperationAt: now, releasedToOperationBy: who, ...pickedSet }).where(eq(projects.id, id));
  }
  await logAudit(req, {
    action: action === "reviewed" ? "enquiry.reviewed" : "enquiry.sent_to_operation",
    entity: "projects",
    entityId: id,
    detail: `${p.code}: ${action === "reviewed" ? "saved versions reviewed" : "sent to operation"}${picked ? ` (${picked.join(", ")})` : ""}`,
  });
  return json({
    reviewed_at: action === "reviewed" ? now : p.reviewedAt,
    released_to_operation_at: action === "send" ? now : null,
    operation_docs: picked,
  });
}
