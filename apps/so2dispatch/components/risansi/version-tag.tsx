"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { Loader2, X } from "lucide-react";
import { ackEcVersionChangesAction, ecVersionChangesAction } from "@/app/risansi/orders/actions";
import type { SoEcChanges } from "@/lib/ec-version-changes";

// Every version tag on a page asks for its SO's EC changes; the asks are
// gathered into one request, and the answers kept until acknowledged.
const cache = new Map<string, SoEcChanges | null>();
let viewerDept: string | null = null;
const queue = new Set<string>();
let scheduled = false;
const listeners = new Set<() => void>();
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};
function want(orderId: string) {
  if (!orderId || cache.has(orderId) || queue.has(orderId)) return;
  queue.add(orderId);
  if (!scheduled) {
    scheduled = true;
    setTimeout(flush, 30);
  }
}
async function flush() {
  scheduled = false;
  const ids = [...queue];
  queue.clear();
  try {
    const r = await ecVersionChangesAction(ids);
    viewerDept = r.dept;
    for (const id of ids) cache.set(id, r.changes[id] ?? null);
  } catch {
    for (const id of ids) cache.set(id, null);
  }
  listeners.forEach((fn) => fn());
}

const str = (v: unknown) => (v === null || v === undefined ? "" : String(v).trim());

/**
 * A Pump SO's version, as the departments see it: the number only, from v1
 * (an SO still at v0 shows nothing). Order Making, Central Visibility and
 * Admin open the versions themselves from their own tag. When ECs were
 * added, changed or removed in this version, a chip says how many; the
 * department opens them and acknowledges what it has seen.
 */
export function VersionTag({ order }: { order: Record<string, unknown> | null | undefined }) {
  const n = Number(order?.version_no ?? 0) || 0;
  // Item rows carry their SO as order_id; SO rows are the SO.
  const orderId = str(order?.order_id) || str(order?.id);
  const data = useSyncExternalStore(subscribe, () => cache.get(orderId), () => undefined);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (n >= 1) want(orderId);
  }, [orderId, n]);
  if (n < 1) return null;
  const changes = data?.changes ?? [];
  const unseen = changes.filter((c) => !c.acked).length;
  // A department sees what it has not acknowledged; anyone else, every change.
  const shown = viewerDept ? unseen : changes.length;
  return (
    <span className="mt-1 flex w-fit flex-wrap items-center gap-1">
      <span
        title={`Version ${n} — the SO was revised ${n === 1 ? "once" : `${n} times`}`}
        className="flex w-fit items-center rounded-md bg-primary/10 px-1.5 py-0.5 text-[11px] font-semibold text-primary"
      >
        v{n}
      </span>
      {changes.length > 0 && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setOpen(true);
          }}
          title="ECs added, changed or removed in this version"
          className={`rounded-md px-1.5 py-0.5 text-[11px] font-semibold ${
            shown > 0
              ? "bg-amber-100 text-amber-800 hover:bg-amber-200 dark:bg-amber-500/15 dark:text-amber-300"
              : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-white/10 dark:text-slate-300"
          }`}
        >
          {shown > 0 ? `${shown} EC change${shown === 1 ? "" : "s"}` : "EC changes seen"}
        </button>
      )}
      {open && data && <ChangesDialog orderId={orderId} version={n} data={data} onClose={() => setOpen(false)} />}
    </span>
  );
}

const KIND: Record<string, { label: string; tone: string }> = {
  added: { label: "Added", tone: "bg-emerald-50 text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-300" },
  changed: { label: "Changed", tone: "bg-amber-50 text-amber-800 dark:bg-amber-500/10 dark:text-amber-300" },
  removed: { label: "Removed", tone: "bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:text-rose-300" },
};

function ChangesDialog({ orderId, version, data, onClose }: { orderId: string; version: number; data: SoEcChanges; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const unseen = data.changes.some((c) => !c.acked);
  async function ack() {
    setBusy(true);
    setError(null);
    const res = await ackEcVersionChangesAction(orderId);
    setBusy(false);
    if (!res.ok) return setError(res.error);
    // Read again: the chip settles.
    cache.delete(orderId);
    want(orderId);
    onClose();
  }
  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`EC changes in v${version}`}
      className="fixed inset-0 z-[60] flex items-center justify-center whitespace-normal bg-black/40 p-4 text-left"
      onClick={(e) => {
        e.stopPropagation();
        onClose();
      }}
    >
      <div onClick={(e) => e.stopPropagation()} className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-surface p-5 shadow-xl">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <h3 className="font-display text-base font-semibold text-foreground">EC changes in v{version}</h3>
            <p className="text-xs text-muted">Since v{version - 1}: ECs added, changed or removed</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg p-1.5 text-muted hover:bg-background hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>
        <ul className="divide-y divide-card-border rounded-xl border border-card-border">
          {data.changes.map((c) => (
            <li key={c.itemId} className="px-3 py-2 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className={`font-semibold ${c.kind === "removed" ? "text-muted line-through" : "text-foreground"}`}>{c.ecNo ?? "EC"}</span>
                <span className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${KIND[c.kind].tone}`}>{KIND[c.kind].label}</span>
                {viewerDept && c.acked && <span className="text-[11px] text-muted">seen</span>}
              </div>
              {c.lines.map((l, i) => (
                <div key={i} className="text-xs text-muted">
                  {l}
                </div>
              ))}
            </li>
          ))}
        </ul>
        {error && <p className="mt-3 text-sm text-danger">{error}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="inline-flex h-9 items-center rounded-lg border border-input-border px-4 text-sm font-medium text-foreground hover:bg-background">
            Close
          </button>
          {viewerDept && unseen && (
            <button
              type="button"
              onClick={ack}
              disabled={busy}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary-hover disabled:opacity-60"
            >
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              Acknowledge
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
