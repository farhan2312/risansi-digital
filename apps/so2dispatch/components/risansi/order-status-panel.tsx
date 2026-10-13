"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Ban, Loader2, Shuffle, X } from "lucide-react";
import { setOrderStatusAction } from "@/app/risansi/orders/actions";
import { isCentral } from "@/lib/roles";

type Row = Record<string, unknown>;

const str = (v: unknown) => (v === null || v === undefined ? "" : String(v).trim());

function when(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

/** The choices, in the order they are offered; "auto" follows the invoices. */
const CHOICES: { value: string; label: string; hint: string }[] = [
  { value: "auto", label: "Automatic", hint: "Follow the invoices" },
  { value: "Pending", label: "Pending", hint: "Nothing dispatched yet" },
  { value: "LOT dispatch", label: "Lot dispatch", hint: "Partly dispatched" },
  { value: "Fully dispatch", label: "Fully dispatched", hint: "Everything dispatched" },
  { value: "Cancelled by client", label: "Cancelled by client", hint: "Closes the order" },
  { value: "Diverted", label: "Diverted", hint: "Closes the order" },
];

const TONE: Record<string, string> = {
  Pending: "bg-slate-100 text-slate-700",
  "LOT dispatch": "bg-blue-50 text-blue-700",
  "Fully dispatch": "bg-emerald-50 text-emerald-700",
  "Cancelled by client": "bg-rose-50 text-rose-700",
  Diverted: "bg-amber-50 text-amber-700",
};

/**
 * The order's status: a banner when it is cancelled or diverted, a chip
 * otherwise — and, for Central Visibility and Admin, the control that sets it.
 *
 * The status follows the invoices (Pending → Lot dispatch → Fully dispatched)
 * until Central Visibility sets it by hand; "Automatic" hands it back.
 */
export function OrderStatusPanel({
  orderId,
  order,
  role,
}: {
  orderId: string;
  order: Row;
  role: string;
}) {
  const [open, setOpen] = useState(false);
  const override = str(order.status_override);
  const fromInvoices = str(order.dispatch_status) || "Pending";
  const status = override || fromInvoices;
  const closed = status === "Cancelled by client" || status === "Diverted";
  const setBy = str(order.status_set_by_name);
  const setAt = str(order.status_set_at);
  const reason = str(order.status_reason);
  const divertedTo = str(order.status_diverted_to);
  const canSet = isCentral(role);

  const who = override
    ? `Set${setBy ? ` by ${setBy}` : ""}${setAt ? ` on ${when(setAt)}` : ""}`
    : "From the invoices";

  return (
    <>
      {closed ? (
        <div
          role="status"
          className={`mb-6 flex flex-wrap items-start justify-between gap-3 rounded-xl border px-5 py-4 ${
            status === "Diverted"
              ? "border-amber-300 bg-amber-50 text-amber-900"
              : "border-rose-300 bg-rose-50 text-rose-900"
          }`}
        >
          <div className="flex min-w-0 items-start gap-3">
            {status === "Diverted" ? (
              <Shuffle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
            ) : (
              <Ban className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
            )}
            <div className="min-w-0 text-sm">
              <p className="font-semibold">
                {status === "Diverted" ? "This order was diverted" : "This order was cancelled by the client"}
                {divertedTo && ` — to ${divertedTo}`}
              </p>
              {reason && <p className="mt-0.5">Reason: {reason}</p>}
              <p className="mt-0.5 text-xs opacity-80">
                {who}. It is off every department&apos;s work, and only Central
                Visibility and Admin can change it. Nothing on it has been deleted.
              </p>
            </div>
          </div>
          {canSet && (
            <button
              type="button"
              onClick={() => setOpen(true)}
              className="inline-flex h-9 shrink-0 items-center rounded-lg border border-current/30 bg-white/60 px-3 text-sm font-medium transition-colors hover:bg-white"
            >
              Change status
            </button>
          )}
        </div>
      ) : (
        <div className="mb-6 flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted">Order status</span>
          <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${TONE[status] ?? TONE.Pending}`}>
            {status === "LOT dispatch" ? "Lot dispatch" : status === "Fully dispatch" ? "Fully dispatched" : status}
          </span>
          <span className="text-xs text-muted">{who}</span>
          {canSet && (
            <button
              type="button"
              onClick={() => setOpen(true)}
              className="ml-1 inline-flex h-7 items-center rounded-md border border-input-border px-2.5 text-xs font-medium text-foreground transition-colors hover:bg-background"
            >
              Change status
            </button>
          )}
        </div>
      )}

      {open && (
        <StatusDialog
          orderId={orderId}
          current={override || "auto"}
          fromInvoices={fromInvoices}
          reason={reason}
          divertedTo={divertedTo}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function StatusDialog({
  orderId,
  current,
  fromInvoices,
  reason: reasonNow,
  divertedTo: divertedNow,
  onClose,
}: {
  orderId: string;
  current: string;
  fromInvoices: string;
  reason: string;
  divertedTo: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [choice, setChoice] = useState(current);
  const [reason, setReason] = useState(reasonNow);
  const [divertedTo, setDivertedTo] = useState(divertedNow);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const closing = choice === "Cancelled by client" || choice === "Diverted";

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !saving && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, saving]);

  async function save() {
    if (closing && !reason.trim()) {
      setError("Say why — a reason is needed to cancel or divert an order.");
      return;
    }
    setSaving(true);
    setError(null);
    const res = await setOrderStatusAction(orderId, choice, reason, divertedTo);
    setSaving(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    onClose();
    router.refresh();
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Change order status"
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-6"
      onClick={() => !saving && onClose()}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg rounded-t-2xl bg-surface p-5 shadow-xl sm:rounded-2xl"
      >
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="font-display text-lg font-semibold text-foreground">Order status</h2>
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

        <fieldset className="space-y-1.5">
          <legend className="sr-only">Status</legend>
          {CHOICES.map((c) => (
            <label
              key={c.value}
              className={`flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2 text-sm transition-colors ${
                choice === c.value ? "border-primary bg-primary/5" : "border-card-border hover:bg-background"
              }`}
            >
              <input
                type="radio"
                name="order-status"
                value={c.value}
                checked={choice === c.value}
                onChange={() => setChoice(c.value)}
                className="mt-1"
              />
              <span>
                <span className="font-medium text-foreground">{c.label}</span>
                <span className="ml-2 text-xs text-muted">
                  {c.value === "auto" ? `${c.hint} — now ${fromInvoices}` : c.hint}
                </span>
              </span>
            </label>
          ))}
        </fieldset>

        {choice === "Diverted" && (
          <label className="mt-4 block text-sm">
            <span className="mb-1 block font-medium text-foreground">Diverted to</span>
            <input
              value={divertedTo}
              onChange={(e) => setDivertedTo(e.target.value)}
              placeholder="Another SO or client (optional)"
              className="h-9 w-full rounded-lg border border-input-border bg-surface px-3 text-sm text-foreground"
            />
          </label>
        )}

        <label className="mt-4 block text-sm">
          <span className="mb-1 block font-medium text-foreground">
            Reason {closing ? <span className="text-danger">*</span> : <span className="font-normal text-muted">(optional)</span>}
          </span>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            className="w-full rounded-lg border border-input-border bg-surface px-3 py-2 text-sm text-foreground"
          />
        </label>

        {closing && (
          <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
            The order leaves every department&apos;s work, escalations and reminders, and
            becomes read-only for them. The departments with work on it are told.
            Nothing is deleted, and it can be reopened here.
          </p>
        )}

        {error && (
          <p role="alert" className="mt-3 text-sm text-danger">
            {error}
          </p>
        )}

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
            type="button"
            onClick={save}
            disabled={saving}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary-hover disabled:opacity-60"
          >
            {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Save status
          </button>
        </div>
      </div>
    </div>
  );
}
