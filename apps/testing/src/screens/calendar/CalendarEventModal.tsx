"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createCalendarEvent, listCalendarEcOptions, listCalendarRequisitionOptions, updateCalendarEvent } from "@/services/calendarService";
import { getRequisition, listPumpModels } from "@/services/testingService";
import { formatDate, targetDateFor } from "@/lib/formUtils";
import {
  CALENDAR_EVENT_STATUSES,
  RESPONSIBLE_PERSONS,
  type CalendarEcOption,
  type CalendarEvent,
  type CalendarEventStatus,
  CALENDAR_EVENT_TYPES,
  type CalendarEventType,
  type CalendarRequisitionOption,
  type TestRequisition,
} from "@/types/testing";

interface CalendarEventModalProps {
  /** Editing this event, or null when creating a new one. */
  event: CalendarEvent | null;
  /** Pre-fills the date field when creating (the day the user clicked "+" on). */
  defaultDate?: string;
  /** false = every field is read-only, Close is the only action. */
  canManage: boolean;
  onClose: () => void;
  onSaved: () => void;
  onRequestDelete: (event: CalendarEvent) => void;
}

const errorMessage = (err: unknown, fallback: string): string => {
  const response = (err as { response?: { data?: { error?: string } } })?.response;
  return response?.data?.error ?? fallback;
};

const dash = (v: string | number | null | undefined) => (v === null || v === undefined || v === "" ? "-" : String(v));
const withUnit = (v: number | null | undefined, unit: string | null | undefined) => (v === null || v === undefined ? "-" : `${v}${unit ? ` ${unit}` : ""}`);

