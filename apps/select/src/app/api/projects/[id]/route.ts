import { eq } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import { error, isUniqueViolation, json, projectToDict } from "@/lib/api";
import { AuthError, decodeToken, requireEnquiryManager, type TokenClaims } from "@/lib/auth";
import { db } from "@/lib/db";
import { projects, users } from "@/lib/db/schema";
import { canSeeProject } from "@/lib/enquiry-access";
import { clientDetailsFrom, orderTypeFrom } from "@/lib/enquiry-fields";

const assignee = alias(users, "assignee");

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Reading an enquiry: any signed-in user who may see it (a worker only the
// ones assigned to them). Editing and deleting: the User-Master and system
// admins only (lib/roles.ts) - a worker cannot change an enquiry's details.
async function guard(
  req: Request,
  check: (req: Request) => Promise<TokenClaims>,
): Promise<{ claims: TokenClaims; denied: null } | { claims: null; denied: Response }> {
  try {
    return { claims: await check(req), denied: null };
  } catch (e) {
    if (e instanceof AuthError) return { claims: null, denied: error(e.message, e.statusCode) };
    throw e;
  }
}

// Nullable free-text/enum columns: "" clears them to NULL, anything else trims.
function textOrNull(v: unknown): string | null {
  if (v === null || v === undefined || String(v).trim() === "") return null;
  return String(v).trim();
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { claims, denied } = await guard(req, decodeToken);
  if (denied) return denied;

  const { id } = await params;
  if (!UUID_RE.test(id)) return error("Invalid project id", 400);
  // Not assigned to this worker reads as not found, like a deleted one.
  if (!(await canSeeProject(claims, id))) return error("Project not found", 404);

  const [project] = await db
    .select({ project: projects, createdByName: users.name, assignedToName: assignee.name })
    .from(projects)
    .leftJoin(users, eq(projects.createdBy, users.id))
    .leftJoin(assignee, eq(projects.assignedTo, assignee.id))
    .where(eq(projects.id, id))
    .limit(1);
  if (!project) return error("Project not found", 404);

  return json(projectToDict(project.project, project.createdByName, project.assignedToName));
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { denied } = await guard(req, requireEnquiryManager);
  if (denied) return denied;

  const { id } = await params;
  if (!UUID_RE.test(id)) return error("Invalid project id", 400);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return error("Request body must be JSON", 400);
  }

  const patch: Partial<typeof projects.$inferInsert> = {};

  // name is NOT NULL — reject a blank rather than nulling it.
  if ("name" in body) {
    const n = String(body.name ?? "").trim();
    if (!n) return error("'name' can't be empty", 400);
    patch.name = n;
  }
  // Enquiry no. (project_code) is also NOT NULL and UNIQUE — accepted from
  // either projectCode or project_code so client code doesn't have to pick.
  const rawCode = "projectCode" in body ? body.projectCode
    : "project_code" in body ? body.project_code
    : undefined;
  if (rawCode !== undefined) {
    const c = String(rawCode ?? "").trim();
    if (!c) return error("'project_code' (Enquiry no.) can't be empty", 400);
    patch.projectCode = c;
  }
  if ("customerName" in body) patch.customerName = textOrNull(body.customerName);
  if ("clientCode" in body) patch.clientCode = textOrNull(body.clientCode);
  if ("industry" in body) patch.industry = textOrNull(body.industry);
  if ("remarks" in body) patch.remarks = textOrNull(body.remarks);
  if ("enquiryDate" in body) {
    const d = textOrNull(body.enquiryDate);
    if (d !== null && (!/^\d{4}-\d{2}-\d{2}$/.test(d) || Number.isNaN(Date.parse(`${d}T00:00:00Z`)))) {
      return error("'enquiryDate' must be a date (YYYY-MM-DD)", 400);
    }
    patch.enquiryDate = d;
  }
  if ("status" in body) {
    const s = textOrNull(body.status);
    if (s === null) return error("'status' can't be empty", 400);
    patch.status = s;
  }
  if ("orderType" in body) {
    const t = orderTypeFrom(body.orderType);
    if (!t) return error("'orderType' must be pump or spare", 400);
    patch.orderType = t;
  }
  Object.assign(patch, clientDetailsFrom(body));

  if (Object.keys(patch).length === 0) {
    return error("No editable fields provided", 400);
  }
  patch.updatedAt = new Date();

  let updated: typeof projects.$inferSelect | undefined;
  try {
    [updated] = await db
      .update(projects)
      .set(patch)
      .where(eq(projects.id, id))
      .returning();
  } catch (e) {
    if (isUniqueViolation(e)) {
      return error(`Enquiry no. "${patch.projectCode}" already exists`, 409);
    }
    throw e;
  }
  if (!updated) return error("Project not found", 404);

  const nameOf = async (userId: string | null) => {
    if (!userId) return null;
    const [u] = await db.select({ name: users.name }).from(users).where(eq(users.id, userId)).limit(1);
    return u?.name ?? null;
  };

  return json(projectToDict(updated, await nameOf(updated.createdBy), await nameOf(updated.assignedTo)));
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { denied } = await guard(req, requireEnquiryManager);
  if (denied) return denied;

  const { id } = await params;
  if (!UUID_RE.test(id)) return error("Invalid project id", 400);

  // pump_selection_input rows for this project cascade-delete via its FK.
  const [deleted] = await db
    .delete(projects)
    .where(eq(projects.id, id))
    .returning();
  if (!deleted) return error("Project not found", 404);

  return json({ id: deleted.id, deleted: true });
}
