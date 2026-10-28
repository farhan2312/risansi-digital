"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { updateOrderSectionAction } from "@/app/risansi/orders/actions";
import { OM_HOLD_REASONS } from "@/lib/order-schema";
import {
  omStatusHistoryAction,
  recordOmStatusAction,
  type OmStatusEntry,
} from "@/app/risansi/departments/order-making/om-status-actions";

type Row = Record<string, unknown>;
const str = (v: unknown) => (v == null ? "" : String(v));

/**
 * Order Making's own Clear / Hold on an SO — the first step, before Central
 * Visibility's clearance. An SO Order Making holds goes to no department until
 * Order Making clears it (lib/dept-view.ts releasedSql).
 */
export function OmHoldBadge({ order, readOnly = false }: { order: Row; readOnly?: boolean }) {
  const [open, setOpen] = useState(false);
  const held = str(order.om_status) === "Hold";
  return (
    <>
      <button
        type="button"
        disabled={readOnly}
        onClick={() => setOpen(true)}
        title={held ? `On hold — ${str(order.om_hold_reason)}. Click to change.` : "Clear. Click to put on hold."}
        className={`flex w-fit max-w-[14rem] flex-col rounded-md px-1.5 py-0.5 text-left text-[11px] leading-tight transition-opacity enabled:hover:opacity-80 disabled:cursor-default ${
          held
            ? "bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:text-rose-300"
            : "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300"
        }`}
      >
        <span className="font-semibold">{held ? "On hold" : "Clear"}</span>
        {held && str(order.om_hold_reason) && <span className="whitespace-normal">{str(order.om_hold_reason)}</span>}
        {held && str(order.om_hold_remarks) && (
          <span className="whitespace-normal opacity-80">{str(order.om_hold_remarks)}</span>
        )}
      </button>
      {open && <OmHoldForm order={order} onClose={() => setOpen(false)} />}
    </>
  );
}

/** A small read-only mark for an SO Order Making holds, for those who cannot change it. */
export function OmHoldChip({ order }: { order: Row }) {
  if (str(order.om_status) !== "Hold") return null;
  return (
    <span
      title={[str(order.om_hold_reason), str(order.om_hold_remarks)].filter(Boolean).join(" — ")}
      className="mt-1 flex w-fit max-w-[12rem] flex-col rounded-md bg-rose-50 px-1.5 py-0.5 text-left text-[11px] leading-tight text-rose-700 dark:bg-rose-500/10 dark:text-rose-300"
    >
      <span className="font-semibold">Order Making hold</span>
      {str(order.om_hold_reason) && <span className="whitespace-normal">{str(order.om_hold_reason)}</span>}
    </span>
  );
}

function formatWhen(v: string): string {
  const d = new Date(v.replace(" ", "T"));
  return Number.isNaN(d.getTime())
    ? v
    : d.toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function OmHoldForm({ order, onClose }: { order: Row; onClose: () => void }) {
  const router = useRouter();
  const [status, setStatus] = useState(str(order.om_status) === "Hold" ? "Hold" : "Clear");
  const [reason, setReason] = useState(str(order.om_hold_reason));
  const [remarks, setRemarks] = useState(str(order.om_hold_remarks));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Every Clear / Hold the SO has had, with its reason and remarks.
  const [history, setHistory] = useState<OmStatusEntry[] | null>(null);
  useEffect(() => {
    let live = true;
    omStatusHistoryAction(str(order.id)).then((res) => live && setHistory(res.ok ? res.rows : []));
    return () => {
      live = false;
    };
  }, [order.id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !saving && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [saving, onClose]);

  async function save(e: FormEvent) {
    e.preventDefault();
    if (status === "Hold" && !reason.trim()) {
      setError("Choose the reason for the delay.");
      return;
    }
    setSaving(true);
    setError(null);
    const res = await updateOrderSectionAction(str(order.id), "orders", {
      om_status: status,
      om_hold_reason: status === "Hold" ? reason : "",
      om_hold_remarks: remarks,
    });
    if (!res.ok) {
      setSaving(false);
      setError(res.error);
      return;
    }
    // Kept in the SO's Clear / Hold history.
    await recordOmStatusAction(str(order.id));
    setSaving(false);
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
      aria-label="Order Making clear or hold"
      className="fixed inset-0 z-50 flex items-end justify-center whitespace-normal bg-black/40 sm:items-center sm:p-6"
      onClick={() => !saving && onClose()}
    >
      <form
        onSubmit={save}
        onClick={(e) => e.stopPropagation()}
        className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-surface p-5 text-left shadow-xl sm:rounded-2xl"
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="font-display text-lg font-semibold text-foreground">Clear or hold</h2>
            <p className="text-xs text-muted">
              SO {str(order.so_no) || str(order.sl_no)} · on hold, it goes to no department until cleared here
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
              <label className="block text-sm">
                <span className="mb-1 block text-[13px] font-medium text-brand-label">
                  Reason of delay <span className="text-danger">*</span>
                </span>
                <select value={reason} onChange={(e) => setReason(e.target.value)} className={`${input} cursor-pointer`}>
                  <option value="">Choose a reason</option>
                  {/* An older typed reason stays as it was until changed. */}
                  {[...new Set([...OM_HOLD_REASONS.map((o) => o.value), ...(reason ? [reason] : [])])].map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </label>
            </>
          )}
          {/* Remarks on a Clear too. */}
          <label className="block text-sm">
            <span className="mb-1 block text-[13px] font-medium text-brand-label">Remarks</span>
            <textarea
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              rows={3}
              className="w-full rounded-[10px] border border-input-border bg-surface px-3 py-2 text-[14px] text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-ring/20"
            />
          </label>
          {history && history.length > 0 && (
            <div>
              <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">History</p>
              <ol className="max-h-48 space-y-1.5 overflow-y-auto border-l-2 border-card-border pl-3">
                {[...history].reverse().map((h) => (
                  <li key={h.id} className="text-xs">
                    <span className={`font-semibold ${h.status === "Hold" ? "text-rose-700" : "text-emerald-700"}`}>{h.status}</span>
                    {h.reason && <span className="text-foreground"> · {h.reason}</span>}
                    {h.remarks && <span className="block text-muted-foreground">{h.remarks}</span>}
                    <span className="block text-[10.5px] text-muted">
                      {[h.changed_by_name, formatWhen(h.created_at)].filter(Boolean).join(" · ")}
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          )}
        </div>
        <div className="mt-5 flex justify-end gap-2">
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
            className="inline-flex h-10 items-center rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary-hover disabled:opacity-60"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
    </div>
  );
}
