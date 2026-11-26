"use client";

// Choose which of a wide table's columns to see. Each header cell that can
// be hidden carries data-col="<key>"; the hidden ones are taken out whole —
// their header and every body cell under them — by working out, from the
// header's rows and spans, which column positions each key covers. Kept per
// table on this device.

import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type RefObject } from "react";
import { Columns3, RotateCcw } from "lucide-react";

const listeners = new Set<() => void>();
const subscribe = (cb: () => void) => {
  listeners.add(cb);
  window.addEventListener("storage", cb);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", cb);
  };
};

/** The keys hidden in the table stored under `storageKey`. */
export function useHiddenColumns(storageKey: string): [Set<string>, (next: Set<string>) => void] {
  const raw = useSyncExternalStore(subscribe, () => localStorage.getItem(storageKey) ?? "", () => "");
  const hidden = new Set(raw ? raw.split(",") : []);
  const set = (next: Set<string>) => {
    localStorage.setItem(storageKey, [...next].join(","));
    listeners.forEach((cb) => cb());
  };
  return [hidden, set];
}

/**
 * Hide the columns whose keys are in `hidden`: the header cells tagged with
 * them, and every body cell lying wholly under them. Runs after each render.
 */
export function useApplyHiddenColumns(table: RefObject<HTMLTableElement | null>, hidden: Set<string>) {
  const sig = [...hidden].sort().join(",");
  useLayoutEffect(() => {
    const t = table.current;
    if (!t) return;
    // The header as a grid: which column positions each cell covers.
    const covered = new Set<number>();
    const occupied: boolean[][] = [];
    const heads: { el: HTMLElement; from: number; to: number }[] = [];
    Array.from(t.tHead?.rows ?? []).forEach((row, r) => {
      occupied[r] = occupied[r] ?? [];
      let c = 0;
      for (const cell of Array.from(row.cells)) {
        while (occupied[r][c]) c++;
        const span = cell.colSpan || 1;
        const down = cell.rowSpan || 1;
        for (let dr = 0; dr < down; dr++) {
          occupied[r + dr] = occupied[r + dr] ?? [];
          for (let dc = 0; dc < span; dc++) occupied[r + dr][c + dc] = true;
        }
        heads.push({ el: cell, from: c, to: c + span - 1 });
        const key = cell.dataset.col;
        if (key && hidden.has(key)) for (let i = c; i < c + span; i++) covered.add(i);
        c += span;
      }
    });
    const within = (from: number, to: number) => {
      for (let i = from; i <= to; i++) if (!covered.has(i)) return false;
      return true;
    };
    for (const h of heads) h.el.style.display = within(h.from, h.to) ? "none" : "";
    for (const body of Array.from(t.tBodies)) {
      for (const row of Array.from(body.rows)) {
        let c = 0;
        for (const cell of Array.from(row.cells)) {
          const span = cell.colSpan || 1;
          cell.style.display = within(c, c + span - 1) ? "none" : "";
          c += span;
        }
      }
    }
  });
  return sig;
}

/** The Columns button: every column the table offers, ticked when shown. */
export function ColumnPicker({ columns, hidden, onChange }: { columns: { key: string; label: string }[]; hidden: Set<string>; onChange: (next: Set<string>) => void }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  const shown = columns.filter((c) => !hidden.has(c.key)).length;
  const toggle = (key: string) => {
    const next = new Set(hidden);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    onChange(next);
  };
  return (
    <div ref={box} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className={`inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-sm font-medium transition-colors ${
          hidden.size ? "border-primary/40 bg-primary/[0.06] text-primary" : "border-input-border bg-surface text-foreground hover:bg-background"
        }`}
      >
        <Columns3 className="h-4 w-4" />
        Columns
        <span className="text-xs tabular-nums text-muted">
          {shown}/{columns.length}
        </span>
      </button>
      {open && (
        <div className="absolute right-0 top-full z-40 mt-1.5 w-72 overflow-hidden rounded-xl border border-card-border bg-surface shadow-xl">
          <div className="flex items-center justify-between border-b border-card-border px-3 py-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted">Show columns</span>
            <span className="flex gap-2">
              <button type="button" onClick={() => onChange(new Set())} className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
                <RotateCcw className="h-3 w-3" /> All
              </button>
            </span>
          </div>
          <ul className="max-h-80 overflow-y-auto py-1">
            {columns.map((c) => (
              <li key={c.key}>
                <label className="flex cursor-pointer items-center gap-2.5 px-3 py-1.5 text-sm text-foreground hover:bg-background">
                  <input type="checkbox" checked={!hidden.has(c.key)} onChange={() => toggle(c.key)} className="h-4 w-4 accent-[#2F5496]" />
                  {c.label}
                </label>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
