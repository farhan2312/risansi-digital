"use client";

import { useEffect } from "react";
import { CheckCircle2, Package, X } from "lucide-react";
import { boiStatus } from "@/lib/dept-view";

type Row = Record<string, unknown>;
const str = (v: unknown) => (v == null ? "" : String(v).trim());

function day(v: unknown): string {
  const s = str(v);
  if (!s) return "—";
  const d = new Date(s.slice(0, 10));
  return Number.isNaN(d.getTime()) ? s : d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
}

const money = (v: unknown) =>
  str(v) === "" ? "—" : Number(v).toLocaleString("en-IN", { maximumFractionDigits: 2 });

/** A bought-out item's name: the list's, or what Others was called. */
export function boiName(b: Row): string {
  const item = str(b.boi_item);
  return item === "Others" ? str(b.boi_item_other) || "Others" : item || "Item";
}

const TONE = {
  done: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  part: "bg-sky-50 text-sky-700 ring-sky-200",
  pending: "bg-amber-50 text-amber-700 ring-amber-200",
} as const;

/** A bought-out item's status as a tag. */
export function BoiStatusTag({ item, small = false }: { item: Row; small?: boolean }) {
  const s = boiStatus(item);
  return (
    <span
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full font-semibold ring-1 ring-inset ${TONE[s.tone]} ${
        small ? "px-1.5 text-[10px]" : "px-2.5 py-0.5 text-xs"
      }`}
    >
      {s.tone === "done" && !small && <CheckCircle2 className="h-3 w-3" />}
      {s.label}
    </span>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[11px] font-medium text-muted-foreground">{label}</p>
      <p className="text-sm text-foreground">{value || "—"}</p>
    </div>
  );
}

/**
 * One bought-out item, read-only: the item, what RIL stock covers, the vendor
 * order and what has come in. Planning opens it from an EC's BOI items.
 */
export function BoiDetailModal({ item, ecLabel, onClose }: { item: Row; ecLabel?: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const vendor = item.vendor_order === "Yes";
  const qty = Number(item.boi_qty ?? 0) || 0;
  const inHand = (Number(item.stock_allocated_qty ?? 0) || 0) + (vendor ? Number(item.received_qty ?? 0) || 0 : 0);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Bought-out item ${boiName(item)}`}
      className="fixed inset-0 z-50 flex items-end justify-center whitespace-normal bg-black/40 sm:items-center sm:p-6"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-t-2xl bg-surface p-5 text-left shadow-xl sm:rounded-2xl"
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary text-primary-foreground">
              <Package className="h-5 w-5" />
            </span>
            <div>
              <h2 className="font-display text-lg font-semibold text-foreground">{boiName(item)}</h2>
              <p className="text-xs text-muted">{[ecLabel, qty ? `${inHand}/${qty} in hand` : ""].filter(Boolean).join(" · ")}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <BoiStatusTag item={item} />
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

        <section className="mb-3 rounded-xl border border-card-border p-4">
          <h3 className="mb-3 text-sm font-semibold text-foreground">Item</h3>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Field label="Item" value={boiName(item)} />
            <Field label="Make" value={str(item.boi_make)} />
            <Field label="Qty" value={str(item.boi_qty)} />
            <Field label="RIL Stock Allocated" value={str(item.stock_allocated_qty)} />
          </div>
          {str(item.boi_description) && (
            <div className="mt-3">
              <Field label="Description" value={str(item.boi_description)} />
            </div>
          )}
        </section>

        <section className="rounded-xl border border-card-border p-4">
          <h3 className="mb-3 text-sm font-semibold text-foreground">Vendor order</h3>
          {vendor ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Field label="Vendor Code" value={str(item.vendor_code)} />
              <div className="col-span-1 sm:col-span-3">
                <Field label="Vendor Name" value={str(item.vendor_name)} />
              </div>
              <Field label="RIL PO No." value={str(item.ril_po_no)} />
              <Field label="RIL PO Date" value={day(item.ril_po_date)} />
              <Field label="Vendor SO No." value={str(item.vendor_so_no)} />
              <Field label="Vendor SO Date" value={day(item.vendor_so_date)} />
              <Field label="Order Qty" value={str(item.order_qty)} />
              <Field label="Expected Date" value={day(item.expected_receipt_date)} />
              <Field label="Rate" value={money(item.rate_per_unit)} />
              <Field label="Total" value={money(item.total_value)} />
              <Field label="Received Qty" value={str(item.received_qty)} />
              <Field label="Received Date" value={day(item.receipt_date)} />
            </div>
          ) : (
            <p className="text-sm text-muted">No vendor order placed{qty ? " — supplied from RIL stock" : ""}.</p>
          )}
          {str(item.remarks) && (
            <div className="mt-3">
              <Field label="Remarks" value={str(item.remarks)} />
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
