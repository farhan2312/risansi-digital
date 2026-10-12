import { and, desc, eq, isNotNull, sql } from "drizzle-orm";

import { error, json } from "@/lib/api";
import { AuthError, decodeToken } from "@/lib/auth";
import { db } from "@/lib/db";
import { testRequisitions } from "@/lib/db/schema";

export const dynamic = "force-dynamic";

/** Distinct Model / Submitted By / calendar-month values for the Testing
 * Summary filter bar's dropdowns -- these must reflect every requisition in
 * the current status tab, not just whatever page of 25 is currently
 * loaded, so they're computed here as their own lightweight DISTINCT
 * queries rather than derived from the (now paginated) row list. Scoped to
 * `status` the same way GET /api/requisitions is (a status-tab switch
 * changes the option lists too), and to the caller's own requisitions for
 * the "source" role, matching that same visibility rule. */
export async function GET(req: Request) {
  let claims;
  try {
    claims = await decodeToken(req);
  } catch (e) {
    if (e instanceof AuthError) return error(e.message, e.statusCode);
    throw e;
  }

  const status = new URL(req.url).searchParams.get("status");
  const conditions = [];
  if (status) conditions.push(eq(testRequisitions.status, status));
  if (claims.role === "source") conditions.push(eq(testRequisitions.createdBy, claims.sub));
  const where = conditions.length ? and(...conditions) : undefined;

  const [models, submittedBy, months] = await Promise.all([
    db
      .selectDistinct({ value: testRequisitions.model })
      .from(testRequisitions)
      .where(where)
      .orderBy(testRequisitions.model),
    db
      .selectDistinct({ value: testRequisitions.submittedBy })
      .from(testRequisitions)
      .where(where ? and(where, isNotNull(testRequisitions.submittedBy)) : isNotNull(testRequisitions.submittedBy))
      .orderBy(testRequisitions.submittedBy),
    db
      .selectDistinct({ value: sql<string>`substring(${testRequisitions.dateOfRequisition}::text, 1, 7)` })
      .from(testRequisitions)
      .where(
        where
          ? and(where, isNotNull(testRequisitions.dateOfRequisition))
          : isNotNull(testRequisitions.dateOfRequisition)
      )
      .orderBy(desc(sql`substring(${testRequisitions.dateOfRequisition}::text, 1, 7)`)),
  ]);

  return json({
    models: models.map((m) => m.value).filter((v): v is string => Boolean(v)),
    submitted_by: submittedBy.map((s) => s.value).filter((v): v is string => Boolean(v)),
    months: months.map((m) => m.value).filter((v): v is string => Boolean(v)),
  });
}
