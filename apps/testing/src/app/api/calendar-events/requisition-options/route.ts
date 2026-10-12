import { desc, eq } from "drizzle-orm";

import { error, json } from "@/lib/api";
import { AuthError, decodeToken } from "@/lib/auth";
import { db } from "@/lib/db";
import { testRequisitions } from "@/lib/db/schema";

export const dynamic = "force-dynamic";

/** Requisition numbers for the New Event form's search box, each with enough context (model, EC /
 * quotation, status) to tell them apart in the pick list. Same visibility rule as the requisition list: a
 * Source Team user only sees their own, everyone else sees all. The full record is then fetched through
 * GET /api/requisitions/[id], which applies its own access check. Newest first. */
export async function GET(req: Request) {
  let claims;
  try {
    claims = await decodeToken(req);
  } catch (e) {
    if (e instanceof AuthError) return error(e.message, e.statusCode);
    throw e;
  }

  const rows = await db
    .select({
      requisitionNo: testRequisitions.requisitionNo,
      model: testRequisitions.model,
      ecQuotationNo: testRequisitions.ecQuotationNo,
      status: testRequisitions.status,
    })
    .from(testRequisitions)
    .where(claims.role === "source" ? eq(testRequisitions.createdBy, claims.sub) : undefined)
    .orderBy(desc(testRequisitions.createdAt))
    .limit(2000);

  return json(
    rows
      .filter((r) => r.requisitionNo)
      .map((r) => ({ requisition_no: r.requisitionNo, model: r.model, ec_quotation_no: r.ecQuotationNo, status: r.status }))
  );
}
