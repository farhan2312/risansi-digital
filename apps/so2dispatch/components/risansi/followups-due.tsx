"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { BellRing, Loader2, Search, X } from "lucide-react";
import { listFollowupsDueAction, type FollowupDue } from "@/app/risansi/orders/followup-actions";
import { FollowupDialog } from "./order-followups";
import { RetrofitLine } from "./retrofit-line";

function day(v: string | null): string {
  if (!v) return "—";
  const d = new Date(`${v.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? v : d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
}

/**
 * The Orders page's alarm: how many SOs are due a follow-up (their latest
 * follow-up's next date is today or past). It rings while any are due, and
 * opens the list, each SO's follow-up a click away.
 */
export function FollowupsDueButton({ count, canAdd }: { count: number; canAdd: boolean }) {
  const [open, setOpen] = useState(false);
  const due = count > 0;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={due ? `${count} ${count === 1 ? "SO is" : "SOs are"} due a follow-up` : "No follow-up due"}
        className={`relative inline-flex h-10 items-center gap-2 rounded-lg border px-4 text-sm font-semibold transition-colors ${
          due
            ? "border-rose-500/40 bg-rose-500/10 text-rose-700 hover:bg-rose-500/20 dark:text-rose-300"
            : "border-input-border bg-surface text-foreground hover:bg-background"
        }`}
      >
        <BellRing className={`h-4 w-4 ${due ? "alarm-ring" : ""}`} />
        Follow-ups due
        {due && (
          <span className="alarm-ring inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-rose-600 px-1.5 text-[11px] font-bold text-white">
            {count}
          </span>
        )}
      </button>
      {open && <FollowupsDueModal canAdd={canAdd} onClose={() => setOpen(false)} />}
    </>
  );
}

function FollowupsDueModal({ canAdd, onClose }: { canAdd: boolean; onClose: () => void }) {
  const [rows, setRows] = useState<FollowupDue[] | null>(null);
  const [search, setSearch] = useState("");
  const [picked, setPicked] = useState<FollowupDue | null>(null);

  const load = useCallback(() => {
    listFollowupsDueAction()
      .then(setRows)
      .catch(() => setRows([]));
  }, []);
  useEffect(load, [load]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !picked) onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, picked]);

  const term = search.trim().toLowerCase();
  const shown = (rows ?? []).filter(
    (r) => !term || [r.so_no, r.client_name, r.reps, r.remarks].some((v) => String(v ?? "").toLowerCase().includes(term))
  );

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Follow-ups due"
      className="fixed inset-0 z-50 flex items-end justify-center whitespace-normal bg-black/40 sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-t-2xl bg-surface shadow-xl sm:rounded-2xl"
      >
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-card-border px-5 py-4">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-rose-500/15 text-rose-600">
              <BellRing className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <h2 className="font-display text-lg font-semibold text-foreground">Follow-ups due</h2>
              <p className="text-xs text-muted">
                {rows ? `${rows.length} ${rows.length === 1 ? "SO" : "SOs"} · next follow-up date today or past` : "SOs whose next follow-up has come"}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-lg p-1.5 text-muted transition-colors hover:bg-background hover:text-foreground"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="border-b border-card-border px-5 py-3">
          <div className="relative max-w-md">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search SO no., client, rep or remarks…"
              aria-label="Search follow-ups due"
              autoFocus
              className="h-9 w-full rounded-lg border border-input-border bg-background pl-9 pr-3 text-sm text-foreground placeholder:text-muted-foreground"
            />
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-auto">
          {rows === null ? (
            <p className="flex items-center justify-center gap-2 py-12 text-sm text-muted">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </p>
          ) : shown.length === 0 ? (
            <p className="py-12 text-center text-sm text-muted">{term ? "No SO matching that is due." : "No follow-up is due."}</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10 bg-background text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-2.5">SO</th>
                  <th className="px-4 py-2.5">Client</th>
                  <th className="px-4 py-2.5">Rep</th>
                  <th className="px-4 py-2.5">Last follow-up</th>
                  <th className="px-4 py-2.5">Due</th>
                  <th className="px-4 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={r.id} className="border-t border-card-border align-top">
                    <td className="whitespace-nowrap px-4 py-2.5">
                      <Link href={`/risansi/orders/${r.id}`} className="font-semibold text-primary hover:underline">
                        {r.so_no || "—"}
                      </Link>
                      <span className="block text-[11px] text-muted">
                        {day(r.so_date)}
                        {r.order_type ? ` · ${r.order_type}` : ""}
                      </span>
                      <RetrofitLine row={r} />
                    </td>
                    <td className="max-w-[14rem] px-4 py-2.5 text-foreground">{r.client_name || "—"}</td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-foreground">{r.reps || "—"}</td>
                    <td className="max-w-[22rem] px-4 py-2.5">
                      <span className="text-xs font-semibold text-foreground">{day(r.followup_date)}</span>
                      <span className="text-xs text-muted"> · {r.count} in all</span>
                      <p className="mt-0.5 line-clamp-2 break-words text-xs text-foreground" title={r.remarks}>
                        {r.remarks}
                      </p>
                      {r.by && <p className="text-[11px] text-muted">{r.by}</p>}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5">
                      <span className="text-xs font-semibold text-foreground">{day(r.next_followup_date)}</span>
                      <span
                        className={`mt-0.5 block w-fit rounded-full px-2 py-0.5 text-[11px] font-bold ${
                          r.days_late > 0
                            ? "bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-300"
                            : "bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300"
                        }`}
                      >
                        {r.days_late > 0 ? `${r.days_late} ${r.days_late === 1 ? "day" : "days"} late` : "Today"}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-right">
                      <button
                        type="button"
                        onClick={() => setPicked(r)}
                        className="inline-flex h-8 items-center rounded-lg border border-input-border px-3 text-xs font-semibold text-foreground transition-colors hover:bg-background"
                      >
                        {canAdd ? "Follow up" : "History"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
      {picked && (
        <div onClick={(e) => e.stopPropagation()}>
          <FollowupDialog
            orderId={picked.id}
            soLabel={picked.so_no || "—"}
            canAdd={canAdd}
            onClose={() => setPicked(null)}
            onSaved={() => {
              setPicked(null);
              load();
            }}
          />
        </div>
      )}
    </div>
  );
}
