import { desc, isNotNull } from "drizzle-orm";

import { error, json } from "@/lib/api";
import { AuthError, decodeToken } from "@/lib/auth";
import { db } from "@/lib/db";
import { pumpTestReports, testRequisitions } from "@/lib/db/schema";

export const dynamic = "force-dynamic";

/** Every EC / Quotation No. already on record -- from requisitions and from reports (most reports
 * are standalone imports with no requisition at all, see reportEnrichment.ts) -- each paired with its
 * model, so picking one on the New Event form can offer to fill in Model too. Read-only reference
 * data, same numbers already visible elsewhere in the portal, so any signed-in user can call this
 * (matches listPumpModels, which isn't role-gated either) -- only creating the event itself is
 * Admin-only. Newest first, capped generously; a free-typed EC number that isn't in this list yet is
 * still accepted by the event form, this is a convenience list, not a restriction. */
export async function GET(req: Request) {
  try {
    await decodeToken(req);
  } catch (e) {
    if (e instanceof AuthError) return error(e.message, e.statusCode);
    throw e;
  }

  const [fromRequisitions, fromReports] = await Promise.all([
    db
      .select({ ec: testRequisitions.ecQuotationNo, model: testRequisitions.model })
      .from(testRequisitions)
      .where(isNotNull(testRequisitions.ecQuotationNo))
      .orderBy(desc(testRequisitions.createdAt))
      .limit(1000),
    db
      .select({ ec: pumpTestReports.ecNo, model: pumpTestReports.model })
      .from(pumpTestReports)
      .where(isNotNull(pumpTestReports.ecNo))
      .orderBy(desc(pumpTestReports.createdAt))
      .limit(1000),
  ]);

  const byEc = new Map<string, string | null>();
  for (const row of [...fromRequisitions, ...fromReports]) {
    const ec = row.ec?.trim();
    if (ec && !byEc.has(ec)) byEc.set(ec, row.model);
  }

  return json(
    [...byEc.entries()]
      .map(([ec_quotation_no, model]) => ({ ec_quotation_no, model }))
      .sort((a, b) => a.ec_quotation_no.localeCompare(b.ec_quotation_no))
  );
}
