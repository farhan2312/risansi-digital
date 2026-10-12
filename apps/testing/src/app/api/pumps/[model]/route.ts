import { and, eq, inArray, sql } from "drizzle-orm";

import { error, json, pointToDict, reportToDict, requisitionToDict } from "@/lib/api";
import { AuthError, decodeToken } from "@/lib/auth";
import { db } from "@/lib/db";
import { pumpTestReportPoints, pumpTestReports, testRequisitions } from "@/lib/db/schema";
import { modelDisplayLabel, normalizeModelKey } from "@/lib/modelKey";

export const dynamic = "force-dynamic";

// Everything for one physical pump, matched across test_requisitions and
// pump_test_reports by normalized model (case/punctuation/spacing
// insensitive) -- same matching Report Archive uses to group pumps, so a
// pump's dashboard always contains exactly what its archive group shows.
export async function GET(req: Request, { params }: { params: Promise<{ model: string }> }) {
  let claims;
  try {
    claims = await decodeToken(req);
  } catch (e) {
    if (e instanceof AuthError) return error(e.message, e.statusCode);
    throw e;
  }

  const { model } = await params;
  const target = normalizeModelKey(decodeURIComponent(model));
  if (!target) {
    return error("Model is required", 400);
  }

  // normalizeModelKey is just upper() + strip-non-alphanumeric -- pushed
  // into SQL here instead of fetching every requisition/report into memory
  // to filter in JS (this route used to do exactly that, unconditionally).
  const normalizedModelSql = <T extends { model: unknown }>(table: T) =>
    sql`upper(regexp_replace(${table.model}, '[^A-Za-z0-9]', '', 'g'))`;

  const requisitionMatch = eq(normalizedModelSql(testRequisitions), target);
  // Source teams only see the requisitions they personally raised -- testing
  // team and admins still see everything, matching GET /api/requisitions.
  const requisitionsWhere =
    claims.role === "source" ? and(requisitionMatch, eq(testRequisitions.createdBy, claims.sub)) : requisitionMatch;

  const [requisitions, reports] = await Promise.all([
    db.select().from(testRequisitions).where(requisitionsWhere),
    db.select().from(pumpTestReports).where(eq(normalizedModelSql(pumpTestReports), target)),
  ]);

  if (requisitions.length === 0 && reports.length === 0) {
    return error("Pump not found", 404);
  }

  const reportIds = reports.map((r) => r.id);
  const points = reportIds.length
    ? await db.select().from(pumpTestReportPoints).where(inArray(pumpTestReportPoints.reportId, reportIds))
    : [];
  const pointsByReport = new Map<string, typeof points>();
  for (const p of points) {
    const list = pointsByReport.get(p.reportId) ?? [];
    list.push(p);
    pointsByReport.set(p.reportId, list);
  }

  const displayModel = modelDisplayLabel([...reports, ...requisitions]);

  // Which requisition each report is linked to, for requisitions this
  // pump's reports reference -- almost always the same set already fetched
  // above, but a report can in principle link to a requisition under a
  // slightly different raw model spelling, so resolve properly rather than
  // assuming it's always in the `requisitions` map.
  const linkedRequisitionIds = [...new Set(reports.map((r) => r.requisitionId).filter((id): id is string => Boolean(id)))];
  const requisitionNoById = new Map(requisitions.map((r) => [r.id, r.requisitionNo]));
  const missingIds = linkedRequisitionIds.filter((id) => !requisitionNoById.has(id));
  if (missingIds.length) {
    const extra = await db
      .select({ id: testRequisitions.id, requisitionNo: testRequisitions.requisitionNo })
      .from(testRequisitions)
      .where(inArray(testRequisitions.id, missingIds));
    for (const r of extra) requisitionNoById.set(r.id, r.requisitionNo);
  }

  return json({
    model: displayModel,
    requisitions: requisitions
      .sort((a, b) => (b.createdAt?.toString() ?? "").localeCompare(a.createdAt?.toString() ?? ""))
      .map(requisitionToDict),
    reports: reports
      .sort((a, b) => (b.createdAt?.toString() ?? "").localeCompare(a.createdAt?.toString() ?? ""))
      .map((r) => ({
        ...reportToDict(r),
        requisition_no: r.requisitionId ? requisitionNoById.get(r.requisitionId) ?? null : null,
        points: (pointsByReport.get(r.id) ?? []).map(pointToDict),
      })),
  });
}
