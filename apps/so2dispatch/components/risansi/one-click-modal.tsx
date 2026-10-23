"use client";

import { useEffect, useState } from "react";
import { Download, Loader2, Sheet, X } from "lucide-react";
import type { OneGroup } from "@/lib/one-click-export";

type Preview = { scope: string; groups: OneGroup[]; total: number; rows: (string | number | null)[][] };

const GROUP_BG = ["#1F3864", "#2F5496", "#385723", "#7F6000", "#843C0C", "#5B2C6F", "#0B5563", "#7B3F00", "#1F4E79", "#3A3A3A"];

function show(v: string | number | null, type: string): string {
  if (v == null || v === "") return "";
  if (type === "date") {
    const d = new Date(`${String(v).slice(0, 10)}T00:00:00Z`);
    if (!Number.isNaN(d.getTime())) return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
  }
  if (type === "number" && typeof v === "number") return v.toLocaleString("en-IN", { maximumFractionDigits: 2 });
  return String(v);
}

/**
 * One Click: the whole Export on one sheet, in a pop-up — the first rows to
 * look over, the groups over their columns as in the file, then Download.
 */
function OneClickModal({ query, onClose }: { query: string; onClose: () => void }) {
  const qs = query ? `?${query}` : "";
  const [data, setData] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    fetch(`/api/orders/export/one${qs}${qs ? "&" : "?"}view=1`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`Could not load the sheet (${r.status}).`))))
      .then((d: Preview) => live && setData(d))
      .catch((e: Error) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [qs]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const cols = data ? data.groups.flatMap((g) => g.columns) : [];

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="One Click — all order details on one sheet"
      className="fixed inset-0 z-50 flex items-end justify-center whitespace-normal bg-black/40 sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[94vh] w-full max-w-[96rem] flex-col overflow-hidden rounded-t-2xl bg-surface shadow-xl sm:rounded-2xl"
      >
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-card-border px-5 py-4">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-600 text-white">
              <Sheet className="h-5 w-5" />
            </span>
            <div>
              <h2 className="font-display text-lg font-semibold text-foreground">One Click — every detail, one sheet</h2>
              <p className="text-xs text-muted">
                {data
                  ? `${data.scope} · ${data.total} rows, one per EC · ${cols.length} columns${data.total > data.rows.length ? ` · showing the first ${data.rows.length}` : ""}`
                  : "Everything the Export has, on a single sheet"}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <a
              href={`/api/orders/export/one${qs}`}
              aria-disabled={!data}
              className={`inline-flex h-10 items-center gap-2 rounded-lg bg-emerald-600 px-4 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-emerald-700 ${
                data ? "" : "pointer-events-none opacity-50"
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

        <div className="min-h-0 flex-1 overflow-auto">
          {!data && !error && (
            <p className="flex items-center justify-center gap-2 py-16 text-sm text-muted">
              <Loader2 className="h-4 w-4 animate-spin" />
              Building the sheet…
            </p>
          )}
          {error && <p className="py-16 text-center text-sm text-rose-600">{error}</p>}
          {data && (
            <table className="w-max min-w-full border-separate border-spacing-0 text-xs">
              <thead className="sticky top-0 z-10">
                <tr>
                  {data.groups.map((g, gi) => (
                    <th
                      key={g.name}
                      colSpan={g.columns.length}
                      style={{ background: GROUP_BG[gi % GROUP_BG.length] }}
                      className="border-b border-r border-white/20 px-3 py-1.5 text-left text-[11px] font-semibold text-white"
                    >
                      {g.name}
                    </th>
                  ))}
                </tr>
                <tr>
                  {data.groups.flatMap((g, gi) =>
                    g.columns.map((c, ci) => (
                      <th
                        key={`${g.name}-${c.label}`}
                        style={{ background: GROUP_BG[gi % GROUP_BG.length] }}
                        className={`${gi === 0 && ci === 1 ? "sticky left-0 z-20" : ""} ${c.type === "list" ? "min-w-[16rem]" : "min-w-[7rem]"} max-w-[14rem] border-b border-r border-white/20 px-3 py-2 text-left align-bottom font-semibold leading-tight text-white/95`}
                      >
                        {c.label}
                      </th>
                    ))
                  )}
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r, ri) => (
                  <tr key={ri} className="odd:bg-background/40 hover:bg-primary/[0.04]">
                    {r.map((v, i) => (
                      <td
                        key={i}
                        className={`${i === 1 ? "sticky left-0 z-[1] bg-[#EAF0F8] font-semibold dark:bg-[#1c2740]" : i < 3 ? "bg-[#EAF0F8] dark:bg-[#1c2740]" : ""} ${
                          cols[i]?.type === "list" ? "whitespace-pre-line" : "max-w-[14rem] truncate"
                        } border-b border-r border-card-border px-3 py-1.5 align-top text-foreground`}
                        title={typeof v === "string" && v.length > 30 ? v : undefined}
                      >
                        {show(v, cols[i]?.type ?? "text")}
                      </td>
                    ))}
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

/** The Orders page's One Click button: the pop-up, for the list as filtered. */
export function OneClickButton({ query }: { query: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex h-10 items-center gap-2 rounded-lg border border-emerald-600/40 bg-emerald-600/10 px-4 text-sm font-semibold text-emerald-700 transition-colors hover:bg-emerald-600/20 dark:text-emerald-300"
      >
        <Sheet className="h-4 w-4" />
        One Click
      </button>
      {open && <OneClickModal query={query} onClose={() => setOpen(false)} />}
    </>
  );
}
