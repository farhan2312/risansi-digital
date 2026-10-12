"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import PageHeader from "@/components/ui/PageHeader";
import { SkeletonPage } from "@/components/ui/Skeleton";
import ConfirmModal from "@/components/ui/ConfirmModal";
import { useAuth } from "@/contexts/AuthContext";
import { canCreateCalendarEvent, canManageCalendar } from "@/lib/calendarPermissions";
import { listCalendarEvents, deleteCalendarEvent } from "@/services/calendarService";
import { localIsoDay } from "@/lib/dateRangePresets";
import { CALENDAR_EVENT_STATUSES, RESPONSIBLE_PERSONS, type CalendarEvent } from "@/types/testing";
import CalendarEventModal from "./CalendarEventModal";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
/** Week view's rows: one per Responsible Person. Every event belongs to one of them. */
const CALENDAR_ROWS = RESPONSIBLE_PERSONS;

/** Every calendar date cell the month grid needs, Monday-first (same week convention
 * dateRangePresets.ts uses), including the tail end of the previous/next month so every row has 7 days. */
const monthGridDays = (year: number, month: number): Date[] => {
  const first = new Date(year, month, 1);
  // getDay(): 0 = Sunday .. 6 = Saturday -> how many days back to the Monday on/before the 1st.
  const back = (first.getDay() + 6) % 7;
  const start = new Date(year, month, 1 - back);
  return Array.from({ length: 42 }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
};

/** The Monday-Sunday week containing `date`. */
const weekDays = (date: Date): Date[] => {
  const back = (date.getDay() + 6) % 7;
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate() - back);
  return Array.from({ length: 7 }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
};

const formatTimeRange = (e: CalendarEvent) => {
  if (!e.start_time) return null;
  return e.end_time ? `${e.start_time} – ${e.end_time}` : e.start_time;
};

/** Status sets both the card's accent color and its badge -- the same visual rule used consistently
 * across the card, never color alone (the badge always carries the word too). */
const STATUS_STYLE: Record<CalendarEvent["status"], { border: string; bg: string; badge: string }> = {
  Completed: { border: "border-l-pos-strong", bg: "bg-pos-soft", badge: "text-pos-strong" },
  "In Testing": { border: "border-l-warn", bg: "bg-warn-soft", badge: "text-warn" },
  Planned: { border: "border-l-accent", bg: "bg-bg-sunk", badge: "text-text-muted" },
};

/** "% done" chip: red while most of the week is still ahead, amber midway, green when mostly done. */
const doneChipClass = (pct: number) =>
  pct >= 80 ? "border-pos-strong/30 bg-pos-soft text-pos-strong" : pct >= 50 ? "border-warn/30 bg-warn-soft text-warn" : "border-neg-strong/30 bg-neg-soft text-neg-strong";

const dayLabel = (d: Date) => d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });

