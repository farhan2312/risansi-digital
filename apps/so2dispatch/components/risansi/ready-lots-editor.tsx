"use client";

import { useState } from "react";
import { Lock, Plus, Trash2 } from "lucide-react";
import { READY_LOT_LIMIT, READY_LOT_STATUSES } from "@/lib/order-schema";
import { lotsFrozen, type ReadyLot } from "@/lib/ready-lots";

function formatDate(value: string): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

const inputClass =
  "h-9 w-full rounded-lg border border-input-border bg-surface px-2.5 text-[13px] text-foreground focus:border-primary focus:outline-none disabled:cursor-not-allowed disabled:opacity-60";

/**
 * A Spare's readiness lots inside the Planning form. Editing: each lot's
 * status and date, Add lot up to the limit, and remove the last one. Once a
 * lot is Fully ready the lots lock; "Correct lots" opens them again.
 */
export function ReadyLotsEditor({
  lots,
  onChange,
  editing,
}: {
  lots: ReadyLot[];
  onChange: (next: ReadyLot[]) => void;
  /** False shows them read-only, as the section does outside its edit mode. */
  editing: boolean;
}) {
  const [unlocked, setUnlocked] = useState(false);
  // Locked as saved: a Fully ready lot being entered now stays editable until
  // the form is saved.
  const [savedFrozen] = useState(() => lotsFrozen(lots));
  const frozen = editing ? savedFrozen : lotsFrozen(lots);
  const editable = editing && (!frozen || unlocked);

  if (lots.length === 0 && !editing) return null;

  const set = (i: number, patch: Partial<ReadyLot>) =>
    onChange(lots.map((l, k) => (k === i ? { ...l, ...patch } : l)));

  return (
    <div className="rounded-xl border border-card-border bg-background/50 p-3 sm:col-span-2">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-[13px] font-semibold text-foreground">
          Readiness lots{" "}
          <span className="font-normal text-muted">
            (up to {READY_LOT_LIMIT} · the status and readiness date follow the latest lot)
          </span>
        </p>
        {editing && frozen && !unlocked && (
          <button
            type="button"
            onClick={() => setUnlocked(true)}
            className="inline-flex h-7 items-center gap-1 rounded-md border border-input-border px-2.5 text-xs font-medium text-foreground transition-colors hover:bg-surface"
          >
            <Lock className="h-3 w-3" />
            Correct lots
          </button>
        )}
      </div>

      {lots.length === 0 ? (
        <p className="text-xs text-muted">No lots yet.</p>
      ) : (
        <div className="space-y-2">
          {lots.map((lot, i) => (
            <div key={i} className="grid grid-cols-[3.5rem_1fr_1fr_2rem] items-center gap-2">
              <span className="text-xs font-semibold text-muted-foreground">Lot {i + 1}</span>
              {editable ? (
                <>
                  <select
                    aria-label={`Lot ${i + 1} status`}
                    value={lot.status}
                    onChange={(e) => set(i, { status: e.target.value })}
                    className={inputClass}
                  >
                    <option value="">—</option>
                    {READY_LOT_STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                  <input
                    aria-label={`Lot ${i + 1} date`}
                    type="date"
                    value={lot.ready_date}
                    onChange={(e) => set(i, { ready_date: e.target.value })}
                    className={inputClass}
                  />
                </>
              ) : (
                <>
                  <span className="text-[13px] text-foreground">{lot.status || "—"}</span>
                  <span className="text-[13px] text-foreground">{formatDate(lot.ready_date)}</span>
                </>
              )}
              {editable && i === lots.length - 1 ? (
                <button
                  type="button"
                  onClick={() => onChange(lots.slice(0, -1))}
                  aria-label={`Remove lot ${i + 1}`}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-rose-200 text-rose-600 transition-colors hover:bg-rose-50"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              ) : (
                <span />
              )}
            </div>
          ))}
        </div>
      )}

      {editing && frozen && !unlocked && (
        <p className="mt-2 text-xs text-muted">Fully ready — the lots are locked.</p>
      )}
      {editable && !lotsFrozen(lots) && lots.length < READY_LOT_LIMIT && (
        <button
          type="button"
          onClick={() => onChange([...lots, { status: "", ready_date: "" }])}
          className="mt-2 inline-flex h-8 items-center gap-1 rounded-lg border border-input-border px-3 text-xs font-medium text-foreground transition-colors hover:bg-surface"
        >
          <Plus className="h-3.5 w-3.5" />
          Add lot
        </button>
      )}
    </div>
  );
}
