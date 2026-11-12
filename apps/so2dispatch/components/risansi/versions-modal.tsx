"use client";

import { useCallback, useEffect, useState } from "react";
import { CopyPlus, Loader2, X } from "lucide-react";
import { loadOrderVersionsAction } from "@/app/risansi/orders/version-actions";
import type { VersionsData } from "@/lib/order-versions";
import { VersionsBody } from "./order-version-view";
import { NewVersionDialog } from "./new-version-dialog";

/**
 * An SO's versions in a wide pop-up: each earlier one read-only with every
 * department's data, the current one, and what changed in each — and, for
 * Order Making PO, Central Visibility and Admin, New version.
 */
export function VersionsModal({
  orderId,
  soLabel,
  canMake = false,
  onClose,
}: {
  orderId: string;
  soLabel: string;
  canMake?: boolean;
  onClose: () => void;
}) {
  const [data, setData] = useState<VersionsData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [making, setMaking] = useState(false);

  const load = useCallback(
    async (version: number | null) => {
      setLoading(true);
      setError(null);
      const res = await loadOrderVersionsAction(orderId, version);
      setLoading(false);
      if (res.ok) setData(res.data);
      else setError(res.error);
    },
    [orderId]
  );

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the first read, once, on opening
    void load(null);
  }, [load]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !making && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [making, onClose]);

  const closed = data ? ["Cancelled by client", "Diverted"].includes(String(data.snap.order.status_override ?? "")) : true;
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Versions of ${soLabel}`}
      className="fixed inset-0 z-50 flex items-stretch justify-center whitespace-normal bg-black/40 sm:p-6"
      onClick={onClose}
    >
      <div onClick={(e) => e.stopPropagation()} className="flex w-full max-w-7xl flex-col overflow-hidden bg-background text-left shadow-xl sm:rounded-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-card-border bg-surface px-5 py-4">
          <div className="min-w-0">
            <h2 className="font-display text-lg font-semibold text-foreground">{soLabel} · Versions</h2>
            <p className="truncate text-xs text-muted">{data?.client ?? ""}</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {loading && <Loader2 className="h-4 w-4 animate-spin text-muted" />}
            {canMake && data && !closed && (
              <button
                type="button"
                onClick={() => setMaking(true)}
                title="Save the SO as it is as a read-only version, and go on editing the next one"
                className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-primary/40 bg-primary/10 px-3 text-sm font-semibold text-primary hover:bg-primary hover:text-primary-foreground"
              >
                <CopyPlus className="h-3.5 w-3.5" />
                New version
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="rounded-lg p-1.5 text-muted transition-colors hover:bg-background hover:text-foreground"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>
        <div className={`flex-1 overflow-y-auto px-5 py-4 ${loading && data ? "opacity-60" : ""}`}>
          {error && <p className="text-sm text-rose-600">{error}</p>}
          {!data && !error && <p className="text-sm text-muted">Loading the versions…</p>}
          {data && <VersionsBody data={data} onPick={(n) => void load(n)} />}
        </div>
      </div>
      {making && data && (
        <span onClick={(e) => e.stopPropagation()}>
          <NewVersionDialog
            orderId={orderId}
            soLabel={soLabel}
            versionNo={data.currentNo}
            onClose={() => setMaking(false)}
            onDone={() => void load(null)}
          />
        </span>
      )}
    </div>
  );
}
