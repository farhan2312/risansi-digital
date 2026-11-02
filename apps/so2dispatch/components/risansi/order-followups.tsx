"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Loader2, X } from "lucide-react";
import { addFollowupAction, listFollowupsAction, type Followup } from "@/app/risansi/orders/followup-actions";

/** The SO's latest follow-up, as the Orders list carries it. */
export type LastFollowup = { followup_date: string; remarks: string; next_followup_date: string; count: number };

function day(v: string): string {
  const d = new Date(`${v.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? v : d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
}
const todayIso = () => new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);

/** The Orders list's Follow Up column: when the next is due (red once past), opening the follow-ups. */
export function FollowupCell({
  orderId,
  soLabel,
  last,
  canAdd,
}: {
  orderId: string;
  soLabel: string;
  last?: LastFollowup | null;
  canAdd: boolean;
}) {
  const [open, setOpen] = useState(false);
  const late = !!last && last.next_followup_date < todayIso();
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={last ? last.remarks : "No follow-up yet"}
        className="inline-flex flex-col items-start whitespace-nowrap rounded-lg border border-input-border px-2.5 py-1 text-left text-xs font-medium text-foreground transition-colors hover:bg-background"
      >
        {last ? `Follow-ups · ${last.count}` : canAdd ? "Add follow-up" : "No follow-up"}
        {last && (
          <span className={`text-[11px] font-normal ${late ? "font-medium text-rose-600" : "text-muted"}`}>
            Next {day(last.next_followup_date)}
          </span>
        )}
      </button>
      {open && <FollowupDialog orderId={orderId} soLabel={soLabel} canAdd={canAdd} onClose={() => setOpen(false)} />}
    </>
  );
}

function FollowupDialog({
  orderId,
  soLabel,
  canAdd,
  onClose,
}: {
  orderId: string;
  soLabel: string;
  canAdd: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const [history, setHistory] = useState<Followup[] | null>(null);
  const [date, setDate] = useState(todayIso);
  const [remarks, setRemarks] = useState("");
  const [next, setNext] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    listFollowupsAction(orderId)
      .then((rows) => live && setHistory(rows))
      .catch(() => live && setHistory([]));
    return () => {
      live = false;
    };
  }, [orderId]);

  async function save(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const res = await addFollowupAction(orderId, { followup_date: date, remarks, next_followup_date: next });
    if (!res.ok) {
      setSaving(false);
      setError(res.error);
      return;
    }
    setHistory(await listFollowupsAction(orderId));
    setSaving(false);
    setRemarks("");
    setNext("");
    router.refresh();
  }

  const field =
    "w-full rounded-lg border border-input-border bg-surface px-3 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-ring/20";
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Follow-ups"
      className="fixed inset-0 z-50 flex items-end justify-center whitespace-normal bg-black/40 sm:items-center sm:p-6"
      onClick={() => !saving && onClose()}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-t-2xl bg-surface p-5 text-left shadow-xl sm:rounded-2xl"
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="font-display text-lg font-semibold text-foreground">Follow-ups</h2>
            <p className="text-xs text-muted">SO {soLabel}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            aria-label="Close"
            className="rounded-lg p-1.5 text-muted transition-colors hover:bg-background hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {canAdd && (
          <form onSubmit={save} className="mb-5 space-y-3 rounded-xl border border-card-border p-3">
            {error && (
              <div className="rounded-[10px] border border-danger-border bg-danger-bg px-3 py-2 text-sm text-danger">{error}</div>
            )}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-muted-foreground">
                  Follow-up date <span className="text-danger">*</span>
                </span>
                <input type="date" required value={date} onChange={(e) => setDate(e.target.value)} className={`${field} h-10`} />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-muted-foreground">
                  Next follow-up date <span className="text-danger">*</span>
                </span>
                <input type="date" required min={date} value={next} onChange={(e) => setNext(e.target.value)} className={`${field} h-10`} />
              </label>
            </div>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-muted-foreground">
                Remarks <span className="text-danger">*</span>
              </span>
              <textarea required rows={3} value={remarks} onChange={(e) => setRemarks(e.target.value)} className={`${field} py-2`} />
            </label>
            <div className="flex justify-end">
              <button
                type="submit"
                disabled={saving}
                className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary-hover disabled:opacity-50"
              >
                {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                Add follow-up
              </button>
            </div>
          </form>
        )}

        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          History{history ? ` · ${history.length}` : ""}
        </h3>
        {history === null ? (
          <p className="flex items-center gap-2 text-sm text-muted">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…
          </p>
        ) : history.length === 0 ? (
          <p className="text-sm text-muted">No follow-ups yet.</p>
        ) : (
          <ul className="space-y-2">
            {history.map((f) => (
              <li key={f.id} className="rounded-lg border border-card-border px-3 py-2 text-sm">
                <div className="flex flex-wrap justify-between gap-x-3 gap-y-0.5 text-xs">
                  <span className="font-semibold text-foreground">{day(f.followup_date)}</span>
                  <span className="text-muted">Next {day(f.next_followup_date)}</span>
                </div>
                <p className="mt-1 whitespace-pre-wrap break-words text-foreground">{f.remarks}</p>
                {f.by && <p className="mt-1 text-[11px] text-muted">{f.by}</p>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
