import { and, asc, eq, gte, lte } from "drizzle-orm";

import { calendarEventToDict, error, json } from "@/lib/api";
import { getClientIp, logAudit } from "@/lib/audit";
import { AuthError, decodeToken } from "@/lib/auth";
import { canCreateCalendarEvent } from "@/lib/calendarPermissions";
import { db } from "@/lib/db";
import { calendarEvents, users } from "@/lib/db/schema";
import { CalendarRuleError, MISSING_LINK_MESSAGE, requireReportFiled, resolveLinkedRequisition } from "@/lib/calendarCompletion";
import { CALENDAR_EVENT_STATUSES, CALENDAR_EVENT_TYPES, RESPONSIBLE_PERSONS } from "@/types/testing";

export const dynamic = "force-dynamic";

const dayParam = (v: string | null) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);

/** Testing Calendar: pump-testing-related events (a scheduled test, calibration, a team meeting),
 * not tied to any requisition/report. Everyone signed in can view it; the Testing Team and Admin
 * can create, update and delete (see PATCH/DELETE on /api/calendar-events/[id]). */
export async function GET(req: Request) {
  try {
    await decodeToken(req);
  } catch (e) {
    if (e instanceof AuthError) return error(e.message, e.statusCode);
    throw e;
  }

  const { searchParams } = new URL(req.url);
  const from = dayParam(searchParams.get("from"));
  const to = dayParam(searchParams.get("to"));
  const conditions = [];
  if (from) conditions.push(gte(calendarEvents.eventDate, from));
  if (to) conditions.push(lte(calendarEvents.eventDate, to));

  const rows = await db
    .select()
    .from(calendarEvents)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(asc(calendarEvents.eventDate), asc(calendarEvents.startTime));

  return json(rows.map(calendarEventToDict));
}

export async function POST(req: Request) {
  let claims;
  try {
    claims = await decodeToken(req);
  } catch (e) {
    if (e instanceof AuthError) return error(e.message, e.statusCode);
    throw e;
  }
  if (!canCreateCalendarEvent(claims.role)) {
    return error("Only an admin or the testing team can create calendar events.", 403);
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return error("Request body must be JSON", 400);
  }

  const title = typeof body.title === "string" ? body.title.trim() : "";
  const eventDate = typeof body.event_date === "string" ? body.event_date.trim() : "";
  if (!title) return error("'title' is required", 400);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(eventDate)) return error("'event_date' must be a YYYY-MM-DD date", 400);
  const responsiblePerson = typeof body.responsible_person === "string" ? body.responsible_person.trim() : "";
  if (!RESPONSIBLE_PERSONS.includes(responsiblePerson as (typeof RESPONSIBLE_PERSONS)[number])) {
    return error(`'responsible_person' must be one of: ${RESPONSIBLE_PERSONS.join(", ")}`, 400);
  }
  const status = typeof body.status === "string" && CALENDAR_EVENT_STATUSES.includes(body.status as never) ? body.status : "Planned";

  // Every event is a Test unless marked a Meeting / Calibration. A Test must name its requisition, and can
  // only be created already Completed if that requisition's report is filed.
  const eventType = body.event_type === undefined || body.event_type === "" ? "Test" : String(body.event_type);
  if (!(CALENDAR_EVENT_TYPES as readonly string[]).includes(eventType)) {
    return error(`'event_type' must be one of: ${CALENDAR_EVENT_TYPES.join(", ")}`, 400);
  }
  let linked: Awaited<ReturnType<typeof resolveLinkedRequisition>> = null;
  try {
    if (eventType === "Test") {
      linked = await resolveLinkedRequisition(body.requisition_no);
      if (!linked) return error(MISSING_LINK_MESSAGE, 400);
      if (status === "Completed") await requireReportFiled(linked);
    }
  } catch (e) {
    if (e instanceof CalendarRuleError) return error(e.message, e.status);
    throw e;
  }

  const [creator] = await db.select().from(users).where(eq(users.id, claims.sub)).limit(1);
  const createdByName = creator?.name ?? claims.email;

  const [created] = await db
    .insert(calendarEvents)
    .values({
      title,
      eventDate,
      status,
      model: typeof body.model === "string" && body.model.trim() ? body.model.trim() : null,
      eventType,
      requisitionNo: linked?.requisitionNo ?? null,
      ecQuotationNo: typeof body.ec_quotation_no === "string" && body.ec_quotation_no.trim() ? body.ec_quotation_no.trim() : null,
      responsiblePerson,
      startTime: typeof body.start_time === "string" && body.start_time.trim() ? body.start_time.trim() : null,
      endTime: typeof body.end_time === "string" && body.end_time.trim() ? body.end_time.trim() : null,
      notes: typeof body.notes === "string" && body.notes.trim() ? body.notes.trim() : null,
      createdBy: claims.sub,
      createdByName,
    })
    .returning();

  await logAudit({
    ipAddress: getClientIp(req),
    userId: claims.sub,
    userName: createdByName,
    userEmail: claims.email,
    eventType: "create",
    entityType: "calendar_event",
    entityId: created.id,
    entityLabel: created.title,
    details: `${created.eventDate}${created.model ? ` · ${created.model}` : ""}`,
  });

  return json(calendarEventToDict(created), 201);
}