const CalendarPage = () => {
  const { user } = useAuth();
  // Everyone signed in can view the calendar; only Admin can manage it (create/update/delete) -- the
  // API itself enforces the same rule, this just decides what controls the page even offers.
  const canManage = canManageCalendar(user?.role);
  const canCreate = canCreateCalendarEvent(user?.role);

  const today = useMemo(() => new Date(), []);
  const [mode, setMode] = useState<"week" | "month">("week");
  const [cursor, setCursor] = useState(() => new Date(today.getFullYear(), today.getMonth(), today.getDate()));
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [statusFilter, setStatusFilter] = useState<"All" | CalendarEvent["status"]>("All");

  const [editing, setEditing] = useState<CalendarEvent | null>(null);
  const [creatingOn, setCreatingOn] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<CalendarEvent | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const days = useMemo(
    () => (mode === "week" ? weekDays(cursor) : monthGridDays(cursor.getFullYear(), cursor.getMonth())),
    [mode, cursor]
  );
  const rangeFrom = localIsoDay(days[0]);
  const rangeTo = localIsoDay(days[days.length - 1]);

  const [reloadKey, setReloadKey] = useState(0);
  const load = () => setReloadKey((k) => k + 1);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setError("");
    listCalendarEvents({ from: rangeFrom, to: rangeTo })
      .then((result) => {
        if (!cancelled) setEvents(result);
      })
      .catch(() => {
        if (!cancelled) setError("Could not load the calendar.");
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [rangeFrom, rangeTo, reloadKey]);

  const visibleEvents = useMemo(
    () => (statusFilter === "All" ? events : events.filter((e) => e.status === statusFilter)),
    [events, statusFilter]
  );

  const eventsByDay = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const e of visibleEvents) map.set(e.event_date, [...(map.get(e.event_date) ?? []), e]);
    return map;
  }, [visibleEvents]);

  // Week view: person -> day -> events, so each row only ever shows its own person's events.
  const eventsByPersonAndDay = useMemo(() => {
    const map = new Map<string, Map<string, CalendarEvent[]>>();
    for (const person of CALENDAR_ROWS) map.set(person, new Map());
    for (const e of visibleEvents) {
      const byDay = e.responsible_person ? map.get(e.responsible_person) : undefined;
      if (byDay) byDay.set(e.event_date, [...(byDay.get(e.event_date) ?? []), e]);
    }
    return map;
  }, [visibleEvents]);

  const todayIso = localIsoDay(today);
  const monthIndex = cursor.getMonth();
  const completedCount = visibleEvents.filter((e) => e.status === "Completed").length;
  const completedPct = visibleEvents.length ? Math.round((completedCount / visibleEvents.length) * 100) : 0;

  const goToday = () => setCursor(new Date(today.getFullYear(), today.getMonth(), today.getDate()));
  const goPrev = () => setCursor(mode === "week" ? new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() - 7) : new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1));
  const goNext = () => setCursor(mode === "week" ? new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + 7) : new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1));

  const handleDelete = async () => {
    if (!deleting) return;
    setIsDeleting(true);
    try {
      await deleteCalendarEvent(deleting.id);
      setDeleting(null);
      load();
    } catch {
      setError("Could not delete the event. Please try again.");
      setIsDeleting(false);
    }
  };

  if (isLoading && events.length === 0) return <SkeletonPage />;

  const rangeTitle =
    mode === "week"
      ? `Week of ${dayLabel(days[0])} – ${dayLabel(days[6])}`
      : `${MONTH_NAMES[monthIndex]} ${cursor.getFullYear()}`;

  return (
    <div className="tw-reset mx-auto flex max-w-[1500px] flex-col gap-4 p-2">
      <PageHeader
        icon="📅"
        title="Testing Calendar"
        subtitle={canManage ? "Pump-testing events · you can add, edit and delete these" : "Pump-testing events · view-only (the testing team and admins maintain this calendar)"}
        actions={
          <div className="flex items-center gap-2">
            <div className="range-group" role="group" aria-label="View">
              <button type="button" className="range-pill" aria-pressed={mode === "week"} onClick={() => setMode("week")}>
                Week
              </button>
              <button type="button" className="range-pill" aria-pressed={mode === "month"} onClick={() => setMode("month")}>
                Month
              </button>
            </div>
            <button type="button" onClick={goPrev} className="hero-btn hero-btn--secondary" aria-label={mode === "week" ? "Previous week" : "Previous month"}>
              ← Prev
            </button>
            <button type="button" onClick={goToday} className="hero-btn hero-btn--secondary">
              Today
            </button>
            <button type="button" onClick={goNext} className="hero-btn hero-btn--secondary" aria-label={mode === "week" ? "Next week" : "Next month"}>
              Next →
            </button>
            {canCreate && (
              <button type="button" onClick={() => setCreatingOn(todayIso)} className="hero-btn">
                + New Event
              </button>
            )}
          </div>
        }
      />

      {error && <p className="text-sm font-medium text-neg">{error}</p>}

      <div className="viz-root overflow-hidden rounded-2xl border border-border bg-surface shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
          <div className="min-w-0">
            <h2 className="m-0 text-lg font-bold text-text-h">{rangeTitle}</h2>
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center rounded-full border border-border bg-bg-sunk px-3 py-0.5 text-xs text-text-muted">
                <strong className="mr-1 font-bold text-text-h">{visibleEvents.length}</strong> event{visibleEvents.length === 1 ? "" : "s"}
              </span>
              {visibleEvents.length > 0 && (
                <span className={`inline-flex items-center rounded-full border px-3 py-0.5 text-xs font-semibold ${doneChipClass(completedPct)}`}>
                  <strong className="mr-1 font-bold">{completedPct}%</strong> done
                </span>
              )}
            </div>
          </div>
          <div className="range-group" role="group" aria-label="Status">
            {(["All", ...CALENDAR_EVENT_STATUSES] as const).map((st) => (
              <button key={st} type="button" className="range-pill" aria-pressed={statusFilter === st} onClick={() => setStatusFilter(st)}>
                {st}
              </button>
            ))}
          </div>
        </div>

        {mode === "week" ? (
          <div className={`overflow-x-auto transition-opacity ${isLoading ? "opacity-60" : ""}`}>
            <div className="grid min-w-[1000px] grid-cols-[150px_repeat(7,minmax(0,1fr))]">
              <div className="sticky left-0 z-10 border-b border-border bg-bg-sunk px-4 py-3 text-[11px] font-bold uppercase tracking-[0.1em] text-text-muted">Person</div>
              {days.map((day) => {
                const iso = localIsoDay(day);
                const isToday = iso === todayIso;
                return (
                  <div
                    key={iso}
                    className={`border-b border-l border-border px-3 py-3 text-center text-xs font-semibold ${isToday ? "bg-accent-soft text-accent" : "bg-bg-sunk text-text-muted"}`}
                  >
                    {day.toLocaleDateString("en-GB", { weekday: "short" })}, {day.getDate()} {MONTH_NAMES[day.getMonth()].slice(0, 3)}
                  </div>
                );
              })}

              {CALENDAR_ROWS.map((person, rowIndex) => {
                const personEvents = eventsByPersonAndDay.get(person);
                const weekCount = days.reduce((n, d) => n + (personEvents?.get(localIsoDay(d))?.length ?? 0), 0);
                const lastRow = rowIndex === CALENDAR_ROWS.length - 1;
                return (
                  <Fragment key={person}>
                    <div className={`sticky left-0 z-10 flex flex-col justify-start bg-surface px-4 py-3.5 ${lastRow ? "" : "border-b border-border"}`}>
                      <span className="text-sm font-bold text-text-h">{person}</span>
                      <span className="text-xs text-text-muted">
                        {weekCount} this {mode}
                      </span>
                    </div>
                    {days.map((day) => {
                      const iso = localIsoDay(day);
                      const cellEvents = personEvents?.get(iso) ?? [];
                      const isToday = iso === todayIso;
                      return (
                        <div
                          key={`${person}-${iso}`}
                          className={`group/cell flex min-h-[110px] flex-col gap-2 border-l border-border p-2 ${lastRow ? "" : "border-b"} ${isToday ? "bg-accent-soft/40" : "bg-surface"}`}
                        >
                          {cellEvents.map((e) => (
                            <div
                              key={e.id}
                              className={`relative rounded-lg border-l-[3px] ${STATUS_STYLE[e.status].border} ${STATUS_STYLE[e.status].bg} `}
                            >
                              <button type="button" onClick={() => setEditing(e)} className="block w-full px-2.5 py-2 pr-8 text-left">
                                <div className="truncate text-[13px] font-bold uppercase leading-tight text-text-h" title={e.title}>
                                  {e.title}
                                </div>
                                <div className="mt-0.5 truncate text-xs text-text-muted">
                                  {e.ec_quotation_no ? e.ec_quotation_no : e.model ? e.model : "Event"}
                                  {formatTimeRange(e) && ` · ${formatTimeRange(e)}`}
                                </div>
                                <div className={`mt-1.5 text-[11px] font-bold uppercase tracking-wider ${STATUS_STYLE[e.status].badge}`}>{e.status}{e.event_type !== "Test" ? ` · ${e.event_type}` : ""}</div>
                              </button>
                              {canManage && (
                                <button
                                  type="button"
                                  onClick={() => setEditing(e)}
                                  className="absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-md border border-border bg-surface text-xs text-text-muted shadow-sm hover:border-accent hover:text-accent"
                                  title="Edit"
                                  aria-label={`Edit ${e.title}`}
                                >
                                  ✎
                                </button>
                              )}
                            </div>
                          ))}
                          {canCreate && (
                            <button
                              type="button"
                              onClick={() => setCreatingOn(iso)}
                              className={`rounded-lg border border-dashed border-border text-[11px] font-medium text-text-faint transition hover:border-accent hover:text-accent ${
                                cellEvents.length === 0 ? "min-h-[56px] flex-1" : "py-1 opacity-0 group-hover/cell:opacity-100 focus-visible:opacity-100"
                              }`}
                            >
                              + Add
                            </button>
                          )}
                          {!canCreate && cellEvents.length === 0 && <div className="min-h-[56px] flex-1 rounded-lg border border-dashed border-border/70" />}
                        </div>
                      );
                    })}
                  </Fragment>
                );
              })}
            </div>
          </div>
        ) : (
          <div className={`m-4 grid grid-cols-7 gap-px overflow-hidden rounded-lg border border-border bg-border transition-opacity ${isLoading ? "opacity-60" : ""}`}>
            {WEEKDAYS.map((d) => (
              <div key={d} className="bg-bg-sunk px-2 py-1.5 text-center text-[11px] font-semibold uppercase tracking-wide text-text-muted">
                {d}
              </div>
            ))}

            {days.map((day) => {
              const iso = localIsoDay(day);
              const inMonth = day.getMonth() === monthIndex;
              const isToday = iso === todayIso;
              const dayEvents = eventsByDay.get(iso) ?? [];
              return (
                <div key={iso} className={`group relative flex min-h-[104px] flex-col gap-1 bg-surface p-1.5 ${inMonth ? "" : "bg-bg-sunk/40"}`}>
                  <div className="flex items-center justify-between">
                    <span
                      className={`inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[12px] font-semibold ${
                        isToday ? "bg-accent text-white" : inMonth ? "text-text" : "text-text-faint"
                      }`}
                    >
                      {day.getDate()}
                    </span>
                    {canCreate && inMonth && (
                      <button
                        type="button"
                        onClick={() => setCreatingOn(iso)}
                        className="hidden h-5 w-5 items-center justify-center rounded-md text-text-muted hover:bg-bg-sunk hover:text-accent group-hover:flex"
                        title="Add an event on this day"
                        aria-label={`Add an event on ${iso}`}
                      >
                        +
                      </button>
                    )}
                  </div>
                  <div className="flex flex-col gap-1">
                    {dayEvents.map((e) => (
                      <button
                        key={e.id}
                        type="button"
                        onClick={() => setEditing(e)}
                        className={`truncate rounded-md border-l-2 ${STATUS_STYLE[e.status].border} ${STATUS_STYLE[e.status].bg} px-1.5 py-0.5 text-left text-[11px] font-semibold text-text-h hover:brightness-95`}
                        title={`${e.title}${formatTimeRange(e) ? ` · ${formatTimeRange(e)}` : ""}${e.model ? ` · ${e.model}` : ""} · ${e.status}`}
                      >
                        {formatTimeRange(e) && <span className="mr-1 font-normal text-text-muted">{e.start_time}</span>}
                        {e.title}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {(editing || creatingOn) && (
        <CalendarEventModal
          event={editing}
          defaultDate={creatingOn ?? undefined}
          canManage={editing ? canManage : canCreate}
          onClose={() => {
            setEditing(null);
            setCreatingOn(null);
          }}
          onSaved={() => {
            setEditing(null);
            setCreatingOn(null);
            load();
          }}
          onRequestDelete={(e) => {
            setEditing(null);
            setDeleting(e);
          }}
        />
      )}

      {deleting && (
        <ConfirmModal
          title="Delete event"
          message={`Delete "${deleting.title}" on ${deleting.event_date}? This cannot be undone.`}
          confirmLabel="Delete"
          danger
          isConfirming={isDeleting}
          onConfirm={handleDelete}
          onCancel={() => setDeleting(null)}
        />
      )}
    </div>
  );
};

export default CalendarPage;
