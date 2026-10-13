import { query } from "@/lib/db";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type BugKind = "bug" | "feature";
export type BugSeverity = "Low" | "Medium" | "High" | "Critical";
export type BugStatus =
  | "open"
  | "need_clarification"
  | "in_progress"
  | "resolved"
  | "wont_fix";

/** How each status reads to a person — "wont_fix" is shown as Closed. */
export const BUG_STATUS_LABELS: Record<BugStatus, string> = {
  open: "Open",
  need_clarification: "Need clarification",
  in_progress: "In progress",
  resolved: "Resolved",
  wont_fix: "Closed",
};

export type BugReportRow = {
  id: string;
  user_id: string | null;
  user_email: string | null;
  user_role: string | null;
  kind: BugKind;
  severity: string | null;
  title: string;
  description: string | null;
  page_path: string | null;
  screenshot_name: string | null;
  screenshot_size: number | null;
  status: BugStatus;
  created_at: string;
};

export type NewBugReport = {
  actor: { id?: string; email?: string; role?: string };
  kind: BugKind;
  title: string;
  description?: string;
  severity?: string;
  pagePath?: string;
  screenshot?: {
    name: string;
    mimeType: string | null;
    size: number;
    data: Buffer;
  };
};

/** Persist one bug/feature report. */
export async function insertBugReport(input: NewBugReport): Promise<string> {
  const result = await query<{ id: string }>(
    `INSERT INTO bug_reports (
        user_id, user_email, user_role, kind, severity, title, description,
        page_path, screenshot_name, screenshot_mime, screenshot_size, screenshot_data
     ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12
     )
     RETURNING id`,
    [
      input.actor.id ?? null,
      input.actor.email ?? null,
      input.actor.role ?? null,
      input.kind,
      input.severity ?? null,
      input.title,
      input.description ?? null,
      input.pagePath ?? null,
      input.screenshot?.name ?? null,
      input.screenshot?.mimeType ?? null,
      input.screenshot?.size ?? null,
      input.screenshot?.data ?? null,
    ]
  );
  return result.rows[0].id;
}

/**
 * List bug reports for the admin viewer (metadata only, no screenshot bytes).
 * The board counts its columns from this list, so the cap sits well above
 * the number of reports the tracker holds.
 */
export async function listBugReports(
  opts: {
    /** Only this person's own reports; omitted, every report. */
    reporterId?: string | null;
    limit?: number;
  } = {}
): Promise<BugReportRow[]> {
  const result = await query<BugReportRow>(
    `SELECT id, user_id, user_email, user_role, kind, severity, title, description,
            page_path, screenshot_name, screenshot_size, status,
            to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS created_at
       FROM bug_reports
      WHERE ($2::uuid IS NULL OR user_id = $2)
      ORDER BY created_at DESC
      LIMIT $1`,
    [opts.limit ?? 1000, opts.reporterId ?? null]
  );
  return result.rows;
}

/** Who reported a bug, and its title — for telling them it moved. */
export async function getBugReportOwner(
  id: string
): Promise<{ user_id: string | null; title: string; status: BugStatus } | null> {
  if (!UUID_RE.test(id)) return null;
  const r = await query<{ user_id: string | null; title: string; status: BugStatus }>(
    `SELECT user_id, title, status FROM bug_reports WHERE id = $1`,
    [id]
  );
  return r.rows[0] ?? null;
}

/** Fetch one report's screenshot bytes for download, with who reported it. */
export async function getBugReportScreenshot(
  id: string
): Promise<{
  file_name: string;
  mime_type: string | null;
  file_data: Buffer;
  user_id: string | null;
} | null> {
  if (!UUID_RE.test(id)) return null;
  const result = await query<{
    screenshot_name: string | null;
    screenshot_mime: string | null;
    screenshot_data: Buffer | null;
    user_id: string | null;
  }>(
    `SELECT screenshot_name, screenshot_mime, screenshot_data, user_id
       FROM bug_reports WHERE id = $1`,
    [id]
  );
  const row = result.rows[0];
  if (!row?.screenshot_data || !row.screenshot_name) return null;
  return {
    file_name: row.screenshot_name,
    mime_type: row.screenshot_mime,
    file_data: row.screenshot_data,
    user_id: row.user_id,
  };
}

/** How many reports are still "open" or "in progress" — for the top-bar bell. */
export async function countOpenBugReports(): Promise<number> {
  const result = await query<{ n: string }>(
    `SELECT count(*)::text AS n FROM bug_reports
      WHERE status IN ('open', 'need_clarification', 'in_progress')`
  );
  return Number(result.rows[0]?.n ?? 0);
}

/** Move a report through its lifecycle (admin action). */
export async function updateBugReportStatus(
  id: string,
  status: BugStatus
): Promise<void> {
  if (!UUID_RE.test(id)) return;
  await query(`UPDATE bug_reports SET status = $2 WHERE id = $1`, [id, status]);
}
