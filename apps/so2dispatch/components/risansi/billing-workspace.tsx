"use client";

import { KpiStrip } from "./kpi-strip";
import type { KpiCard } from "@/lib/kpis";
import { Fragment, useEffect, useState } from "react";
import { MessageSquare } from "lucide-react";
import type { BillingQueueRow } from "@/lib/orders";
import { TermPis } from "./term-pis";
import { billModeLabel } from "@/lib/order-schema";
import { OrderDetailsModal } from "./order-details-modal";
import { DispatchInline } from "./dispatch-inline";
import { SortHeader } from "./sort-header";
import { HoldBadge } from "./hold-badge";
import { DispatchStatusPill } from "./dispatch-status-pill";
import { DispatchStatusControl } from "./order-status-panel";
import { isCentral } from "@/lib/roles";
import { dispatchRowTone } from "@/lib/dept-view";
import { UrlPagination, UrlSearchInput, useUrlTable } from "./url-table";
import { OrderListFilterBar } from "./order-list-filter-bar";
import type { OrderListOptions } from "@/lib/orders";
import { DEPT_VIEWS } from "@/lib/dept-view";
import { useFocusRow } from "./use-focus-row";
import type { PageResult } from "@/lib/pagination";
import { OrderThreadModal } from "./order-thread-modal";
import type { DeptCompletion } from "@/lib/dept-completion";

type Row = Record<string, unknown>;

function rowSearchText(o: BillingQueueRow): string {
  return [o.sl_no, o.so_no, o.client_name].filter(Boolean).join(" ");
}

function formatDate(value: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

const numberFmt = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 });
function formatValue(v: string | null): string {
  if (!v || v.trim() === "") return "—";
  const n = Number(v);
  return Number.isFinite(n) ? numberFmt.format(n) : v;
}

