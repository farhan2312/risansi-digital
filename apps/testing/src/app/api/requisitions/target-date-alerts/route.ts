import { and, eq, inArray, sql } from "drizzle-orm";

import { error, json } from "@/lib/api";
import { AuthError, decodeToken } from "@/lib/auth";
import { db } from "@/lib/db";
import { testRequisitions, users } from "@/lib/db/schema";

export const dynamic = "force-dynamic";

const ALERT_STATUSES = ["Pending", "Retest Needed"];
const LEAD_DAYS = 5;

/** Backs the sidebar target-date bell -- every Pending / Retest Needed
 * requisition whose target date is within the next 5 days (or already
 * past it, which is more urgent still, not less), matched to the caller by
 * Responsible Person. That field is a plain name (see RESPONSIBLE_PERSONS,
 * not a real FK to `users`), so the match is a case-insensitive "does the
 * logged-in user's name start with this responsible_person" check -- same
 * informal name-snapshot convention the rest of this app already uses
 * (submitted_by, prepared_by), not a strict equality. */
export async function GET(req: Request) {
  let claims;
  try {
    claims = await decodeToken(req);
  } catch (e) {
    if (e instanceof AuthError) return error(e.message, e.statusCode);
    throw e;
  }

  const [caller] = await db.select({ name: users.name }).from(users).where(eq(users.id, claims.sub)).limit(1);
  const name = (caller?.name ?? "").trim().toLowerCase();
  if (!name) return json({ count: 0, items: [] });

  // Same effective target date the Testing Summary shows (formUtils.ts
  // targetDateFor): explicit target_date only exists for R&D Trials, every
  // other requisition's target is date of requisition + 7 days.
  const effTarget = sql`coalesce(${testRequisitions.targetDate}, coalesce(${testRequisitions.dateOfRequisition}, ${testRequisitions.createdAt}::date) + 7)`;

  const rows = await db
    .select({
      id: testRequisitions.id,
      requisitionNo: testRequisitions.requisitionNo,
      model: testRequisitions.model,
      status: testRequisitions.status,
      targetDate: sql<string>`to_char(${effTarget}, 'YYYY-MM-DD')`,
      responsiblePerson: testRequisitions.responsiblePerson,
    })
    .from(testRequisitions)
    .where(and(inArray(testRequisitions.status, ALERT_STATUSES), sql`${effTarget} <= current_date + ${LEAD_DAYS}::int`));

  const items = rows
    .filter((r) => r.responsiblePerson && name.startsWith(r.responsiblePerson.trim().toLowerCase()))
    .sort((a, b) => (a.targetDate ?? "").localeCompare(b.targetDate ?? ""))
    .map((r) => ({
      id: r.id,
      requisition_no: r.requisitionNo,
      model: r.model,
      status: r.status,
      target_date: r.targetDate,
    }));

  return json({ count: items.length, items });
}
