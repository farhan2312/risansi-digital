"use client";

import { useEffect, useState } from "react";
import { History, Loader2, X } from "lucide-react";
import { getPackingPlanHistoryAction, type PackingPlanEvent } from "@/app/risansi/orders/actions";

const ROLE_NAMES: Record<string, string> = {
  assembly: "Assembly & Packing",
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

/** One labelled line: "Date  13 Oct 2026 → 15 Oct 2026", or just the value when unchanged. */
function Line({ label, from, to }: { label: string; from: string; to: string }) {
  const changed = from !== to;
  return (
    <div className="flex gap-2 text-sm">
      <span className="w-12 shrink-0 text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</span>
      {changed ? (
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
 * Assembly & Packing's packing date, clickable: how the SO's packing plan
 * moved — how often the date moved, then every change to a lot's packing
 * date, shift or PDI, newest first, with who made it.
 */
export function PackingPlanHistoryButton({
  orderId,
  label,
  soLabel,
  stage = "packing",
}: {
  orderId: string;
  label: React.ReactNode;
  soLabel: string;
  /** A pump lot's assembly plan has its own history (no PDI). */
  stage?: "packing" | "assembly";
}) {
  const what = stage === "assembly" ? "Assembly" : "Packing";
  const [open, setOpen] = useState(false);
  const [events, setEvents] = useState<PackingPlanEvent[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let live = true;
    getPackingPlanHistoryAction(orderId, stage).then((res) => {
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
  }, [open, orderId, stage]);

  const moves = (events ?? []).filter((e) => e.prev_plan_date && e.plan_date !== e.prev_plan_date).length;

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setEvents(null);
          setError(null);
          setOpen(true);
        }}
        title={stage === "assembly" ? "See how the assembly date and shift changed" : "See how the packing date, shift and PDI changed"}
        className="inline-flex items-center gap-1 whitespace-nowrap text-left underline decoration-dotted underline-offset-2 hover:text-foreground"
      >
        {label}
        <History className="h-3 w-3 shrink-0" aria-hidden />
      </button>
      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`${what} plan history for ${soLabel}`}
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-6"
          onClick={() => setOpen(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-surface p-5 shadow-xl sm:rounded-2xl"
          >
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <h2 className="font-display text-base font-semibold text-foreground">{what} plan history</h2>
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
            ) : events.length === 0 ? (
              <p className="text-sm text-muted">No {what.toLowerCase()} plan recorded on this SO yet.</p>
            ) : (
              <>
                <div className="mb-4 rounded-lg bg-amber-50 px-3 py-2">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-800">{what} date moved</p>
                  <p className="font-display text-xl font-bold text-amber-900">
                    {moves} <span className="text-sm font-medium">time{moves === 1 ? "" : "s"}</span>
                  </p>
                </div>
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  All changes · newest first
                </p>
                <ol className="space-y-2">
                  {events.map((e) => (
                    <li key={e.id} className="rounded-lg border border-card-border px-3 py-2.5">
                      <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
                        <span className="text-xs font-semibold text-foreground">
                          {e.ec_no ? `${e.ec_no} · ` : ""}Lot {e.lot_no}
                          {e.ecs > 1 ? ` · all ${e.ecs} ECs` : ""}
                        </span>
                        {!e.prev_plan_date && e.plan_date ? (
                          <span className="rounded-full bg-teal-100 px-2 py-0.5 text-[10px] font-semibold text-teal-800">Date given</span>
                        ) : e.prev_plan_date && e.plan_date !== e.prev_plan_date ? (
                          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-800">Date moved</span>
                        ) : null}
                      </div>
                      <Line label="Date" from={day(e.prev_plan_date)} to={day(e.plan_date)} />
                      <Line label="Shift" from={e.prev_shift ?? "—"} to={e.shift ?? "—"} />
                      {stage === "packing" && <Line label="PDI" from={e.prev_pdi ?? "—"} to={e.pdi ?? "—"} />}
                      <p className="mt-1.5 text-[11px] text-muted">
                        {when(e.changed_at)}
                        {e.changed_by_name ? ` · ${e.changed_by_name}` : ""}
                        {e.changed_by_role ? ` (${ROLE_NAMES[e.changed_by_role] ?? e.changed_by_role})` : ""}
                      </p>
                    </li>
                  ))}
                </ol>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
