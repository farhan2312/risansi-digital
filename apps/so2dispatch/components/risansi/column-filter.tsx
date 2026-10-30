"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ListFilter, Loader2, X } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useUrlTable } from "./url-table";
import { orderColumnFacetsAction } from "@/app/risansi/orders/column-filter-actions";
import { parseDeptStatusMulti, serializeDeptStatusMulti } from "@/lib/order-list-filter";
import { DEPT_FILTER_LABELS, type DeptFilterKey } from "@/lib/dept-status";
import type { OrderColumnKey } from "@/lib/orders";

/** Where a column's pick lives in the URL — the same filter the filter bar sets. */
function picked(column: OrderColumnKey, sp: URLSearchParams): string[] {
  const list = (k: string) => (sp.get(k) ?? "").split(",").map((v) => v.trim()).filter(Boolean);
  if (column === "bill_mode") return list("bmode");
  if (column === "order_status") return list("ost");
  return parseDeptStatusMulti(sp.get("dsm") ?? undefined)[column.slice(5) as DeptFilterKey] ?? [];
}

/**
 * A column header that filters, Excel-like: its label and a button opening the
 * values the column holds in the list as filtered, each with its count, to
 * tick. The pick is the filter bar's own (Bill mode, Order status, Departments),
 * so the two always agree.
 */
export function ColumnFilter({ column, label, align = "left" }: { column: OrderColumnKey; label: React.ReactNode; align?: "left" | "center" }) {
  const sp = useSearchParams();
  const { setParams } = useUrlTable();
  const qs = sp?.toString() ?? "";
  const current = picked(column, new URLSearchParams(qs));
  const [open, setOpen] = useState(false);
  // The counts read, for the column and filter they were read for.
  const [loaded, setLoaded] = useState<{ key: string; data: { value: string; count: number }[] } | null>(null);
  const key = `${column}?${qs}`;
  const facets = loaded?.key === key ? loaded.data : null;
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  // The values and counts, read when it opens and whenever the list's filter moves.
  useEffect(() => {
    if (!open) return;
    let live = true;
    orderColumnFacetsAction(column, qs).then((data) => live && setLoaded({ key: `${column}?${qs}`, data }));
    return () => {
      live = false;
    };
  }, [open, column, qs]);

  // Placed under the button, in the page (the table scrolls sideways and would clip it).
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const r = btnRef.current?.getBoundingClientRect();
      if (r) setPos({ top: r.bottom + 6, left: Math.min(r.left, window.innerWidth - 272) });
    };
    place();
    const close = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node) && !btnRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", key);
    };
  }, [open]);

  function apply(next: string[]) {
    if (column === "bill_mode") return setParams({ bmode: next });
    if (column === "order_status") return setParams({ ost: next });
    const dept = column.slice(5) as DeptFilterKey;
    const m = parseDeptStatusMulti(new URLSearchParams(qs).get("dsm") ?? undefined);
    setParams({ dsm: serializeDeptStatusMulti({ ...m, [dept]: next }) });
  }
  const toggle = (v: string) => apply(current.includes(v) ? current.filter((x) => x !== v) : [...current, v]);

  // What the column holds: values with SOs, and any already ticked.
  const shown = (facets ?? []).filter((f) => f.count > 0 || current.includes(f.value));
  const title = column.startsWith("dept:") ? DEPT_FILTER_LABELS[column.slice(5) as DeptFilterKey] : typeof label === "string" ? label : "";

  return (
    <span className={`inline-flex items-center gap-1 ${align === "center" ? "justify-center" : ""}`}>
      {label}
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={`Filter ${title}`}
        aria-expanded={open}
        className={`relative inline-flex h-5 w-5 items-center justify-center rounded transition-colors ${
          current.length ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-background hover:text-foreground"
        }`}
      >
        <ListFilter className="h-3 w-3" />
        {current.length > 0 && (
          <span className="absolute -right-1.5 -top-1.5 inline-flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-rose-600 px-0.5 text-[9px] font-bold text-white">
            {current.length}
          </span>
        )}
      </button>
      {open &&
        pos &&
        createPortal(
          <div
            ref={boxRef}
            style={{ top: pos.top, left: pos.left }}
            className="fixed z-[70] w-64 rounded-xl border border-card-border bg-surface p-1.5 text-left normal-case tracking-normal shadow-xl"
          >
            <div className="flex items-center justify-between px-2 pb-1.5 pt-1">
              <span className="text-xs font-semibold text-foreground">{title}</span>
              {current.length > 0 && (
                <button type="button" onClick={() => apply([])} className="inline-flex items-center gap-1 text-[11px] font-medium text-muted hover:text-foreground">
                  <X className="h-3 w-3" />
                  Clear
                </button>
              )}
            </div>
            {!facets ? (
              <p className="flex items-center gap-2 px-2 py-3 text-xs text-muted">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Reading the column…
              </p>
            ) : shown.length === 0 ? (
              <p className="px-2 py-3 text-xs text-muted">Nothing in this column for the list as filtered.</p>
            ) : (
              <div className="max-h-72 overflow-y-auto">
                {shown.map((f) => {
                  const on = current.includes(f.value);
                  return (
                    <button
                      key={f.value}
                      type="button"
                      onClick={() => toggle(f.value)}
                      className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm text-foreground transition-colors hover:bg-background"
                    >
                      <span
                        className={`inline-flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                          on ? "border-primary bg-primary text-primary-foreground" : "border-input-border"
                        }`}
                      >
                        {on && <Check className="h-3 w-3" />}
                      </span>
                      <span className="flex-1 truncate">{f.value}</span>
                      <span className="text-xs tabular-nums text-muted">{f.count}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>,
          document.body
        )}
    </span>
  );
}
