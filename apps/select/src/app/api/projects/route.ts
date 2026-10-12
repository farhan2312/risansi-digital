import { and, desc, eq, sql, type SQL } from "drizzle-orm";

import { error, isUniqueViolation, json, projectToDict } from "@/lib/api";
import { tryDecodeToken } from "@/lib/auth";
import { db } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { enquiryTags, projects, users } from "@/lib/db/schema";

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
  // Status is now DERIVED from the enquiry's tags rather than read straight
  // from projects.status: an enquiry rolls up to Completed only when EVERY
  // tag under it is Completed, Pending only when every tag is Pending, and
  // In Progress otherwise (any mix, or any tag in progress). Rolled up in
  // SQL so the Dashboard, Projects list and Reports list all agree without
  // an extra client round-trip. projects.status is left in place but no
  // longer read by the app; the wizard writes to enquiry_tags.status now.
  const rollup = sql<string>`(
    SELECT CASE
      WHEN COUNT(*) FILTER (WHERE t.status = 'Completed') = COUNT(*)
           AND COUNT(*) > 0
        THEN 'Completed'
      WHEN COUNT(*) FILTER (WHERE t.status = 'Pending') = COUNT(*)
           AND COUNT(*) > 0
        THEN 'Pending'
      WHEN COUNT(*) = 0
        THEN ${projects.status}
      ELSE 'In Progress'
    END
    FROM ${enquiryTags} t
    WHERE t.project_id = ${projects.id}
  )`;

  // Filters live here rather than in the browser: with pagination the client
  // only holds one page, so filtering there would search 20 rows instead of
  // the whole table. Case-insensitive substring on the same two columns the
  // Enquiries filter bar has always used. `%` and `_` are escaped so a code
  // containing them is matched literally rather than as a wildcard.
  const params = new URL(req.url).searchParams;
  const like = (value: string) =>
    `%${value.trim().replace(/([\\%_])/g, "\\$1")}%`;

  const conditions: SQL[] = [];
  const clientName = params.get("clientName");
  if (clientName && clientName.trim()) {
    conditions.push(sql`${projects.name} ILIKE ${like(clientName)}`);
  }
  const enquiryCode = params.get("enquiryCode");
  if (enquiryCode && enquiryCode.trim()) {
    conditions.push(sql`${projects.projectCode} ILIKE ${like(enquiryCode)}`);
  }
  // Created-date window: ISO instants (the client converts picked calendar
  // days to its own time zone). Unparseable values are ignored.
  const instant = (v: string | null) => {
    const d = v ? new Date(v) : null;
    return d && !Number.isNaN(d.getTime()) ? d : null;
  };
  const createdFrom = instant(params.get("from"));
  const createdTo = instant(params.get("to"));
  if (createdFrom) conditions.push(sql`${projects.createdAt} >= ${createdFrom}`);
  if (createdTo) conditions.push(sql`${projects.createdAt} <= ${createdTo}`);
  // "Created by me" toggle: only enquiries the signed-in user created.
  if (params.get("mine") === "1") {
    const me = tryDecodeToken(req)?.sub ?? null;
    conditions.push(me ? eq(projects.createdBy, me) : sql`false`);
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
      derivedStatus: rollup,
      createdByName: users.name,
    })
    .from(projects)
    .leftJoin(users, eq(projects.createdBy, users.id))
    .where(where)
    .orderBy(desc(projects.createdAt));

  const rows = paginated
    ? await base.limit(pageSize).offset((page - 1) * pageSize)
    : await base;

  const items = rows.map((r) => ({
    ...projectToDict(r.project, r.createdByName),
    // Overwrite status with the rollup so the Dashboard's status column and
    // stat cards read the tag-aware value automatically.
    status: r.derivedStatus,
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
  const createdBy = tryDecodeToken(req)?.sub ?? null;

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
  await db.insert(enquiryTags).values({ projectId: project.id, name: "Default" });

  let createdByName: string | null = null;
  if (createdBy) {
    const [creator] = await db.select({ name: users.name }).from(users).where(eq(users.id, createdBy)).limit(1);
    createdByName = creator?.name ?? null;
  }

  await logAudit(req, {
    action: "enquiry.create",
    entity: "projects",
    entityId: project.id,
    detail: `Created enquiry ${project.projectCode}`,
  });

  return json(projectToDict(project, createdByName), 201);
}
