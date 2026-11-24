"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { History, Loader2, Lock, X } from "lucide-react";
import { ackEcVersionChangesAction, ecVersionChangesAction } from "@/app/risansi/orders/actions";
import { chooseOnVersionAction, loadDeptVersionsAction } from "@/app/risansi/orders/version-actions";
import type { SoEcChanges } from "@/lib/ec-version-changes";
import type { DeptVersionsData } from "@/lib/order-versions";
import { CHOICE_DEPTS, CHOICE_LABEL, type VersionChoice } from "@/lib/version-dept-choice";
import { OrderVersionView } from "./order-version-view";

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
function want(orderId: string, fresh = false) {
  if (!orderId || queue.has(orderId)) return;
  // The page's data refreshed (an EC saved, say): read it again.
  if (fresh) cache.delete(orderId);
  if (cache.has(orderId)) return;
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
const when = (v: string) =>
  new Date(v).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" });

/** The viewer's department chooses on a new version (Not needed, or Acknowledge with Copy or Flush). */
const choosing = () => !!viewerDept && !!CHOICE_DEPTS[viewerDept];

/**
 * A Pump SO's version, as the departments see it: the number only, from v1
 * (an SO still at v0 shows nothing). Order Making, Central Visibility and
 * Admin open the versions themselves from their own tag. When ECs were
 * added, changed or removed in this version, a chip says how many. A
 * department opens the version: the changes, its choice on it (once), and
 * its own work in the earlier versions.
 */
export function VersionTag({ order }: { order: Record<string, unknown> | null | undefined }) {
  const n = Number(order?.version_no ?? 0) || 0;
  // Item rows carry their SO as order_id; SO rows are the SO.
  const orderId = str(order?.order_id) || str(order?.id);
  const data = useSyncExternalStore(subscribe, () => cache.get(orderId), () => undefined);
  const [open, setOpen] = useState(false);
  // Read when shown, and again whenever the page hands it a fresh row.
  useEffect(() => {
    if (n >= 1) want(orderId, true);
  }, [orderId, n, order]);
  if (n < 1) return null;
  const changes = data?.changes ?? [];
  const unseen = changes.filter((c) => !c.acked).length;
  const chooser = choosing() && !!data;
  // A department sees what it has not acknowledged; anyone else, every change.
  const shown = viewerDept ? unseen : changes.length;
  const toChoose = chooser && !data?.choice;
  const label = toChoose
    ? `${unseen > 0 ? `${unseen} EC change${unseen === 1 ? "" : "s"} · ` : ""}Choose`
    : shown > 0
      ? `${shown} EC change${shown === 1 ? "" : "s"}`
      : chooser && data?.choice
        ? CHOICE_LABEL[data.choice.choice].replace("Acknowledged · ", "")
        : "EC changes seen";
  const openIt = (e: React.MouseEvent) => {
    e.stopPropagation();
    setOpen(true);
  };
  return (
    <span className="mt-1 flex w-fit flex-wrap items-center gap-1">
      {chooser ? (
        <button
          type="button"
          onClick={openIt}
          title={`Version ${n}: open its changes, your choice on it, and your work in the earlier versions`}
          className="flex w-fit items-center rounded-md bg-primary/10 px-1.5 py-0.5 text-[11px] font-semibold text-primary hover:bg-primary/20"
        >
          v{n}
        </button>
      ) : (
        <span
          title={`Version ${n} — the SO was revised ${n === 1 ? "once" : `${n} times`}`}
          className="flex w-fit items-center rounded-md bg-primary/10 px-1.5 py-0.5 text-[11px] font-semibold text-primary"
        >
          v{n}
        </span>
      )}
      {(changes.length > 0 || chooser) && (
        <button
          type="button"
          onClick={openIt}
          title={toChoose ? "Not needed, or Acknowledge and Copy or Flush your work" : "ECs added, changed or removed in this version"}
          className={`rounded-md px-1.5 py-0.5 text-[11px] font-semibold ${
            toChoose || shown > 0
              ? "bg-amber-100 text-amber-800 hover:bg-amber-200 dark:bg-amber-500/15 dark:text-amber-300"
              : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-white/10 dark:text-slate-300"
          }`}
        >
          {label}
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

const btn = "inline-flex h-9 items-center gap-1.5 rounded-lg px-4 text-sm font-semibold disabled:opacity-60";
const ghost = `${btn} border border-input-border font-medium text-foreground hover:bg-background`;
const primary = `${btn} bg-primary text-primary-foreground hover:bg-primary-hover`;

function ChangesDialog({ orderId, version, data, onClose }: { orderId: string; version: number; data: SoEcChanges; onClose: () => void }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Acknowledge first, then Copy or Flush.
  const [acking, setAcking] = useState(false);
  const [earlier, setEarlier] = useState(false);
  const unseen = data.changes.some((c) => !c.acked);
  const chooser = choosing();
  const choice = data.choice;
  // What a Flush clears: the ECs added or changed in this version.
  const targets = data.changes.filter((c) => c.kind !== "removed");
  const dept = viewerDept ? CHOICE_DEPTS[viewerDept] : "";

  function settle() {
    // Read again: the chip settles; the page shows what a Flush cleared.
    cache.delete(orderId);
    want(orderId);
    router.refresh();
    onClose();
  }
  async function ack() {
    setBusy(true);
    setError(null);
    const res = await ackEcVersionChangesAction(orderId);
    setBusy(false);
    if (!res.ok) return setError(res.error);
    settle();
  }
  async function choose(c: VersionChoice) {
    if (c === "flush") {
      const list = targets.map((t) => t.ecNo ?? "EC").join(", ");
      const ok = window.confirm(
        targets.length
          ? `Flush: ${dept}'s work on ${list} is cleared, to start again from zero. v${version - 1} keeps it. This is your choice for v${version}, made once. Go on?`
          : `No EC was added or changed in v${version}: nothing is cleared. Record Flush for v${version}?`
      );
      if (!ok) return;
    }
    if (c === "not_needed" && !window.confirm(`Not needed: ${dept} has no work on v${version}; its data stays as in v${version - 1}. Made once. Go on?`)) return;
    setBusy(true);
    setError(null);
    const res = await chooseOnVersionAction(orderId, c);
    setBusy(false);
    if (!res.ok) return setError(res.error);
    settle();
  }

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Version ${version}`}
      className="fixed inset-0 z-[60] flex items-center justify-center whitespace-normal bg-black/40 p-4 text-left"
      onClick={(e) => {
        e.stopPropagation();
        if (!busy) onClose();
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
        {data.changes.length === 0 ? (
          <p className="rounded-xl border border-card-border px-3 py-2 text-sm text-muted">No EC was added, changed or removed in this version.</p>
        ) : (
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
        )}

        {/* The department's choice on this version: shown once made. */}
        {chooser && choice && (
          <div className="mt-3 rounded-xl border border-card-border bg-background/50 px-3 py-2 text-xs">
            <span className="font-semibold text-foreground">
              {dept}: {CHOICE_LABEL[choice.choice]}
            </span>
            <span className="block text-muted">
              {[choice.chosen_by_name, when(choice.chosen_at)].filter(Boolean).join(" · ")}
              {choice.flushed_ecs.length > 0 && ` · cleared on ${choice.flushed_ecs.map((e) => e || "EC").join(", ")}`}
            </span>
          </div>
        )}

        {/* Acknowledged: Copy or Flush. */}
        {chooser && !choice && acking && (
          <div className="mt-3 space-y-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => void choose("copy")}
              className="w-full rounded-xl border border-card-border px-3 py-2.5 text-left hover:border-primary/50 hover:bg-primary/5 disabled:opacity-60"
            >
              <span className="block text-sm font-semibold text-foreground">Copy</span>
              <span className="block text-xs text-muted">Keep your work as it was in v{version - 1} and carry on from there.</span>
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void choose("flush")}
              className="w-full rounded-xl border border-card-border px-3 py-2.5 text-left hover:border-rose-300 hover:bg-rose-50/60 disabled:opacity-60 dark:hover:bg-rose-500/10"
            >
              <span className="block text-sm font-semibold text-foreground">Flush</span>
              <span className="block text-xs text-muted">
                Start again from zero on{" "}
                {targets.length ? targets.map((t) => t.ecNo ?? "EC").join(", ") : "the ECs changed (none in this version)"}: your work there is cleared.
                v{version - 1} keeps it, read-only.
              </span>
            </button>
          </div>
        )}

        {error && <p className="mt-3 text-sm text-danger">{error}</p>}
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
          {chooser ? (
            <button type="button" onClick={() => setEarlier(true)} className={ghost}>
              <History className="h-4 w-4" />
              Earlier versions
            </button>
          ) : (
            <span />
          )}
          <div className="flex flex-wrap justify-end gap-2">
            {busy && <Loader2 className="h-4 w-4 animate-spin self-center text-muted" />}
            {chooser && !choice && !acking && (
              <>
                <button type="button" disabled={busy} onClick={() => void choose("not_needed")} className={ghost}>
                  Not needed
                </button>
                <button type="button" disabled={busy} onClick={() => setAcking(true)} className={primary}>
                  Acknowledge
                </button>
              </>
            )}
            {chooser && !choice && acking && (
              <button type="button" disabled={busy} onClick={() => setAcking(false)} className={ghost}>
                Back
              </button>
            )}
            {/* Chosen already, or Admin: a later change is simply acknowledged. */}
            {viewerDept && (choice || !chooser) && unseen && (
              <button type="button" onClick={ack} disabled={busy} className={primary}>
                Acknowledge
              </button>
            )}
            <button type="button" onClick={onClose} className={ghost}>
              Close
            </button>
          </div>
        </div>
      </div>
      {earlier && <DeptVersionsDialog orderId={orderId} onClose={() => setEarlier(false)} />}
    </div>,
    document.body
  );
}

/** A department's own work in the SO's earlier versions, read-only, one version at a time. */
function DeptVersionsDialog({ orderId, onClose }: { orderId: string; onClose: () => void }) {
  const [data, setData] = useState<DeptVersionsData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const load = useCallback(
    async (v: number | null) => {
      setLoading(true);
      setError(null);
      const res = await loadDeptVersionsAction(orderId, v);
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
  const frozen = data?.versions.find((v) => v.version_no === data.picked);
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Earlier versions"
      className="fixed inset-0 z-[70] flex items-stretch justify-center bg-black/40 sm:p-6"
      onClick={(e) => {
        e.stopPropagation();
        onClose();
      }}
    >
      <div onClick={(e) => e.stopPropagation()} className="flex w-full max-w-5xl flex-col overflow-hidden bg-background shadow-xl sm:rounded-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-card-border bg-surface px-5 py-4">
          <div className="min-w-0">
            <h2 className="font-display text-lg font-semibold text-foreground">
              {data?.soLabel ?? "SO"} · {data ? CHOICE_DEPTS[data.dept] : ""} in earlier versions
            </h2>
            <p className="text-xs text-muted">Your department&apos;s work as it stood in each version, read-only.</p>
          </div>
          <div className="flex items-center gap-2">
            {loading && <Loader2 className="h-4 w-4 animate-spin text-muted" />}
            <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg p-1.5 text-muted hover:bg-background hover:text-foreground">
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>
        <div className={`flex-1 overflow-y-auto px-5 py-4 ${loading && data ? "opacity-60" : ""}`}>
          {error && <p className="text-sm text-danger">{error}</p>}
          {data && (
            <>
              <nav aria-label="Versions" className="mb-3 flex flex-wrap gap-1.5">
                {data.versions.map((v) => (
                  <button
                    key={v.version_no}
                    type="button"
                    onClick={() => void load(v.version_no)}
                    aria-pressed={v.version_no === data.picked}
                    className={`inline-flex h-8 items-center gap-1 rounded-lg border px-3 text-xs font-semibold ${
                      v.version_no === data.picked ? "border-primary bg-primary text-primary-foreground" : "border-input-border text-foreground hover:bg-background"
                    }`}
                  >
                    <Lock className="h-3 w-3" />v{v.version_no}
                  </button>
                ))}
              </nav>
              {frozen && (
                <p className="mb-3 text-xs text-muted">
                  v{frozen.version_no}, saved {when(frozen.created_at)}
                  {frozen.created_by_name ? ` by ${frozen.created_by_name}` : ""} when v{frozen.version_no + 1} was made — {frozen.reason}
                </p>
              )}
              <OrderVersionView snap={data.snap} only={data.dept} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
