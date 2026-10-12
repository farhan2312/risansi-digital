import { and, desc, eq, ilike, inArray, isNull, sql } from "drizzle-orm";

import { error, json, requisitionToDict } from "@/lib/api";
import { getClientIp, logAudit } from "@/lib/audit";
import { AuthError, decodeToken } from "@/lib/auth";
import { db } from "@/lib/db";
import { pumpTestReportPoints, pumpTestReports, testRequisitions, users } from "@/lib/db/schema";
import { offsetFor, PAGE_SIZE, parsePage } from "@/lib/pagination";
import { isRaisedByGroup, raisedByGroup } from "@/lib/raisedBy";
import { autoResponsiblePerson } from "@/lib/requisitionAssignment";
import { computeRequirementStatus, unmetRequirementLabels } from "@/lib/requirementCheck";

export const dynamic = "force-dynamic";

const CAMEL_BY_SNAKE = {
  model: "model",
  category: "category",
  ec_quotation_no: "ecQuotationNo",
  offer_date: "offerDate",
  responsible_person: "responsiblePerson",
  source_team: "sourceTeam",
  date_of_requisition: "dateOfRequisition",
  test_qty: "testQty",
  qth: "qth",
  specific_gravity: "specificGravity",
  power_hp: "powerHp",
  power_kw: "powerKw",
  head_kgcm2: "headKgcm2",
  head_unit: "headUnit",
  rpm: "rpm",
  motor_rpm: "motorRpm",
  req_capacity: "reqCapacity",
  req_capacity_unit: "reqCapacityUnit",
  media_type: "mediaType",
  target_date: "targetDate",
  general_remarks: "generalRemarks",
};

type RequisitionRow = typeof testRequisitions.$inferSelect;

/** Attaches report_id/report_no/report_requirement_unmet_fields to a set of
 * requisition rows -- whether the linked report (if any) reached its rated
 * head/capacity/power, aggregated in SQL from its points rather than
 * shipped down to compute in the list view. Shared by every path below. */
async function reportStatusFor(rows: RequisitionRow[]) {
  const requisitionIds = rows.map((r) => r.id);
  const reports = requisitionIds.length
    ? await db
        .select({
          id: pumpTestReports.id,
          reportNo: pumpTestReports.reportNo,
          requisitionId: pumpTestReports.requisitionId,
          ratedHead: pumpTestReports.ratedHead,
          ratedCapacity: pumpTestReports.ratedCapacity,
          ratedPowerKw: pumpTestReports.ratedPowerKw,
        })
        .from(pumpTestReports)
        .where(inArray(pumpTestReports.requisitionId, requisitionIds))
    : [];
  const reportIdByRequisition = new Map(reports.map((r) => [r.requisitionId, r.id]));
  const reportNoByRequisition = new Map(reports.map((r) => [r.requisitionId, r.reportNo]));

  const reportIds = reports.map((r) => r.id);
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

  // "Judged" = a rated Head/Capacity/Power WITH a measured value to compare it with -- the same rule the
  // Overview pass rate and Report Compilation use (lib/reportVerdict.ts). A report that has a rating but
  // no readings is not judged, instead of being counted as Met.
  const judgedByRequisition = new Set<string | null>();
  const unmetByRequisition = new Map(
    reports.map((r) => {
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
      if ([status.head, status.capacity, status.power].some((v) => v !== null)) judgedByRequisition.add(r.requisitionId);
      return [r.requisitionId, unmetRequirementLabels(status)];
    })
  );

  // Who raised each one -- the creator's current role, bucketed Source / Testing / Other.
  const creatorIds = [...new Set(rows.map((r) => r.createdBy).filter((id): id is string => !!id))];
  const creators = creatorIds.length
    ? await db.select({ id: users.id, role: users.role }).from(users).where(inArray(users.id, creatorIds))
    : [];
  const roleByUser = new Map(creators.map((u) => [u.id, u.role]));
  const raisedByGroupByRequisition = new Map(
    rows.map((r) => [r.id, raisedByGroup(r.createdBy ? roleByUser.get(r.createdBy) : null)])
  );

  return { reportIdByRequisition, reportNoByRequisition, unmetByRequisition, judgedByRequisition, raisedByGroupByRequisition };
}

function dictify(
  rows: RequisitionRow[],
  status: Awaited<ReturnType<typeof reportStatusFor>>
) {
  return rows.map((r) => ({
    ...requisitionToDict(r),
    report_id: status.reportIdByRequisition.get(r.id) ?? null,
    report_no: status.reportNoByRequisition.get(r.id) ?? null,
    report_requirement_unmet_fields: status.unmetByRequisition.get(r.id) ?? [],
    raised_by_group: status.raisedByGroupByRequisition.get(r.id) ?? "other",
  }));
}

