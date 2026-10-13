"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ChevronRight,
  LayoutGrid,
  Loader2,
  Plus,
  Trash2,
} from "lucide-react";
import { deleteItemAction } from "@/app/risansi/orders/actions";
import { OrderStatusPanel } from "./order-status-panel";
import { canCreateOrders, canSeeClient } from "@/lib/roles";
import type { ItemDetail, OrderDetail as OrderDetailData, SoDeptStatus } from "@/lib/orders";
import { EcDeptGrid } from "./ec-dept-grid";
import { AddOnForm } from "./add-on-form";
import { OrderThread } from "./order-thread";
import type { TargetRevision } from "@/lib/target-dates";
import { SoSections } from "./so-sections";
import { HoldBanner } from "./hold-badge";

export { invoiceRowHeader } from "./so-sections";

type Row = Record<string, unknown>;

function str(value: unknown): string {
  return value === null || value === undefined ? "" : String(value);
}

function formatDate(value: unknown): string {
  const s = str(value);
  if (s === "") return "—";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function OrderDetail({
  detail,
  orderId,
  role,
  targetRevisions,
  grid,
}: {
  detail: OrderDetailData;
  orderId: string;
  role: string;
  targetRevisions: TargetRevision[];
  // Central Visibility and Admin: every EC department at a glance, each
  // opening in a pop-up (EcDeptGrid).
  grid?: { items: ItemDetail[]; status: SoDeptStatus | null };
}) {
  const router = useRouter();
  const order = detail.order;
  const canManageItems = canCreateOrders(role);
  const [addOpen, setAddOpen] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const soLabel = str(order.so_no) || `#${str(order.sl_no) || "—"}`;

  const items = (detail.items ?? []) as Row[];

  async function removeItem(item: Row) {
    const ec = str(item.ec_no) || "this EC";
    if (!confirm(`Delete ${ec}? This removes the EC and all its department data.`)) {
      return;
    }
    setDeletingId(str(item.id));
    const res = await deleteItemAction(str(item.id));
    setDeletingId(null);
    if (!res.ok) alert(res.error);
    else router.refresh();
  }

  // An EC's own buttons: open its page, and (for those who manage ECs) delete it.
  const rowActions = (item: Row) => {
    const id = str(item.id);
    return (
      <div className="flex items-center justify-end gap-2">
        <Link
          href={`/risansi/orders/${orderId}/items/${id}`}
          className="inline-flex h-8 items-center gap-1 rounded-lg border border-input-border px-2.5 text-xs font-medium text-foreground transition-colors hover:bg-background"
        >
          Open
          <ChevronRight className="h-3.5 w-3.5" />
        </Link>
        {canManageItems && (
          <button
            type="button"
            onClick={() => removeItem(item)}
            disabled={deletingId === id}
            aria-label="Delete EC"
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-rose-200 text-rose-600 transition-colors hover:bg-rose-50 disabled:opacity-50"
          >
            {deletingId === id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
          </button>
        )}
      </div>
    );
  };

  const ecOrdersPanel = (
    <section className="rounded-xl border border-card-border bg-surface p-6 shadow-sm">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2.5">
            <h2 className="font-display text-base font-semibold text-foreground">
              {grid ? "ECs and departments" : "EC orders"}
            </h2>

          </div>
          <p className="text-sm text-muted">
            {items.length} {items.length === 1 ? "item" : "items"} under this SO.
            {grid && items.length > 0 && " Click a department's status to see or edit it."}
          </p>
        </div>
        {canManageItems && (
          <button
            type="button"
            onClick={() => setAddOpen(true)}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary-hover"
          >
            <Plus className="h-3.5 w-3.5" />
            {`${str(order.order_type) || "Pump"} Add-On`}
          </button>
        )}
      </div>

      {items.length === 0 ? (
        <p className="text-sm text-muted">
          No EC items yet.
          {canManageItems
            ? ` Use ${str(order.order_type) || "Pump"} Add-On to add one.`
            : ""}
        </p>
      ) : grid ? (
        <EcDeptGrid orderId={orderId} role={role} items={grid.items} status={grid.status} actions={rowActions} />
      ) : (
        (() => {
          // Columns follow the SO's order type: a Spare has no Pump Type /
          // Series Version (matching the Spare Add-On form), while a Pump
          // shows both, plus Model.
          const isSpareSo = str(order.order_type).trim().toLowerCase() === "spare";
          return (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-sm">
                <thead>
                  <tr className="border-b border-card-border text-left text-xs font-semibold uppercase tracking-wide text-muted">
                    <th className="px-3 py-2">EC No.</th>
                    <th className="px-3 py-2">EC Date</th>
                    {!isSpareSo && <th className="px-3 py-2">Pump Type</th>}
                    <th className="px-3 py-2">Model No.</th>
                    <th className="px-3 py-2">Internal Model</th>
                    <th className="px-3 py-2">Version</th>
                    <th className="px-3 py-2">Qty</th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-card-border">
                  {items.map((item) => {
                    const id = str(item.id);
                    return (
                      <tr key={id} className="text-foreground">
                        <td className="px-3 py-2 whitespace-nowrap font-medium">
                          {str(item.ec_no) || "—"}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap text-muted">
                          {formatDate(item.ec_date)}
                        </td>
                        {!isSpareSo && (
                          <td className="px-3 py-2">{str(item.pump_type) || "—"}</td>
                        )}
                        <td className="px-3 py-2">{str(item.model_no) || "—"}</td>
                        <td className="px-3 py-2">{str(item.internal_model) || "—"}</td>
                        <td className="px-3 py-2">{str(item.version) || "—"}</td>
                        <td className="px-3 py-2 tabular-nums">{str(item.quantity) || "—"}</td>
                        <td className="px-3 py-2 whitespace-nowrap text-right">{rowActions(item)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          );
        })()
      )}
    </section>
  );

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-8 sm:py-8">
      <Link
        href="/risansi/orders"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to orders
      </Link>

      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="rounded-md bg-slate-100 px-2.5 py-1 text-xs font-semibold uppercase tracking-wide text-slate-600">
            SO · {soLabel}
          </span>
          <h1 className="font-display text-xl font-bold tracking-tight text-foreground">
            {(canSeeClient(role) && str(order.client_name)) || "Order"}
          </h1>
        </div>
        {/* This page is the forms; the overview is the whole order on one
            page, its ECs and every department's state included. */}
        {role !== "planning" && (
        <Link
          href={`/risansi/orders/${orderId}/overview`}
          className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-input-border px-3 text-sm font-medium text-foreground transition-colors hover:bg-background"
        >
          <LayoutGrid className="h-3.5 w-3.5" />
          Full overview
        </Link>
        )}
      </div>

      {/* The order status — a banner once it is cancelled or diverted — and,
          for Central Visibility and Admin, the control that sets it. */}
      <OrderStatusPanel orderId={orderId} order={order} role={role} />
      {/* Held by Central Visibility: everyone sees why. */}
      <HoldBanner order={order} />

      <div className="space-y-6">
        {/* Per-SO discussion. One lane per department, no cross-department
            visibility — Central picks who they are replying to. */}
        <OrderThread
          orderId={orderId}
          role={role}
          soLabel={soLabel}
          collapsible
          defaultOpen={false}
        />

        <SoSections
          detail={detail}
          orderId={orderId}
          role={role}
          targetRevisions={targetRevisions}
          // EC orders sits between Order details and Billing/Accounts.
          middle={ecOrdersPanel}
        />

      </div>

      {addOpen && (
        <AddOnForm
          orderId={orderId}
          soLabel={soLabel}
          orderType={str(order.order_type) || null}
          boiFlag={str(order.boi) || null}
          onClose={() => setAddOpen(false)}
        />
      )}
    </div>
  );
}
