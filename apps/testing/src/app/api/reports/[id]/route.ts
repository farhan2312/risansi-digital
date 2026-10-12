import { eq } from "drizzle-orm";

import { error, json, pointToDict, reportToDict } from "@/lib/api";
import { getClientIp, logAudit } from "@/lib/audit";
import { AuthError, decodeToken } from "@/lib/auth";
import { db } from "@/lib/db";
import { pumpTestReportPoints, pumpTestReports, testRequisitions } from "@/lib/db/schema";
import { isWithinReportEditWindow, REPORT_EDIT_WINDOW_DAYS } from "@/lib/reportEditWindow";
import { POINT_FIELD_MAP, REPORT_FIELD_MAP } from "@/lib/reportFieldMaps";
import { findReportByIdOrNo } from "@/lib/reportLookup";
import { requisitionNoFor } from "@/lib/requisitionLookup";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await decodeToken(req);
  } catch (e) {
    if (e instanceof AuthError) return error(e.message, e.statusCode);
    throw e;
  }

  const { id: idOrNo } = await params;

  const report = await findReportByIdOrNo(idOrNo);
  if (!report) {
    return error("Report not found", 404);
  }

  const points = await db.select().from(pumpTestReportPoints).where(eq(pumpTestReportPoints.reportId, report.id));

  // The "Linked Testing Summary" cell shows this instead of the requisition's
  // raw uuid -- a report only ever carries the FK, never the pretty number.
  const requisitionNo = await requisitionNoFor(report.requisitionId);

  return json({ ...reportToDict(report), requisition_no: requisitionNo, points: points.map(pointToDict) });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  let claims;
  try {
    claims = await decodeToken(req);
  } catch (e) {
    if (e instanceof AuthError) return error(e.message, e.statusCode);
    throw e;
  }
  if (claims.role !== "testing") {
    return error("Only the testing team can edit reports.", 403);
  }

  const { id: idOrNo } = await params;

  const existing = await findReportByIdOrNo(idOrNo);
  if (!existing) {
    return error("Report not found", 404);
  }
  if (!isWithinReportEditWindow(existing.createdAt ?? new Date())) {
    return error(`Reports can only be edited within ${REPORT_EDIT_WINDOW_DAYS} days of submission.`, 403);
  }
  const id = existing.id;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return error("Request body must be JSON", 400);
  }

  const values: Record<string, unknown> = {};
  if (body.model !== undefined && body.model !== "") {
    values.model = body.model;
  }
  for (const [snakeKey, camelKey] of Object.entries(REPORT_FIELD_MAP)) {
    if (body[snakeKey] !== undefined) {
      values[camelKey] = body[snakeKey] === "" ? null : body[snakeKey];
    }
  }

  const [report] = await db
    .update(pumpTestReports)
    .set(values as Partial<typeof pumpTestReports.$inferInsert>)
    .where(eq(pumpTestReports.id, id))
    .returning();

  const changedFields = Object.keys(values);
  if (Array.isArray(body.points)) changedFields.push("points");
  await logAudit({
    ipAddress: getClientIp(req),
    userId: claims.sub,
    userEmail: claims.email,
    eventType: "update",
    entityType: "report",
    entityId: report.id,
    entityLabel: report.reportNo ?? report.model,
    details: changedFields.length ? `Changed: ${changedFields.join(", ")}` : null,
  });

  // Points are replaced wholesale on edit — simpler and matches how the
  // create flow builds them, rather than diffing add/remove/reorder.
  if (Array.isArray(body.points)) {
    await db.delete(pumpTestReportPoints).where(eq(pumpTestReportPoints.reportId, id));

    const rawPoints = body.points as Record<string, unknown>[];
    const pointRows = rawPoints.map((point) => {
      const pointValues: Record<string, unknown> = { reportId: id };
      for (const [snakeKey, camelKey] of Object.entries(POINT_FIELD_MAP)) {
        if (point[snakeKey] !== undefined) {
          pointValues[camelKey] = point[snakeKey];
        }
      }
      return pointValues as typeof pumpTestReportPoints.$inferInsert;
    });

    const insertedPoints = pointRows.length
      ? await db.insert(pumpTestReportPoints).values(pointRows).returning()
      : [];

    return json({
      ...reportToDict(report),
      requisition_no: await requisitionNoFor(report.requisitionId),
      points: insertedPoints.map(pointToDict),
    });
  }

  const points = await db.select().from(pumpTestReportPoints).where(eq(pumpTestReportPoints.reportId, id));
  return json({
    ...reportToDict(report),
    requisition_no: await requisitionNoFor(report.requisitionId),
    points: points.map(pointToDict),
  });
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  let claims;
  try {
    claims = await decodeToken(req);
  } catch (e) {
    if (e instanceof AuthError) return error(e.message, e.statusCode);
    throw e;
  }
  if (claims.role !== "testing") {
    return error("Only the testing team can delete reports.", 403);
  }

  const { id: idOrNo } = await params;

  const report = await findReportByIdOrNo(idOrNo);
  if (!report) {
    return error("Report not found", 404);
  }
  const id = report.id;

  await db.delete(pumpTestReportPoints).where(eq(pumpTestReportPoints.reportId, id));
  await db.delete(pumpTestReports).where(eq(pumpTestReports.id, id));

  await logAudit({
    ipAddress: getClientIp(req),
    userId: claims.sub,
    userEmail: claims.email,
    eventType: "delete",
    entityType: "report",
    entityId: report.id,
    entityLabel: report.reportNo ?? report.model,
  });

  // Submitting this report auto-closed its requisition (see reports/route.ts
  // POST) — deleting it undoes that so the requisition doesn't sit "Closed"
  // pointing at a report that no longer exists. Only revert if it's still
  // "Closed" — don't clobber a status changed independently since then.
  if (report.requisitionId) {
    const [requisition] = await db
      .select()
      .from(testRequisitions)
      .where(eq(testRequisitions.id, report.requisitionId))
      .limit(1);
    if (requisition?.status === "Closed") {
      await db
        .update(testRequisitions)
        .set({ status: "In Testing", closedAt: null, updatedAt: new Date() })
        .where(eq(testRequisitions.id, report.requisitionId));
    }
  }

  return json({ success: true });
}
