"use client";

import { useEffect, useRef } from "react";
import { AlertTriangle, Check, Loader2, X } from "lucide-react";

/**
 * A confirmation the app draws itself, rather than the browser's `confirm()`.
 *
 * Beyond looking like the rest of the app, it can say what the action will
 * record — a native dialog gets one blob of text and no formatting — and it
 * keeps the page responsive while the action runs.
 */
export function ConfirmDialog({
  open,
  title,
  message,
  detail,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  tone = "primary",
  busy = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  message: string;
  // An extra line under the message: what gets recorded, what gets lost.
  detail?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "primary" | "danger";
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    // Focus the confirm button so Enter completes and Escape backs out — the
    // two things a keyboard user expects from a dialog.
    confirmRef.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !busy) onCancel();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, busy, onCancel]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-6"
      onClick={() => !busy && onCancel()}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md overflow-hidden rounded-t-2xl bg-surface shadow-xl sm:rounded-2xl"
      >
        <div className="flex items-start gap-3 px-5 pb-4 pt-5">
          <span
            className={`mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
              tone === "danger"
                ? "bg-danger-bg text-danger"
                : "bg-emerald-50 text-emerald-700"
            }`}
          >
            {tone === "danger" ? (
              <AlertTriangle className="h-4 w-4" />
            ) : (
              <Check className="h-4 w-4" />
            )}
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="font-display text-sm font-semibold text-foreground">
              {title}
            </h2>
            <p className="mt-1 text-sm text-muted">{message}</p>
            {detail && (
              <div className="mt-3 rounded-lg border border-card-border bg-background px-3 py-2 text-[12px] text-muted-foreground">
                {detail}
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            aria-label="Close"
            className="rounded-lg p-1.5 text-muted transition-colors hover:bg-background hover:text-foreground disabled:opacity-50"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex justify-end gap-2 border-t border-card-border bg-background/60 px-5 py-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="h-9 rounded-lg border border-input-border bg-surface px-4 text-sm font-medium text-foreground transition-colors hover:bg-background disabled:opacity-50"
          >
            {cancelLabel}
          </button>
          <button
            ref={confirmRef}
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className={`inline-flex h-9 items-center gap-1.5 rounded-lg px-4 text-sm font-semibold text-white transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
              tone === "danger"
                ? "bg-rose-600 hover:bg-rose-700"
                : "bg-emerald-600 hover:bg-emerald-700"
            }`}
          >
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
