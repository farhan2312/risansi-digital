import { desc, inArray, sql } from "drizzle-orm";

import { error, json } from "@/lib/api";
import { AuthError, decodeToken } from "@/lib/auth";
import { db } from "@/lib/db";
import { pumpTestReportPoints, pumpTestReports, testRequisitions, users } from "@/lib/db/schema";
import { RAISED_BY_GROUPS, RAISED_BY_LABELS, raisedByGroup } from "@/lib/raisedBy";
import { REPORT_CATEGORY_NONE, REPORT_CATEGORY_ORDER, reportCategoryLabel, reportCategoryOf } from "@/lib/reportCategory";
import { REQUISITION_CATEGORIES } from "@/types/testing";
import { normalizeModelKey } from "@/lib/modelKey";
import { enrichReports } from "@/lib/reportEnrichment";
import { computeRequirementStatus } from "@/lib/requirementCheck";

export const dynamic = "force-dynamic";

const OPEN_STATUSES = ["Pending", "In Testing", "Retest Needed"];
const DUE_SOON_DAYS = 5;

const toNum = (v: unknown) => Number(v ?? 0);

const isoDay = (d: Date) => d.toISOString().slice(0, 10);

const DAY_MS = 86400000;
/** Windows up to this long (Today / 7 days / 30 days) trend per day. */
const DAILY_MAX_DAYS = 31;
/** A daily trend never shows fewer than this many days, so "Today" still has context. */
const DAILY_MIN_DAYS = 7;

/** Every YYYY-MM-DD key from `start` through `end` inclusive. */
const dayKeys = (start: Date, end: Date): string[] => {
  const keys: string[] = [];
  for (let t = start.getTime(); t <= end.getTime(); t += DAY_MS) keys.push(isoDay(new Date(t)));
  return keys;
};

/** Every YYYY-MM key from `start` through `end` inclusive. */
const monthKeys = (start: Date, end: Date): string[] => {
  const keys: string[] = [];
  const cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
  const last = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 1));
  while (cursor <= last) {
    keys.push(cursor.toISOString().slice(0, 7));
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return keys;
};

/**
 * Portal-wide snapshot for the Overview dashboard.
 *
 * Optional `?from=YYYY-MM-DD&to=YYYY-MM-DD` narrows everything to that
 * window: requisitions by `date_of_requisition` (falling back to
 * `created_at`), reports/points by the report's `test_date` (same fallback).
 * Omit both for the all-time snapshot. Optional `category`, `model` and `status` narrow every figure
 * further (category "none" = uncategorised; a report has no status of its own, so `status=Closed` keeps
 * reports -- a filed report is finished testing -- and any other status leaves them out).
 * Omit all three for everything. The monthly trend / matrix span the
 * filtered window (capped at the latest 24 months), or the last 12 months
 * when unfiltered. A window of 31 days or less trends per day instead
 * (`trend_granularity: "day"`, keys are YYYY-MM-DD, padded back to at least
 * 7 days so a single-day window still draws a line).
 *
 * "Target date" everywhere here is the same effective date the Testing
 * Summary shows (lib/formUtils.ts targetDateFor): the explicit target_date
 * if set, otherwise date of requisition + 7 days.
 */
