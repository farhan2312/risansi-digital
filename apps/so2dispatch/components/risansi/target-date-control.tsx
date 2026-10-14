"use client";

import { useState } from "react";
import { ChevronDown, Loader2, Plus, Trash2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import {
  addTargetRevisionAction,
  deleteTargetRevisionAction,
} from "@/app/risansi/orders/actions";
import type { OrderField } from "@/lib/order-schema";
import {
  TARGET_DATES,
  type TargetDate,
  type TargetRevision,
} from "@/lib/target-dates";

function formatDate(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

/** How far a revision moved the date, in days. */
function shift(from: string, to: string): number | null {
  const a = new Date(from);
  const b = new Date(to);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return null;
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}

const TARGET_BY_COLUMN = new Map<string, TargetDate>(
  TARGET_DATES.map((t) => [t.column, t])
);

/**
 * The revise button and change history for one target date, rendered inside
 * the Order details form next to the date itself — targets belong with the
 * rest of the order, not in a panel of their own.
 *
 * The date is never edited through the section form (the fields are readOnly);
 * every change goes through here so it lands in the history. Who made the
 * change and when is recorded but not shown — the audit log is where that
 * belongs; here the useful part is the date, the slip and the reason.
 */
export function TargetDateControl({
  orderId,
  target,
  revisions,
  canEdit,
}: {
  orderId: string;
  target: TargetDate;
  revisions: TargetRevision[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [date, setDate] = useState("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const history = revisions
    .filter((r) => r.target_key === target.key)
    .sort((a, b) => a.seq - b.seq);
  // Revision 1 is the original, so anything past it is a change.
  const changes = Math.max(history.length - 1, 0);

  async function save() {
    if (!date) {
      setError("Choose a date.");
      return;
    }
    setSaving(true);
    setError(null);
    const result = await addTargetRevisionAction(orderId, target.key, date, reason);
    setSaving(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setOpen(false);
    setDate("");
    setReason("");
    setShowHistory(true);
    router.refresh();
  }

  /** Undo the most recent value, falling back to the one before it. */
  async function remove() {
    const latest = history[history.length - 1];
    const previous = history[history.length - 2];
    const after = previous
      ? `back to ${formatDate(previous.target_date)}`
      : "clearing the target";
    if (
      !confirm(
        `Remove ${formatDate(latest.target_date)} from ${target.label}, ${after}?`
      )
    ) {
      return;
    }
    setRemoving(true);
    setError(null);
    const result = await deleteTargetRevisionAction(orderId, target.key);
    setRemoving(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    router.refresh();
  }

  return (
    <>
      {error && !open && (
        <span role="alert" className="text-[11px] text-danger">
          {error}
        </span>
      )}
      {changes > 0 && (
        <button
          type="button"
          onClick={() => setShowHistory((v) => !v)}
          aria-expanded={showHistory}
          title={`This date has moved ${changes} time${changes === 1 ? "" : "s"}`}
          className="inline-flex h-6 items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 text-[11px] font-medium text-amber-700 transition-colors hover:bg-amber-100"
        >
          {changes}×
          <ChevronDown
            className={`h-3 w-3 transition-transform ${showHistory ? "rotate-180" : ""}`}
          />
        </button>
      )}
      {changes === 0 && history.length > 0 && (
        <button
          type="button"
          onClick={() => setShowHistory((v) => !v)}
          aria-expanded={showHistory}
          aria-label={`${target.label} history`}
          className="inline-flex h-6 items-center rounded-full px-1.5 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronDown
            className={`h-3 w-3 transition-transform ${showHistory ? "rotate-180" : ""}`}
          />
        </button>
      )}

      {canEdit && (
        <button
          type="button"
          onClick={() => {
            setOpen((v) => !v);
            setError(null);
          }}
          aria-label={`${history.length === 0 ? "Set" : "Revise"} ${target.label}`}
          className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-input-border text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
        >
          {open ? <X className="h-3 w-3" /> : <Plus className="h-3 w-3" />}
        </button>
      )}

      {/* Full-width children wrap onto their own line inside the field cell. */}
      {open && (
        <div className="w-full rounded-lg border border-card-border bg-background p-2">
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              aria-label="New date"
              className="h-8 rounded-md border border-input-border bg-surface px-2 text-[13px] text-foreground"
            />
            <input
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Reason"
              aria-label="Reason"
              className="h-8 min-w-40 flex-1 rounded-md border border-input-border bg-surface px-2 text-[13px] text-foreground"
            />
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-[12px] font-semibold text-primary-foreground transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving && <Loader2 className="h-3 w-3 animate-spin" />}
              {history.length === 0 ? "Set" : "Save"}
            </button>
          </div>
          {error && (
            <p role="alert" className="mt-1.5 text-[11px] text-danger">
              {error}
            </p>
          )}
        </div>
      )}

      {showHistory && history.length > 0 && (
        <ol className="w-full space-y-1 border-l-2 border-card-border pl-2.5">
          {history.map((rev, i) => {
            const previous = history[i - 1];
            const moved = previous
              ? shift(previous.target_date, rev.target_date)
              : null;
            return (
              <li
                key={rev.id}
                className="flex flex-wrap items-baseline gap-x-1.5 text-[11px] text-muted-foreground"
              >
                <span className="font-medium tabular-nums text-foreground">
                  {formatDate(rev.target_date)}
                </span>
                {moved !== null && moved !== 0 && (
                  <span className={moved > 0 ? "text-danger" : "text-emerald-600"}>
                    {moved > 0 ? `+${moved}` : moved}d
                  </span>
                )}
                {rev.reason && <span>· {rev.reason}</span>}
                {canEdit && i === history.length - 1 && (
                  <button
                    type="button"
                    onClick={remove}
                    disabled={removing}
                    aria-label={`Remove ${formatDate(rev.target_date)} from ${target.label}`}
                    title="Remove this date"
                    className="inline-flex h-5 w-5 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-danger-bg hover:text-danger disabled:opacity-50"
                  >
                    {removing ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Trash2 className="h-3 w-3" />
                    )}
                  </button>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </>
  );
}

/**
 * The `fieldExtra` renderer for the Order details section: a control on each
 * target date, nothing on any other field.
 */
export function targetDateExtra(
  orderId: string,
  revisions: TargetRevision[],
  canEdit: boolean
) {
  return function render(field: OrderField) {
    const target = TARGET_BY_COLUMN.get(field.column);
    // dispatch_target_revised_date is written by a dispatch revision, so it
    // shows the value but carries no control of its own.
    if (!target) return null;
    return (
      <TargetDateControl
        orderId={orderId}
        target={target}
        revisions={revisions}
        canEdit={canEdit}
      />
    );
  };
}
