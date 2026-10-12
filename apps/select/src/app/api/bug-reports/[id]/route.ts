import { eq } from "drizzle-orm";

import { error, json } from "@/lib/api";
import { AuthError, requireSystemAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { bugReportSelection } from "@/lib/db/schema";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// "Resolved" is the "Resolved / Closed" column (Closed was merged into it).
const STATUSES = new Set(["Open", "Need Clarification", "In progress", "Resolved"]);

// Triage — system_admin only, from the Bug Tracker page. The only editable
// field is status; changing it flips reporterUnread so the filer's bell
// lights up (see /api/bug-reports/notifications).
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    requireSystemAdmin(req);
  } catch (e) {
    if (e instanceof AuthError) return error(e.message, e.statusCode);
    throw e;
  }

  const { id } = await params;
  if (!UUID_RE.test(id)) return error("Invalid report id", 400);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return error("Request body must be JSON", 400);
  }

  const status = String(body.status ?? "");
  if (!STATUSES.has(status)) {
    return error("'status' must be one of: Open, Need Clarification, In progress, Resolved", 400);
  }

  const [existing] = await db
    .select({ status: bugReportSelection.status, reportedBy: bugReportSelection.reportedBy })
    .from(bugReportSelection)
    .where(eq(bugReportSelection.id, id))
    .limit(1);
  if (!existing) return error("Report not found", 404);

  const [updated] = await db
    .update(bugReportSelection)
    .set({
      status,
      updatedAt: new Date(),
      // Only notify when the status is genuinely changing, and only when
      // there's a reporter on file to notify.
      ...(status !== existing.status && existing.reportedBy
        ? { reporterUnread: true }
        : {}),
    })
    .where(eq(bugReportSelection.id, id))
    .returning({
      id: bugReportSelection.id,
      status: bugReportSelection.status,
      updatedAt: bugReportSelection.updatedAt,
    });

  return json(updated);
}
