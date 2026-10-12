import { and, desc, eq, ilike, or, sql, type SQL } from "drizzle-orm";

import { error, json } from "@/lib/api";
import { AuthError, decodeToken, requireSystemAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { bugReportSelection } from "@/lib/db/schema";

export const dynamic = "force-dynamic";

const TYPES = new Set(["bug", "feature"]);
const SEVERITIES = new Set(["Low", "Medium", "High", "Critical"]);
const STATUSES = new Set(["Open", "Need Clarification", "In progress", "Resolved"]);

function textOrNull(v: unknown): string | null {
  if (v === null || v === undefined || String(v).trim() === "") return null;
  return String(v).trim();
}

// GET is system_admin only (the Bug Tracker page) — EXCEPT with mine=1, which
// any signed-in user may call and which returns only the reports THEY filed
// (the read-only "My Bug Reports" page). Never returns the binary screenshot_data
// column; the tracker fetches that separately via [id]/screenshot when a row
// has one, same pattern as the MOC PDF blob route.
export async function GET(req: Request) {
  const mine = new URL(req.url).searchParams.get("mine") === "1";
  let callerId: string;
  try {
    callerId = (mine ? decodeToken(req) : requireSystemAdmin(req)).sub;
  } catch (e) {
    if (e instanceof AuthError) return error(e.message, e.statusCode);
    throw e;
  }
  // "Mine": only the caller's own reports — list, counts and header figures.
  const mineFilter = mine ? eq(bugReportSelection.reportedBy, callerId) : undefined;

  // Server-side paging / search / filters. Query params (all optional):
  //   q         words searched in title, description, reporter and page
  //             (every word must match somewhere)
  //   type      bug | feature
  //   severity  Low | Medium | High | Critical
  //   status    Open | Need Clarification | In progress | Resolved (a board
  //             column; Resolved = "Resolved / Closed" and also returns the
  //             legacy Closed rows)
  //   order     "board" = most severe first, then newest (board columns);
  //             anything else = newest first (list)
  //   offset    rows to skip (default 0)
  //   limit     rows to return, 0-100 (default 20; 0 = counts only)
  //   mine      1 = only the caller's own reports (any signed-in user)
  // Returns { rows, total, summary } - total is the filtered count, summary
  // the unfiltered header figures (all / open / critical open).
  const params = new URL(req.url).searchParams;
  const filters: SQL[] = mineFilter ? [mineFilter] : [];
  const type = params.get("type");
  if (type && TYPES.has(type)) filters.push(eq(bugReportSelection.type, type));
  const severity = params.get("severity");
  if (severity && SEVERITIES.has(severity)) filters.push(eq(bugReportSelection.severity, severity));
  const status = params.get("status");
  if (status && STATUSES.has(status)) {
    // A report with no status shows in the Open column (as it always has).
    filters.push(
      status === "Open"
        ? or(eq(bugReportSelection.status, status), sql`${bugReportSelection.status} is null`)!
        : status === "Resolved"
          ? sql`${bugReportSelection.status} in ('Resolved', 'Closed')`
          : eq(bugReportSelection.status, status),
    );
  }
  const words = (params.get("q") ?? "").trim().split(/\s+/).filter(Boolean).slice(0, 8);
  for (const w of words) {
    // Escape LIKE wildcards so "50%" or "a_b" search literally.
    const pattern = `%${w.replace(/[\\%_]/g, (c) => "\\" + c)}%`;
    filters.push(
      or(
        ilike(bugReportSelection.title, pattern),
        ilike(bugReportSelection.description, pattern),
        ilike(bugReportSelection.reportedByName, pattern),
        ilike(bugReportSelection.page, pattern),
      )!,
    );
  }
  const where = filters.length ? and(...filters) : undefined;
  const offset = Math.max(0, parseInt(params.get("offset") ?? "0", 10) || 0);
  const limitRaw = parseInt(params.get("limit") ?? "20", 10);
  const limit = Math.min(100, Math.max(0, Number.isNaN(limitRaw) ? 20 : limitRaw));
  const severityRank = sql`case ${bugReportSelection.severity} when 'Critical' then 0 when 'High' then 1 when 'Medium' then 2 when 'Low' then 3 else 9 end`;
  const orderBy =
    params.get("order") === "board"
      ? [severityRank, desc(bugReportSelection.createdAt), desc(bugReportSelection.id)]
      : [desc(bugReportSelection.createdAt), desc(bugReportSelection.id)];

  const [[{ total }], [summary]] = await Promise.all([
    db.select({ total: sql<number>`count(*)::int` }).from(bugReportSelection).where(where),
    db
      .select({
        total: sql<number>`count(*)::int`,
        open: sql<number>`count(*) filter (where ${bugReportSelection.status} in ('Open', 'Need Clarification', 'In progress'))::int`,
        criticalOpen: sql<number>`count(*) filter (where ${bugReportSelection.status} in ('Open', 'Need Clarification', 'In progress') and ${bugReportSelection.severity} = 'Critical')::int`,
      })
      .from(bugReportSelection)
      .where(mineFilter),
  ]);
  if (limit === 0) return json({ rows: [], total, summary });

  const rows = await db
    .select({
      id: bugReportSelection.id,
      type: bugReportSelection.type,
      title: bugReportSelection.title,
      description: bugReportSelection.description,
      severity: bugReportSelection.severity,
      page: bugReportSelection.page,
      status: bugReportSelection.status,
      screenshotFileName: bugReportSelection.screenshotFileName,
      screenshotMimeType: bugReportSelection.screenshotMimeType,
      screenshotFileSize: bugReportSelection.screenshotFileSize,
      reportedBy: bugReportSelection.reportedBy,
      reportedByName: bugReportSelection.reportedByName,
      createdAt: bugReportSelection.createdAt,
      updatedAt: bugReportSelection.updatedAt,
    })
    .from(bugReportSelection)
    .where(where)
    .orderBy(...orderBy)
    .limit(limit)
    .offset(offset);

  return json({ rows, total, summary });
}

// Any logged-in user can file a report — this is the "Report a Bug" button
// available everywhere in the top bar, not an admin-only action.
export async function POST(req: Request) {
  let claims;
  try {
    claims = decodeToken(req);
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

  const title = textOrNull(body.title);
  if (!title) return error("'title' is required", 400);

  const description = textOrNull(body.description);
  if (!description) return error("'description' (What happened?) is required", 400);

  const type = TYPES.has(String(body.type)) ? String(body.type) : "bug";
  const severity = SEVERITIES.has(String(body.severity)) ? String(body.severity) : "Medium";
  const page = textOrNull(body.page);

  // Screenshot arrives as a data URL (from <input type=file> or a clipboard
  // paste, both read client-side as base64) — decoded here into the bytea
  // column, same idea as the MOC PDF upload but inline in this JSON body
  // rather than a separate binary POST, since it's optional and small.
  let screenshotFileName: string | null = null;
  let screenshotMimeType: string | null = null;
  let screenshotFileSize: number | null = null;
  let screenshotData: Buffer | null = null;
  const dataUrl = body.screenshotDataUrl;
  if (typeof dataUrl === "string" && dataUrl.startsWith("data:")) {
    const m = /^data:([^;]+);base64,(.+)$/.exec(dataUrl);
    if (m) {
      screenshotMimeType = m[1];
      screenshotData = Buffer.from(m[2], "base64");
      screenshotFileSize = screenshotData.length;
      screenshotFileName = textOrNull(body.screenshotFileName) ?? "screenshot.png";
    }
  }

  const [created] = await db
    .insert(bugReportSelection)
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
      reportedByName: claims.name ?? claims.email ?? null,
    })
    .returning({
      id: bugReportSelection.id,
      type: bugReportSelection.type,
      title: bugReportSelection.title,
      description: bugReportSelection.description,
      severity: bugReportSelection.severity,
      page: bugReportSelection.page,
      status: bugReportSelection.status,
      createdAt: bugReportSelection.createdAt,
    });

  return json(created, 201);
}
