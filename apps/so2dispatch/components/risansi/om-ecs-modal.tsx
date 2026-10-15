"use client";

import { Fragment, useEffect, useState } from "react";
import { ChevronDown, ChevronRight, Loader2, Pencil, Plus, Trash2, X } from "lucide-react";
import { addOnFieldsFor } from "@/lib/order-schema";
import { formatDisplay } from "./editable-section";

type Row = Record<string, unknown>;
const str = (v: unknown) => (v === null || v === undefined ? "" : String(v));

/**
 * An SO's ECs on Order Making, in a pop-up: each EC opens to its whole EC
 * form (the Pump or Spare Add-On fields, name plate and BOI included). Those
 * who manage ECs add, edit and delete them here.
 */
export function OmEcsModal({
  order,
  items,
  canManage,
  deletingId,
  onAdd,
  onEdit,
  onDelete,
  onClose,
}: {
  order: Row;
  items: Row[];
  canManage: boolean;
  deletingId: string | null;
  onAdd: () => void;
  onEdit: (item: Row) => void;
  onDelete: (item: Row) => void;
  onClose: () => void;
}) {
  const fields = addOnFieldsFor(str(order.order_type) || null);
  // One EC open by default when there is only one.
  const [open, setOpen] = useState<Set<string>>(() => new Set(items.length === 1 ? [str(items[0].id)] : []));
  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const soLabel = str(order.so_no) || `#${str(order.sl_no)}`;
  const isSpare = str(order.order_type) === "Spare";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`ECs of ${soLabel}`}
      className="fixed inset-0 z-40 flex items-end justify-center bg-black/40 sm:items-center sm:p-6"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="max-h-[90vh] w-full max-w-5xl overflow-y-auto rounded-t-2xl bg-surface p-5 shadow-xl sm:rounded-2xl"
      >
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-display text-lg font-semibold text-foreground">ECs · {soLabel}</h2>
            <p className="text-xs text-muted">
              {[str(order.client_name), str(order.order_type), `${items.length} EC${items.length === 1 ? "" : "s"}`]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {canManage && (
              <button
                type="button"
                onClick={onAdd}
                className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3 text-xs font-semibold text-primary-foreground hover:bg-primary-hover"
              >
                <Plus className="h-3.5 w-3.5" />
                {isSpare ? "Spare Add-On" : "Pump Add-On"}
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="rounded-lg p-1.5 text-muted transition-colors hover:bg-background hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {items.length === 0 ? (
          <p className="rounded-xl border border-dashed border-card-border px-4 py-8 text-center text-sm text-muted">
            No ECs on this SO yet.
            {canManage ? ` Use ${isSpare ? "Spare" : "Pump"} Add-On to add one.` : ""}
          </p>
        ) : (
          <ul className="space-y-2">
            {items.map((it) => {
              const id = str(it.id);
              const isOpen = open.has(id);
              return (
                <li key={id} className="rounded-xl border border-card-border">
                  <div className="flex flex-wrap items-center gap-3 px-4 py-3">
                    <button
                      type="button"
                      onClick={() => toggle(id)}
                      aria-expanded={isOpen}
                      className="flex min-w-0 flex-1 items-center gap-2 text-left"
                    >
                      {isOpen ? (
                        <ChevronDown className="h-4 w-4 shrink-0 text-muted" />
                      ) : (
                        <ChevronRight className="h-4 w-4 shrink-0 text-muted" />
                      )}
                      <span className="font-semibold text-foreground">{str(it.ec_no) || "EC"}</span>
                      <span className="truncate text-xs text-muted">
                        {[
                          str(it.ec_date) && formatDisplay({ column: "ec_date", label: "", type: "date" }, it.ec_date),
                          str(it.model_no),
                          str(it.quantity) && `Qty ${str(it.quantity)}`,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    </button>
                    {canManage && (
                      <span className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => onEdit(it)}
                          className="inline-flex h-8 items-center gap-1 rounded-lg border border-input-border px-2.5 text-xs font-medium text-foreground hover:bg-background"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => onDelete(it)}
                          disabled={deletingId === id}
                          aria-label={`Delete ${str(it.ec_no) || "EC"}`}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-rose-200 text-rose-600 hover:bg-rose-50 disabled:opacity-50"
                        >
                          {deletingId === id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                        </button>
                      </span>
                    )}
                  </div>
                  {isOpen && (
                    <dl className="grid grid-cols-1 gap-x-5 gap-y-3 border-t border-card-border px-4 py-3 sm:grid-cols-2 lg:grid-cols-4">
                      {fields.map((f, i) => (
                        <Fragment key={f.column}>
                          {f.group && f.group !== fields[i - 1]?.group && (
                            <h3 className="col-span-full mt-1 border-t border-card-border pt-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                              {f.group}
                            </h3>
                          )}
                          <div className="text-sm">
                            <dt className="text-[12px] text-muted">{f.label}</dt>
                            <dd className="font-medium text-foreground">{formatDisplay(f, it[f.column]) || "—"}</dd>
                          </div>
                        </Fragment>
                      ))}
                    </dl>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
