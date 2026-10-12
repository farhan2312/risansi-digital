/**
 * Same idea as requisitionLookup.ts: every route the URL bar can address a
 * single report by accepts EITHER the real uuid `id` or the human-facing
 * `report_no` ("TR-000159") -- new navigation links use the pretty number,
 * but anything that already stored a raw uuid (Action Registry, Audit Log,
 * any old bookmark) keeps working unchanged. Resolve once here, then use
 * the row's real `.id` for every actual FK-style reference -- never the
 * string the caller passed in.
 */
import { eq } from "drizzle-orm";

import { db } from "./db";
import { pumpTestReports } from "./db/schema";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ReportRow = typeof pumpTestReports.$inferSelect;

export async function findReportByIdOrNo(idOrNo: string): Promise<ReportRow | null> {
  if (UUID_RE.test(idOrNo)) {
    const [byId] = await db.select().from(pumpTestReports).where(eq(pumpTestReports.id, idOrNo)).limit(1);
    if (byId) return byId;
  }
  const [byNo] = await db.select().from(pumpTestReports).where(eq(pumpTestReports.reportNo, idOrNo)).limit(1);
  return byNo ?? null;
}
