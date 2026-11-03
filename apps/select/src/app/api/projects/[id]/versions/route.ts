import { desc, eq, or } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import { error, isUniqueViolation, json, projectToDict } from "@/lib/api";
import { logAudit } from "@/lib/audit";
import { AuthError, decodeToken, requireEnquiryManager } from "@/lib/auth";
import { db } from "@/lib/db";
import { projects, users } from "@/lib/db/schema";
import { findAssignee, viewDenied } from "@/lib/enquiry-access";
import { enquiryStatusColumns, enquiryStatusFields, enquiryStatusSql } from "@/lib/enquiry-filters-server";
import { RevisionError, createRevision } from "@/lib/enquiry-revision";
import { enquiryNoWithVersions } from "@/lib/roles";

const assignee = alias(users, "assignee");

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** GET - every version of the enquiry, newest first (the Versions pop-up). */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await decodeToken(req);
  } catch (e) {
    if (e instanceof AuthError) return error(e.message, e.statusCode);
    throw e;
  }
  const { id } = await params;
  if (!UUID_RE.test(id)) return error("Invalid project id", 400);
  const notYours = await viewDenied(req, { projectId: id });
  if (notYours) return notYours;

  const [me] = await db.select({ id: projects.id, root: projects.rootProjectId }).from(projects).where(eq(projects.id, id)).limit(1);
  if (!me) return error("Project not found", 404);
  const root = me.root ?? me.id;

  const rows = await db
    .select({ project: projects, ...enquiryStatusColumns, createdByName: users.name, assignedToName: assignee.name })
    .from(projects)
    .leftJoin(users, eq(projects.createdBy, users.id))
    .leftJoin(assignee, eq(projects.assignedTo, assignee.id))
    .where(or(eq(projects.id, root), eq(projects.rootProjectId, root)))
    .orderBy(desc(projects.versionNo));
  return json(rows.map((r) => ({ ...projectToDict(r.project, r.createdByName, r.assignedToName), ...enquiryStatusFields(r.project, r) })));
}

/** POST {enquiryDate, assignedTo, note?} - the next version of a technically Completed
 *  enquiry, copied from its latest version (lib/enquiry-revision.ts). User-Master
 *  and system admins only. Audited; the assignee is told by the portal's bell. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  let claims;
  try {
    claims = await requireEnquiryManager(req);
  } catch (e) {
    if (e instanceof AuthError) return error(e.message, e.statusCode);
    throw e;
  }
  const { id } = await params;
  if (!UUID_RE.test(id)) return error("Invalid project id", 400);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return error("Request body must be JSON", 400);
  }

  const [found] = await db.select({ source: projects, status: enquiryStatusSql }).from(projects).where(eq(projects.id, id)).limit(1);
  if (!found) return error("Project not found", 404);
  const { source, status } = found;
  if (!source.isLatest) return error("Only the latest version of an enquiry can be revised.", 409);
  if (status !== "Completed") return error("The Technical status of the latest version has to be Completed before it can be revised.", 409);

  const enquiryDate = String(body.enquiryDate ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(enquiryDate) || Number.isNaN(Date.parse(`${enquiryDate}T00:00:00Z`))) {
    return error("'enquiryDate' is required (YYYY-MM-DD)", 400);
  }
  if (source.enquiryDate && enquiryDate < source.enquiryDate) {
    return error("The revised enquiry date can't be before the previous version's date.", 400);
  }
  const target = await findAssignee(claims.sub, String(body.assignedTo ?? "").trim());
  if (!target) return error("Pick a worker (or yourself) to assign the new version to", 400);
  const note = typeof body.note === "string" ? body.note.trim().slice(0, 2000) : "";
  // A spare has no technical side, so its version is always both.
  const kind = body.kind === "technical" && source.orderType !== "spare" ? ("technical" as const) : ("both" as const);

  let created;
  try {
    created = await createRevision(source, { enquiryDate, assignedTo: target.id, note: note || null, createdBy: claims.sub, kind });
  } catch (e) {
    if (e instanceof RevisionError) return error(e.message, e.status);
    if (isUniqueViolation(e)) return error("A newer version of this enquiry already exists.", 409);
    throw e;
  }

  await logAudit(req, {
    action: "enquiry.revise",
    entity: "projects",
    entityId: created.id,
    detail: `${enquiryNoWithVersions(source.projectCode, created.versionNo, created.commercialVersionNo)} created from V${source.versionNo} (${kind === "both" ? "Technical and Commercial" : "Technical only"}), assigned to ${target.name || target.email}${note ? ` - ${note.slice(0, 300)}` : ""}`,
  });
  return json(projectToDict(created, null, target.name), 201);
}
