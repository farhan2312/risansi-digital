import { and, desc, eq, inArray, or } from "drizzle-orm";

import { error, json } from "@/lib/api";
import { AuthError, decodeToken } from "@/lib/auth";
import { ASSIGNMENT_ACTIONS, assignmentEntry, type AssignmentEntry } from "@/lib/assignment-history";
import { db } from "@/lib/db";
import { auditLog, projects, users } from "@/lib/db/schema";
import { repScope } from "@/lib/rep-scope";
import { isRepRole } from "@/lib/roles";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** POST {ids} - the assignment history of many enquiries at once, for the Enquiry Report
 *  (user, 2026-11-25): { [id]: entries, newest first, across its versions }, as
 *  GET /projects/[id]/assign gives one. A rep gets only their clients' enquiries. */
export async function POST(req: Request) {
  let claims;
  try {
    claims = await decodeToken(req);
  } catch (e) {
    if (e instanceof AuthError) return error(e.message, e.statusCode);
    throw e;
  }
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return error("Request body must be JSON", 400);
  }
  const ids = [...new Set((Array.isArray(body.ids) ? body.ids : []).map(String).filter((s) => UUID_RE.test(s)))].slice(0, 5000);
  if (ids.length === 0) return json({});

  const scope = isRepRole(claims.role) ? await repScope(claims) : null;
  const asked = await db
    .select({ id: projects.id, root: projects.rootProjectId })
    .from(projects)
    .where(scope ? and(inArray(projects.id, ids), scope) : inArray(projects.id, ids));
  if (asked.length === 0) return json({});
  const rootOf = new Map(asked.map((p) => [p.id, p.root ?? p.id]));
  const roots = [...new Set(rootOf.values())];
  const versions = await db
    .select({ id: projects.id, root: projects.rootProjectId })
    .from(projects)
    .where(or(inArray(projects.id, roots), inArray(projects.rootProjectId, roots)));
  const versionRoot = new Map(versions.map((v) => [v.id, v.root ?? v.id]));

  const rows = await db
    .select({ entityId: auditLog.entityId, action: auditLog.action, detail: auditLog.detail, at: auditLog.createdAt, name: users.name, email: auditLog.userEmail })
    .from(auditLog)
    .leftJoin(users, eq(users.id, auditLog.userId))
    .where(and(eq(auditLog.entity, "projects"), inArray(auditLog.entityId, [...versionRoot.keys()]), inArray(auditLog.action, [...ASSIGNMENT_ACTIONS])))
    .orderBy(desc(auditLog.createdAt));

  const byRoot = new Map<string, AssignmentEntry[]>();
  for (const r of rows) {
    const root = versionRoot.get(String(r.entityId));
    if (!root) continue;
    const e = assignmentEntry({ action: r.action, detail: r.detail, at: (r.at ?? new Date()).toISOString(), byName: r.name || r.email || null });
    if (!e) continue;
    const list = byRoot.get(root) ?? [];
    list.push(e);
    byRoot.set(root, list);
  }
  const out: Record<string, AssignmentEntry[]> = {};
  for (const [id, root] of rootOf) out[id] = byRoot.get(root) ?? [];
  return json(out);
}
