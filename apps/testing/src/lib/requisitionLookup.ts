/**
 * Every route the URL bar can address a single requisition by (the detail
 * page, its edit/report sub-routes, and anything that resolves the
 * requisitionId a report is filed against) accepts EITHER the real uuid
 * `id` or the human-facing `requisition_no` ("REQ-000123") -- new
 * navigation links use the pretty number, but anything that already stored
 * a raw uuid (action_registry, audit_logs, any old bookmark) keeps working
 * unchanged. Resolve once here, then use the row's real `.id` for every
 * actual FK-style reference -- never the string the caller passed in.
 */
import { eq } from "drizzle-orm";

import { db } from "./db";
import { testRequisitions } from "./db/schema";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type RequisitionRow = typeof testRequisitions.$inferSelect;

export async function findRequisitionByIdOrNo(idOrNo: string): Promise<RequisitionRow | null> {
  if (UUID_RE.test(idOrNo)) {
    const [byId] = await db.select().from(testRequisitions).where(eq(testRequisitions.id, idOrNo)).limit(1);
    if (byId) return byId;
  }
  const [byNo] = await db.select().from(testRequisitions).where(eq(testRequisitions.requisitionNo, idOrNo)).limit(1);
  return byNo ?? null;
}

/** A report/action-registry-entry only ever stores the requisition's real
 * uuid FK, never its pretty number -- this is the small join anything
 * displaying "which requisition is this linked to" needs. Null in, null out,
 * so callers can pass a possibly-absent requisitionId straight through. */
export async function requisitionNoFor(requisitionId: string | null): Promise<string | null> {
  if (!requisitionId) return null;
  const [row] = await db
    .select({ requisitionNo: testRequisitions.requisitionNo })
    .from(testRequisitions)
    .where(eq(testRequisitions.id, requisitionId))
    .limit(1);
  return row?.requisitionNo ?? null;
}
