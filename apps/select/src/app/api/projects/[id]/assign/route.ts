import { eq } from "drizzle-orm";

import { error, json } from "@/lib/api";
import { AuthError, requireEnquiryManager } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { db } from "@/lib/db";
import { projects, users } from "@/lib/db/schema";
import { findAssignee } from "@/lib/enquiry-access";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** POST {assignedTo} - assign or reassign an enquiry to a worker or to the
 *  caller. User-Master and system admins only. Audited (old -> new); no
 *  e-mail (user, 2026-10-31). */
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

  const target = await findAssignee(claims.sub, String(body.assignedTo ?? "").trim());
  if (!target) return error("Pick a worker (or yourself) to assign the enquiry to", 400);

  const [current] = await db
    .select({ code: projects.projectCode, assignedTo: projects.assignedTo })
    .from(projects)
    .where(eq(projects.id, id))
    .limit(1);
  if (!current) return error("Project not found", 404);
  if (current.assignedTo === target.id) return json({ id, assigned_to: target.id, assigned_to_name: target.name, unchanged: true });

  const [before] = current.assignedTo
    ? await db.select({ name: users.name, email: users.email }).from(users).where(eq(users.id, current.assignedTo)).limit(1)
    : [];
  const now = new Date();
  await db
    .update(projects)
    .set({ assignedTo: target.id, assignedBy: claims.sub, assignedAt: now, updatedAt: now })
    .where(eq(projects.id, id));

  const fromName = before ? before.name || before.email : "nobody";
  await logAudit(req, {
    action: current.assignedTo ? "enquiry.reassign" : "enquiry.assign",
    entity: "projects",
    entityId: id,
    detail: `Enquiry ${current.code}: ${fromName} -> ${target.name || target.email}`,
  });

  return json({ id, assigned_to: target.id, assigned_to_name: target.name, assigned_at: now });
}
