"use client";

import { useEffect, useMemo, useState } from "react";
import { Columns3, Download, EyeOff, Loader2, Sheet, X } from "lucide-react";
import type { OneGroup } from "@/lib/one-click-export";

type Preview = { scope: string; groups: OneGroup[]; total: number; rowLabel?: string; rows: (string | number | null)[][] };

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

// A scrollbar that shows: wide enough to see and grab, in the primary colour.
const SCROLLBAR =
  "[scrollbar-color:color-mix(in_srgb,var(--primary)_55%,transparent)_transparent] [&::-webkit-scrollbar]:h-2.5 [&::-webkit-scrollbar]:w-2.5 [&::-webkit-scrollbar-track]:bg-background [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-primary/50 hover:[&::-webkit-scrollbar-thumb]:bg-primary/70";

/** A column by its group and label, so what is hidden holds when the filter changes. */
const keyOf = (group: string, label: string) => `${group}::${label}`;

// The columns hidden, remembered in this browser for each kind of sheet.
const storeKey = (rowLabel: string) => `one-click-hidden:${rowLabel}`;
function readHidden(rowLabel: string): Set<string> {
  try {
    const v = JSON.parse(localStorage.getItem(storeKey(rowLabel)) ?? "[]");
    return new Set(Array.isArray(v) ? v.map(String) : []);
  } catch {
    return new Set();
  }
}
function writeHidden(rowLabel: string, hidden: Set<string>) {
  try {
    localStorage.setItem(storeKey(rowLabel), JSON.stringify([...hidden]));
  } catch {
    // Not remembered; the pop-up still works.
  }
}

/**
 * One Click: the whole Export on one sheet, in a pop-up — the first rows to
 * look over, the groups over their columns as in the file, columns hidden as
 * wanted (and left out of the file), then Download.
 */
