"use client";

import { useEffect, useState } from "react";
import { History, Loader2, X } from "lucide-react";
import { getReadyLotHistoryAction } from "@/app/risansi/orders/actions";
import type { ReadyLotEvent } from "@/lib/orders";
import {
  collapseHistory,
  tagHistory,
  type HistoryKind,
} from "@/lib/readiness-history";

const ROLE_NAMES: Record<string, string> = {
  planning: "Planning",
  central_visibility: "Central Visibility",
  admin: "Admin",
};

function day(value: string | null): string {
  if (!value) return "no date";
  const d = new Date(value);
  return Number.isNaN(d.getTime())
    ? value
    : d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

function when(value: string): string {
  const d = new Date(value);
  return Number.isNaN(d.getTime())
    ? value
    : d.toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });
}

const sameDay = (a: string | null, b: string | null) => (a ?? "").slice(0, 10) === (b ?? "").slice(0, 10);

type Kind = HistoryKind;

const TAG: Record<Kind, { label: string; className: string }> = {
  date: { label: "Date moved", className: "bg-amber-100 text-amber-800" },
  status: { label: "Status changed", className: "bg-sky-100 text-sky-800" },
  first: { label: "Date given", className: "bg-teal-100 text-teal-800" },
  cleared: { label: "Date removed", className: "bg-slate-100 text-slate-700" },
  added: { label: "Lot added", className: "bg-emerald-100 text-emerald-800" },
  removed: { label: "Lot removed", className: "bg-rose-100 text-rose-700" },
  recorded: { label: "First recorded", className: "bg-slate-100 text-slate-600" },
};

/** One labelled line: "Date  10 May 2026 → 06 Oct 2026". */
function Line({ label, from, to, changed }: { label: string; from?: string; to: string; changed: boolean }) {
  return (
    <div className="flex gap-2 text-sm">
      <span className="w-12 shrink-0 text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</span>
      {changed && from !== undefined ? (
        <span className="text-foreground">
          <span className="text-muted line-through decoration-muted/60">{from}</span>
          <span className="mx-1.5 text-muted">→</span>
          <span className="font-semibold">{to}</span>
        </span>
      ) : (
        <span className="text-foreground">{to}</span>
      )}
    </div>
  );
}

/**
 * The readiness date, clickable: opens how the SO's readiness moved — a
 * summary of how often the date was moved and the status changed, then every
 * change, newest first, tagged by what it did.
 */
export function ReadyLotHistoryButton({
  orderId,
  label,
  soLabel,
}: {
  orderId: string;
  label: string;
  soLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const [events, setEvents] = useState<ReadyLotEvent[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let live = true;
    getReadyLotHistoryAction(orderId).then((res) => {
      if (!live) return;
      if (res.ok) setEvents(res.events);
      else setError(res.error);
    });
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    return () => {
      live = false;
      document.removeEventListener("keydown", onKey);
    };
  }, [open, orderId]);

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setEvents(null);
          setError(null);
          setOpen(true);
        }}
        title="See how the readiness date and status changed"
        className="inline-flex items-center gap-1 whitespace-nowrap text-left underline decoration-dotted underline-offset-2 hover:text-foreground"
      >
        {label}
        <History className="h-3 w-3 shrink-0" aria-hidden />
      </button>
      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Readiness history for ${soLabel}`}
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-6"
          onClick={() => setOpen(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-surface p-5 shadow-xl sm:rounded-2xl"
          >
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <h2 className="font-display text-base font-semibold text-foreground">Readiness history</h2>
                <p className="text-xs text-muted">{soLabel}</p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="rounded-lg p-1.5 text-muted transition-colors hover:bg-background hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {error ? (
              <p className="text-sm text-danger">{error}</p>
            ) : events === null ? (
              <p className="flex items-center gap-2 text-sm text-muted">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading…
              </p>
            ) : (
              <ReadinessHistoryView events={events} />
            )}
          </div>
        </div>
      )}
    </>
  );
}


/** The history itself: two counts, then each change tagged by what it did. */
export function ReadinessHistoryView({ events }: { events: ReadyLotEvent[] }) {
  const entries = collapseHistory(events);
  const tags = tagHistory(entries);
  const dateMoves = entries.filter((x) => tags.get(x)!.includes("date")).length;
  const statusChanges = entries.filter((x) => tags.get(x)!.includes("status")).length;
  if (entries.length === 0) return <p className="text-sm text-muted">Nothing recorded on this SO yet.</p>;
  return (
    <>
      {/* The two numbers people ask for, apart from everything else. */}
      <div className="mb-4 grid grid-cols-2 gap-2">
        <div className="rounded-lg bg-amber-50 px-3 py-2">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-800">Date moved</p>
          <p className="font-display text-xl font-bold text-amber-900">
            {dateMoves} <span className="text-sm font-medium">time{dateMoves === 1 ? "" : "s"}</span>
          </p>
        </div>
        <div className="rounded-lg bg-sky-50 px-3 py-2">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-sky-800">Status changed</p>
          <p className="font-display text-xl font-bold text-sky-900">
            {statusChanges} <span className="text-sm font-medium">time{statusChanges === 1 ? "" : "s"}</span>
          </p>
        </div>
      </div>

      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        All changes · newest first
      </p>
      <ol className="space-y-2">
        {entries.map((x, i) => {
          const { e, times } = x;
          const kinds = tags.get(x)!;
          const edit = e.action === "changed" || e.action === "readiness";
          return (
            <li key={i} className="rounded-lg border border-card-border px-3 py-2.5">
              <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
                <span className="text-xs font-semibold text-foreground">
                  {e.lot_no === 0 ? "Readiness" : `Lot ${e.lot_no}`}
                </span>
                {kinds.map((k) => (
                  <span key={k} className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${TAG[k].className}`}>
                    {TAG[k].label}
                  </span>
                ))}
                {kinds.length === 0 && (
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600">
                    Saved, no change
                  </span>
                )}
              </div>
              {e.action === "removed" ? (
                <p className="text-sm text-muted">
                  Was {e.status ?? "—"} · {day(e.ready_date)}
                </p>
              ) : (
                <>
                  <Line
                    label="Status"
                    from={e.prev_status ?? "—"}
                    to={e.status ?? "—"}
                    changed={edit && (e.prev_status ?? "") !== (e.status ?? "")}
                  />
                  <Line
                    label="Date"
                    from={day(e.prev_ready_date)}
                    to={day(e.ready_date)}
                    changed={edit && !sameDay(e.prev_ready_date, e.ready_date)}
                  />
                </>
              )}
              <p className="mt-1.5 text-xs text-muted">
                {e.action === "recorded"
                  ? `Before history was kept · ${when(e.changed_at)}`
                  : `${e.changed_by_name ?? "—"}${
                      e.changed_by_role ? ` (${ROLE_NAMES[e.changed_by_role] ?? e.changed_by_role})` : ""
                    } · ${when(e.changed_at)}${times > 1 ? ` · saved ${times}×` : ""}`}
              </p>
            </li>
          );
        })}
      </ol>
    </>
  );
}
