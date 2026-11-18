"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { History, Loader2, X } from "lucide-react";
import { listDispatchDateHistoryAction, setFinalDispatchTargetAction, type DispatchDateChange } from "@/app/risansi/dispatch-plan/actions";

function formatDate(value: string | null): string {
  if (!value) return "—";
  const d = new Date(`${value}T00:00:00`);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

/**
 * Central Visibility's To Be Dispatch Date on the Dispatch Plan: a date it
 * sets on the row (saved as it is picked); everyone else reads it.
 */
export function FinalDispatchTarget({
  orderId,
  value,
  by,
  canEdit,
  late,
}: {
  orderId: string;
  value: string | null;
  by: string | null;
  canEdit: boolean;
  late: boolean;
}) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [v, setV] = useState(value ?? "");
  if (!canEdit) {
    return (
      <span className={`inline-flex items-start gap-1 ${late ? "font-medium text-rose-700 dark:text-rose-300" : ""}`}>
        <span>
          {formatDate(value)}
          {value && by && <span className="block text-[11px] font-normal text-muted">{by}</span>}
        </span>
        <DispatchDateHistory orderId={orderId} />
      </span>
    );
  }
  async function save(next: string) {
    if (next === (value ?? "")) return;
    setSaving(true);
    setError(null);
    const res = await setFinalDispatchTargetAction(orderId, next);
    setSaving(false);
    if (!res.ok) setError(res.error);
    else router.refresh();
  }
  return (
    <span className="flex flex-col items-start gap-0.5">
      <span className="inline-flex items-center gap-1.5">
        <input
          type="date"
          value={v}
          disabled={saving}
          // Saved when left (or Enter): typing a year would otherwise save each digit.
          onChange={(e) => setV(e.target.value)}
          // A half-typed date is not a clearing: left as it was.
          onBlur={(e) => !e.currentTarget.validity.badInput && save(v)}
          onKeyDown={(e) => e.key === "Enter" && save(v)}
          aria-label="To Be Dispatch Date"
          className={`h-8 rounded-md border bg-surface px-2 text-xs ${late ? "border-rose-300 text-rose-700" : "border-input-border text-foreground"}`}
        />
        {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin text-muted" /> : <DispatchDateHistory orderId={orderId} />}
      </span>
      {value && by && <span className="text-[11px] text-muted">{by}</span>}
      {error && <span className="text-[11px] text-rose-600">{error}</span>}
    </span>
  );
}

/** The To Be Dispatch Date's history: a clock that opens every change, from what to what, by whom and when. */
function DispatchDateHistory({ orderId }: { orderId: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="To Be Dispatch Date history"
        aria-label="To Be Dispatch Date history"
        className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted transition-colors hover:bg-background hover:text-primary"
      >
        <History className="h-3.5 w-3.5" />
      </button>
      {open && <HistoryDialog orderId={orderId} onClose={() => setOpen(false)} />}
    </>
  );
}

function HistoryDialog({ orderId, onClose }: { orderId: string; onClose: () => void }) {
  const [rows, setRows] = useState<DispatchDateChange[] | null>(null);
  useEffect(() => {
    let live = true;
    listDispatchDateHistoryAction(orderId)
      .then((r) => live && setRows(r))
      .catch(() => live && setRows([]));
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => {
      live = false;
      document.removeEventListener("keydown", onKey);
    };
  }, [orderId, onClose]);
  const when = (iso: string) => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime())
      ? iso
      : d.toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" });
  };
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="To Be Dispatch Date history"
      className="fixed inset-0 z-50 flex items-end justify-center whitespace-normal bg-black/40 sm:items-center sm:p-6"
      onClick={onClose}
    >
      <div onClick={(e) => e.stopPropagation()} className="max-h-[80vh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-surface p-5 text-left shadow-xl sm:rounded-2xl">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="font-display text-base font-semibold text-foreground">To Be Dispatch Date history</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg p-1.5 text-muted hover:bg-background hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>
        {rows === null ? (
          <p className="flex items-center gap-2 text-sm text-muted">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…
          </p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted">Not set yet.</p>
        ) : (
          <ol className="space-y-2">
            {rows.map((h, i) => (
              <li key={h.id} className="rounded-lg border border-card-border px-3 py-2 text-sm">
                <div className="font-medium text-foreground">
                  {h.prev_date ? <span className="text-muted line-through">{formatDate(h.prev_date)}</span> : <span className="text-muted">Set</span>}
                  {" → "}
                  {h.new_date ? formatDate(h.new_date) : "Cleared"}
                  {i === 0 && <span className="ml-2 rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary">Current</span>}
                </div>
                <div className="mt-0.5 text-[11px] text-muted">
                  {h.by || "—"} · {when(h.at)}
                </div>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}
