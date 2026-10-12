import { desc, eq, ilike, sql } from "drizzle-orm";

import { error, json, pointToDict, reportToDict } from "@/lib/api";
import { getClientIp, logAudit } from "@/lib/audit";
import { AuthError, decodeToken } from "@/lib/auth";
import { db } from "@/lib/db";
import { pumpModels, pumpTestReportPoints, pumpTestReports, testRequisitions, users } from "@/lib/db/schema";
import { REPORT_FIELD_MAP, POINT_FIELD_MAP } from "@/lib/reportFieldMaps";
import { enrichReports } from "@/lib/reportEnrichment";
import { findRequisitionByIdOrNo } from "@/lib/requisitionLookup";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    await decodeToken(req);
  } catch (e) {
    if (e instanceof AuthError) return error(e.message, e.statusCode);
    throw e;
  }

  const { searchParams } = new URL(req.url);
  const model = searchParams.get("model");
  const limit = Math.min(Number(searchParams.get("limit") ?? 200), 500);

  const reports = model
    ? await db.select().from(pumpTestReports).where(ilike(pumpTestReports.model, `%${model}%`)).orderBy(desc(pumpTestReports.createdAt)).limit(limit)
    : await db.select().from(pumpTestReports).orderBy(desc(pumpTestReports.createdAt)).limit(limit);

  return json(await enrichReports(reports));
}

export async function POST(req: Request) {
  let claims;
  try {
    claims = await decodeToken(req);
  } catch (e) {
    if (e instanceof AuthError) return error(e.message, e.statusCode);
    throw e;
  }

  if (claims.role === "source") {
    return error("Source team cannot submit test reports.", 403);
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return error("Request body must be JSON", 400);
  }

  const model = body.model;
  if (!model) {
    return error("'model' is required", 400);
  }

  // The caller may pass either the requisition's real uuid or its
  // human-facing requisition_no (a report-fill page's URL, and thus its
  // "which requisition is this for" param, addresses by the latter now) --
  // resolve to the real row once and use ITS id for the actual FK-style
  // storage below, never the raw string the caller sent.
  const requisitionIdOrNo = body.requisitionId ? String(body.requisitionId) : null;
  let requisitionId: string | null = null;
  if (requisitionIdOrNo) {
    const requisition = await findRequisitionByIdOrNo(requisitionIdOrNo);
    if (!requisition) {
      return error("Requisition not found", 404);
    }
    requisitionId = requisition.id;
  }

  const seqResult = await db.execute<{ n: number }>(
    sql`select nextval('pump_test_reports_report_no_seq') as n`
  );
  const reportNo = `TR-${String(seqResult.rows[0].n).padStart(6, "0")}`;

  // "Prepared By" is always the logged-in submitter, computed server-side —
  // never trusted from the request body, and never touched on edit.
  const [submitter] = await db.select().from(users).where(eq(users.id, claims.sub)).limit(1);
  const preparedBy = submitter?.name ?? claims.email;

  const reportValues: Record<string, unknown> = { model, requisitionId, reportNo, preparedBy };
  for (const [snakeKey, camelKey] of Object.entries(REPORT_FIELD_MAP)) {
    if (body[snakeKey] !== undefined && body[snakeKey] !== "") {
      reportValues[camelKey] = body[snakeKey];
    }
  }

  const [report] = await db
    .insert(pumpTestReports)
    .values(reportValues as typeof pumpTestReports.$inferInsert)
    .returning();

  const rawPoints = Array.isArray(body.points) ? (body.points as Record<string, unknown>[]) : [];
  const pointRows = rawPoints.map((point) => {
    const values: Record<string, unknown> = { reportId: report.id };
    for (const [snakeKey, camelKey] of Object.entries(POINT_FIELD_MAP)) {
      if (point[snakeKey] !== undefined) {
        values[camelKey] = point[snakeKey];
      }
    }
    return values as typeof pumpTestReportPoints.$inferInsert;
  });

  const insertedPoints = pointRows.length
    ? await db.insert(pumpTestReportPoints).values(pointRows).returning()
    : [];

  if (requisitionId) {
    await db
      .update(testRequisitions)
      .set({ status: "Closed", closedAt: new Date(), updatedAt: new Date() })
      .where(eq(testRequisitions.id, requisitionId));

    // A model typed via the requisition form's "+ Add New Model" option only
    // becomes a shared dropdown suggestion once its testing actually closes.
    await db.insert(pumpModels).values({ model: String(model) }).onConflictDoNothing();
  }

  await logAudit({
    ipAddress: getClientIp(req),
    userId: claims.sub,
    userName: preparedBy,
    userEmail: claims.email,
    eventType: "create",
    entityType: "report",
    entityId: report.id,
    entityLabel: report.reportNo ?? report.model,
  });

  return json(
    {
      ...reportToDict(report),
      points: insertedPoints.map(pointToDict),
    },
    201
  );
}