export function BillingWorkspace({
  queue,
  mode = "billing",
  canEdit,
  openOrderId,
  openThreadId,
  focusOrderId,
  role,
  unreadThreads = {},
  filterOptions,
  kpis = [],
}: {
  /** The summary cards under the filter bar. */
  kpis?: KpiCard[];
  // One server-fetched page; search and paging ran in SQL.
  queue: PageResult<BillingQueueRow>;
  /**
   * Which department's screen this is. "billing" shows the PI list (the
   * Operation card); "dispatch" shows the invoice-and-dispatch cards, which
   * is the work that happens after Assembly & Packing.
   */
  mode?: "billing" | "dispatch";
  canEdit: boolean;
  // Billing's sign-offs for the SOs on this page. Billing is SO-scope, so a
  // single tick covers the order rather than one of its ECs.
  completions?: DeptCompletion[];
  // Facet values for the filter bar; omitted, the plain search box stays.
  filterOptions?: OrderListOptions;
  openOrderId?: string;
  // Deep-link from the discussion icon: open this SO's thread on load.
  openThreadId?: string;
  // The SO a notification deep link resolved to — scrolled to and highlighted.
  focusOrderId?: string;
  // The viewer's role — decides which discussion lane they get.
  role: string;
  // Unread discussion messages keyed by order id, for the row badge.
  unreadThreads?: Record<string, number>;
}) {
  const rows = queue.rows;
  const { get: getParam } = useUrlTable();
  // An empty table means one of two very different things — say which, so a
  // search that matched nothing isn't read as an empty queue.
  const emptyMessage = getParam("q")
    ? "No orders match your search."
    : "No orders yet.";
  const [threadFor, setThreadFor] = useState<{
    orderId: string;
    soLabel: string;
  } | null>(null);

  // Deep link from the discussion icon: open that SO's thread on arrival.
  useEffect(() => {
    if (!openThreadId) return;
    const row = rows.find((r) => String(r.id) === openThreadId);
    if (!row) return;
    setThreadFor({
      orderId: openThreadId,
      soLabel: String(row.so_no ?? row.sl_no ?? ""),
    });
  }, [openThreadId, rows]);

  const [orderDetailsFor, setOrderDetailsFor] = useState<string | null>(null);
  const pageRows = rows;

  const focusClass = useFocusRow([focusOrderId ?? openOrderId], rows.length > 0);



  return (
    <div>
      <div className="mb-3">
        {/* The same filter bar the orders list carries, with this
            department pinned: its own statuses, its own target. */}
        {filterOptions ? (
          <OrderListFilterBar
            options={filterOptions}
            total={queue.total}
            dept={mode}
            hasTarget={DEPT_VIEWS[mode].hasTarget}
            searchPlaceholder="Search SO, client…"
          />
        ) : (
          <UrlSearchInput placeholder="Search SO, client…" />
        )}
      </div>

      <KpiStrip cards={kpis} />

      <div className="rounded-xl border border-card-border bg-surface shadow-sm">
        {/* The header row stays under the top bar as the page scrolls (AppShell). */}
        <div className="overflow-x-auto" data-sticky-head>
          <table className="w-full min-w-[880px] text-sm">
            <thead className="relative z-10 bg-surface data-[stuck=1]:shadow-[0_2px_6px_-2px_rgba(0,0,0,0.18)] [&_th]:bg-surface">
              <tr className="border-b border-card-border text-left text-xs font-semibold uppercase tracking-wide text-muted">
                <th className="px-4 py-3"><SortHeader label="Sl." sortKey="sl" /></th>
                <th className="px-4 py-3">SO No.</th>
                <th className="px-4 py-3">Chat</th>
                <th className="px-4 py-3"><SortHeader label="SO Date" sortKey="so_date" /></th>
                {mode === "billing" && (
                  <th className="px-4 py-3 whitespace-nowrap">
                    <SortHeader label="Readiness Date" sortKey="readiness" />
                  </th>
                )}
                <th className="px-4 py-3">Order Type</th>
                <th className="px-4 py-3">Client Name</th>
                <th className="px-4 py-3">Bill Mode</th>
                <th className="px-4 py-3">{mode === "billing" ? "Payment terms & PIs" : "Packing slips & dispatches"}</th>
                <th className="px-4 py-3 text-right">Order Value</th>
                {mode === "billing" && <th className="px-4 py-3">PI Status</th>}
                <th className="px-4 py-3">Dispatch Status</th>
                {mode === "dispatch" && <th className="px-4 py-3">Stage</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-card-border">
              {pageRows.length === 0 && (
                <tr>
                  <td colSpan={14} className="px-4 py-10 text-center text-sm text-muted">
                    {emptyMessage}
                  </td>
                </tr>
              )}
              {pageRows.map((row) => {
                return (
                  <Fragment key={row.id}>
                    <tr
                      data-focus-row={String(row.id)}
                      // A click on the row opens its Order details — but not a
                      // click on its own buttons, links or fields.
                      onClick={(e) => {
                        if ((e.target as HTMLElement).closest("button, a, input, select, textarea, label, [role=dialog]")) return;
                        setOrderDetailsFor(row.id);
                      }}
                      title="Click for order details"
                      className={`cursor-pointer text-foreground transition-colors ${
                        dispatchRowTone(row as unknown as Record<string, unknown>) ?? "hover:bg-background/60"
                      } ${focusClass(String(row.id))}`}
                    >
                      <td className="px-4 py-3 font-medium tabular-nums">{row.sl_no}</td>
                      <td className="px-4 py-3 whitespace-nowrap">{row.so_no ?? "—"}
                        <HoldBadge order={row} />
                      </td>
                      <td className="px-4 py-3">
                        <button
                          type="button"
                          onClick={() =>
                            setThreadFor({ orderId: String(row.id), soLabel: row.so_no ?? String(row.sl_no) })
                          }
                          aria-label="Chat"
                          title="Chat"
                          className="relative inline-flex h-8 w-8 items-center justify-center rounded-lg border border-input-border text-foreground transition-colors hover:bg-background"
                        >
                          <MessageSquare className="h-3.5 w-3.5" />
                          {(unreadThreads[String(row.id)] ?? 0) > 0 && (
                            <span className="absolute -right-1.5 -top-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-600 px-1 text-[10px] font-bold text-white">
                              {unreadThreads[String(row.id)]}
                            </span>
                          )}
                        </button>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-muted">{formatDate(row.so_date)}</td>
                      {/* Planning's readiness date (a range when the ECs differ), and
                          the status when they all share it. */}
                      {mode === "billing" && (
                        <td className="px-4 py-3 whitespace-nowrap">
                          {row.readiness_from
                            ? row.readiness_to && row.readiness_to !== row.readiness_from
                              ? `${formatDate(row.readiness_from)} – ${formatDate(row.readiness_to)}`
                              : formatDate(row.readiness_from)
                            : "—"}
                          {row.readiness_status && (
                            <div className="text-[11px] text-muted">{row.readiness_status}</div>
                          )}
                        </td>
                      )}
                      <td className="px-4 py-3 whitespace-nowrap">{row.order_type ?? "—"}</td>
                      <td className="px-4 py-3">{row.client_name ?? "—"}</td>
                      <td className="px-4 py-3">{billModeLabel(null, row.bill_type) || "—"}</td>
                      <td className="px-4 py-3 align-top">
                        {/* Billing: each term line with its PI, or "+ PI".
                            Dispatch: each dispatch and the slips still waiting. */}
                        {mode === "billing" ? (
                          <TermPis
                            orderId={row.id}
                            soLabel={row.so_no ?? String(row.sl_no)}
                            terms={(row.term_lines ?? []) as Row[]}
                            pis={(row.pi_docs ?? []) as Row[]}
                            canEdit={canEdit}
                          />
                        ) : (
                          <DispatchInline
                            orderId={row.id}
                            slips={(row.packing_slips ?? []) as Row[]}
                            invoices={(row.invoices ?? []) as Row[]}
                            billType={row.bill_type}
                            canEdit={canEdit}
                          />
                        )}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {formatValue(row.order_value)}
                        {row.order_currency ? ` ${row.order_currency}` : ""}
                      </td>
                      {mode === "billing" && (
                        <td className="px-4 py-3 whitespace-nowrap">
                          <PiStatePill state={row.billing_state} />
                        </td>
                      )}
                      <td className="px-4 py-3 whitespace-nowrap">
                        {mode === "dispatch" ? (
                          // Dispatch may set it by hand, as well as by its invoices.
                          <DispatchStatusControl
                            orderId={row.id}
                            status={row.dispatch_status}
                            override={row.status_override}
                            fromInvoices={row.invoice_dispatch_status}
                            reason={row.status_reason}
                            canSet={role === "dispatch" || isCentral(role)}
                          />
                        ) : (
                          <DispatchStatusPill status={row.dispatch_status} />
                        )}
                      </td>
                      {mode === "dispatch" && (
                        <td className="px-4 py-3 whitespace-nowrap">
                          <StagePill stage={row.dispatch_stage} />
                        </td>
                      )}
                    </tr>
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
        <UrlPagination
          page={queue.page}
          totalPages={queue.totalPages}
          from={queue.from}
          to={queue.to}
          total={queue.total}
        />
      </div>

      {orderDetailsFor && (
        <OrderDetailsModal
          orderId={orderDetailsFor}
          onClose={() => setOrderDetailsFor(null)}
        />
      )}

      {threadFor && (
        <OrderThreadModal
          orderId={threadFor.orderId}
          role={role}
          soLabel={threadFor.soLabel}
          onClose={() => setThreadFor(null)}
        />
      )}
    </div>
  );
}

/** The SO's stage in Invoice → Dispatch → Docket & LR, as a coloured pill. */
function StagePill({ stage }: { stage: string | null | undefined }) {
  const s = (stage ?? "").trim();
  if (!s) return <span className="text-muted-foreground">—</span>;
  const tone =
    s === "Docket & LR done"
      ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300"
      : s === "Docket & LR pending"
        ? "bg-sky-100 text-sky-800 dark:bg-sky-500/15 dark:text-sky-300"
        : s === "Dispatch pending"
          ? "bg-violet-100 text-violet-800 dark:bg-violet-500/15 dark:text-violet-300"
          : "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300";
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${tone}`}>{s}</span>;
}

/** How far the SO's PIs are raised against its terms, as a coloured pill. */
function PiStatePill({ state }: { state: string | null | undefined }) {
  const s = (state ?? "").trim() || "Pending";
  const tone =
    s === "Fully raised"
      ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300"
      : s === "Partially raised"
        ? "bg-sky-100 text-sky-800 dark:bg-sky-500/15 dark:text-sky-300"
        : s === "N/A"
          ? "bg-slate-100 text-slate-600 dark:bg-white/10 dark:text-slate-300"
          : "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300";
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${tone}`}>
      {s === "N/A" ? "N/A · after receipt" : s}
    </span>
  );
}
