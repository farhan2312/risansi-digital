"use client";

import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Loader2, X } from "lucide-react";
import { savePendencyAction } from "@/app/risansi/orders/pendency-actions";
import { PENDENCY, type Pendency, type PendencyDept } from "@/lib/pendency";

/**
 * A department's Pending / Open status with why it is still pending: the
 * status opens the reason and remarks (for whoever may set them), and the
 * reason shows under it.
 */
export function PendencyCell({
  orderId,
  soLabel,
  dept,
  pendency,
  canEdit,
  children,
}: {
  orderId: string;
  soLabel: string;
  dept: PendencyDept;
  pendency?: Pendency;
  canEdit: boolean;
  /** The status chip itself. */
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  // Cleared: no longer pending, the latest reason kept beneath.
  const active = pendency && !pendency.clearedAt ? pendency : undefined;
  return (
    <span className="flex flex-col items-start gap-0.5">
      {canEdit ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          title={active ? "Change the pendency reason" : "Give the pendency reason"}
          className="rounded-full hover:opacity-80"
        >
          {children}
        </button>
      ) : (
        children
      )}
      {active ? (
        <span className="max-w-[14rem] text-[11px] leading-snug">
          <span className="font-medium text-amber-700 dark:text-amber-400">{active.reason}</span>
          {active.remarks && <span className="block text-muted">{active.remarks}</span>}
        </span>
      ) : (
        <>
          {canEdit && (
            <button type="button" onClick={() => setOpen(true)} className="text-[11px] font-medium text-primary hover:underline">
              + Reason
            </button>
          )}
          {pendency && (
            <span className="max-w-[14rem] text-[11px] leading-snug text-muted" title={`Cleared ${pendency.clearedAt}${pendency.clearedBy ? ` by ${pendency.clearedBy}` : ""}`}>
              Last: <span className="line-through">{pendency.reason}</span>
              {pendency.remarks && <span className="block">{pendency.remarks}</span>}
            </span>
          )}
        </>
      )}
      {open && <PendencyForm orderId={orderId} soLabel={soLabel} dept={dept} pendency={pendency} onClose={() => setOpen(false)} />}
    </span>
  );
}

function PendencyForm({
  orderId,
  soLabel,
  dept,
  pendency,
  onClose,
}: {
  orderId: string;
  soLabel: string;
  dept: PendencyDept;
  pendency?: Pendency;
  onClose: () => void;
}) {
  const router = useRouter();
  // A cleared one is the latest still: the form starts from it.
  const active = pendency && !pendency.clearedAt;
  const [reason, setReason] = useState(pendency?.reason ?? "");
  const [remarks, setRemarks] = useState(pendency?.remarks ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !saving && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [saving, onClose]);

  async function save(why: string) {
    setSaving(true);
    setError(null);
    const res = await savePendencyAction(orderId, dept, why, why ? remarks : "");
    setSaving(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    router.refresh();
    onClose();
  }
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!reason) {
      setError("Choose a reason.");
      return;
    }
    void save(reason);
  };

  const field =
    "w-full rounded-lg border border-input-border bg-surface px-3 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-ring/20";
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Pendency reason"
      className="fixed inset-0 z-50 flex items-end justify-center whitespace-normal bg-black/40 sm:items-center sm:p-6"
      onClick={() => !saving && onClose()}
    >
      <form
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-t-2xl bg-surface p-5 text-left shadow-xl sm:rounded-2xl"
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="font-display text-lg font-semibold text-foreground">Pendency reason</h2>
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
        <div className="space-y-3">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-muted-foreground">
              Reason <span className="text-danger">*</span>
            </span>
            <select value={reason} onChange={(e) => setReason(e.target.value)} className={`${field} h-10`}>
              <option value="">Choose…</option>
              {PENDENCY[dept].reasons.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-muted-foreground">Remarks</span>
            <textarea value={remarks} onChange={(e) => setRemarks(e.target.value)} rows={3} className={`${field} py-2`} />
          </label>
          {pendency && (
            <p className="text-[11px] text-muted">
              Last set by {pendency.by || "—"} on {pendency.at}
              {pendency.clearedAt && ` · cleared ${pendency.clearedAt}${pendency.clearedBy ? ` by ${pendency.clearedBy}` : ""}`}
            </p>
          )}
        </div>
        {error && <p className="mt-3 text-sm text-rose-600">{error}</p>}
        <div className="mt-5 flex items-center justify-between gap-2">
          {active ? (
            <button
              type="button"
              onClick={() => void save("")}
              disabled={saving}
              className="text-sm font-medium text-rose-600 hover:underline disabled:opacity-60"
            >
              Clear reason
            </button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="inline-flex h-10 items-center rounded-lg border border-input-border px-4 text-sm font-medium text-foreground hover:bg-background"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary-hover disabled:opacity-60"
            >
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              Save
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
