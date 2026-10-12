import { eq, sql } from "drizzle-orm";

import { actionRegistryToDict, error, json, requisitionToDict } from "@/lib/api";
import { getClientIp, logAudit } from "@/lib/audit";
import { AuthError, decodeToken } from "@/lib/auth";
import { db } from "@/lib/db";
import { actionRegistry, pumpTestReportPoints, testRequisitions, users } from "@/lib/db/schema";
import { findReportByIdOrNo } from "@/lib/reportLookup";
import { computeRequirementStatus, unmetRequirementLabels } from "@/lib/requirementCheck";

export const dynamic = "force-dynamic";

const maxOf = (values: (number | null)[]): number | null => {
  const nums = values.filter((v): v is number => v !== null);
  return nums.length ? Math.max(...nums) : null;
};

/**
 * Raises a fresh Pending requisition for this report's model, Retest Needed
 * pre-set, so a report that missed its rated Head/Capacity/Power can go
 * straight back into the testing queue instead of someone re-typing the
 * intake fields by hand -- and records an Action Registry entry (unmet
 * fields, rated/measured snapshot, any action points the assigner typed in,
 * who assigned it, who raised the original test) so there's a durable trail
 * of why. Admin / Central Admin only -- see CLAUDE.md's role table.
 *
 * Rated targets and unit labels are pulled from the REPORT itself (already
 * normalized to KG/CM2 / M3/HR, see unitConversion.ts), not the original
 * requisition -- the report is what was actually tested against. Category /
 * EC-Quotation No. / Responsible Person / Source Team are only available
 * when this report has a linked requisition to carry them over from
 * (standalone/historical reports don't have one); left blank otherwise for
 * whoever picks this up to fill in.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  let claims;
  try {
    claims = await decodeToken(req);
  } catch (e) {
    if (e instanceof AuthError) return error(e.message, e.statusCode);
    throw e;
  }
  if (claims.role !== "admin" && claims.role !== "central-admin") {
    return error("Only Admin or Central Admin can assign a retest.", 403);
  }

  const { id: idOrNo } = await params;

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    // No body (or an empty one) is fine -- action points are optional.
  }
  const actionPoints = Array.isArray(body.action_points)
    ? (body.action_points as unknown[]).map((v) => String(v).trim()).filter((v) => v !== "")
    : [];

  const report = await findReportByIdOrNo(idOrNo);
  if (!report) {
    return error("Report not found", 404);
  }
  const id = report.id;

  const points = await db.select().from(pumpTestReportPoints).where(eq(pumpTestReportPoints.reportId, id));
  const measuredHeads = points.map((p) => (p.headKgcm2 === null ? null : Number(p.headKgcm2)));
  const measuredCapacities = points.map((p) => (p.capacityCalculatedM3hr === null ? null : Number(p.capacityCalculatedM3hr)));
  const measuredPowers = points.map((p) => (p.powerCalculatedKw === null ? null : Number(p.powerCalculatedKw)));

  const status = computeRequirementStatus(
    {
      rated_head: report.ratedHead === null ? null : Number(report.ratedHead),
      rated_capacity: report.ratedCapacity === null ? null : Number(report.ratedCapacity),
      rated_power_kw: report.ratedPowerKw === null ? null : Number(report.ratedPowerKw),
    },
    points.map((p) => ({
      head_kgcm2: p.headKgcm2 === null ? null : Number(p.headKgcm2),
      capacity_calculated_m3hr: p.capacityCalculatedM3hr === null ? null : Number(p.capacityCalculatedM3hr),
      power_calculated_kw: p.powerCalculatedKw === null ? null : Number(p.powerCalculatedKw),
    }))
  );
  const unmetLabels = unmetRequirementLabels(status);
  if (unmetLabels.length === 0) {
    return error("This report already met its rated requirement -- nothing to retest.", 400);
  }

  const original = report.requisitionId
    ? (await db.select().from(testRequisitions).where(eq(testRequisitions.id, report.requisitionId)).limit(1))[0]
    : undefined;

  const [assigner] = await db.select().from(users).where(eq(users.id, claims.sub)).limit(1);
  const submittedBy = assigner?.name ?? claims.email;
  const originallyRaisedBy = original?.submittedBy ?? report.testedBy ?? report.preparedBy ?? null;

  const seqResult = await db.execute<{ n: number }>(
    sql`select nextval('test_requisitions_requisition_no_seq') as n`
  );
  const requisitionNo = `REQ-${String(seqResult.rows[0].n).padStart(6, "0")}`;

  const [requisition] = await db
    .insert(testRequisitions)
    .values({
      requisitionNo,
      model: report.model,
      category: original?.category ?? null,
      ecQuotationNo: original?.ecQuotationNo ?? null,
      responsiblePerson: original?.responsiblePerson ?? null,
      sourceTeam: original?.sourceTeam ?? null,
      dateOfRequisition: new Date().toISOString().slice(0, 10),
      qth: report.qTheoretical100rev,
      powerKw: report.ratedPowerKw,
      headKgcm2: report.ratedHead,
      headUnit: report.ratedHead !== null ? "KG/CM2" : null,
      rpm: report.ratedRpm,
      motorRpm: report.motorRpm,
      reqCapacity: report.ratedCapacity,
      reqCapacityUnit: report.ratedCapacity !== null ? "M3/HR" : null,
      status: "Pending",
      retestNeeded: true,
      generalRemarks: `Retest assigned from report ${report.reportNo ?? report.id} -- outside rated ${unmetLabels.join(", ")}.`,
      createdBy: claims.sub,
      submittedBy,
    } as typeof testRequisitions.$inferInsert)
    .returning();

  const [registryEntry] = await db
    .insert(actionRegistry)
    .values({
      requisitionId: requisition.id,
      reportId: report.id,
      model: report.model,
      reportNo: report.reportNo,
      unmetFields: unmetLabels.join(", "),
      ratedHead: report.ratedHead,
      measuredHead: maxOf(measuredHeads),
      ratedCapacity: report.ratedCapacity,
      measuredCapacity: maxOf(measuredCapacities),
      ratedPowerKw: report.ratedPowerKw,
      measuredPowerKw: maxOf(measuredPowers),
      actionPoints: actionPoints.length ? actionPoints.join("\n") : null,
      assignedBy: claims.sub,
      assignedByName: submittedBy,
      originallyRaisedBy,
    } as typeof actionRegistry.$inferInsert)
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
    details: `Retest assigned from report ${report.reportNo ?? report.id} (outside rated ${unmetLabels.join(", ")})`,
  });

  return json(
    {
      requisition: requisitionToDict(requisition),
      action_registry_entry: actionRegistryToDict(registryEntry),
    },
    201
  );
}
