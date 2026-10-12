import { desc, eq, ilike, inArray } from "drizzle-orm";

import { error, json, pointToDict, reportToDict } from "@/lib/api";
import { AuthError, decodeToken } from "@/lib/auth";
import { db } from "@/lib/db";
import { pumpTestReportPoints, pumpTestReports } from "@/lib/db/schema";

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
  if (!model) {
    return error("'model' query param is required", 400);
  }

  const reports = await db
    .select()
    .from(pumpTestReports)
    .where(ilike(pumpTestReports.model, model))
    .orderBy(desc(pumpTestReports.createdAt));

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

  const priorReports = reports.map((r) => ({
    ...reportToDict(r),
    points: (pointsByReport.get(r.id) ?? []).map(pointToDict),
  }));

  return json({ model, priorReports, alreadyTested: priorReports.length > 0 });
}
