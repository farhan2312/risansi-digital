import { inArray, sql } from "drizzle-orm";

import { reportToDict } from "@/lib/api";
import { db } from "@/lib/db";
import { pumpTestReportPoints, pumpTestReports, testRequisitions } from "@/lib/db/schema";
import { reportCategoryOf } from "@/lib/reportCategory";
import { computeRequirementStatus, unmetRequirementLabels } from "@/lib/requirementCheck";

type ReportRow = typeof pumpTestReports.$inferSelect;

// node-postgres doesn't always parse an array_agg() result into a real JS
// array (depends on whether it recognizes the aggregate's element OID) --
// handle both a real array and a raw Postgres array literal ("{1.5,NULL}").
function toNumArray(arr: unknown): (number | null)[] {
  if (Array.isArray(arr)) return arr.map((v) => (v === null ? null : Number(v)));
  if (typeof arr === "string") {
    const inner = arr.slice(1, -1); // strip surrounding { }
    if (inner === "") return [];
    return inner.split(",").map((v) => (v === "NULL" ? null : Number(v)));
  }
  return [];
}

/** Attaches every computed/aggregated field a report list view needs (point
 * count, whether it reached its rated head/capacity/power, max VE/ME, and
 * the per-point head/capacity/power arrays the Pump Dashboard's "rated vs
 * every measured point" columns use) -- shared by GET /api/reports and the
 * grouped pump views (Report Archive, Report Compilation), so this
 * moderately expensive aggregation is only written once. */
export async function enrichReports(reports: ReportRow[]) {
  const reportIds = reports.map((r) => r.id);
  const counts = reportIds.length
    ? await db
        .select({ reportId: pumpTestReportPoints.reportId, count: sql<number>`count(*)::int` })
        .from(pumpTestReportPoints)
        .where(inArray(pumpTestReportPoints.reportId, reportIds))
        .groupBy(pumpTestReportPoints.reportId)
    : [];
  const countByReport = new Map(counts.map((c) => [c.reportId, c.count]));

  // A report filed against a requisition takes that requisition's category (lib/reportCategory.ts).
  const requisitionIds = [...new Set(reports.map((r) => r.requisitionId).filter((id): id is string => !!id))];
  const requisitionCategories = requisitionIds.length
    ? await db
        .select({ id: testRequisitions.id, category: testRequisitions.category })
        .from(testRequisitions)
        .where(inArray(testRequisitions.id, requisitionIds))
    : [];
  const categoryByRequisition = new Map(requisitionCategories.map((r) => [r.id, r.category]));

  const maxes = reportIds.length
    ? await db
        .select({
          reportId: pumpTestReportPoints.reportId,
          maxHead: sql<string | null>`max(${pumpTestReportPoints.headKgcm2})`,
          maxCapacity: sql<string | null>`max(${pumpTestReportPoints.capacityCalculatedM3hr})`,
          maxPower: sql<string | null>`max(${pumpTestReportPoints.powerCalculatedKw})`,
          maxVe: sql<string | null>`max(${pumpTestReportPoints.volumetricEfficiency})`,
          maxMe: sql<string | null>`max(${pumpTestReportPoints.mechanicalEfficiency})`,
          heads: sql<(string | null)[]>`array_agg(${pumpTestReportPoints.headKgcm2} order by ${pumpTestReportPoints.headKgcm2} asc nulls last)`,
          capacities: sql<(string | null)[]>`array_agg(${pumpTestReportPoints.capacityCalculatedM3hr} order by ${pumpTestReportPoints.headKgcm2} asc nulls last)`,
          powers: sql<(string | null)[]>`array_agg(${pumpTestReportPoints.powerCalculatedKw} order by ${pumpTestReportPoints.headKgcm2} asc nulls last)`,
          ves: sql<(string | null)[]>`array_agg(${pumpTestReportPoints.volumetricEfficiency}) filter (where ${pumpTestReportPoints.volumetricEfficiency} is not null)`,
          mes: sql<(string | null)[]>`array_agg(${pumpTestReportPoints.mechanicalEfficiency}) filter (where ${pumpTestReportPoints.mechanicalEfficiency} is not null)`,
        })
        .from(pumpTestReportPoints)
        .where(inArray(pumpTestReportPoints.reportId, reportIds))
        .groupBy(pumpTestReportPoints.reportId)
    : [];
  const maxByReport = new Map(maxes.map((m) => [m.reportId, m]));

  return reports.map((r) => {
    const max = maxByReport.get(r.id);
    const status = computeRequirementStatus(
      {
        rated_head: r.ratedHead === null ? null : Number(r.ratedHead),
        rated_capacity: r.ratedCapacity === null ? null : Number(r.ratedCapacity),
        rated_power_kw: r.ratedPowerKw === null ? null : Number(r.ratedPowerKw),
      },
      max
        ? [
            {
              head_kgcm2: max.maxHead === null ? null : Number(max.maxHead),
              capacity_calculated_m3hr: max.maxCapacity === null ? null : Number(max.maxCapacity),
              power_calculated_kw: max.maxPower === null ? null : Number(max.maxPower),
            },
          ]
        : []
    );
    // Whether this report has anything to judge at all -- a rated field with at least one matching
    // measured point. A report with no rated targets is neither "met" nor "missed"; without this,
    // an empty requirement_unmet_fields (met) and "nothing to judge" would look identical.
    const hasTarget = [status.head, status.capacity, status.power].some((v) => v !== null);
    return {
      ...reportToDict(r),
      pointCount: countByReport.get(r.id) ?? 0,
      requirement_unmet_fields: unmetRequirementLabels(status),
      has_target: hasTarget,
      report_category: reportCategoryOf({
        remarks: r.remarks,
        ecNo: r.ecNo,
        requisitionCategory: r.requisitionId ? categoryByRequisition.get(r.requisitionId) : null,
      }),
      max_ve: max?.maxVe === null || max?.maxVe === undefined ? null : Number(max.maxVe),
      max_me: max?.maxMe === null || max?.maxMe === undefined ? null : Number(max.maxMe),
      points_head_kgcm2: toNumArray(max?.heads),
      points_capacity_m3hr: toNumArray(max?.capacities),
      points_power_kw: toNumArray(max?.powers),
      // Every point's own VE / ME (only the recorded ones) -- the VE & ME Performance page judges each.
      points_ve: toNumArray(max?.ves).filter((v): v is number => v !== null),
      points_me: toNumArray(max?.mes).filter((v): v is number => v !== null),
    };
  });
}
