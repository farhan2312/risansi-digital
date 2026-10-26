import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ClipboardList, Download, FileText, Plus, Upload } from "lucide-react";
import { listOrderDeptStatuses, listOrdersPage, orderListKpiCards, parseQueueSort, pumpCardSql } from "@/lib/orders";
import { listPumpSummaries } from "@/lib/pump-summary";
import { parsePage } from "@/lib/pagination";
import {
  isOrderListFiltered,
  orderListFilterParams,
  parseOrderListFilter,
  withOrdersKind, ordersKind,
  scopeToRep,
} from "@/lib/order-list-filter";
import { getCurrentUser } from "@/lib/session";
import { canCreateOrders, canViewAll, isRep } from "@/lib/roles";
import { OrdersTable } from "@/components/risansi/orders-table";
import { MissingDetailsButton } from "@/components/risansi/missing-details-modal";
import { OneClickButton } from "@/components/risansi/one-click-modal";

export const metadata: Metadata = {
  title: "Orders | Risansi",
};

export const dynamic = "force-dynamic";

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  // The whole-order list/summary is Central Visibility & Admin only;
  // department roles use their own workspace instead.
  if (!canViewAll(user.role)) redirect("/risansi/dashboard");
  const rep = isRep(user.role);

  const params = await searchParams;
  // The central dashboard's filter set, read from the URL so it narrows the
  // whole table in SQL — see lib/order-list-filter.ts.
  // A Rep sees only their own SOs.
  // Spare or Pump, as the toggle says (Spare when it says nothing).
  const filter = scopeToRep(
    withOrdersKind(parseOrderListFilter((key) => params[key], { noDispatchTarget: true }), params.type),
    user
  );
  const result = await listOrdersPage({
    page: parsePage(params.page),
    filter,
    sort: parseQueueSort(params.sort),
    // The department summary cards (Spare or Pump); on Pump, the card picked narrows the list.
    kpis: orderListKpiCards(ordersKind(params.type)),
    extraRestrict: ordersKind(params.type) === "pump" ? pumpCardSql(params.pk) : null,
  });
  const canCreate = canCreateOrders(user.role);
  // Every department on each SO of this page, for the row's tags; on the Pump
  // view, each department's own standing on the SO (its column groups).
  const pumpView = ordersKind(params.type) === "pump";
  const pageIds = result.rows.map((r) => r.id);
  const [deptStatuses, pumpSummaries] = await Promise.all([
    listOrderDeptStatuses(pageIds).then((m) => Object.fromEntries(m)),
    pumpView ? listPumpSummaries(pageIds) : Promise.resolve(undefined),
  ]);

  // The export mirrors whatever the list is showing: with any filter on it
  // downloads just those SOs, otherwise the whole tracker.
  const isFiltered = isOrderListFiltered(filter);
  // The PDF carries the same filter and sort as the list on screen.
  const pdfParams = orderListFilterParams(filter);
  if (params.sort) pdfParams.set("sort", params.sort);
  const pdfHref = `/api/orders/pdf${pdfParams.size ? `?${pdfParams}` : ""}`;
  const exportHref = isFiltered
    ? `/api/orders/export?${orderListFilterParams(filter)}`
    : "/api/orders/export";

  return (
    <div className="px-4 py-6 sm:px-8 sm:py-8">
      {/* header */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <ClipboardList className="h-6 w-6" />
          </div>
          <div>
            <h1 className="font-display text-2xl font-bold tracking-tight text-foreground">
              Orders
            </h1>
            <p className="text-sm text-muted">
              Master Order-to-Dispatch tracker — {result.total}{" "}
              {result.total === 1 ? "order" : "orders"}.
            </p>
          </div>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {/* What the tracker is still waiting on, across every SO — see
              lib/order-gaps.ts. */}
          {!rep && <MissingDetailsButton />}
          <a
            href={pdfHref}
            target="_blank"
            rel="noopener"
            className="inline-flex h-10 items-center gap-2 rounded-lg border border-input-border bg-surface px-4 text-sm font-semibold text-foreground transition-colors hover:bg-background"
          >
            <FileText className="h-4 w-4" />
            PDF report
          </a>
          <a
            href={exportHref}
            className="inline-flex h-10 items-center gap-2 rounded-lg border border-input-border bg-surface px-4 text-sm font-semibold text-foreground transition-colors hover:bg-background"
          >
            <Download className="h-4 w-4" />
            {isFiltered ? `Export ${result.total} filtered` : "Export all"}
          </a>
          {/* The same, on a single sheet: a pop-up to look over, then download. */}
          <OneClickButton query={orderListFilterParams(filter).toString()} />
          {canCreate && (
            <>
              <Link
                href="/risansi/orders/import"
                className="inline-flex h-10 items-center gap-2 rounded-lg border border-input-border bg-surface px-4 text-sm font-semibold text-foreground transition-colors hover:bg-background"
              >
                <Upload className="h-4 w-4" />
                Import orders
              </Link>
              <Link
                href="/risansi/orders/new"
                className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary-hover"
              >
                <Plus className="h-4 w-4" />
                New order
              </Link>
            </>
          )}
        </div>
      </div>

      <OrdersTable result={result} canDelete={canCreate} role={user.role} deptStatuses={deptStatuses} pumpSummaries={pumpSummaries} />
    </div>
  );
}