function OneClickModal({ query, onClose }: { query: string; onClose: () => void }) {
  const qs = query ? `?${query}` : "";
  const [data, setData] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [picking, setPicking] = useState(false);
  // Whether the Columns panel has more below (null until it is measured).
  const [moreBelow, setMoreBelow] = useState<boolean | null>(null);

  useEffect(() => {
    let live = true;
    fetch(`/api/orders/export/one${qs}${qs ? "&" : "?"}view=1`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`Could not load the sheet (${r.status}).`))))
      .then((d: Preview) => {
        if (!live) return;
        setHidden(readHidden(d.rowLabel ?? "one per EC"));
        setData(d);
      })
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

  // Every column with its place across the sheet; the keys (first group) always show.
  const all = useMemo(() => {
    if (!data) return [];
    let at = 0;
    return data.groups.flatMap((g, gi) =>
      g.columns.map((c) => ({ ...c, group: g.name, gi, index: at++, key: keyOf(g.name, c.label), fixed: gi === 0 }))
    );
  }, [data]);
  const shown = all.filter((c) => c.fixed || !hidden.has(c.key));
  const hiddenCount = all.length - shown.length;
  const groups = (data?.groups ?? [])
    .map((g, gi) => ({ ...g, gi, cols: shown.filter((c) => c.gi === gi) }))
    .filter((g) => g.cols.length > 0);

  function change(next: Set<string>) {
    setHidden(next);
    if (data) writeHidden(data.rowLabel ?? "one per EC", next);
  }
  const toggle = (key: string) => {
    const next = new Set(hidden);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    change(next);
  };
  const toggleGroup = (gi: number, hide: boolean) => {
    const next = new Set(hidden);
    for (const c of all.filter((x) => x.gi === gi)) {
      if (hide) next.add(c.key);
      else next.delete(c.key);
    }
    change(next);
  };

  // The file leaves out what is hidden here.
  const hideParam = all.filter((c) => !c.fixed && hidden.has(c.key)).map((c) => c.index);
  const download = `/api/orders/export/one${qs}${hideParam.length ? `${qs ? "&" : "?"}hide=${hideParam.join(",")}` : ""}`;
  const keyCount = data?.groups[0]?.columns.length ?? 0;

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
                  ? `${data.scope} · ${data.total} rows, ${data.rowLabel ?? "one per EC"} · ${shown.length} columns${hiddenCount ? ` (${hiddenCount} hidden)` : ""}${data.total > data.rows.length ? ` · showing the first ${data.rows.length}` : ""}`
                  : "Everything the Export has, on a single sheet"}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setPicking((v) => !v);
                setMoreBelow(null);
              }}
              disabled={!data}
              aria-expanded={picking}
              className={`inline-flex h-10 items-center gap-2 rounded-lg border px-3 text-sm font-medium transition-colors disabled:opacity-50 ${
                picking || hiddenCount ? "border-primary/40 bg-primary/10 text-primary" : "border-input-border text-foreground hover:bg-background"
              }`}
            >
              <Columns3 className="h-4 w-4" />
              Columns{hiddenCount ? ` · ${hiddenCount} hidden` : ""}
            </button>
            <a
              href={download}
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

        {/* The columns to show: a group at a time, or one by one. */}
        {data && picking && (
          <div className="relative border-b border-card-border bg-background/40">
          <div
            onScroll={(e) => {
              const el = e.currentTarget;
              setMoreBelow(el.scrollTop + el.clientHeight < el.scrollHeight - 4);
            }}
            ref={(el) => {
              if (el && moreBelow === null) setMoreBelow(el.scrollHeight > el.clientHeight + 4);
            }}
            className={`max-h-[45vh] overflow-y-scroll px-5 pb-3 ${SCROLLBAR}`}
          >
            <div className="sticky top-0 z-[1] -mx-5 mb-2 flex items-center justify-between gap-3 border-b border-card-border bg-surface px-5 py-2">
              <p className="text-xs text-muted">Hidden columns are left out of the preview and the Excel. SO keys always show.</p>
              <button
                type="button"
                onClick={() => change(new Set())}
                disabled={!hiddenCount}
                className="text-xs font-semibold text-primary hover:underline disabled:text-muted disabled:no-underline"
              >
                Show all
              </button>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {data.groups.map((g, gi) => {
                if (gi === 0) return null;
                const cols = all.filter((c) => c.gi === gi);
                const on = cols.filter((c) => !hidden.has(c.key)).length;
                return (
                  <div key={g.name} className="rounded-lg border border-card-border bg-surface p-2.5">
                    <label className="mb-1.5 flex items-center gap-2 text-xs font-semibold text-foreground">
                      <input
                        type="checkbox"
                        checked={on === cols.length}
                        ref={(el) => {
                          if (el) el.indeterminate = on > 0 && on < cols.length;
                        }}
                        onChange={() => toggleGroup(gi, on === cols.length)}
                        className="h-3.5 w-3.5 accent-[var(--primary)]"
                      />
                      <span className="h-2.5 w-2.5 rounded-sm" style={{ background: GROUP_BG[gi % GROUP_BG.length] }} />
                      {g.name}
                      <span className="font-normal text-muted">
                        {on}/{cols.length}
                      </span>
                    </label>
                    <div className="flex flex-wrap gap-1">
                      {cols.map((c) => {
                        const visible = !hidden.has(c.key);
                        return (
                          <button
                            key={c.key}
                            type="button"
                            onClick={() => toggle(c.key)}
                            aria-pressed={visible}
                            className={`rounded-md border px-2 py-0.5 text-[11px] transition-colors ${
                              visible
                                ? "border-primary/30 bg-primary/10 text-foreground"
                                : "border-dashed border-input-border text-muted line-through"
                            }`}
                          >
                            {c.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
          {/* More groups below: say so, until the end is reached. */}
          {moreBelow && (
            <div className="pointer-events-none absolute inset-x-0 bottom-0 flex h-10 items-end justify-center bg-gradient-to-t from-surface to-transparent pb-1">
              <span className="rounded-full bg-primary px-2.5 py-0.5 text-[11px] font-semibold text-primary-foreground shadow">Scroll for more ↓</span>
            </div>
          )}
          </div>
        )}

        <div className={`min-h-0 flex-1 overflow-auto ${SCROLLBAR}`}>
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
                  {groups.map((g) => (
                    <th
                      key={g.name}
                      colSpan={g.cols.length}
                      style={{ background: GROUP_BG[g.gi % GROUP_BG.length] }}
                      className="border-b border-r border-white/20 px-3 py-1.5 text-left text-[11px] font-semibold text-white"
                    >
                      {g.name}
                    </th>
                  ))}
                </tr>
                <tr>
                  {shown.map((c) => (
                    <th
                      key={c.key}
                      style={{ background: GROUP_BG[c.gi % GROUP_BG.length] }}
                      className={`${c.index === 1 ? "sticky left-0 z-20" : ""} ${c.type === "list" ? "min-w-[16rem]" : "min-w-[7rem]"} group/col max-w-[14rem] border-b border-r border-white/20 px-3 py-2 text-left align-bottom font-semibold leading-tight text-white/95`}
                    >
                      <span className="flex items-end justify-between gap-1.5">
                        <span>{c.label}</span>
                        {!c.fixed && (
                          <button
                            type="button"
                            onClick={() => toggle(c.key)}
                            title={`Hide ${c.label}`}
                            aria-label={`Hide ${c.label}`}
                            className="shrink-0 rounded p-0.5 text-white/60 opacity-0 transition-opacity hover:bg-white/15 hover:text-white focus:opacity-100 group-hover/col:opacity-100"
                          >
                            <EyeOff className="h-3 w-3" />
                          </button>
                        )}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r, ri) => (
                  <tr key={ri} className="odd:bg-background/40 hover:bg-primary/[0.04]">
                    {shown.map((c) => {
                      const v = r[c.index] ?? null;
                      return (
                        <td
                          key={c.key}
                          className={`${c.index === 1 ? "sticky left-0 z-[1] bg-[#EAF0F8] font-semibold dark:bg-[#1c2740]" : c.index < keyCount ? "bg-[#EAF0F8] dark:bg-[#1c2740]" : ""} ${
                            c.type === "list" ? "whitespace-pre-line" : "max-w-[14rem] truncate"
                          } border-b border-r border-card-border px-3 py-1.5 align-top text-foreground`}
                          title={typeof v === "string" && v.length > 30 ? v : undefined}
                        >
                          {show(v, c.type)}
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
