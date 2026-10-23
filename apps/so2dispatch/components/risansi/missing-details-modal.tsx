"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ClipboardX, Download, Loader2, Search, X } from "lucide-react";
import { orderGapSheetAction } from "@/app/risansi/orders/gap-actions";
import type { GapSheet } from "@/lib/order-gaps";

function dayOnly(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

/**
 * Every SO whose order details are still blank, as a sheet: a row per SO, a
 * column per field missing anywhere — the blank cells to fill highlighted,
 * those that do not apply greyed, what is there already shown. All, Pump or
 * Spare; searched; and downloaded as the same sheet in Excel to fill in.
 */
function MissingDetailsModal({ onClose }: { onClose: () => void }) {
  const [sheet, setSheet] = useState<GapSheet | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [term, setTerm] = useState("");
  const [type, setType] = useState<"" | "Pump" | "Spare">("");
  const requestRef = useRef(0);

  // Typing narrows the whole sheet, so hold off until the typing stops.
  useEffect(() => {
    const id = setTimeout(() => setTerm(search.trim()), 300);
    return () => clearTimeout(id);
  }, [search]);

  useEffect(() => {
    const request = ++requestRef.current;
    let live = true;
    orderGapSheetAction(term, type || null).then((res) => {
      if (!live || request !== requestRef.current) return;
      setLoading(false);
      if (res.ok) {
        setSheet(res.sheet);
        setError(null);
      } else setError(res.error);
    });
    return () => {
      live = false;
    };
  }, [term, type]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const pick = (t: "" | "Pump" | "Spare") => {
    if (t === type) return;
    setLoading(true);
    setType(t);
  };
  const query = new URLSearchParams({ ...(type ? { type } : {}), ...(term ? { q: term } : {}) }).toString();
  const downloadHref = `/api/orders/gaps/export${query ? `?${query}` : ""}`;
  const rows = sheet?.rows ?? [];
  const columns = sheet?.columns ?? [];
  const cellsToFill = rows.reduce((n, r) => n + r.missing, 0);
  // The groups over their fields (Client, Purchase Order…), as in the Excel.
  const groups: { name: string; span: number }[] = [];
  for (const c of columns) {
    const last = groups[groups.length - 1];
    if (last && last.name === c.group) last.span++;
    else groups.push({ name: c.group, span: 1 });
  }
  const shown = (c: GapSheet["columns"][number], v: string | null) =>
    v && c.type === "date" ? dayOnly(v) : v;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Order details not filled"
      className="fixed inset-0 z-50 flex items-end justify-center whitespace-normal bg-black/40 p-0 sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[94vh] w-full max-w-[96rem] flex-col overflow-hidden rounded-t-2xl bg-surface shadow-xl sm:rounded-2xl"
      >
        {/* Head: what this is, how many, and the download. */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-card-border px-5 py-4">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-500/15 text-amber-700">
              <ClipboardX className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <h2 className="font-display text-lg font-semibold text-foreground">Details not filled</h2>
              <p className="text-xs text-muted">
                {sheet
                  ? `${rows.length} ${rows.length === 1 ? "SO" : "SOs"} · ${cellsToFill} details to fill · ${columns.length} fields`
                  : "Every SO with order details still blank"}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <a
              href={downloadHref}
              aria-disabled={!sheet || rows.length === 0}
              className={`inline-flex h-10 items-center gap-2 rounded-lg bg-emerald-600 px-4 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-emerald-700 ${
                !sheet || rows.length === 0 ? "pointer-events-none opacity-50" : ""
              }`}
            >
              <Download className="h-4 w-4" />
              Download Excel
            </a>
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

        {/* All / Pump / Spare, the search, and how to read the colours. */}
        <div className="flex flex-wrap items-center gap-3 border-b border-card-border px-5 py-3">
          <div role="group" aria-label="Order type" className="inline-flex overflow-hidden rounded-lg border border-input-border">
            {([["", "All"], ["Pump", "Pump"], ["Spare", "Spare"]] as const).map(([value, label]) => (
              <button
                key={label}
                type="button"
                onClick={() => pick(value)}
                aria-pressed={type === value}
                className={`h-9 px-4 text-sm font-semibold transition-colors ${
                  type === value ? "bg-primary text-primary-foreground" : "bg-surface text-foreground hover:bg-background"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="relative min-w-[14rem] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="search"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setLoading(true);
              }}
              placeholder="Search SO no., client, code or serial…"
              aria-label="Search orders"
              autoFocus
              className="h-9 w-full rounded-lg border border-input-border bg-background pl-9 pr-3 text-sm text-foreground placeholder:text-muted-foreground"
            />
          </div>
          <div className="flex items-center gap-3 text-[11px] text-muted">
            <span className="inline-flex items-center gap-1.5">
              <span className="h-3 w-3 rounded-sm border border-amber-400 bg-amber-100" /> To fill
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-3 w-3 rounded-sm border border-card-border bg-slate-100 dark:bg-white/10" /> N/A
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-3 w-3 rounded-sm border border-card-border bg-surface" /> Filled
            </span>
          </div>
        </div>

        <div className="relative min-h-0 flex-1 overflow-auto">
          {loading && (
            <div className="absolute inset-x-0 top-0 z-20 flex items-center justify-center gap-2 bg-surface/80 py-3 text-sm text-muted">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading…
            </div>
          )}
          {error ? (
            <p role="alert" className="px-5 py-10 text-sm text-danger">
              {error}
            </p>
          ) : sheet && rows.length === 0 ? (
            <p className="px-5 py-12 text-center text-sm text-muted">
              {term || type ? "No SO matching that has details missing." : "Every SO has its details filled in."}
            </p>
          ) : (
            <table className="w-max min-w-full border-separate border-spacing-0 text-xs">
              <thead className="sticky top-0 z-10">
                <tr>
                  <th colSpan={4} className="sticky left-0 z-20 border-b border-r border-white/20 bg-[#2F5496] px-3 py-1.5 text-left text-[11px] font-semibold text-white">
                    SO
                  </th>
                  {groups.map((g, i) => (
                    <th key={`${g.name}-${i}`} colSpan={g.span} className="border-b border-r border-white/20 bg-[#2F5496] px-3 py-1.5 text-left text-[11px] font-semibold text-white">
                      {g.name}
                    </th>
                  ))}
                </tr>
                <tr>
                  {["SO No.", "Type", "Client", "Missing"].map((h, i) => (
                    <th
                      key={h}
                      className={`${i === 0 ? "sticky left-0 z-20" : ""} whitespace-nowrap border-b border-r border-white/20 bg-[#1F3864] px-3 py-2 text-left font-semibold text-white`}
                    >
                      {h}
                    </th>
                  ))}
                  {columns.map((c) => (
                    <th key={c.column} className="min-w-[8rem] max-w-[12rem] border-b border-r border-white/20 bg-[#1F3864] px-3 py-2 text-left align-bottom font-semibold leading-tight text-white">
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="group">
                    <td className="sticky left-0 z-[1] whitespace-nowrap border-b border-r border-card-border bg-[#EAF0F8] px-3 py-1.5 dark:bg-[#1c2740]">
                      <Link href={`/risansi/orders/${r.id}`} className="font-semibold text-primary hover:underline">
                        {r.so_no || `#${r.sl_no}`}
                      </Link>
                      <span className="block text-[10.5px] text-muted">{dayOnly(r.so_date)}</span>
                    </td>
                    <td className="whitespace-nowrap border-b border-r border-card-border bg-[#EAF0F8] px-3 py-1.5 dark:bg-[#1c2740]">{r.order_type ?? "—"}</td>
                    <td className="min-w-[12rem] max-w-[16rem] border-b border-r border-card-border bg-[#EAF0F8] px-3 py-1.5 dark:bg-[#1c2740]">
                      <span className="line-clamp-2">{r.client_name ?? "—"}</span>
                      {r.client_code && <span className="block text-[10.5px] text-muted">{r.client_code}</span>}
                    </td>
                    <td className="border-b border-r border-card-border bg-[#EAF0F8] px-3 py-1.5 text-center dark:bg-[#1c2740]">
                      <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[11px] font-bold text-rose-700 dark:bg-rose-500/20 dark:text-rose-300">{r.missing}</span>
                    </td>
                    {columns.map((c) => {
                      const cell = r.cells[c.column];
                      if (!cell || cell.s === "na") {
                        return (
                          <td key={c.column} className="border-b border-r border-card-border bg-slate-50 px-3 py-1.5 text-center text-[10.5px] italic text-slate-400 dark:bg-white/5">
                            N/A
                          </td>
                        );
                      }
                      if (cell.s === "miss") {
                        return (
                          <td key={c.column} className="border-b border-r border-amber-300 bg-amber-50 px-3 py-1.5 dark:border-amber-500/60 dark:bg-amber-500/30" title={`${c.label} — to fill`} />
                        );
                      }
                      return (
                        <td key={c.column} className="max-w-[12rem] truncate border-b border-r border-card-border px-3 py-1.5 text-foreground" title={cell.v ?? undefined}>
                          {shown(c, cell.v) ?? "—"}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

/** The toolbar button that opens the list. */
export function MissingDetailsButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex h-10 items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 text-sm font-semibold text-amber-700 transition-colors hover:bg-amber-500/20"
      >
        <ClipboardX className="h-4 w-4" />
        Details not filled
      </button>
      {open && <MissingDetailsModal onClose={() => setOpen(false)} />}
    </>
  );
}
