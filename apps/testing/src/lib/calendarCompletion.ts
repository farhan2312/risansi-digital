/**
 * "To complete a test you fill its report." A calendar event can point at a requisition; marking such an
 * event Completed is only allowed once a test report has been filed against that requisition. Events with
 * no requisition (a meeting, a calibration) are not tests and complete freely.
 */
import { eq } from "drizzle-orm";

import { db } from "./db";
import { pumpTestReports } from "./db/schema";
import { findRequisitionByIdOrNo } from "./requisitionLookup";

/** Thrown for a request the caller got wrong; the route turns it into the given HTTP status. */
export class CalendarRuleError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "CalendarRuleError";
    this.status = status;
  }
}

export const MISSING_LINK_MESSAGE =
  "Pick the requisition this test is for, or mark the event as a Meeting or Calibration if it is not a test.";

/** The canonical REQ-number for whatever the caller typed (a number or the uuid), or null for blank. */
export async function resolveLinkedRequisition(raw: unknown): Promise<{ id: string; requisitionNo: string } | null> {
  if (raw === undefined || raw === null || raw === "") return null;
  if (typeof raw !== "string") throw new CalendarRuleError("'requisition_no' must be text");
  const found = await findRequisitionByIdOrNo(raw.trim());
  if (!found || !found.requisitionNo) throw new CalendarRuleError("That requisition was not found", 400);
  return { id: found.id, requisitionNo: found.requisitionNo };
}

/** Refuses (409) when the requisition has no filed test report yet. */
export async function requireReportFiled(requisition: { id: string; requisitionNo: string }): Promise<void> {
  const [report] = await db
    .select({ id: pumpTestReports.id })
    .from(pumpTestReports)
    .where(eq(pumpTestReports.requisitionId, requisition.id))
    .limit(1);
  if (!report) {
    throw new CalendarRuleError(
      `Fill the test report for ${requisition.requisitionNo} before marking this test Completed.`,
      409
    );
  }
}
