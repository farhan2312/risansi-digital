import { and, desc, eq, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import { error, isUniqueViolation, json, projectToDict } from "@/lib/api";
import { AuthError, requireEnquiryManager, tryDecodeToken } from "@/lib/auth";
import { db } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { enquiryTags, projects, quotation, users } from "@/lib/db/schema";
import { findAssignee } from "@/lib/enquiry-access";
import type { ClearanceNow } from "@/lib/clearance";
import { filtersFromParams } from "@/lib/enquiry-filters";
import { enquiryFilterSql, enquiryStatusColumns, enquiryStatusFields } from "@/lib/enquiry-filters-server";
import { repScope } from "@/lib/rep-scope";
import { orderSubtypeLabel, orderTypeLabel } from "@/lib/roles";
import { clientDetailsFrom, orderSubtypeFrom, orderTypeFrom } from "@/lib/enquiry-fields";

const assignee = alias(users, "assignee");

export const dynamic = "force-dynamic";

// Pagination is opt-in: a request with no `page` param returns the plain,
// unpaginated array it always did. The Dashboard rolls its stat cards up
// across every enquiry and the Copy-tag picker has to offer all of them, so
// both still want the whole list; only the Enquiries table pages.
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

export async function GET(req: Request) {
  // Left-join users so the list can show a real "Created By" name - created_by
  // on the project row is just a user id, not a display name.
  //
  // The two statuses are worked out in SQL (lib/enquiry-filters-server.ts) so the
  // Dashboard, Projects list and Reports list all agree without an extra client
  // round-trip. projects.status is left in place but no longer read by the app.

  // Filters live here rather than in the browser: with pagination the client
  // only holds one page, so filtering there would search 20 rows instead of
  // the whole table. Case-insensitive substring on the same two columns the
  // Enquiries filter bar has always used. `%` and `_` are escaped so a code
  // containing them is matched literally rather than as a wildcard.
  const params = new URL(req.url).searchParams;
  const like = (value: string) =>
    `%${value.trim().replace(/([\\%_])/g, "\\$1")}%`;

  const conditions: SQL[] = [];
  const caller = await tryDecodeToken(req);
  const clientName = params.get("clientName");
  if (clientName && clientName.trim()) {
    conditions.push(sql`${projects.name} ILIKE ${like(clientName)}`);
  }
  const enquiryCode = params.get("enquiryCode");
  if (enquiryCode && enquiryCode.trim()) {
    conditions.push(sql`${projects.projectCode} ILIKE ${like(enquiryCode)}`);
  }
  // Date window: ISO instants (the client converts picked calendar days to
  // its own time zone). Unparseable values are ignored. dateField picks the
  // date: "enquiry" (default - the date the enquiry was received, a calendar
  // day, compared as the instant's IST day), "assigned" or "created".
  const instant = (v: string | null) => {
    const d = v ? new Date(v) : null;
    return d && !Number.isNaN(d.getTime()) ? d : null;
  };
  const windowFrom = instant(params.get("from"));
  const windowTo = instant(params.get("to"));
  const dateField = params.get("dateField");
  if (dateField === "assigned" || dateField === "created") {
    const col = dateField === "assigned" ? projects.assignedAt : projects.createdAt;
    if (windowFrom) conditions.push(sql`${col} >= ${windowFrom}`);
    if (windowTo) conditions.push(sql`${col} <= ${windowTo}`);
  } else {
    const istDay = (d: Date) => sql`(${d.toISOString()}::timestamptz at time zone 'Asia/Kolkata')::date`;
    if (windowFrom) conditions.push(sql`${projects.enquiryDate} >= ${istDay(windowFrom)}`);
    if (windowTo) conditions.push(sql`${projects.enquiryDate} <= ${istDay(windowTo)}`);
  }
  // Client / reps / zone / market / industry / status (shared with the Dashboard).
  conditions.push(...enquiryFilterSql(filtersFromParams(params)));
  // A Rep / Rep Manager sees only their own enquiries (`rep` = one of a
  // manager's reps, or themselves).
  const repCond = caller ? await repScope(caller, params.get("rep")) : null;
  if (repCond) conditions.push(repCond);
  // "Assigned to me" toggle (the default for a worker - everyone sees every
  // enquiry, lib/roles.ts).
  if (params.get("mine") === "1") {
    conditions.push(caller ? eq(projects.assignedTo, caller.sub) : sql`false`);
  }
  const where = conditions.length ? and(...conditions) : undefined;

  const pageRaw = params.get("page");
  const paginated = pageRaw !== null;
  const page = Math.max(1, Math.trunc(Number(pageRaw)) || 1);
  const pageSize = Math.min(
    MAX_PAGE_SIZE,
    Math.max(1, Math.trunc(Number(params.get("pageSize"))) || DEFAULT_PAGE_SIZE),
  );

  const base = db
    .select({
      project: projects,
      ...enquiryStatusColumns,
      createdByName: users.name,
      assignedToName: assignee.name,
      // Commercial opens only once the Quotation step has generated one.
      quotationCount: sql<number>`(SELECT count(*)::int FROM ${quotation} q WHERE q.project_id = ${projects.id})`,
      // The newest row of the clearance history.
      clearance: sql<ClearanceNow | null>`(
        SELECT jsonb_build_object('status', c.status, 'group', c.reason_group, 'reason', c.reason, 'remarks', c.remarks, 'at', c.created_at)
        FROM enquiry_clearance c WHERE c.project_id = projects.id ORDER BY c.created_at DESC LIMIT 1
      )`,
    })
    .from(projects)
    .leftJoin(users, eq(projects.createdBy, users.id))
    .leftJoin(assignee, eq(projects.assignedTo, assignee.id))
    .where(where)
    .orderBy(desc(projects.createdAt));

  const rows = paginated
    ? await base.limit(pageSize).offset((page - 1) * pageSize)
    : await base;

  const items = rows.map((r) => ({
    ...projectToDict(r.project, r.createdByName, r.assignedToName),
    // Overwrites status with the Technical status, so everything reading the
    // list's status gets it.
    ...enquiryStatusFields(r.project, r),
    quotation_count: r.quotationCount,
    clearance: r.clearance,
  }));

  if (!paginated) return json(items);

  const [{ total }] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(projects)
    .where(where);

  return json({
    items,
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  });
}

export async function POST(req: Request) {
  // Only the User-Master (and system admins) create enquiries.
  let claims;
  try {
    claims = await requireEnquiryManager(req);
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

  const name = body.name;
  if (!name) {
    return error("'name' is required", 400);
  }

  // Enquiry no. (stored as project_code — column kept for compatibility) is
  // now user-supplied and required on create, replacing the earlier auto-
  // generated PRJ-NNN scheme. Uniqueness stays enforced by the DB constraint;
  // a duplicate falls through to the catch below and returns 409.
  const projectCode = String(body.project_code ?? body.projectCode ?? "").trim();
  if (!projectCode) {
    return error("'project_code' (Enquiry no.) is required", 400);
  }

  // Enquiry date: a calendar day (YYYY-MM-DD). Required on create.
  const enquiryDate = String(body.enquiryDate ?? body.enquiry_date ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(enquiryDate) || Number.isNaN(Date.parse(`${enquiryDate}T00:00:00Z`))) {
    return error("'enquiryDate' is required (YYYY-MM-DD)", 400);
  }

  // Derived from the verified session cookie, not client input — a client
  // could otherwise attribute a project to any arbitrary user id.
  const createdBy = claims.sub;

  const orderType = orderTypeFrom(body.orderType);
  if (!orderType) return error("'orderType' must be pump or spare", 400);
  const orderSubtype = orderSubtypeFrom(orderType, body.orderSubtype);
  if (!orderSubtype) return error(`Pick a ${orderTypeLabel(orderType).toLowerCase()} type`, 400);

  // Assigned to a worker or the master; the creator when none is picked.
  const assignedToId = String(body.assignedTo ?? "").trim() || createdBy;
  const assignedTo = await findAssignee(createdBy, assignedToId);
  if (!assignedTo) return error("Pick a worker (or yourself) to assign the enquiry to", 400);

  let project: typeof projects.$inferSelect;
  try {
    [project] = await db
      .insert(projects)
      .values({
        projectCode,
        name: String(name),
        customerName: (body.customer as string) ?? null,
        industry: (body.industry as string) ?? null,
        enquiryDate,
        remarks: (body.remarks as string) ?? null,
        clientCode: (body.clientCode as string) ?? "Pending",
        // New projects start "Pending" — flips to "In Progress" once General
        // Information is saved, "Completed" once the final report is generated.
        status: (body.status as string) ?? "Pending",
        createdBy,
        orderType,
        orderSubtype,
        assignedTo: assignedTo.id,
        assignedBy: createdBy,
        assignedAt: new Date(),
        // Their bell tells them, unless the creator kept it.
        assigneeUnread: assignedTo.id !== createdBy,
        ...clientDetailsFrom(body),
      })
      .returning();
  } catch (e) {
    // unique_violation on project_code (the DB constraint enforces Enquiry-no.
    // uniqueness; the client sees a friendly 409 rather than a 500).
    if (isUniqueViolation(e)) {
      return error(`Enquiry no. "${projectCode}" already exists`, 409);
    }
    throw e;
  }

  // Every new project starts with one "Default" tag so the wizard has
  // something to key its rows against - the tag_id column on the wizard
  // tables is NOT NULL, so a project with no tag can't hold any wizard
  // data. Without this, the Open button on a tag row would 404 because
  // no tag exists yet.
  // A spare order has no tags: it is quoted part by part on its Commercial page.
  if (orderType !== "spare") await db.insert(enquiryTags).values({ projectId: project.id, name: "Default" });

  const [creator] = await db.select({ name: users.name }).from(users).where(eq(users.id, createdBy)).limit(1);
  const createdByName = creator?.name ?? null;
  const assignedName = assignedTo.name || assignedTo.email;

  await logAudit(req, {
    action: "enquiry.create",
    entity: "projects",
    entityId: project.id,
    detail: `Created enquiry ${project.projectCode} (${orderTypeLabel(orderType)} - ${orderSubtypeLabel(orderSubtype)}), assigned to ${assignedName}`,
  });

  return json(projectToDict(project, createdByName, assignedTo.name), 201);
}
