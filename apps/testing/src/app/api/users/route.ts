import bcrypt from "bcryptjs";
import { and, asc, eq, ilike, inArray, or, sql } from "drizzle-orm";

import { error, json, userToDict } from "@/lib/api";
import { getClientIp, logAudit } from "@/lib/audit";
import { AuthError, requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { offsetFor, PAGE_SIZE, parsePage } from "@/lib/pagination";

export const dynamic = "force-dynamic";

const ROLES = ["source", "testing", "central-admin", "admin"];

/** Server-paginated, 25/page, with optional `search` (name/email),
 * `role`, and `status` filters. Also returns `stats` -- unfiltered counts
 * (total/pending/active/admins) for the Users & Access page's KPI tiles,
 * which must reflect the whole table regardless of the current filter/page.
 *
 * Exception: a bare `status=pending` query (no search/role/page) -- the
 * shape DashboardLayout's pending-badge poll and the Pending Requests panel
 * both rely on -- returns every pending row unpaginated. That queue is
 * inherently small (bounded by how often admins review it), and both of
 * those callers need the complete set, not one page of it. */
export async function GET(req: Request) {
  try {
    await requireAdmin(req);
  } catch (e) {
    if (e instanceof AuthError) return error(e.message, e.statusCode);
    throw e;
  }

  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status");
  const role = searchParams.get("role");
  const search = searchParams.get("search")?.trim();
  const page = parsePage(req);

  const conditions = [];
  if (status) conditions.push(eq(users.status, status));
  if (role) conditions.push(eq(users.role, role));
  if (search) {
    const like = `%${search}%`;
    conditions.push(or(ilike(users.name, like), ilike(users.email, like))!);
  }
  const where = conditions.length ? and(...conditions) : undefined;

  const isPendingQueueQuery = status === "pending" && !role && !search && !searchParams.has("page");
  if (isPendingQueueQuery) {
    const rows = await db.select().from(users).where(where).orderBy(asc(users.createdAt));
    // Pending rows are never reviewed yet (reviewed_by is always null here --
    // a resubmitted "rejected" account gets reviewedBy reset to null too,
    // see POST /api/access-requests), so no reviewer name lookup needed.
    return json({
      entries: rows.map((r) => ({ ...userToDict(r), reviewed_by_name: null })),
      total: rows.length,
      page: 1,
      page_size: rows.length,
    });
  }

  const [rows, [{ count }], [stats]] = await Promise.all([
    db.select().from(users).where(where).orderBy(asc(users.createdAt)).limit(PAGE_SIZE).offset(offsetFor(page)),
    db.select({ count: sql<number>`count(*)::int` }).from(users).where(where),
    db
      .select({
        total: sql<number>`count(*)::int`,
        pending: sql<number>`count(*) filter (where status = 'pending')::int`,
        active: sql<number>`count(*) filter (where status = 'active')::int`,
        admins: sql<number>`count(*) filter (where role in ('admin', 'central-admin'))::int`,
      })
      .from(users),
  ]);

  // "Reviewed" column needs the reviewer's name, not just reviewed_by's raw
  // uuid -- one batched lookup for every distinct reviewer on this page.
  const reviewerIds = [...new Set(rows.map((r) => r.reviewedBy).filter((id): id is string => Boolean(id)))];
  const reviewerNameById = new Map(
    reviewerIds.length
      ? (await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, reviewerIds))).map(
          (r) => [r.id, r.name]
        )
      : []
  );

  return json({
    entries: rows.map((r) => ({
      ...userToDict(r),
      reviewed_by_name: r.reviewedBy ? (reviewerNameById.get(r.reviewedBy) ?? null) : null,
    })),
    total: count,
    page,
    page_size: PAGE_SIZE,
    stats,
  });
}

/** Admin-only direct account creation -- unlike the public /access-requests
 * signup, this skips the pending-review step (the admin creating the
 * account *is* the approval) and can assign any role, including
 * central-admin/admin which aren't self-serviceable from the login screen. */
export async function POST(req: Request) {
  let claims;
  try {
    claims = await requireAdmin(req);
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

  const name = String(body.name ?? "").trim();
  const email = String(body.email ?? "").trim().toLowerCase();
  const password = String(body.password ?? "");
  const role = String(body.role ?? "");

  if (!name || !email || !password) {
    return error("'name', 'email', and 'password' are required", 400);
  }
  if (!ROLES.includes(role)) {
    return error(`'role' must be one of: ${ROLES.join(", ")}`, 400);
  }
  if (password.length < 6) {
    return error("Password must be at least 6 characters.", 400);
  }

  const [existing] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (existing) {
    return error("An account with this email already exists.", 409);
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const [user] = await db
    .insert(users)
    .values({
      name,
      email,
      passwordHash,
      role,
      status: "active",
      reviewedBy: claims.sub,
      reviewedAt: new Date(),
      mustChangePassword: true,
    })
    .returning();

  await logAudit({
    ipAddress: getClientIp(req),
    userId: claims.sub,
    userEmail: claims.email,
    eventType: "create",
    entityType: "user",
    entityId: user.id,
    entityLabel: user.email,
    details: `Created directly by admin with role ${role}`,
  });

  return json(userToDict(user), 201);
}
