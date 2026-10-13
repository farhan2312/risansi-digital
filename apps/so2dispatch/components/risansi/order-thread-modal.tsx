"use client";

import { X } from "lucide-react";
import { OrderThread } from "./order-thread";

/** The SO discussion in a dialog, for the department workspaces. */
export function OrderThreadModal({
  orderId,
  role,
  soLabel,
  onClose,
}: {
  orderId: string;
  role: string;
  soLabel?: string;
  onClose: () => void;
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Discussion for SO ${soLabel ?? ""}`}
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-6"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-4xl overflow-hidden rounded-t-2xl bg-surface shadow-xl sm:rounded-2xl"
      >
        <div className="flex items-center justify-between border-b border-card-border px-5 py-3">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Discussion
            </p>
            <p className="truncate font-display text-sm font-semibold text-foreground">
              {soLabel || "—"}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-lg p-1.5 text-muted transition-colors hover:bg-background hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <OrderThread
          orderId={orderId}
          role={role}
          soLabel={soLabel}
          className="rounded-none border-0 shadow-none"
        />
      </div>
    </div>
  );
}