export async function GET(req: Request) {
  let claims;
  try {
    claims = await decodeToken(req);
  } catch (e) {
    if (e instanceof AuthError) return error(e.message, e.statusCode);
    throw e;
  }

  const { searchParams } = new URL(req.url);
  const from = searchParams.get("from") || undefined;
  const to = searchParams.get("to") || undefined;
  // "Created by me" toggle: only the requisitions I raised, and the reports on them (or that I prepared).
  const mine = searchParams.get("mine") === "1";

  const categoryParam = searchParams.get("category") || undefined;
  const modelParam = searchParams.get("model")?.trim() || undefined;
  const statusParam = searchParams.get("status") || undefined;
  const modelKeySql = (col: ReturnType<typeof sql>) => sql`upper(regexp_replace(${col}, '[^A-Za-z0-9]', '', 'g'))`;

  const reqDateCol = sql`coalesce(${testRequisitions.dateOfRequisition}, ${testRequisitions.createdAt}::date)`;
  const reportDateCol = sql`coalesce(${pumpTestReports.testDate}, ${pumpTestReports.createdAt}::date)`;
  const effTargetCol = sql`coalesce(${testRequisitions.targetDate}, ${reqDateCol} + 7)`;
  const dateRange = (col: ReturnType<typeof sql>, f?: string, t?: string) => {
    const parts: ReturnType<typeof sql>[] = [];
    if (f) parts.push(sql`${col} >= ${f}`);
    if (t) parts.push(sql`${col} <= ${t}`);
    return parts.length ? sql.join(parts, sql` and `) : sql`true`;
  };
  // Source teams only ever see the requisitions they raised (same rule as
  // GET /api/requisitions), so every requisition figure here is scoped the
  // same way -- otherwise a card's number wouldn't match the list it opens.
  const reqFilters: ReturnType<typeof sql>[] = [];
  if (claims.role === "source" || mine) reqFilters.push(sql`${testRequisitions.createdBy} = ${claims.sub}`);
  if (statusParam) reqFilters.push(sql`${testRequisitions.status} = ${statusParam}`);
  if (categoryParam) reqFilters.push(categoryParam === "none" ? sql`${testRequisitions.category} is null` : sql`${testRequisitions.category} = ${categoryParam}`);
  if (modelParam) reqFilters.push(sql`${modelKeySql(sql`${testRequisitions.model}`)} = ${normalizeModelKey(modelParam)}`);
  const ownOnly = reqFilters.length ? sql.join(reqFilters, sql` and `) : sql`true`;
  const reqDateCondition = sql`${dateRange(reqDateCol, from, to)} and ${ownOnly}`;
  // A report's category is derived (remarks / EC no. / linked requisition), not a column, so the matching
  // report ids are worked out here once and every report query is restricted to them.
  let categoryReportIds: string[] | null = null;
  if (categoryParam) {
    const candidates = await db
      .select({ id: pumpTestReports.id, remarks: pumpTestReports.remarks, ecNo: pumpTestReports.ecNo, requisitionCategory: testRequisitions.category })
      .from(pumpTestReports)
      .leftJoin(testRequisitions, sql`${testRequisitions.id} = ${pumpTestReports.requisitionId}`);
    categoryReportIds = candidates.filter((r) => reportCategoryOf(r) === categoryParam).map((r) => r.id);
  }
  const reportFilters: ReturnType<typeof sql>[] = [];
  if (mine) {
    reportFilters.push(
      sql`(${pumpTestReports.requisitionId} in (select ${testRequisitions.id} from ${testRequisitions} where ${testRequisitions.createdBy} = ${claims.sub}) or ${pumpTestReports.preparedBy} = (select ${users.name} from ${users} where ${users.id} = ${claims.sub}))`
    );
  }
  if (statusParam && statusParam !== "Closed") reportFilters.push(sql`false`);
  if (modelParam) reportFilters.push(sql`${modelKeySql(sql`${pumpTestReports.model}`)} = ${normalizeModelKey(modelParam)}`);
  if (categoryReportIds) {
    reportFilters.push(categoryReportIds.length ? sql`${pumpTestReports.id} in (${sql.join(categoryReportIds.map((id) => sql`${id}`), sql`, `)})` : sql`false`);
  }
  const reportScope = reportFilters.length ? sql.join(reportFilters, sql` and `) : sql`true`;
  const reportDateCondition = sql`${dateRange(reportDateCol, from, to)} and ${reportScope}`;
  const openCondition = sql`${testRequisitions.status} in ('Pending', 'In Testing', 'Retest Needed')`;

  // ---- Trend window: the filtered range (max 24 months), else last 12 ----
  const today = new Date();
  const trendEnd = to ? new Date(`${to}T00:00:00Z`) : today;
  const spanDays =
    from && to ? Math.round((trendEnd.getTime() - new Date(`${from}T00:00:00Z`).getTime()) / DAY_MS) + 1 : null;
  const daily = spanDays !== null && spanDays <= DAILY_MAX_DAYS;

  let months: string[];
  let trendFrom: string;
  if (daily) {
    const windowStart = new Date(`${from}T00:00:00Z`);
    const paddedStart = new Date(trendEnd.getTime() - (DAILY_MIN_DAYS - 1) * DAY_MS);
    months = dayKeys(windowStart < paddedStart ? windowStart : paddedStart, trendEnd);
    trendFrom = months[0];
  } else {
    const trendStart = from
      ? new Date(`${from}T00:00:00Z`)
      : new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 11, 1));
    months = monthKeys(trendStart, trendEnd).slice(-24);
    trendFrom = `${months[0]}-01`;
  }
  const trendTo = to ?? isoDay(today);
  const bucketFormat = sql.raw(daily ? "'YYYY-MM-DD'" : "'YYYY-MM'");
  const monthOf = (col: ReturnType<typeof sql>) => sql<string>`to_char(${col}, ${bucketFormat})`;

  const [
    requisitionsByStatus,
    reportsByFormat,
    totals,
    raisedByMonth,
    reportsByMonth,
    closedByMonth,
    byCategory,
    bySourceTeam,
    workloadRows,
    matrixRows,
    deadlineCounts,
    upcoming,
    turnaround,
    latestReports,
    raiserRows,
    reportsInRange,
    [allTimeReports],
  ] = await Promise.all([
    db
      .select({ status: testRequisitions.status, n: sql<number>`count(*)::int` })
      .from(testRequisitions)
      .where(reqDateCondition)
      .groupBy(testRequisitions.status),
    db
      .select({ format: pumpTestReports.reportFormat, n: sql<number>`count(*)::int` })
      .from(pumpTestReports)
      .where(reportDateCondition)
      .groupBy(pumpTestReports.reportFormat),
    db
      .select({
        totalRequisitions: sql<number>`(select count(*)::int from ${testRequisitions} where ${reqDateCondition})`,
        totalReports: sql<number>`(select count(*)::int from ${pumpTestReports} where ${reportDateCondition})`,
        totalPoints: sql<number>`(select count(*)::int from ${pumpTestReportPoints} where report_id in (select id from ${pumpTestReports} where ${reportDateCondition}))`,
        // Every distinct pump model known to the portal -- same normalized
        // key the Report Compilation page groups by (lib/modelKey.ts).
        distinctModels: sql<number>`(
          select count(distinct key)::int from (
            select upper(regexp_replace(model, '[^A-Za-z0-9]', '', 'g')) as key
            from ${testRequisitions} where ${reqDateCondition}
            union
            select upper(regexp_replace(model, '[^A-Za-z0-9]', '', 'g')) as key
            from ${pumpTestReports} where ${reportDateCondition}
          ) all_models
        )`,
      })
      .from(pumpTestReports)
      .limit(1),
    db
      .select({ month: monthOf(reqDateCol), n: sql<number>`count(*)::int` })
      .from(testRequisitions)
      .where(sql`${dateRange(reqDateCol, trendFrom, trendTo)} and ${ownOnly}`)
      .groupBy(monthOf(reqDateCol)),
    db
      .select({ month: monthOf(reportDateCol), n: sql<number>`count(*)::int` })
      .from(pumpTestReports)
      .where(sql`${dateRange(reportDateCol, trendFrom, trendTo)} and ${reportScope}`)
      .groupBy(monthOf(reportDateCol)),
    db
      .select({ month: monthOf(sql`${testRequisitions.closedAt}::date`), n: sql<number>`count(*)::int` })
      .from(testRequisitions)
      .where(sql`${testRequisitions.closedAt} is not null and ${ownOnly} and ${dateRange(sql`${testRequisitions.closedAt}::date`, trendFrom, trendTo)}`)
      .groupBy(monthOf(sql`${testRequisitions.closedAt}::date`)),
    db
      .select({ category: testRequisitions.category, status: testRequisitions.status, n: sql<number>`count(*)::int` })
      .from(testRequisitions)
      .where(reqDateCondition)
      .groupBy(testRequisitions.category, testRequisitions.status),
    db
      .select({ team: testRequisitions.sourceTeam, n: sql<number>`count(*)::int` })
      .from(testRequisitions)
      .where(reqDateCondition)
      .groupBy(testRequisitions.sourceTeam),
    db
      .select({
        person: testRequisitions.responsiblePerson,
        status: testRequisitions.status,
        n: sql<number>`count(*)::int`,
      })
      .from(testRequisitions)
      .where(sql`${openCondition} and ${reqDateCondition}`)
      .groupBy(testRequisitions.responsiblePerson, testRequisitions.status),
    db
      .select({
        category: testRequisitions.category,
        month: monthOf(reqDateCol),
        n: sql<number>`count(*)::int`,
      })
      .from(testRequisitions)
      .where(sql`${dateRange(reqDateCol, trendFrom, trendTo)} and ${ownOnly}`)
      .groupBy(testRequisitions.category, monthOf(reqDateCol)),
    db
      .select({
        overdue: sql<number>`count(*) filter (where ${effTargetCol} < current_date)::int`,
        dueSoon: sql<number>`count(*) filter (where ${effTargetCol} >= current_date and ${effTargetCol} <= current_date + ${DUE_SOON_DAYS}::int)::int`,
      })
      .from(testRequisitions)
      .where(sql`${openCondition} and ${reqDateCondition}`),
    db
      .select({
        id: testRequisitions.id,
        requisitionNo: testRequisitions.requisitionNo,
        model: testRequisitions.model,
        ecQuotationNo: testRequisitions.ecQuotationNo,
        status: testRequisitions.status,
        responsiblePerson: testRequisitions.responsiblePerson,
        targetDate: sql<string>`to_char(${effTargetCol}, 'YYYY-MM-DD')`,
        daysLeft: sql<number>`(${effTargetCol} - current_date)::int`,
      })
      .from(testRequisitions)
      .where(sql`${openCondition} and ${reqDateCondition}`)
      .orderBy(effTargetCol)
      .limit(8),
    db
      .select({
        avgDays: sql<number | null>`avg(extract(epoch from (${testRequisitions.closedAt} - ${testRequisitions.createdAt})) / 86400)`,
      })
      .from(testRequisitions)
      .where(sql`${testRequisitions.closedAt} is not null and ${reqDateCondition}`),
    db.select().from(pumpTestReports).where(reportDateCondition).orderBy(desc(pumpTestReports.createdAt)).limit(6),
    // Who raised them -- the creator's role bucketed Source / Testing / Other
    // (same rule as GET /api/requisitions?raised_by=).
    db
      .select({
        role: users.role,
        n: sql<number>`count(*)::int`,
      })
      .from(testRequisitions)
      .leftJoin(users, sql`${users.id} = ${testRequisitions.createdBy}`)
      .where(reqDateCondition)
      .groupBy(users.role),
    // Category-wise reports: each in-range report's own remarks / EC number (see lib/reportCategory.ts).
    db
      .select({ remarks: pumpTestReports.remarks, ecNo: pumpTestReports.ecNo, requisitionCategory: testRequisitions.category })
      .from(pumpTestReports)
      .leftJoin(testRequisitions, sql`${testRequisitions.id} = ${pumpTestReports.requisitionId}`)
      .where(reportDateCondition),
    db.select({ n: sql<number>`count(*)::int` }).from(pumpTestReports).where(reportScope),
  ]);

  // ---- Pass/fail -- same rule as the Testing Summary's Green/Red filter, run over EVERY report in
  // range, not just ones tied to a requisition that reached Closed. Most reports (the bulk-imported
  // historical ones) have no linked requisition at all, so scoping this to "Closed and joined" left
  // Pass Rate judged against a handful of requisitions while the report archive held hundreds --
  // computeRequirementStatus only needs the report's own rated fields + points, never the requisition. ----
  const reportsForJudging = await db
    .select({
      ratedHead: pumpTestReports.ratedHead,
      ratedCapacity: pumpTestReports.ratedCapacity,
      ratedPowerKw: pumpTestReports.ratedPowerKw,
      reportId: pumpTestReports.id,
    })
    .from(pumpTestReports)
    .where(reportDateCondition);

  const reportIds = reportsForJudging.map((r) => r.reportId);
  const maxes = reportIds.length
    ? await db
        .select({
          reportId: pumpTestReportPoints.reportId,
          maxHead: sql<string | null>`max(${pumpTestReportPoints.headKgcm2})`,
          maxCapacity: sql<string | null>`max(${pumpTestReportPoints.capacityCalculatedM3hr})`,
          maxPower: sql<string | null>`max(${pumpTestReportPoints.powerCalculatedKw})`,
        })
        .from(pumpTestReportPoints)
        .where(inArray(pumpTestReportPoints.reportId, reportIds))
        .groupBy(pumpTestReportPoints.reportId)
    : [];
  const maxByReport = new Map(maxes.map((m) => [m.reportId, m]));

  let requirementMet = 0;
  let requirementUnmet = 0;
  const unmetByParameter = { head: 0, capacity: 0, power: 0 };
  for (const r of reportsForJudging) {
    const max = maxByReport.get(r.reportId);
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
    const hasAnyTarget = [status.head, status.capacity, status.power].some((v) => v !== null);
    if (!hasAnyTarget) continue; // nothing to judge -- not counted either way
    if (status.head === false) unmetByParameter.head++;
    if (status.capacity === false) unmetByParameter.capacity++;
    if (status.power === false) unmetByParameter.power++;
    if ([status.head, status.capacity, status.power].some((v) => v === false)) requirementUnmet++;
    else requirementMet++;
  }

  // ---- Previous equal-length window, for KPI deltas (only when bounded) ----
  let previous: { total_requisitions: number; total_reports: number } | null = null;
  if (from && to) {
    const fromD = new Date(`${from}T00:00:00Z`);
    const toD = new Date(`${to}T00:00:00Z`);
    const lengthDays = Math.round((toD.getTime() - fromD.getTime()) / 86400000) + 1;
    const prevTo = new Date(fromD.getTime() - 86400000);
    const prevFrom = new Date(prevTo.getTime() - (lengthDays - 1) * 86400000);
    const [prev] = await db
      .select({
        reqs: sql<number>`(select count(*)::int from ${testRequisitions} where ${dateRange(reqDateCol, isoDay(prevFrom), isoDay(prevTo))} and ${ownOnly})`,
        reps: sql<number>`(select count(*)::int from ${pumpTestReports} where ${dateRange(reportDateCol, isoDay(prevFrom), isoDay(prevTo))} and ${reportScope})`,
      })
      .from(pumpTestReports)
      .limit(1);
    previous = { total_requisitions: toNum(prev?.reqs), total_reports: toNum(prev?.reps) };
  }

  const enrichedLatest = await enrichReports(latestReports);

  // Reports by category -- the category each report states for itself (lib/reportCategory.ts).
  const reportCategoryCounts = new Map<string, number>();
  for (const r of reportsInRange) {
    const key = reportCategoryOf(r);
    reportCategoryCounts.set(key, (reportCategoryCounts.get(key) ?? 0) + 1);
  }
  const reportsByCategory = REPORT_CATEGORY_ORDER.filter((key) => (reportCategoryCounts.get(key) ?? 0) > 0).map((key) => ({
    key,
    label: reportCategoryLabel(key),
    count: reportCategoryCounts.get(key) ?? 0,
  }));

  // Requisitions AND reports by category, for the Dashboard's "Requisitions by category" table.
  // Total = requisitions raised + reports filed in that category (same "everything on record" rule
  // as the Totals card). Completed = Closed requisitions + every report (a filed report is, by
  // definition, finished testing -- reports carry no status of their own to be "pending" in).
  // Pending = requisitions not yet Closed; a report is never counted as pending. That keeps
  // Total = Completed + Pending exactly, the same identity the Totals card uses.
  const categoryStatusTotals = new Map<string, { reqTotal: number; reqCompleted: number }>();
  for (const row of byCategory) {
    const key = row.category ?? "Uncategorised";
    const entry = categoryStatusTotals.get(key) ?? { reqTotal: 0, reqCompleted: 0 };
    entry.reqTotal += toNum(row.n);
    if (row.status === "Closed") entry.reqCompleted += toNum(row.n);
    categoryStatusTotals.set(key, entry);
  }
  // Requisitions use `null` -> "Uncategorised"; reports use reportCategoryOf's REPORT_CATEGORY_NONE
  // ("none", labelled "Not stated on the report") -- folded into the same "Uncategorised" row here.
  const reportCountFor = (key: string) => reportCategoryCounts.get(key) ?? 0;
  // Fixed category order (matches the intake form), "Uncategorised" last, empty categories omitted.
  const requisitionsByCategoryStatus = [...REQUISITION_CATEGORIES, "Uncategorised"]
    .filter((key) => categoryStatusTotals.has(key) || reportCountFor(key === "Uncategorised" ? REPORT_CATEGORY_NONE : key) > 0)
    .map((key) => {
      const { reqTotal, reqCompleted } = categoryStatusTotals.get(key) ?? { reqTotal: 0, reqCompleted: 0 };
      const reports = reportCountFor(key === "Uncategorised" ? REPORT_CATEGORY_NONE : key);
      return {
        label: key,
        total: reqTotal + reports,
        completed: reqCompleted + reports,
        pending: reqTotal - reqCompleted,
        requisitions: reqTotal,
        reports,
      };
    });

  const raiserCounts = new Map(RAISED_BY_GROUPS.map((g) => [g, 0]));
  for (const r of raiserRows) {
    const group = raisedByGroup(r.role);
    raiserCounts.set(group, (raiserCounts.get(group) ?? 0) + toNum(r.n));
  }

  const countByMonth = (rows: { month: string; n: number }[]) => {
    const m = new Map(rows.map((r) => [r.month, toNum(r.n)]));
    return (key: string) => m.get(key) ?? 0;
  };
  const raised = countByMonth(raisedByMonth);
  const filed = countByMonth(reportsByMonth);
  const closed = countByMonth(closedByMonth);

  const workloadByPerson = new Map<string, { pending: number; in_testing: number; retest_needed: number }>();
  for (const row of workloadRows) {
    // A blank name counts as unassigned too, matching the list's "none" filter.
    const key = row.person?.trim() ? row.person : "Unassigned";
    const entry = workloadByPerson.get(key) ?? { pending: 0, in_testing: 0, retest_needed: 0 };
    if (row.status === "Pending") entry.pending += toNum(row.n);
    if (row.status === "In Testing") entry.in_testing += toNum(row.n);
    if (row.status === "Retest Needed") entry.retest_needed += toNum(row.n);
    workloadByPerson.set(key, entry);
  }

  const matrixCategories = [...new Set(matrixRows.map((r) => r.category ?? "Uncategorised"))];
  const matrixLookup = new Map(matrixRows.map((r) => [`${r.category ?? "Uncategorised"}|${r.month}`, toNum(r.n)]));

  return json({
    total_requisitions: toNum(totals[0]?.totalRequisitions),
    requisitions_by_status: Object.fromEntries(requisitionsByStatus.map((r) => [r.status, toNum(r.n)])),
    total_reports: toNum(totals[0]?.totalReports),
    reports_by_format: Object.fromEntries(reportsByFormat.map((r) => [r.format ?? "observation", toNum(r.n)])),
    total_test_points: toNum(totals[0]?.totalPoints),
    distinct_models_tested: toNum(totals[0]?.distinctModels),
    requirement_met: requirementMet,
    requirement_unmet: requirementUnmet,
    unmet_by_parameter: unmetByParameter,
    open_statuses: OPEN_STATUSES,
    overdue_count: toNum(deadlineCounts[0]?.overdue),
    due_soon_count: toNum(deadlineCounts[0]?.dueSoon),
    avg_turnaround_days: turnaround[0]?.avgDays === null || turnaround[0]?.avgDays === undefined ? null : Number(turnaround[0].avgDays),
    previous_period: previous,
    trend_granularity: daily ? "day" : "month",
    monthly_trend: months.map((m) => ({ month: m, raised: raised(m), reports: filed(m), closed: closed(m) })),
    by_category: [...categoryStatusTotals.entries()]
      .map(([label, { reqTotal }]) => ({ label, count: reqTotal }))
      .sort((a, b) => b.count - a.count),
    requisitions_by_category_status: requisitionsByCategoryStatus,
    total_reports_all_time: toNum(allTimeReports?.n),
    reports_by_category: reportsByCategory,
    by_raiser: RAISED_BY_GROUPS.map((group) => ({ group, label: RAISED_BY_LABELS[group], count: raiserCounts.get(group) ?? 0 })),
    by_source_team: bySourceTeam
      .map((r) => ({ label: r.team?.trim() ? r.team : "Unspecified", count: toNum(r.n) }))
      .sort((a, b) => b.count - a.count),
    workload: [...workloadByPerson.entries()]
      .map(([person, c]) => ({ person, ...c, total: c.pending + c.in_testing + c.retest_needed }))
      .sort((a, b) => b.total - a.total),
    category_matrix: {
      months,
      rows: matrixCategories.map((category) => ({
        category,
        counts: months.map((m) => matrixLookup.get(`${category}|${m}`) ?? 0),
      })),
    },
    upcoming_deadlines: upcoming.map((u) => ({
      id: u.id,
      requisition_no: u.requisitionNo,
      model: u.model,
      ec_quotation_no: u.ecQuotationNo,
      status: u.status,
      responsible_person: u.responsiblePerson,
      target_date: u.targetDate,
      days_left: toNum(u.daysLeft),
    })),
    recent_reports: enrichedLatest.map((r) => ({
      id: r.id,
      report_no: r.report_no,
      model: r.model,
      report_format: r.report_format,
      date: r.test_date ?? (r.created_at ? new Date(r.created_at).toISOString().slice(0, 10) : null),
      unmet_fields: r.requirement_unmet_fields,
      // Same rule as the pass rate and Report Compilation: a rated target WITH a measured value to compare.
      has_target: r.has_target,
    })),
  });
}