/** Server-paginated, 25/page, with the Testing Summary filter bar's full
 * filter set applied as SQL WHERE clauses. The one exception is
 * `report_result` (Green/Met vs Red/Not-Met) -- it depends on a computed
 * aggregate (see reportStatusFor above), not a plain column, so it can't be
 * pushed into SQL. It's only ever used already narrowed to one Category
 * (see the frontend), so that path fetches every row matching the other
 * filters, computes status, filters and paginates in memory instead. */
export async function GET(req: Request) {
  let claims;
  try {
    claims = await decodeToken(req);
  } catch (e) {
    if (e instanceof AuthError) return error(e.message, e.statusCode);
    throw e;
  }

  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status");
  const model = searchParams.get("model");
  const ecQuotationNo = searchParams.get("ec_quotation_no");
  const category = searchParams.get("category");
  const sourceTeam = searchParams.get("source_team");
  const responsiblePerson = searchParams.get("responsible_person");
  const submittedBy = searchParams.get("submitted_by");
  const retestNeeded = searchParams.get("retest_needed");
  const month = searchParams.get("month");
  const dateFrom = searchParams.get("date_from");
  const dateTo = searchParams.get("date_to");
  const reportResult = searchParams.get("report_result");
  const scope = searchParams.get("scope");
  const raisedBy = searchParams.get("raised_by");
  const page = parsePage(req);

  const conditions = [];
  if (status) conditions.push(eq(testRequisitions.status, status));
  // Source teams only see the requisitions they personally raised — testing
  // team and admins still see everything, since they process all of them.
  if (claims.role === "source") conditions.push(eq(testRequisitions.createdBy, claims.sub));
  if (model) conditions.push(eq(testRequisitions.model, model));
  if (ecQuotationNo) conditions.push(ilike(testRequisitions.ecQuotationNo, `%${ecQuotationNo}%`));
  // "none" = requisitions raised without a category (the Overview's "Uncategorised" bar).
  if (category === "none") conditions.push(isNull(testRequisitions.category));
  else if (category) conditions.push(eq(testRequisitions.category, category));
  // "none" = no Source Team set (the Overview's "Unspecified" bar); blank counts as unset too.
  if (sourceTeam === "none") {
    conditions.push(sql`(${testRequisitions.sourceTeam} is null or trim(${testRequisitions.sourceTeam}) = '')`);
  } else if (sourceTeam) {
    conditions.push(eq(testRequisitions.sourceTeam, sourceTeam));
  }
  // "none" = no Responsible Person assigned (the Overview workload card's "Unassigned" bar).
  if (responsiblePerson === "none") {
    conditions.push(sql`(${testRequisitions.responsiblePerson} is null or trim(${testRequisitions.responsiblePerson}) = '')`);
  } else if (responsiblePerson) {
    conditions.push(eq(testRequisitions.responsiblePerson, responsiblePerson));
  }
  if (submittedBy) conditions.push(eq(testRequisitions.submittedBy, submittedBy));
  if (retestNeeded === "true") conditions.push(eq(testRequisitions.retestNeeded, true));
  if (retestNeeded === "false") conditions.push(eq(testRequisitions.retestNeeded, false));
  if (month) conditions.push(sql`substring(${testRequisitions.dateOfRequisition}::text, 1, 7) = ${month}`);
  // A requisition with no "date of requisition" counts on the day it was
  // created -- the same fallback the Overview dashboard uses, so a range
  // clicked through from there lists exactly the rows its cards counted.
  const requisitionDay = sql`coalesce(${testRequisitions.dateOfRequisition}, ${testRequisitions.createdAt}::date)`;
  if (dateFrom) conditions.push(sql`${requisitionDay} >= ${dateFrom}`);
  if (dateTo) conditions.push(sql`${requisitionDay} <= ${dateTo}`);
  // Overview drill-downs: open (any not-yet-closed status), overdue, or due
  // within 5 days -- judged on the same effective target date the list shows
  // (explicit target_date, else date of requisition + 7).
  // Raised by: the creator account's role -- Source Team, Testing Team, or
  // anyone else (admins, central admins, deleted accounts, unknown creator).
  if (isRaisedByGroup(raisedBy)) {
    if (raisedBy === "other") {
      conditions.push(
        sql`(${testRequisitions.createdBy} is null or ${testRequisitions.createdBy} not in (select ${users.id} from ${users} where ${users.role} in ('source', 'testing')))`
      );
    } else {
      conditions.push(sql`${testRequisitions.createdBy} in (select ${users.id} from ${users} where ${users.role} = ${raisedBy})`);
    }
  }
  if (scope === "open" || scope === "overdue" || scope === "due_soon") {
    const effTarget = sql`coalesce(${testRequisitions.targetDate}, coalesce(${testRequisitions.dateOfRequisition}, ${testRequisitions.createdAt}::date) + 7)`;
    conditions.push(inArray(testRequisitions.status, ["Pending", "In Testing", "Retest Needed"]));
    if (scope === "overdue") conditions.push(sql`${effTarget} < current_date`);
    if (scope === "due_soon") {
      conditions.push(sql`${effTarget} >= current_date and ${effTarget} <= current_date + 5::int`);
    }
  }
  const where = conditions.length ? and(...conditions) : undefined;

  // Every-other-filter-but-report_result scope -- backs the Met / Missed pill
  // counts, regardless of which pill (if any) is currently selected. Computed
  // once a Category is picked, on the Closed tab, or whenever a result is
  // asked for (the Overview's Pass rate links straight to Closed + Met/Missed).
  // Only Closed requisitions whose report has a rated target are judged.
  let reportResultCounts: { green: number; red: number } | null = null;
  if (category || status === "Closed" || reportResult === "green" || reportResult === "red") {
    const scopedRows = await db.select().from(testRequisitions).where(where).orderBy(desc(testRequisitions.createdAt));
    const scopedStatus = await reportStatusFor(scopedRows);
    let green = 0;
    let red = 0;
    for (const r of scopedRows) {
      if (r.status !== "Closed" || !scopedStatus.judgedByRequisition.has(r.id)) continue;
      const unmet = (scopedStatus.unmetByRequisition.get(r.id) ?? []).length > 0;
      if (unmet) red += 1;
      else green += 1;
    }
    reportResultCounts = { green, red };

    if (reportResult === "green" || reportResult === "red") {
      const filtered = scopedRows.filter((r) => {
        if (r.status !== "Closed" || !scopedStatus.judgedByRequisition.has(r.id)) return false;
        const unmet = (scopedStatus.unmetByRequisition.get(r.id) ?? []).length > 0;
        return reportResult === "red" ? unmet : !unmet;
      });
      const pageRows = filtered.slice(offsetFor(page), offsetFor(page) + PAGE_SIZE);
      return json({
        entries: dictify(pageRows, scopedStatus),
        total: filtered.length,
        page,
        page_size: PAGE_SIZE,
        report_result_counts: reportResultCounts,
      });
    }
  }

  const [rows, [{ count }]] = await Promise.all([
    db
      .select()
      .from(testRequisitions)
      .where(where)
      .orderBy(desc(testRequisitions.createdAt))
      .limit(PAGE_SIZE)
      .offset(offsetFor(page)),
    db.select({ count: sql<number>`count(*)::int` }).from(testRequisitions).where(where),
  ]);
  const rowStatus = await reportStatusFor(rows);

  return json({
    entries: dictify(rows, rowStatus),
    total: count,
    page,
    page_size: PAGE_SIZE,
    report_result_counts: reportResultCounts,
  });
}

