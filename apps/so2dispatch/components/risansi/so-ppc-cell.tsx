"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarCheck, Loader2, X } from "lucide-react";
import { updateOrderSectionAction } from "@/app/risansi/orders/actions";
import { clearOrderPrefetch } from "./order-prefetch";

const shown = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });

/**
 * The Orders list's SO Sent to PPC column: the date, or Set. Central
 * Visibility clicks it for a small pop-up to fill (or change) the date; anyone
 * else reads it.
 */
export function SoPpcCell({ orderId, soLabel, date, canEdit }: { orderId: string; soLabel: string; date: string | null; canEdit: boolean }) {
  const [open, setOpen] = useState(false);
  const iso = (date ?? "").slice(0, 10);
  if (!canEdit) return <span className={iso ? "" : "text-muted"}>{iso ? shown(iso) : "—"}</span>;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={iso ? "Change the SO Sent to PPC Date" : "Fill the SO Sent to PPC Date"}
        className={
          iso
            ? "rounded-md px-1.5 py-0.5 text-left underline decoration-dotted underline-offset-2 hover:bg-background"
            : "inline-flex items-center gap-1 rounded-lg border border-primary/40 bg-primary/10 px-2 py-1 text-xs font-semibold text-primary hover:bg-primary hover:text-primary-foreground"
        }
      >
        {iso ? (
          shown(iso)
        ) : (
          <>
            <CalendarCheck className="h-3.5 w-3.5" />
            Set
          </>
        )}
      </button>
      {open && <PpcDialog orderId={orderId} soLabel={soLabel} date={iso} onClose={() => setOpen(false)} />}
    </>
  );
}

function PpcDialog({ orderId, soLabel, date, onClose }: { orderId: string; soLabel: string; date: string; onClose: () => void }) {
  const router = useRouter();
  const [value, setValue] = useState(date);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setError(null);
    const res = await updateOrderSectionAction(orderId, "orders", { so_handover_date: value });
    setSaving(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    clearOrderPrefetch();
    onClose();
    router.refresh();
  }

  return (
    <div role="dialog" aria-modal="true" aria-label="SO Sent to PPC Date" className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-sm rounded-2xl bg-background p-5 text-left shadow-xl">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="font-display text-base font-semibold text-foreground">SO Sent to PPC Date</h2>
            <p className="text-xs text-muted">SO {soLabel}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg p-1.5 text-muted hover:bg-surface hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>
        <input
          type="date"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          autoFocus
          className="h-10 w-full rounded-lg border border-input-border bg-surface px-3 text-sm focus:border-primary focus:outline-none"
        />
        <p className="mt-2 text-[11px] text-muted">Drawing&apos;s first target is counted from it, when not set yet.</p>
        {error && <p className="mt-2 text-sm text-danger">{error}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="h-9 rounded-lg border border-input-border px-3 text-sm font-medium hover:bg-surface">
            Cancel
          </button>
          <button
            type="button"
            onClick={save}
            disabled={saving || value === date}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary-hover disabled:opacity-50"
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
