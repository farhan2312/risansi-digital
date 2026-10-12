import { and, desc, eq, ilike, or, sql } from "drizzle-orm";

import { bugReportToDict, error, json } from "@/lib/api";
import { getClientIp, logAudit } from "@/lib/audit";
import { AuthError, decodeToken, requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { bugReports, users } from "@/lib/db/schema";
import { PAGE_SIZE, parsePage } from "@/lib/pagination";

export const dynamic = "force-dynamic";

const MAX_FILE_BYTES = 4 * 1024 * 1024; // 4MB -- see schema.ts comment on bugReports.
const ALLOWED_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const TYPES = new Set(["bug", "feature"]);
const SEVERITIES = new Set(["Low", "Medium", "High", "Critical"]);

/** Every logged-in user can report a bug regardless of role -- admin view is
 * gated separately, on GET. Server-paginated, 25/page by default -- the
 * Kanban board's per-column infinite scroll asks for `page_size=10`
 * instead, via an explicit override (never bigger than the default, so
 * this can't become a way to bypass pagination entirely). Optional
 * `search` (title/description/reporter/page), `type`, and `severity`
 * filters narrow within a column the same way. Also returns
 * `status_counts` (unfiltered by `status`, but scoped to whatever
 * search/type/severity filter is active) so the Kanban column headers
 * reflect the current filter, not just whichever status/page is loaded. */
export async function GET(req: Request) {
  try {
    await requireAdmin(req);
  } catch (e) {
    if (e instanceof AuthError) return error(e.message, e.statusCode);
    throw e;
  }

  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status");
  const search = searchParams.get("search")?.trim();
  const type = searchParams.get("type");
  const severity = searchParams.get("severity");
  const page = parsePage(req);
  const requestedPageSize = Number(searchParams.get("page_size"));
  const pageSize =
    Number.isInteger(requestedPageSize) && requestedPageSize > 0 && requestedPageSize < PAGE_SIZE
      ? requestedPageSize
      : PAGE_SIZE;

  const sharedConditions = [];
  if (type && TYPES.has(type)) sharedConditions.push(eq(bugReports.type, type));
  if (severity && SEVERITIES.has(severity)) sharedConditions.push(eq(bugReports.severity, severity));
  if (search) {
    const like = `%${search}%`;
    sharedConditions.push(
      or(
        ilike(bugReports.title, like),
        ilike(bugReports.description, like),
        ilike(bugReports.reportedByName, like),
        ilike(bugReports.page, like)
      )!
    );
  }
  const sharedWhere = sharedConditions.length ? and(...sharedConditions) : undefined;
  const where = status
    ? sharedWhere
      ? and(eq(bugReports.status, status), sharedWhere)
      : eq(bugReports.status, status)
    : sharedWhere;

  const [rows, [{ count }], statusCounts] = await Promise.all([
    db
      .select()
      .from(bugReports)
      .where(where)
      .orderBy(desc(bugReports.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db.select({ count: sql<number>`count(*)::int` }).from(bugReports).where(where),
    db
      .select({ status: bugReports.status, count: sql<number>`count(*)::int` })
      .from(bugReports)
      .where(sharedWhere)
      .groupBy(bugReports.status),
  ]);

  return json({
    entries: rows.map(bugReportToDict),
    total: count,
    page,
    page_size: pageSize,
    status_counts: Object.fromEntries(statusCounts.map((s) => [s.status, s.count])),
  });
}

export async function POST(req: Request) {
  let claims;
  try {
    claims = await decodeToken(req);
  } catch (e) {
    if (e instanceof AuthError) return error(e.message, e.statusCode);
    throw e;
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return error("Request must be multipart/form-data", 400);
  }

  const title = String(form.get("title") ?? "").trim();
  if (!title) return error("'title' is required", 400);

  const typeRaw = String(form.get("type") ?? "bug");
  const type = TYPES.has(typeRaw) ? typeRaw : "bug";
  const severityRaw = String(form.get("severity") ?? "Medium");
  const severity = SEVERITIES.has(severityRaw) ? severityRaw : "Medium";
  const description = form.get("description") ? String(form.get("description")) : null;
  const page = form.get("page") ? String(form.get("page")).slice(0, 255) : null;

  const file = form.get("screenshot");
  let screenshotFileName: string | null = null;
  let screenshotMimeType: string | null = null;
  let screenshotFileSize: number | null = null;
  let screenshotData: Buffer | null = null;

  if (file instanceof File && file.size > 0) {
    if (!ALLOWED_MIME_TYPES.has(file.type)) {
      return error("Screenshot must be an image (JPEG/PNG/WEBP/GIF).", 400);
    }
    if (file.size > MAX_FILE_BYTES) {
      return error("Screenshot exceeds the 4MB limit.", 400);
    }
    screenshotFileName = file.name || "screenshot";
    screenshotMimeType = file.type;
    screenshotFileSize = file.size;
    screenshotData = Buffer.from(await file.arrayBuffer());
  }

  const [reporter] = await db.select().from(users).where(eq(users.id, claims.sub)).limit(1);
  const reportedByName = reporter?.name ?? claims.email;

  const [report] = await db
    .insert(bugReports)
    .values({
      type,
      title,
      description,
      severity,
      page,
      screenshotFileName,
      screenshotMimeType,
      screenshotFileSize,
      screenshotData,
      reportedBy: claims.sub,
      reportedByName,
    })
    .returning();

  await logAudit({
    ipAddress: getClientIp(req),
    userId: claims.sub,
    userName: reportedByName,
    userEmail: claims.email,
    eventType: "create",
    entityType: "bug_report",
    entityId: report.id,
    entityLabel: report.title,
  });

  return json(bugReportToDict(report), 201);
}
