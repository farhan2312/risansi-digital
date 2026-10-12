import { eq } from "drizzle-orm";

import { calendarEventToDict, error, json } from "@/lib/api";
import { getClientIp, logAudit } from "@/lib/audit";
import { AuthError, decodeToken } from "@/lib/auth";
import { canManageCalendar } from "@/lib/calendarPermissions";
import { db } from "@/lib/db";
import { calendarEvents } from "@/lib/db/schema";
import { CalendarRuleError, MISSING_LINK_MESSAGE, requireReportFiled, resolveLinkedRequisition } from "@/lib/calendarCompletion";
import { CALENDAR_EVENT_STATUSES, CALENDAR_EVENT_TYPES, RESPONSIBLE_PERSONS } from "@/types/testing";

export const dynamic = "force-dynamic";

const FIELD_MAP: Record<string, string> = {
  title: "title",
  model: "model",
  ec_quotation_no: "ecQuotationNo",
  responsible_person: "responsiblePerson",
  status: "status",
  event_date: "eventDate",
  start_time: "startTime",
  end_time: "endTime",
  notes: "notes",
};

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  let claims;
  try {
    claims = await decodeToken(req);
  } catch (e) {
    if (e instanceof AuthError) return error(e.message, e.statusCode);
    throw e;
  }
  if (!canManageCalendar(claims.role)) {
    return error("Only an admin or the testing team can update calendar events.", 403);
  }

  const { id } = await params;
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return error("Request body must be JSON", 400);
  }

  if (body.event_date !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(String(body.event_date))) {
    return error("'event_date' must be a YYYY-MM-DD date", 400);
  }
  if (body.title !== undefined && !String(body.title).trim()) {
    return error("'title' cannot be blank", 400);
  }
  if (body.responsible_person !== undefined && !RESPONSIBLE_PERSONS.includes(String(body.responsible_person).trim() as (typeof RESPONSIBLE_PERSONS)[number])) {
    return error(`'responsible_person' must be one of: ${RESPONSIBLE_PERSONS.join(", ")}`, 400);
  }
  if (body.status !== undefined && !CALENDAR_EVENT_STATUSES.includes(body.status as never)) {
    return error(`'status' must be one of: ${CALENDAR_EVENT_STATUSES.join(", ")}`, 400);
  }

  // Completing a linked test needs its report. Checked when the status or the link is part of this edit
  // and the result is "Completed + linked" (re-saving an already-completed event is left alone).
  const [existing] = await db.select().from(calendarEvents).where(eq(calendarEvents.id, id)).limit(1);
  if (!existing) return error("Calendar event not found", 404);
  if (body.event_type !== undefined && !(CALENDAR_EVENT_TYPES as readonly string[]).includes(String(body.event_type))) {
    return error(`'event_type' must be one of: ${CALENDAR_EVENT_TYPES.join(", ")}`, 400);
  }
  let linkValue: string | null | undefined;
  try {
    if (body.requisition_no !== undefined) {
      const linked = await resolveLinkedRequisition(body.requisition_no);
      linkValue = linked?.requisitionNo ?? null;
    }
    const finalStatus = body.status !== undefined ? String(body.status) : existing.status;
    const finalType = body.event_type !== undefined ? String(body.event_type) : existing.eventType;
    // A Meeting / Calibration is not a test: it carries no requisition.
    if (finalType !== "Test") linkValue = null;
    const finalLink = linkValue !== undefined ? linkValue : existing.requisitionNo;
    const touched = body.status !== undefined || body.event_type !== undefined || body.requisition_no !== undefined;
    // Every Test names its requisition. Checked whenever the edit touches the type, link or status, so an
    // old unlinked event can still have its notes fixed but can't be moved along without being linked.
    if (touched && finalType === "Test" && !finalLink) return error(MISSING_LINK_MESSAGE, 400);
    const changed =
      (body.status !== undefined && body.status !== existing.status) ||
      (linkValue !== undefined && linkValue !== existing.requisitionNo) ||
      (body.event_type !== undefined && body.event_type !== existing.eventType);
    if (changed && finalType === "Test" && finalStatus === "Completed" && finalLink) {
      const requisition = await resolveLinkedRequisition(finalLink);
      if (requisition) await requireReportFiled(requisition);
    }
  } catch (e) {
    if (e instanceof CalendarRuleError) return error(e.message, e.status);
    throw e;
  }

  const values: Record<string, unknown> = {};
  if (linkValue !== undefined) values.requisitionNo = linkValue;
  if (body.event_type !== undefined) values.eventType = String(body.event_type);
  for (const [snakeKey, camelKey] of Object.entries(FIELD_MAP)) {
    if (body[snakeKey] === undefined) continue;
    const v = body[snakeKey];
    // "" clears an optional field (model/start_time/end_time/notes) to NULL, same convention as the
    // requisition PATCH route -- title/event_date are validated above and never blank here.
    values[camelKey] = typeof v === "string" && v.trim() === "" && snakeKey !== "title" && snakeKey !== "event_date" ? null : typeof v === "string" ? v.trim() : v;
  }
  values.updatedAt = new Date();

  const [updated] = await db.update(calendarEvents).set(values).where(eq(calendarEvents.id, id)).returning();
  if (!updated) return error("Calendar event not found", 404);

  await logAudit({
    ipAddress: getClientIp(req),
    userId: claims.sub,
    userEmail: claims.email,
    eventType: "update",
    entityType: "calendar_event",
    entityId: updated.id,
    entityLabel: updated.title,
    details: `Changed: ${Object.keys(values).filter((k) => k !== "updatedAt").join(", ") || "nothing"}`,
  });

  return json(calendarEventToDict(updated));
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  let claims;
  try {
    claims = await decodeToken(req);
  } catch (e) {
    if (e instanceof AuthError) return error(e.message, e.statusCode);
    throw e;
  }
  if (!canManageCalendar(claims.role)) {
    return error("Only an admin or the testing team can delete calendar events.", 403);
  }

  const { id } = await params;
  const [existing] = await db.select().from(calendarEvents).where(eq(calendarEvents.id, id)).limit(1);
  if (!existing) return error("Calendar event not found", 404);

  await db.delete(calendarEvents).where(eq(calendarEvents.id, id));

  await logAudit({
    ipAddress: getClientIp(req),
    userId: claims.sub,
    userEmail: claims.email,
    eventType: "delete",
    entityType: "calendar_event",
    entityId: existing.id,
    entityLabel: existing.title,
    details: `${existing.eventDate}${existing.model ? ` · ${existing.model}` : ""}`,
  });

  return json({ ok: true });
}