export async function POST(req: Request) {
  let claims;
  try {
    claims = await decodeToken(req);
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

  if (!body.model) {
    return error("'model' is required", 400);
  }

  const values: Record<string, unknown> = {};
  for (const [snakeKey, camelKey] of Object.entries(CAMEL_BY_SNAKE)) {
    if (body[snakeKey] !== undefined && body[snakeKey] !== "") {
      values[camelKey] = body[snakeKey];
    }
  }

  // Assignment follows the category (EC-based -> Vikash, everything else -> Sachin), never the
  // request body -- see lib/requisitionAssignment.ts.
  values.responsiblePerson = autoResponsiblePerson(values.category as string | undefined);

  // "Submitted By" is always the logged-in creator, resolved server-side —
  // never trusted from the request body.
  const [creator] = await db.select().from(users).where(eq(users.id, claims.sub)).limit(1);
  const submittedBy = creator?.name ?? claims.email;

  const seqResult = await db.execute<{ n: number }>(
    sql`select nextval('test_requisitions_requisition_no_seq') as n`
  );
  const requisitionNo = `REQ-${String(seqResult.rows[0].n).padStart(6, "0")}`;

  const [requisition] = await db
    .insert(testRequisitions)
    .values({
      ...values,
      requisitionNo,
      status: "Pending",
      createdBy: claims.sub,
      submittedBy,
    } as typeof testRequisitions.$inferInsert)
    .returning();

  await logAudit({
    ipAddress: getClientIp(req),
    userId: claims.sub,
    userName: submittedBy,
    userEmail: claims.email,
    eventType: "create",
    entityType: "requisition",
    entityId: requisition.id,
    entityLabel: requisition.model,
  });

  return json(requisitionToDict(requisition), 201);
}
