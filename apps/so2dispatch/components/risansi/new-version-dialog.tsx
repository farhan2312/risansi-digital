"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { History, Loader2, X } from "lucide-react";
import { createOrderVersionAction } from "@/app/risansi/orders/version-actions";

/**
 * A new version of a Pump SO — by Order Making PO, Central Visibility or
 * Admin: why, then the current one is kept read-only with every department's
 * data, and the SO goes on as the next version.
 */
export function NewVersionDialog({
  orderId,
  soLabel,
  versionNo,
  onClose,
}: {
  orderId: string;
  soLabel: string;
  versionNo: number;
  onClose: () => void;
}) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const now = versionNo || 0;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !saving && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [saving, onClose]);

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!reason.trim()) {
      setError("Say why the new version is made.");
      return;
    }
    setSaving(true);
    setError(null);
    const res = await createOrderVersionAction(orderId, reason);
    setSaving(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    router.refresh();
    onClose();
  }

  const so = soLabel;
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`New version of ${so}`}
      className="fixed inset-0 z-50 flex items-end justify-center whitespace-normal bg-black/40 sm:items-center sm:p-6"
      onClick={() => !saving && onClose()}
    >
      <form
        onSubmit={save}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-t-2xl bg-surface p-5 text-left shadow-xl sm:rounded-2xl"
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="font-display text-lg font-semibold text-foreground">New version of {so}</h2>
            <p className="text-xs text-muted">
              v{now} is kept read-only: the SO and every department&apos;s work as they are now. The SO becomes v{now + 1}, a copy
              of it, which you then edit as usual. The departments on it are told.
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
        <label className="block text-sm">
          <span className="mb-1 block text-[13px] font-medium text-brand-label">
            Reason <span className="text-danger">*</span>
          </span>
          <textarea
            autoFocus
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            placeholder="e.g. Client revised PO: qty 4 to 6"
            className="w-full rounded-[10px] border border-input-border bg-surface px-3 py-2 text-[14px] text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-ring/20"
          />
        </label>
        {now > 0 && (
          <Link href={`/risansi/orders/${orderId}/versions`} className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
            <History className="h-3.5 w-3.5" />
            See the earlier versions
          </Link>
        )}
        {error && <p className="mt-2 text-sm text-rose-600">{error}</p>}
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
            className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-60"
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            Save v{now} and make v{now + 1}
          </button>
        </div>
      </form>
    </div>
  );
}