/** Read-only view of the picked requisition: every intake field, so nobody has to leave the form to look. */
const RequisitionSummary = ({ r }: { r: TestRequisition }) => {
  const target = targetDateFor(r);
  const rows: [string, string][] = [
    ["Requisition No.", dash(r.requisition_no)],
    ["Status", dash(r.status)],
    ["Model", dash(r.model)],
    ["Category", dash(r.category)],
    ["EC / Quotation / Offer No.", dash(r.ec_quotation_no)],
    ["Offer Date", r.offer_date ? formatDate(r.offer_date) : "-"],
    ["Responsible Person", dash(r.responsible_person)],
    ["Source Team", dash(r.source_team)],
    ["Submitted By", dash(r.submitted_by)],
    ["Date of Requisition", r.date_of_requisition ? formatDate(r.date_of_requisition) : "-"],
    ["Target Date", target ? `${formatDate(target.date)}${target.isAuto ? " (auto)" : ""}` : "-"],
    ["Test Qty", dash(r.test_qty)],
    ["QTH", dash(r.qth)],
    ["Specific Gravity", dash(r.specific_gravity)],
    ["Power (HP / kW)", `${dash(r.power_hp)} / ${dash(r.power_kw)}`],
    ["Head", withUnit(r.head_kgcm2, r.head_unit)],
    ["RPM / Motor RPM", `${dash(r.rpm)} / ${dash(r.motor_rpm)}`],
    ["Required Capacity", withUnit(r.req_capacity, r.req_capacity_unit)],
    ["Retest Needed", r.retest_needed === null ? "-" : r.retest_needed ? "Yes" : "No"],
    ["Remarks", dash(r.general_remarks)],
  ];
  return (
    <div className="mt-3 rounded-lg border border-border bg-bg-sunk p-3.5">
      <div className="mb-2 text-[11px] font-bold uppercase tracking-[0.1em] text-text-muted">Requisition details</div>
      <dl className="m-0 grid grid-cols-[1fr_1.2fr] gap-x-3 gap-y-1.5 text-[12.5px]">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-text-muted">{label}</dt>
            <dd className="m-0 min-w-0 break-words font-semibold text-text-h">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
};

const inputClasses =
  "h-11 w-full min-w-0 rounded-lg border border-border bg-bg-app px-3.5 text-[15px] text-text-h outline-none focus:border-accent focus:ring-2 focus:ring-accent-line disabled:cursor-not-allowed disabled:opacity-70";
const labelClasses = "mt-3.5 mb-1.5 block text-[13px] font-semibold text-text";

/** Create/edit/view for one Testing Calendar event. `canManage` means "may edit this form": an admin for an
 * existing event, an admin or testing-team member for a new one. Anyone else sees the same layout read-only, since the calendar itself is visible to
 * the whole portal. EC / Quotation No. is searchable against every number already on a requisition or
 * report, and picking one fills in Model when that is still empty. */
const CalendarEventModal = ({ event, defaultDate, canManage, onClose, onSaved, onRequestDelete }: CalendarEventModalProps) => {
  const [title, setTitle] = useState(event?.title ?? "");
  const [model, setModel] = useState(event?.model ?? "");
  const [ecNo, setEcNo] = useState(event?.ec_quotation_no ?? "");
  const [person, setPerson] = useState<string>(event?.responsible_person ?? RESPONSIBLE_PERSONS[0]);
  const [status, setStatus] = useState<CalendarEventStatus>(event?.status ?? "Planned");
  // Every event is a Test (linked to a requisition) unless it is marked a Meeting or Calibration.
  const [eventType, setEventType] = useState<CalendarEventType>(event?.event_type ?? "Test");
  const isTest = eventType === "Test";
  const [eventDate, setEventDate] = useState(event?.event_date ?? defaultDate ?? "");
  const [startTime, setStartTime] = useState(event?.start_time ?? "");
  const [endTime, setEndTime] = useState(event?.end_time ?? "");
  const [notes, setNotes] = useState(event?.notes ?? "");

  const [modelOptions, setModelOptions] = useState<string[]>([]);
  const [ecOptions, setEcOptions] = useState<CalendarEcOption[]>([]);
  // Requisition No. search (New Event only): type or pick a number and the whole requisition is shown.
  const [reqNo, setReqNo] = useState(event?.requisition_no ?? "");
  const [reqOptions, setReqOptions] = useState<CalendarRequisitionOption[]>([]);
  const [reqDetails, setReqDetails] = useState<TestRequisition | null>(null);
  const [reqLoading, setReqLoading] = useState(false);
  const [formError, setFormError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!canManage) return;
    listPumpModels()
      .then(setModelOptions)
      .catch(() => {});
    listCalendarEcOptions()
      .then(setEcOptions)
      .catch(() => {});
    listCalendarRequisitionOptions()
      .then(setReqOptions)
      .catch(() => {});
  }, [canManage]);

  // An event that is already linked: load its requisition so we know whether the test report is filed.
  useEffect(() => {
    if (!event?.requisition_no) return;
    let cancelled = false;
    setReqLoading(true);
    getRequisition(event.requisition_no)
      .then((full) => {
        if (!cancelled) setReqDetails(full);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setReqLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [event?.requisition_no]);

  // The linked requisition (once loaded). Completing a linked test needs its report to be filed first.
  const linkedNo = reqDetails?.requisition_no ?? "";
  const reportFiled = (reqDetails?.reports?.length ?? 0) > 0;
  const needsReport = isTest && status === "Completed" && !!linkedNo && !reportFiled && !reqLoading;

  const reqMatch = (value: string) => reqOptions.find((o) => o.requisition_no.toLowerCase() === value.trim().toLowerCase());

  /** Typing or picking a requisition number: load the full record, show it, and carry its Model, EC /
   * Quotation No. and Responsible Person into the form (Title too while it is still empty). */
  const handleReqChange = async (value: string) => {
    setReqNo(value);
    const match = reqMatch(value);
    if (!match) {
      setReqDetails(null);
      return;
    }
    setReqLoading(true);
    try {
      const full = await getRequisition(match.requisition_no);
      setReqDetails(full);
      setModel(full.model);
      if (full.ec_quotation_no) setEcNo(full.ec_quotation_no);
      if (full.responsible_person && (RESPONSIBLE_PERSONS as readonly string[]).includes(full.responsible_person)) setPerson(full.responsible_person);
      setTitle((t) => (t.trim() ? t : `${match.requisition_no} · ${full.model}`));
    } catch {
      setReqDetails(null);
      setFormError("Could not load that requisition.");
    } finally {
      setReqLoading(false);
    }
  };

  const handleEcChange = (value: string) => {
    setEcNo(value);
    // An exact pick from the list carries its model along -- only fills Model when it is still empty,
    // so it never overwrites something already typed.
    const match = ecOptions.find((o) => o.ec_quotation_no === value.trim());
    if (match?.model && !model.trim()) setModel(match.model);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;
    if (!title.trim()) {
      setFormError("Title is required.");
      return;
    }
    if (!eventDate) {
      setFormError("Date is required.");
      return;
    }
    if (isTest && !linkedNo) {
      setFormError("Pick the requisition this test is for (Requisition No.), or change the event type to Meeting or Calibration.");
      return;
    }
    if (needsReport) {
      setFormError(`Fill the test report for ${linkedNo} first -- a test is completed by filing its report.`);
      return;
    }
    setFormError("");
    setIsSubmitting(true);
    try {
      const payload = {
        event_type: eventType,
        requisition_no: isTest ? linkedNo : "",
        title: title.trim(),
        event_date: eventDate,
        model,
        ec_quotation_no: ecNo,
        responsible_person: person,
        status,
        start_time: startTime,
        end_time: endTime,
        notes,
      };
      if (event) await updateCalendarEvent(event.id, payload);
      else await createCalendarEvent(payload);
      onSaved();
    } catch (err) {
      setFormError(errorMessage(err, event ? "Could not update the event." : "Could not create the event."));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="max-h-[92vh] w-[480px] max-w-[92vw] overflow-y-auto rounded-2xl bg-surface p-6 pb-6.5 text-text shadow-xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="calendar-event-title"
      >
        <div className="mb-4.5 flex items-center justify-between">
          <h3 id="calendar-event-title" className="m-0 text-xl text-text-h">
            {canManage ? (event ? "Edit Event" : "New Event") : "Event Details"}
          </h3>
          <button type="button" className="border-none bg-none text-base text-text-muted" onClick={onClose} aria-label="Close">
            &#10005;
          </button>
        </div>

        <form onSubmit={handleSubmit} noValidate>
          {formError && (
            <div className="mb-1.5 rounded-md border border-neg bg-neg-soft px-3.5 py-2.5 text-[13px] text-neg-strong" role="alert">
              {formError}
            </div>
          )}

          <label htmlFor="cal-event-type" className={labelClasses}>
            Event type
          </label>
          <select id="cal-event-type" value={eventType} onChange={(e) => setEventType(e.target.value as CalendarEventType)} disabled={!canManage} className={inputClasses}>
            {CALENDAR_EVENT_TYPES.map((t) => (
              <option key={t} value={t}>
                {t === "Test" ? "Test (needs a requisition)" : t}
              </option>
            ))}
          </select>

          {canManage && isTest && (
            <>
              <label htmlFor="cal-event-req" className={labelClasses}>
                Requisition No. *
              </label>
              <input
                id="cal-event-req"
                type="text"
                value={reqNo}
                onChange={(e) => handleReqChange(e.target.value)}
                list="cal-event-req-options"
                autoComplete="off"
                className={inputClasses}
                placeholder="Search or type, e.g. REQ-000035"
              />
              <datalist id="cal-event-req-options">
                {reqOptions.map((o) => (
                  <option key={o.requisition_no} value={o.requisition_no}>
                    {o.model}
                    {o.ec_quotation_no ? ` · ${o.ec_quotation_no}` : ""} · {o.status}
                  </option>
                ))}
              </datalist>
              {reqNo.trim() && !reqMatch(reqNo) && reqOptions.length > 0 && (
                <p className="mt-1.5 text-xs text-text-muted">No requisition with this number yet. Keep typing or pick one from the list.</p>
              )}
              {reqLoading && <p className="mt-1.5 text-xs text-text-muted">Loading requisition…</p>}
              {reqDetails && <RequisitionSummary r={reqDetails} />}
              {linkedNo && (
                <p className="mt-1.5 text-xs text-text-muted">
                  {reportFiled
                    ? "✓ The test report for this requisition is filed, so the test can be marked Completed."
                    : "A test is completed by filing its report. Until it is filed this event can't be marked Completed."}
                </p>
              )}
            </>
          )}

          <label htmlFor="cal-event-title" className={labelClasses}>
            Title
          </label>
          <input id="cal-event-title" type="text" value={title} onChange={(e) => setTitle(e.target.value)} disabled={!canManage} className={inputClasses} placeholder="e.g. H40 retest, panel calibration" />

          <label htmlFor="cal-event-ec" className={labelClasses}>
            EC / Quotation No. (optional)
          </label>
          <input
            id="cal-event-ec"
            type="text"
            list="cal-event-ec-options"
            value={ecNo}
            onChange={(e) => handleEcChange(e.target.value)}
            disabled={!canManage}
            className={inputClasses}
            placeholder="Search by EC or quotation number..."
            autoComplete="off"
          />
          <datalist id="cal-event-ec-options">
            {ecOptions.map((o) => (
              <option key={o.ec_quotation_no} value={o.ec_quotation_no}>
                {o.model ?? ""}
              </option>
            ))}
          </datalist>

          <label htmlFor="cal-event-model" className={labelClasses}>
            Model (optional)
          </label>
          <input
            id="cal-event-model"
            type="text"
            list="cal-event-model-options"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            disabled={!canManage}
            className={inputClasses}
            placeholder="Which pump this is about, if any"
          />
          <datalist id="cal-event-model-options">
            {modelOptions.map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>

          {needsReport && (
            <div className="mb-3 rounded-lg border border-warn bg-warn-soft px-3.5 py-3 text-[13px] text-text-h" role="alert">
              <strong>Fill the completion report first.</strong> To mark {linkedNo} Completed, the test report has to be filed.
              <div className="mt-2">
                <Link href={`/requisitions/${linkedNo}/report`} className="inline-block rounded-lg bg-accent px-3.5 py-1.5 text-[13px] font-semibold text-white no-underline hover:brightness-95">
                  Fill the report →
                </Link>
              </div>
            </div>
          )}

          <div className="flex gap-3">
            <div className="min-w-0 flex-1">
              <label htmlFor="cal-event-person" className={labelClasses}>
                Assigned to
              </label>
              <select id="cal-event-person" value={person} onChange={(e) => setPerson(e.target.value)} disabled={!canManage} className={inputClasses}>
                {RESPONSIBLE_PERSONS.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </div>
            <div className="min-w-0 flex-1">
              <label htmlFor="cal-event-status" className={labelClasses}>
                Status
              </label>
              <select id="cal-event-status" value={status} onChange={(e) => setStatus(e.target.value as CalendarEventStatus)} disabled={!canManage} className={inputClasses}>
                {CALENDAR_EVENT_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex gap-3">
            <div className="min-w-0 flex-1">
              <label htmlFor="cal-event-date" className={labelClasses}>
                Date
              </label>
              <input id="cal-event-date" type="date" value={eventDate} onChange={(e) => setEventDate(e.target.value)} disabled={!canManage} className={inputClasses} />
            </div>
            <div className="min-w-0 flex-1">
              <label htmlFor="cal-event-start" className={labelClasses}>
                Start (optional)
              </label>
              <input id="cal-event-start" type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} disabled={!canManage} className={inputClasses} />
            </div>
            <div className="min-w-0 flex-1">
              <label htmlFor="cal-event-end" className={labelClasses}>
                End (optional)
              </label>
              <input id="cal-event-end" type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} disabled={!canManage} className={inputClasses} />
            </div>
          </div>

          <label htmlFor="cal-event-notes" className={labelClasses}>
            Notes (optional)
          </label>
          <textarea
            id="cal-event-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            disabled={!canManage}
            rows={3}
            className="w-full resize-none rounded-lg border border-border bg-bg-app px-3.5 py-2.5 text-[15px] text-text-h outline-none focus:border-accent focus:ring-2 focus:ring-accent-line disabled:cursor-not-allowed disabled:opacity-70"
          />

          {event && (
            <p className="mt-3 text-[12px] text-text-faint">
              Added by {event.created_by_name}
              {event.updated_at !== event.created_at ? " · edited since" : ""}
            </p>
          )}

          <div className="mt-5 flex items-center justify-between gap-2">
            <div>
              {canManage && event && (
                <button
                  type="button"
                  onClick={() => onRequestDelete(event)}
                  className="rounded-lg border border-neg/30 bg-neg-soft px-3.5 py-2 text-[13px] font-semibold text-neg-strong hover:border-neg hover:bg-neg hover:text-white"
                >
                  Delete
                </button>
              )}
            </div>
            <div className="flex gap-2">
              <button type="button" onClick={onClose} className="rounded-lg border border-border bg-surface px-4 py-2 text-[13px] font-semibold text-text hover:bg-surface-hover">
                {canManage ? "Cancel" : "Close"}
              </button>
              {canManage && (
                <button type="submit" disabled={isSubmitting || needsReport} title={needsReport ? "File the test report first" : undefined} className="rounded-lg bg-accent px-4 py-2 text-[13px] font-semibold text-white hover:brightness-95 disabled:opacity-60">
                  {isSubmitting ? "Saving…" : event ? "Save Changes" : "Create Event"}
                </button>
              )}
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};

export default CalendarEventModal;
