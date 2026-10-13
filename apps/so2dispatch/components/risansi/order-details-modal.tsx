"use client";

import { useEffect, useState } from "react";
import {
  CalendarClock,
  FileText,
  Loader2,
  Pencil,
  Plus,
  ScrollText,
  ShieldCheck,
  User,
  X,
  type LucideIcon,
} from "lucide-react";
import { getOrderCoreAction } from "@/app/risansi/orders/actions";
import { SECTION_BY_TABLE, billModeLabel, dependsOnSatisfied, type OrderField } from "@/lib/order-schema";
import { formatDisplay } from "./editable-section";

const CORE = SECTION_BY_TABLE.get("orders")!;

type Order = Record<string, unknown>;

/** The Order details form's groups, each as its own card here. */
const GROUP_ICON: Record<string, LucideIcon> = {
  Clearance: ShieldCheck,
  Client: User,
  "Purchase Order": FileText,
  "Terms & Conditions": ScrollText,
  "Target Dates": CalendarClock,
};

const str = (v: unknown) => (v === null || v === undefined ? "" : String(v).trim());

/**
 * Read-only popup of an SO's Order details, fetched on open: a header with the
 * SO and its client, then one card per part of the form — Clearance, Client,
 * Purchase Order, Terms & Conditions, Target Dates — showing only the fields
 * that apply to this order.
 */
export function OrderDetailsModal({
  orderId,
  onClose,
  onEdit,
  onAddOn,
  addOnLabel,
}: {
  orderId: string;
  onClose: () => void;
  // Adds an EC (Spare / Pump Add-On) — offered with its label when given.
  onAddOn?: () => void;
  addOnLabel?: string;
  // Offered when the viewer may edit: opens the Order details form.
  onEdit?: () => void;
}) {
  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    getOrderCoreAction(orderId).then((o) => {
      if (!active) return;
      setOrder(o);
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [orderId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const soLabel = order ? String(order.so_no ?? `#${order.sl_no ?? "—"}`) : "";

  // Fields that apply to this order, grouped as the form groups them.
  const groups: { title: string; fields: OrderField[] }[] = [];
  if (order) {
    const read = (c: string) => str(order[c]);
    for (const f of CORE.fields) {
      if (!dependsOnSatisfied(f, read)) continue;
      // A field the viewer is not shown at all (Order Making's view) is left out.
      if (!(f.column in order)) continue;
      const title = f.group ?? "Other";
      let g = groups.find((x) => x.title === title);
      if (!g) groups.push((g = { title, fields: [] }));
      g.fields.push(f);
    }
  }

  const held = order && str(order.clearance_status) === "Hold";

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center sm:items-center sm:p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} aria-hidden />
      <div className="relative flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-t-2xl border border-card-border bg-card shadow-xl sm:rounded-2xl">
        {/* Header: the SO, its client, and its standing at a glance. */}
        <div className="flex items-start justify-between gap-4 border-b border-card-border px-5 py-4 sm:px-6">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Order details</p>
            {order ? (
              <>
                <h2 className="mt-0.5 font-display text-lg font-semibold text-foreground">
                  SO {soLabel}
                  {str(order.so_date) && (
                    <span className="ml-2 text-sm font-normal text-muted">
                      {formatDisplay({ column: "so_date", label: "", type: "date" }, order.so_date)}
                    </span>
                  )}
                </h2>
                {str(order.client_name) && <p className="truncate text-sm text-muted">{str(order.client_name)}</p>}
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {[str(order.order_type), billModeLabel(order.bill_mode, order.bill_type)]
                    .filter(Boolean)
                    .map((t) => (
                      <span key={t} className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">
                        {t}
                      </span>
                    ))}
                  {str(order.clearance_status) && (
                    <span
                      className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                        held ? "bg-rose-50 text-rose-700" : "bg-emerald-50 text-emerald-700"
                      }`}
                    >
                      {held ? `On hold${str(order.clearance_hold_reason) ? ` · ${str(order.clearance_hold_reason)}` : ""}` : "Clear"}
                    </span>
                  )}
                  {str(order.accounts_hold_status) === "Hold" && (
                    <span
                      title={str(order.accounts_hold_remarks) || undefined}
                      className="rounded-full bg-rose-50 px-2 py-0.5 text-[11px] font-medium text-rose-700"
                    >
                      Accounts hold{str(order.accounts_hold_reason) ? ` · ${str(order.accounts_hold_reason)}` : ""}
                    </span>
                  )}
                </div>
              </>
            ) : (
              <h2 className="mt-0.5 font-display text-lg font-semibold text-foreground">&nbsp;</h2>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {onAddOn && addOnLabel && order && (
              <button
                type="button"
                onClick={onAddOn}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary px-3 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary-hover"
              >
                <Plus className="h-3.5 w-3.5" />
                {addOnLabel}
              </button>
            )}
            {onEdit && order && (
              <button
                type="button"
                onClick={onEdit}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-primary/40 bg-primary/10 px-3 text-xs font-semibold text-primary transition-colors hover:bg-primary hover:text-primary-foreground"
              >
                <Pencil className="h-3.5 w-3.5" />
                Edit
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        <div className="overflow-y-auto px-5 py-5 sm:px-6">
          {loading ? (
            <div className="flex items-center gap-2 py-10 text-sm text-muted">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading…
            </div>
          ) : !order ? (
            <p className="py-10 text-sm text-muted">Order not found.</p>
          ) : (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              {groups.map((g) => {
                const Icon = GROUP_ICON[g.title] ?? FileText;
                const wide = g.title === "Purchase Order" || g.title === "Terms & Conditions";
                return (
                  <section
                    key={g.title}
                    className={`rounded-xl border border-card-border bg-surface p-4 ${wide ? "lg:col-span-2" : ""}`}
                  >
                    <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
                      <Icon className="h-4 w-4 text-primary" />
                      {g.title}
                    </h3>
                    <dl className={`grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2 ${wide ? "lg:grid-cols-3" : ""}`}>
                      {g.fields.map((f) => (
                        <div key={f.column} className={f.column === "payment_terms" ? "sm:col-span-2 lg:col-span-3" : ""}>
                          <dt className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{f.label}</dt>
                          <dd className="mt-0.5 text-[14px] text-foreground">
                            {f.column === "payment_terms" && str(order.payment_terms) ? (
                              // One line per term, as they are entered.
                              <ul className="space-y-0.5">
                                {str(order.payment_terms)
                                  .split(" + ")
                                  .map((line, i) => (
                                    <li key={i} className="flex gap-2">
                                      <span className="text-muted-foreground">•</span>
                                      {line}
                                    </li>
                                  ))}
                              </ul>
                            ) : (
                              <span className={formatDisplay(f, order[f.column]) === "—" ? "text-muted-foreground" : ""}>
                                {formatDisplay(f, order[f.column])}
                              </span>
                            )}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  </section>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
