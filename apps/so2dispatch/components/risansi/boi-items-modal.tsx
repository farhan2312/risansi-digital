"use client";

import { useEffect, useState } from "react";
import { Loader2, Package, X } from "lucide-react";
import { boiItemsAction } from "@/app/risansi/orders/actions";

type Row = Record<string, unknown>;

function text(value: unknown): string {
  const s = value === null || value === undefined ? "" : String(value);
  return s.trim() === "" ? "—" : s;
}

function dayOnly(value: unknown): string {
  const s = value === null || value === undefined ? "" : String(value);
  if (s.trim() === "") return "—";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

/**
 * The bought-out items on one EC, read-only. Planning opens this from their
 * edit form: BOI receipt dates decide what they can schedule, but the rows
 * themselves belong to Central Visibility and Purchase.
 */
export function BoiItemsModal({
  itemId,
  label,
  onClose,
}: {
  itemId: string;
  label?: string;
  onClose: () => void;
}) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await boiItemsAction(itemId);
      if (cancelled) return;
      if (!res.ok) setError(res.error);
      else setRows(res.rows);
    })();
    return () => {
      cancelled = true;
    };
  }, [itemId]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center sm:items-center sm:p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} aria-hidden />
      <div className="relative flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-t-2xl border border-card-border bg-card shadow-xl sm:rounded-2xl">
        <div className="flex items-center justify-between gap-3 border-b border-card-border px-5 py-3">
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              <Package className="h-3.5 w-3.5" />
              Bought-out items
            </p>
            {label && (
              <p className="truncate font-display text-sm font-semibold text-foreground">
                {label}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-lg p-1.5 text-muted transition-colors hover:bg-background hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-auto">
          {error ? (
            <p role="alert" className="px-5 py-10 text-sm text-danger">
              {error}
            </p>
          ) : rows === null ? (
            <div className="flex items-center gap-2 px-5 py-10 text-sm text-muted">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading…
            </div>
          ) : rows.length === 0 ? (
            <p className="px-5 py-10 text-sm text-muted">
              No bought-out items recorded for this EC.
            </p>
          ) : (
            <table className="w-full min-w-[640px] text-sm">
              <thead className="sticky top-0 z-10 bg-background">
                <tr className="text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  <th className="border-b border-card-border px-4 py-3">Item</th>
                  <th className="border-b border-card-border px-4 py-3">Make</th>
                  <th className="border-b border-card-border px-4 py-3">
                    Description
                  </th>
                  <th className="border-b border-card-border px-4 py-3">
                    Expected Receipt
                  </th>
                  <th className="border-b border-card-border px-4 py-3">
                    Actual Receipt
                  </th>
                  <th className="border-b border-card-border px-4 py-3">
                    Remarks
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-card-border">
                {rows.map((r, i) => (
                  <tr key={String(r.id ?? i)} className="align-top text-foreground">
                    <td className="px-4 py-3 whitespace-nowrap font-medium">
                      {/* "Others" stores the free-text name in its own column. */}
                      {String(r.boi_item ?? "") === "Others"
                        ? text(r.boi_item_other)
                        : text(r.boi_item)}
                    </td>
                    <td className="px-4 py-3">{text(r.boi_make)}</td>
                    <td className="px-4 py-3">{text(r.boi_description)}</td>
                    {/* Planning schedules to the expected date until the
                        actual one is in. */}
                    <td className="px-4 py-3 whitespace-nowrap">
                      {dayOnly(r.expected_receipt_date)}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {dayOnly(r.receipt_date)}
                    </td>
                    <td className="px-4 py-3 text-muted">{text(r.remarks)}</td>
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
