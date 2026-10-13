"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Hand, Loader2, Plus, X } from "lucide-react";
import {
  addAccountsHoldReasonAction,
  listAccountsHoldReasonsAction,
  setAccountsHoldAction,
} from "@/app/risansi/orders/actions";

type Row = Record<string, unknown>;
const str = (v: unknown) => (v === null || v === undefined ? "" : String(v).trim());

/**
 * Accounts' hold on an SO, from its row in the Accounts queue: "Hold" opens a
 * pop-up to put it on hold with a reason (from a list Accounts adds to) and
 * remarks, or to lift it. Every department sees the hold (HoldBadge).
 */
export function AccountsHoldButton({ order }: { order: Row }) {
  const [open, setOpen] = useState(false);
  const held = str(order.accounts_hold_status) === "Hold";
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={held ? "Change or lift the Accounts hold" : "Put this SO on Accounts hold"}
        className={`mt-1 flex h-6 w-fit items-center gap-1 rounded-md border px-1.5 text-[11px] font-medium transition-colors ${
          held
            ? "border-rose-300 text-rose-700 hover:bg-rose-50 dark:border-rose-500/40 dark:text-rose-300"
            : "border-input-border text-muted hover:bg-background hover:text-foreground"
        }`}
      >
        <Hand className="h-3 w-3" />
        {held ? "Edit hold" : "Hold"}
      </button>
      {open && <HoldForm order={order} onClose={() => setOpen(false)} />}
    </>
  );
}

function HoldForm({ order, onClose }: { order: Row; onClose: () => void }) {
  const router = useRouter();
  const [status, setStatus] = useState(str(order.accounts_hold_status) === "Hold" ? "Hold" : "Clear");
  const [reason, setReason] = useState(str(order.accounts_hold_reason));
  const [remarks, setRemarks] = useState(str(order.accounts_hold_remarks));
  const [reasons, setReasons] = useState<string[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [newReason, setNewReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    listAccountsHoldReasonsAction().then((r) => live && setReasons(r));
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !saving && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [saving, onClose]);

  async function addReason() {
    setError(null);
    const res = await addAccountsHoldReasonAction(newReason);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setReasons((prev) => [...new Set([...(prev ?? []), res.label])].sort((a, b) => a.localeCompare(b)));
    setReason(res.label);
    setNewReason("");
    setAdding(false);
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const res = await setAccountsHoldAction(str(order.id), { status, reason, remarks });
    setSaving(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    router.refresh();
    onClose();
  }

  const input =
    "h-10 w-full rounded-[10px] border border-input-border bg-surface px-3 text-[14px] text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-ring/20";
  const choice = (on: boolean, tone: "rose" | "emerald") =>
    `flex-1 rounded-lg border px-3 py-2 text-sm font-semibold transition-colors ${
      on
        ? tone === "rose"
          ? "border-rose-400 bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:text-rose-300"
          : "border-emerald-400 bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300"
        : "border-input-border text-muted hover:bg-background"
    }`;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Accounts hold"
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-6"
      onClick={() => !saving && onClose()}
    >
      <form
        onSubmit={save}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-t-2xl bg-surface p-5 text-left shadow-xl sm:rounded-2xl"
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="font-display text-lg font-semibold text-foreground">Accounts hold</h2>
            <p className="text-xs text-muted">
              SO {str(order.so_no) || str(order.sl_no)} · every department sees the hold and its reason
            </p>
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
        {error && (
          <div role="alert" className="mb-3 rounded-[10px] border border-danger-border bg-danger-bg px-3 py-2 text-sm text-danger">
            {error}
          </div>
        )}
        <div className="space-y-3">
          <div className="flex gap-2">
            <button type="button" onClick={() => setStatus("Clear")} className={choice(status === "Clear", "emerald")}>
              Clear
            </button>
            <button type="button" onClick={() => setStatus("Hold")} className={choice(status === "Hold", "rose")}>
              Hold
            </button>
          </div>
          {status === "Hold" && (
            <>
              <div className="text-sm">
                <span className="mb-1 flex items-center justify-between text-[13px] font-medium text-brand-label">
                  <span>
                    Hold Reason <span className="text-danger">*</span>
                  </span>
                  {!adding && (
                    <button
                      type="button"
                      onClick={() => setAdding(true)}
                      className="inline-flex items-center gap-0.5 text-[12px] font-medium text-primary hover:underline"
                    >
                      <Plus className="h-3 w-3" />
                      Add reason
                    </button>
                  )}
                </span>
                {adding ? (
                  <div className="flex gap-2">
                    <input
                      value={newReason}
                      onChange={(e) => setNewReason(e.target.value)}
                      placeholder="New reason"
                      maxLength={80}
                      className={input}
                      autoFocus
                    />
                    <button
                      type="button"
                      onClick={addReason}
                      disabled={!newReason.trim()}
                      className="inline-flex h-10 items-center rounded-lg bg-primary px-3 text-sm font-semibold text-primary-foreground disabled:opacity-50"
                    >
                      Add
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setAdding(false);
                        setNewReason("");
                      }}
                      className="inline-flex h-10 items-center rounded-lg border border-input-border px-3 text-sm text-foreground"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <select value={reason} onChange={(e) => setReason(e.target.value)} className={input}>
                    <option value="">{reasons === null ? "Loading…" : "Choose a reason"}</option>
                    {[...new Set([...(reasons ?? []), ...(reason ? [reason] : [])])].map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                )}
              </div>
              <label className="block text-sm">
                <span className="mb-1 block text-[13px] font-medium text-brand-label">Remarks</span>
                <textarea
                  value={remarks}
                  onChange={(e) => setRemarks(e.target.value)}
                  rows={3}
                  maxLength={500}
                  className="w-full rounded-[10px] border border-input-border bg-surface px-3 py-2 text-[14px] text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-ring/20"
                />
              </label>
            </>
          )}
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="inline-flex h-9 items-center rounded-lg border border-input-border px-4 text-sm font-medium text-foreground transition-colors hover:bg-background"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving || adding}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary-hover disabled:opacity-60"
          >
            {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Save
          </button>
        </div>
      </form>
    </div>
  );
}
