"use client";

import { KpiStrip } from "./kpi-strip";
import type { KpiCard } from "@/lib/kpis";
import { Fragment, useEffect, useState } from "react";
import { MessageSquare } from "lucide-react";
import type { BillingQueueRow } from "@/lib/orders";
import { TermPis } from "./term-pis";
import { OrderInHand, OrderValueDetails } from "./order-value-details";
import { PendencyCell } from "./pendency-cell";
import { MultiSelectFilter } from "./multi-select-filter";
import { PENDENCY, type Pendency } from "@/lib/pendency";
import { billModeLabel } from "@/lib/order-schema";
import { OrderDetailsModal } from "./order-details-modal";
import { DispatchInline } from "./dispatch-inline";
import { SortHeader } from "./sort-header";
import { HoldBadge } from "./hold-badge";
import { VersionTag } from "./version-tag";
import { DispatchStatusPill, NotAtDispatch, atDispatch } from "./dispatch-status-pill";
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
import { RetrofitLine } from "./retrofit-line";
import { PanelSection, Portrait, SplitShell, type SplitCol } from "./split-view";

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
  pendency = {},
  orderInHand,
  split: splitView = false,
}: {
  /** The split view (the profile menu's switch): the SO list, the SO picked beside it. */
  split?: boolean;
  /** Dispatch: the cumulative Order in Hand of every SO the filter bar matches. */
  orderInHand?: number;
  /** The summary cards under the filter bar. */
  kpis?: KpiCard[];
  /** Why each SO's PI is still pending (Proforma Invoice), by SO id. */
  pendency?: Record<string, Pendency>;
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
  const { get: getParam, getList, setParams } = useUrlTable();
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

  // The columns, listed once: the table draws them across, the split view's
  // panel stands the same ones upright. Billing and Dispatch each have a few of their own.
  const billing = mode === "billing";
  const dispatch = mode === "dispatch";
  const only = (on: boolean, col: SplitCol<BillingQueueRow>) => (on ? [col] : []);
  const cols: SplitCol<BillingQueueRow>[] = [
    { key: "sl", label: "Sl.", head: <SortHeader label="Sl." sortKey="sl" />, tdClass: "font-medium tabular-nums", cell: (row) => row.sl_no, list: true },
    {
      key: "so",
      label: "SO No.",
      head: <SortHeader label="SO No." sortKey="so_no" />,
      thClass: "sticky-so",
      tdClass: "sticky-so whitespace-nowrap",
      cell: (row) => (
        <>
          {row.so_no ?? "—"}
          <VersionTag order={row} />
          <HoldBadge order={row} />
        </>
      ),
      list: true,
    },
    {
      key: "sodate",
      label: "SO Date",
      head: <SortHeader label="SO Date" sortKey="so_date" />,
      tdClass: "whitespace-nowrap text-muted",
      cell: (row) => formatDate(row.so_date),
    },
    {
      key: "chat",
      label: "Chat",
      cell: (row) => (
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
      ),
    },
    // Central Visibility's date for it to go out (Dispatch Plan).
    ...only(dispatch, {
      key: "tbd",
      label: "To Be Dispatch Date",
      head: <SortHeader label="To Be Dispatch Date" sortKey="final_dispatch_target_date" />,
      thClass: "whitespace-nowrap",
      tdClass: "whitespace-nowrap",
      cell: (row) => formatDate(row.final_dispatch_target_date ?? null),
      list: true,
    }),
    // Planning's readiness date (a range when the ECs differ), and the status
    // when they all share it.
    ...only(billing, {
      key: "readiness",
      label: "Readiness Date",
      head: <SortHeader label="Readiness Date" sortKey="readiness" />,
      thClass: "whitespace-nowrap",
      tdClass: "whitespace-nowrap",
      cell: (row) => (
        <>
          {row.readiness_from
            ? row.readiness_to && row.readiness_to !== row.readiness_from
              ? `${formatDate(row.readiness_from)} – ${formatDate(row.readiness_to)}`
              : formatDate(row.readiness_from)
            : "—"}
          {row.readiness_status && (
            <div className="text-[11px] text-muted">{row.readiness_status}</div>
          )}
        </>
      ),
      list: true,
    }),
    {
      key: "type",
      label: "Order Type",
      tdClass: "whitespace-nowrap",
      cell: (row) => (
        <>
          {row.order_type ?? "—"}
          <RetrofitLine row={row} />
        </>
      ),
    },
    { key: "client", label: "Client Name", cell: (row) => row.client_name ?? "—", list: true },
    { key: "bill", label: "Bill Mode", cell: (row) => billModeLabel(null, row.bill_type) || "—" },
    // Dispatch sees, read-only, each term line with its PI and payment. A
    // Challan / FR SO is a replacement: no terms to pay against.
    ...only(dispatch, {
      key: "terms",
      label: "Payment terms & PIs",
      tdClass: "align-top",
      wide: true,
      cell: (row) =>
        row.bill_type === "Challan" && !(row.term_lines ?? []).length ? (
          <span className="whitespace-nowrap text-xs text-muted">REPLACEMENT - NO PAYMENT TERMS</span>
        ) : (
          <TermPis
            orderId={row.id}
            soLabel={row.so_no ?? String(row.sl_no)}
            terms={(row.term_lines ?? []) as Row[]}
            pis={(row.pi_docs ?? []) as Row[]}
            canEdit={false}
            payments={{ canEdit: false }}
          />
        ),
    }),
    // Billing: each term line with its PI, or "+ PI".
    // Dispatch: each dispatch and the slips still waiting.
    {
      key: "work",
      label: billing ? "Payment terms & PIs" : "Packing slips & dispatches",
      tdClass: "align-top",
      wide: true,
      cell: (row) =>
        billing ? (
          <TermPis
            orderId={row.id}
            soLabel={row.so_no ?? String(row.sl_no)}
            terms={(row.term_lines ?? []) as Row[]}
            pis={(row.pi_docs ?? []) as Row[]}
            canEdit={canEdit}
            // Accounts' payment on each PI and term line, read-only.
            payments={{ canEdit: false }}
          />
        ) : (
          <>
            <PumpPackingLines lots={row.pump_lots} />
            <DispatchInline
              orderId={row.id}
              slips={(row.packing_slips ?? []) as Row[]}
              invoices={(row.invoices ?? []) as Row[]}
              billType={row.bill_type}
              canEdit={canEdit}
            />
          </>
        ),
    },
    { key: "value", label: "Order Value Details", thClass: "whitespace-nowrap", tdClass: "align-top", cell: (row) => <OrderValueDetails row={row} /> },
    ...only(dispatch, {
      key: "inhand",
      label: "Order in Hand",
      head: <SortHeader label="Order in Hand" sortKey="in_hand" />,
      thClass: "whitespace-nowrap text-right",
      tdClass: "align-top text-right",
      cell: (row) => <OrderInHand row={row} />,
    }),
    ...only(billing, {
      key: "pi",
      label: "PI Status",
      tdClass: "whitespace-nowrap",
      cell: (row) =>
        ["Pending", "Readiness date awaited", "Partially raised"].includes((row.billing_state ?? "").trim() || "Pending") ? (
          // Still a PI to raise: why, with remarks.
          <PendencyCell
            orderId={String(row.id)}
            soLabel={row.so_no ?? String(row.sl_no)}
            dept="billing"
            pendency={pendency[String(row.id)]}
            canEdit={canEdit}
          >
            <PiStatePill state={row.billing_state} />
          </PendencyCell>
        ) : (
          <PiStatePill state={row.billing_state} />
        ),
      list: true,
    }),
    {
      key: "dstatus",
      label: "Dispatch Status",
      tdClass: "whitespace-nowrap",
      // Dispatch: kept in the split view's list too.
      list: dispatch,
      cell: (row) =>
        dispatch ? (
          // Dispatch may set it by hand, as well as by its invoices
          // (Hold above it while Central Visibility holds the SO).
          <>
            <DispatchStatusControl
              orderId={row.id}
              status={row.dispatch_status}
              override={row.status_override}
              fromInvoices={row.invoice_dispatch_status}
              reason={row.status_reason}
              canSet={role === "dispatch" || isCentral(role)}
            />
          </>
        ) : atDispatch(row as unknown as Record<string, unknown>) ? (
          <DispatchStatusPill status={row.dispatch_status} />
        ) : (
          <NotAtDispatch />
        ),
    },
    ...only(dispatch, {
      key: "stage",
      label: "Stage",
      tdClass: "whitespace-nowrap",
      cell: (row) => <StagePill stage={row.dispatch_stage} />,
      list: true,
    }),
  ];
  const headOf = <R,>(c: SplitCol<R>) => ("head" in c ? c.head : c.label);
  // Split view: the SO picked, the first until another is.
  const split = splitView;
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const focusRow = split ? (pageRows.find((r) => String(r.id) === focusKey) ?? pageRows[0] ?? null) : null;
  const listCols = cols.filter((c) => c.list);

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
            orderInHand={orderInHand}
            searchPlaceholder="Search SO, client…"
            {...(mode === "billing"
              ? {
                  extraKeys: [PENDENCY.billing.key],
                  extraFilters: (
                    <MultiSelectFilter
                      label="Pendency reason"
                      allLabel="Any"
                      options={PENDENCY.billing.reasons}
                      selected={getList(PENDENCY.billing.key)}
                      onChange={(next) => setParams({ [PENDENCY.billing.key]: next })}
                    />
                  ),
                }
              : {})}
          />
        ) : (
          <UrlSearchInput placeholder="Search SO, client…" />
        )}
      </div>

      <KpiStrip cards={kpis} />

      <SplitShell
        split={split}
        focusKey={focusRow ? String(focusRow.id) : null}
        focusLabel={focusRow ? (focusRow.so_no ?? `#${focusRow.sl_no}`) : null}
        list={
      <div className="rounded-xl border border-card-border bg-surface shadow-sm">
        {/* The header row stays under the top bar as the page scrolls (AppShell). */}
        <div className="overflow-x-auto" data-sticky-head>
          {split ? (
            // Split view: the SO's identity and state; the rest is the panel's.
            <table className="w-full text-sm">
              <thead className="relative z-10 bg-surface data-[stuck=1]:shadow-[0_2px_6px_-2px_rgba(0,0,0,0.18)] [&_th]:bg-surface">
                <tr className="border-b border-card-border text-left text-[11px] font-semibold uppercase tracking-wide text-muted">
                  {listCols.map((c) => (
                    <th key={c.key} className={`px-3 py-2 ${c.thClass ?? ""}`}>{headOf(c)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {pageRows.length === 0 && (
                  <tr>
                    <td colSpan={listCols.length} className="px-4 py-10 text-center text-sm text-muted">
                      {emptyMessage}
                    </td>
                  </tr>
                )}
                {pageRows.map((row) => (
                  <tr
                    key={row.id}
                    data-focus-row={String(row.id)}
                    onClick={() => setFocusKey(String(row.id))}
                    className={`cursor-pointer text-foreground ${
                      dispatchRowTone(row as unknown as Record<string, unknown>) ?? "hover:bg-background/40"
                    } ${focusRow?.id === row.id ? "outline-2 -outline-offset-2 outline-primary/50" : ""} ${focusClass(String(row.id))}`}
                  >
                    {listCols.map((c) => (
                      <td key={c.key} className={`border-b border-card-border px-3 py-2 align-top ${c.tdClass ?? ""}`}>
                        {c.cell(row)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
          <table className="w-full min-w-[880px] text-sm">
            <thead className="relative z-10 bg-surface data-[stuck=1]:shadow-[0_2px_6px_-2px_rgba(0,0,0,0.18)] [&_th]:bg-surface">
              <tr className="border-b border-card-border text-left text-xs font-semibold uppercase tracking-wide text-muted">
                {cols.map((c) => (
                  <th key={c.key} className={`px-4 py-3 ${c.thClass ?? ""}`}>{headOf(c)}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-card-border">
              {pageRows.length === 0 && (
                <tr>
                  <td colSpan={cols.length} className="px-4 py-10 text-center text-sm text-muted">
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
                      {cols.map((c) => (
                        <td key={c.key} className={`px-4 py-3 ${c.tdClass ?? ""}`}>
                          {c.cell(row)}
                        </td>
                      ))}
                    </tr>
                  </Fragment>
                );
              })}
            </tbody>
          </table>
          )}
        </div>
        <UrlPagination
          page={queue.page}
          totalPages={queue.totalPages}
          from={queue.from}
          to={queue.to}
          total={queue.total}
        />
      </div>
        }
        panel={
          focusRow ? (
            <PanelSection
              title="SO"
              aside={
                // The table opens it with a click on the row; here the click picks the SO.
                <button
                  type="button"
                  onClick={() => setOrderDetailsFor(focusRow.id)}
                  className="text-xs font-semibold text-primary hover:underline"
                >
                  Order details
                </button>
              }
            >
              <Portrait cols={cols} row={focusRow} />
            </PanelSection>
          ) : null
        }
      />

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

/** A pump SO's lots as Assembly & Packing has them: Dispatch sees what is packed before sending. */
function PumpPackingLines({ lots }: { lots: BillingQueueRow["pump_lots"] }) {
  if (!lots?.length) return null;
  return (
    <div className="mb-2 flex w-[44rem] flex-wrap gap-1.5">
      {lots.map((l) => (
        <span key={l.n} title={l.remarks ?? undefined} className="inline-flex max-w-full items-center gap-1 rounded-md border border-card-border px-1.5 py-0.5 text-[11px]">
          <span className="font-semibold text-foreground">Lot {l.n}</span>
          <span className={l.status === "Packed" ? "text-emerald-700" : l.status ? "text-amber-700" : "text-muted"}>{l.status ?? "No packing status"}</span>
          {l.status === "Packed" && l.packed_date && <span className="text-muted">{formatDate(l.packed_date)}</span>}
          {l.remarks && <span className="truncate text-muted">· {l.remarks}</span>}
        </span>
      ))}
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
        : s === "Transporter pending"
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
