import { and, desc, eq, inArray, or } from "drizzle-orm";

import { error, json } from "@/lib/api";
import { AuthError, decodeToken, requireEnquiryManager } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { ASSIGNMENT_ACTIONS, REASON_SEP, assignmentEntry, type AssignmentEntry } from "@/lib/assignment-history";
import { db } from "@/lib/db";
import { auditLog, projects, users } from "@/lib/db/schema";
import { findAssignee, versionLocked, viewDenied } from "@/lib/enquiry-access";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** GET - who it was assigned to, by whom, when and why, newest first, across its
 *  versions (lib/assignment-history.ts: read from the audit trail). */
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
  const versions = await db.select({ id: projects.id }).from(projects).where(or(eq(projects.id, root), eq(projects.rootProjectId, root)));
  const rows = await db
    .select({ action: auditLog.action, detail: auditLog.detail, at: auditLog.createdAt, name: users.name, email: auditLog.userEmail })
    .from(auditLog)
    .leftJoin(users, eq(users.id, auditLog.userId))
    .where(
      and(
        eq(auditLog.entity, "projects"),
        inArray(auditLog.entityId, versions.map((v) => v.id)),
        inArray(auditLog.action, [...ASSIGNMENT_ACTIONS]),
      ),
    )
    .orderBy(desc(auditLog.createdAt))
    .limit(200);
  const out: AssignmentEntry[] = rows
    .map((r) => assignmentEntry({ action: r.action, detail: r.detail, at: (r.at ?? new Date()).toISOString(), byName: r.name || r.email || null }))
    .filter((e): e is AssignmentEntry => e !== null);
  return json(out);
}

/** POST {assignedTo, reason} - assign or reassign an enquiry to a worker or to the
 *  caller. User-Master and system admins only. Audited (old -> new, and the reason, which
 *  a reassign needs: user, 2026-11-25); no e-mail (user, 2026-10-31) - the assignee is
 *  told by the portal's bell. */
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
  const locked = await versionLocked({ projectId: id });
  if (locked) return locked;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return error("Request body must be JSON", 400);
  }

  const target = await findAssignee(claims.sub, String(body.assignedTo ?? "").trim());
  if (!target) return error("Pick a worker (or yourself) to assign the enquiry to", 400);

  const [current] = await db
    .select({ code: projects.projectCode, assignedTo: projects.assignedTo })
    .from(projects)
    .where(eq(projects.id, id))
    .limit(1);
  if (!current) return error("Project not found", 404);
  if (current.assignedTo === target.id) return json({ id, assigned_to: target.id, assigned_to_name: target.name, unchanged: true });
  const reason = typeof body.reason === "string" ? body.reason.trim().replace(/\s+/g, " ").slice(0, 500) : "";
  if (current.assignedTo && !reason) return error("Enter why it is being reassigned.", 400);

  const [before] = current.assignedTo
    ? await db.select({ name: users.name, email: users.email }).from(users).where(eq(users.id, current.assignedTo)).limit(1)
    : [];
  const now = new Date();
  await db
    .update(projects)
    // The new assignee's bell tells them (not when you take it yourself).
    .set({ assignedTo: target.id, assignedBy: claims.sub, assignedAt: now, updatedAt: now, assigneeUnread: target.id !== claims.sub })
    .where(eq(projects.id, id));

  const fromName = before ? before.name || before.email : "nobody";
  await logAudit(req, {
    action: current.assignedTo ? "enquiry.reassign" : "enquiry.assign",
    entity: "projects",
    entityId: id,
    detail: `Enquiry ${current.code}: ${fromName} -> ${target.name || target.email}${reason ? `${REASON_SEP}${reason}` : ""}`,
  });

  return json({ id, assigned_to: target.id, assigned_to_name: target.name, assigned_at: now });
}
