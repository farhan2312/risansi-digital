import { eq } from "drizzle-orm";

import { bugReportToDict, error, json } from "@/lib/api";
import { getClientIp, logAudit } from "@/lib/audit";
import { AuthError, requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { bugReportNotifications, bugReports, users } from "@/lib/db/schema";

export const dynamic = "force-dynamic";

const STATUSES = new Set(["Open", "In Progress", "Resolved"]);

/** Opening a report's detail is what "visiting" it means for the sidebar
 * notification bell -- flips is_read true (if it wasn't already) and the
 * report drops out of the unread count on the bell's next poll. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin(req);
  } catch (e) {
    if (e instanceof AuthError) return error(e.message, e.statusCode);
    throw e;
  }

  const { id } = await params;
  const [existing] = await db.select().from(bugReports).where(eq(bugReports.id, id)).limit(1);
  if (!existing) return error("Bug report not found", 404);

  if (existing.isRead) return json(bugReportToDict(existing));

  const [report] = await db.update(bugReports).set({ isRead: true }).where(eq(bugReports.id, id)).returning();
  return json(bugReportToDict(report));
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  let claims;
  try {
    claims = await requireAdmin(req);
  } catch (e) {
    if (e instanceof AuthError) return error(e.message, e.statusCode);
    throw e;
  }

  const { id } = await params;
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return error("Request body must be JSON", 400);
  }

  const status = typeof body.status === "string" ? body.status : undefined;
  if (status !== undefined && !STATUSES.has(status)) {
    return error("Invalid status", 400);
  }

  // What the status was before this change, so the reporter can be told "Open -> In Progress".
  const [before] = await db.select({ status: bugReports.status }).from(bugReports).where(eq(bugReports.id, id)).limit(1);

  const [report] = await db
    .update(bugReports)
    .set(status !== undefined ? { status } : {})
    .where(eq(bugReports.id, id))
    .returning();

  if (!report) return error("Bug report not found", 404);

  // Tell whoever reported it (their top-bar bell) when the status actually changed. Not when an admin
  // moves their own report, and never allowed to fail the status change itself.
  if (status !== undefined && before?.status !== status && report.reportedBy && report.reportedBy !== claims.sub) {
    try {
      const [admin] = await db.select({ name: users.name }).from(users).where(eq(users.id, claims.sub)).limit(1);
      await db.insert(bugReportNotifications).values({
        userId: report.reportedBy,
        bugReportId: report.id,
        bugTitle: report.title,
        oldStatus: before?.status ?? null,
        newStatus: status,
        changedByName: (admin?.name ?? claims.email).slice(0, 100),
      });
    } catch (err) {
      console.error("[bug-reports] could not create the reporter notification:", err);
    }
  }

  if (status !== undefined) {
    await logAudit({
      ipAddress: getClientIp(req),
      userId: claims.sub,
      userEmail: claims.email,
      eventType: "update",
      entityType: "bug_report",
      entityId: report.id,
      entityLabel: report.title,
      details: `Status changed to ${status}`,
    });
  }

  return json(bugReportToDict(report));
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  let claims;
  try {
    claims = await requireAdmin(req);
  } catch (e) {
    if (e instanceof AuthError) return error(e.message, e.statusCode);
    throw e;
  }

  const { id } = await params;
  const deleted = await db
    .delete(bugReports)
    .where(eq(bugReports.id, id))
    .returning({ id: bugReports.id, title: bugReports.title });
  if (!deleted.length) return error("Bug report not found", 404);

  await logAudit({
    ipAddress: getClientIp(req),
    userId: claims.sub,
    userEmail: claims.email,
    eventType: "delete",
    entityType: "bug_report",
    entityId: deleted[0].id,
    entityLabel: deleted[0].title,
  });

  return json({ success: true });
}
