import { and, eq } from "drizzle-orm";

import { error, json } from "@/lib/api";
import { logAudit } from "@/lib/audit";
import { AuthError, decodeToken } from "@/lib/auth";
import { SPARE_GROUP } from "@/lib/commercial";
import { projectDriveGroups } from "@/lib/commercial-server";
import { db } from "@/lib/db";
import { projects, quotation, quotationVersion, techDocVersion } from "@/lib/db/schema";
import { viewDenied, workDenied } from "@/lib/enquiry-access";
import { loadSavedDocs } from "@/lib/saved-docs-server";
import { techDocGroups, techDocSheet } from "@/lib/tech-doc";
import { loadTechDocData } from "@/lib/tech-doc-server";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f-]{36}$/i;

/** What still needs Save Version before this enquiry version can be reviewed, or null. */
async function notSaved(projectId: string, orderType: string): Promise<string | null> {
  const saved = await db
    .selectDistinct({ group: quotation.driveGroup })
    .from(quotation)
    .innerJoin(quotationVersion, eq(quotationVersion.quotationId, quotation.id))
    .where(and(eq(quotation.projectId, projectId), eq(quotationVersion.track, "client")));
  const quoted = (g: string) => saved.some((s) => s.group === g);
  if (orderType === "spare") return quoted(SPARE_GROUP) ? null : "Save Version on the quotation first.";

  // Every sheet that has confirmed tags. A pump other than PCP may have none to save.
  const data = await loadTechDocData(projectId);
  if (data) {
    const sheets = await db.selectDistinct({ group: techDocVersion.driveGroup }).from(techDocVersion).where(eq(techDocVersion.projectId, projectId));
    const needed = techDocGroups(data).filter((g) => techDocSheet(data, g).tags.length > 0);
    if (!needed.every((g) => sheets.some((s) => s.group === g))) return "Save Version on the Technical Data Sheet first.";
  }
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
  const [p] = await db.select({ orderType: projects.orderType }).from(projects).where(eq(projects.id, id)).limit(1);
  if (!p) return error("Project not found", 404);
  const [missing, docs] = await Promise.all([notSaved(id, p.orderType), loadSavedDocs(id)]);
  return json({ missing, docs });
}

// POST /api/projects/[id]/review {action: "reviewed" | "send"} — marks the saved
// versions as reviewed, then records them as sent to operation. Only who can work on
// the enquiry (the assigned person, the managers). Sending puts them on Operation's Pump
// Docs / Spare Docs (/api/operation-docs); nothing is e-mailed. A Save Version clears both
// (REVIEW_CLEARED), so what was reviewed is what they see. Audited.
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

  const [p] = await db
    .select({
      code: projects.projectCode,
      orderType: projects.orderType,
      reviewedAt: projects.reviewedAt,
      releasedAt: projects.releasedToOperationAt,
    })
    .from(projects)
    .where(eq(projects.id, id))
    .limit(1);
  if (!p) return error("Project not found", 404);

  const who = UUID.test(claims.sub) ? claims.sub : null;
  const now = new Date();
  if (action === "reviewed") {
    if (p.reviewedAt) return error("This version is already reviewed.", 409);
    const missing = await notSaved(id, p.orderType);
    if (missing) return error(missing, 409);
    await db.update(projects).set({ reviewedAt: now, reviewedBy: who }).where(eq(projects.id, id));
  } else {
    if (!p.reviewedAt) return error("Review this version before sending it to operation.", 409);
    if (p.releasedAt) return error("This version is already sent to operation.", 409);
    await db.update(projects).set({ releasedToOperationAt: now, releasedToOperationBy: who }).where(eq(projects.id, id));
  }
  await logAudit(req, {
    action: action === "reviewed" ? "enquiry.reviewed" : "enquiry.sent_to_operation",
    entity: "projects",
    entityId: id,
    detail: `${p.code}: ${action === "reviewed" ? "saved versions reviewed" : "sent to operation"}`,
  });
  return json({
    reviewed_at: action === "reviewed" ? now : p.reviewedAt,
    released_to_operation_at: action === "send" ? now : null,
  });
}
