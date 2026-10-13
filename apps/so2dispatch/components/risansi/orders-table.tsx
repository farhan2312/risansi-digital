"use client";

import { Fragment, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronRight, Loader2, MessageSquare, Plus, Trash2 } from "lucide-react";
import { ClearanceBadge, OrderPopupHost, type PopupKind } from "./order-popups";
import { TermPis } from "./term-pis";
import { OrderThreadModal } from "./order-thread-modal";
import { OrderDetailsModal } from "./order-details-modal";
import { billModeLabel } from "@/lib/order-schema";
import { dispatchRowTone } from "@/lib/dept-view";
import { CLOSED, READY, assemblyView, planningText, reachedDepts, type ReachedDept } from "@/lib/order-row-view";
import type { DeptCell, ItemSummary, OrderListOptions, OrderListRow, SoDeptStatus } from "@/lib/orders";
import { deleteOrderAction } from "@/app/risansi/orders/actions";
import { UrlPagination, useUrlTable } from "./url-table";
import type { PageResult } from "@/lib/pagination";
import { AddOnForm } from "./add-on-form";
import { SortHeader } from "./sort-header";
import { OrderListFilterBar } from "./order-list-filter-bar";
import { isOrderListFiltered, parseOrderListFilter } from "@/lib/order-list-filter";

const numberFmt = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 });

function formatValue(value: string | null): string {
  if (value === null || value.trim() === "") return "—";
  const n = Number(value);
  return Number.isFinite(n) ? numberFmt.format(n) : value;
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

function cell(value: string | null): string {
  return value && value.trim() !== "" ? value : "—";
}

/**
 * The EC sub-table under an expanded SO. Columns follow the SO's order type:
 * a Spare carries no Pump Type / Series Version (matching the Spare Add-On
 * form), a Pump shows both. Dispatch status is deliberately not here — it's
 * an SO-level value shown once on the parent row.
 */
function ItemRows({
  orderId,
  items,
  orderType,
}: {
  orderId: string;
  items: ItemSummary[];
  orderType: string | null;
}) {
  if (items.length === 0) {
    return (
      <p className="px-4 py-3 text-sm text-muted">No EC items yet.</p>
    );
  }
  const isSpareSo = (orderType ?? "").trim().toLowerCase() === "spare";
  return (
    <div className="overflow-x-auto px-4 py-3">
      <table className="w-full min-w-[680px] text-sm">
        <thead>
          <tr className="text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            <th className="px-3 py-1.5">EC No.</th>
            <th className="px-3 py-1.5">EC Date</th>
            {!isSpareSo && <th className="px-3 py-1.5">Pump Type</th>}
            <th className="px-3 py-1.5">Model No.</th>
            <th className="px-3 py-1.5">Internal Model</th>
            <th className="px-3 py-1.5">Version</th>
            <th className="px-3 py-1.5">Qty</th>
            <th className="px-3 py-1.5" />
          </tr>
        </thead>
        <tbody>
          {items.map((it) => (
            <tr key={it.id} className="text-foreground">
              <td className="px-3 py-1.5 whitespace-nowrap font-medium">{cell(it.ec_no)}</td>
              <td className="px-3 py-1.5 whitespace-nowrap text-muted">
                {formatDate(it.ec_date)}
              </td>
              {!isSpareSo && <td className="px-3 py-1.5">{cell(it.pump_type)}</td>}
              <td className="px-3 py-1.5">{cell(it.model_no)}</td>
              <td className="px-3 py-1.5">{cell(it.internal_model)}</td>
              <td className="px-3 py-1.5">{cell(it.version)}</td>
              <td className="px-3 py-1.5 tabular-nums">{cell(it.quantity)}</td>
              <td className="px-3 py-1.5 whitespace-nowrap text-right">
                <Link
                  href={`/risansi/orders/${orderId}/items/${it.id}`}
                  className="inline-flex h-7 items-center gap-1 rounded-lg border border-input-border px-2.5 text-xs font-medium text-foreground transition-colors hover:bg-background"
                >
                  Open
                  <ChevronRight className="h-3 w-3" />
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const TEXT_TONE: Record<DeptCell["state"], string> = {
  done: "text-emerald-700 dark:text-emerald-400",
  pending: "text-foreground",
  na: "text-muted-foreground",
};

/** A status as text (no pill) that opens its department, with a line under it. */
function StatusText({ text, tone = "pending", line, onClick }: {
  text: string | null;
  tone?: DeptCell["state"];
  line?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title="Open"
      className="-m-1 flex flex-col items-start rounded-md p-1 text-left transition-colors hover:bg-background"
    >
      {text ? (
        <span className={`text-[13px] font-medium ${TEXT_TONE[tone]}`}>{text}</span>
      ) : (
        <span className="text-xs text-muted-foreground">—</span>
      )}
      {line && <span className="text-[11px] text-muted">{line}</span>}
    </button>
  );
}

/** The pop-up each department tag opens. */
const DEPT_POPUP: Record<ReachedDept["key"], PopupKind> = {
  drawing: { kind: "ec", dept: "drawing" },
  purchase: { kind: "ec", dept: "purchase" },
  quality: { kind: "ec", dept: "quality" },
  planning: { kind: "ec", dept: "planning" },
  assembly: { kind: "ec", dept: "assembly" },
  billing: { kind: "so", section: "order_billing", title: "Billing & Operations" },
  accounts: { kind: "so", section: "order_accounts", title: "Accounts" },
  dispatch: { kind: "so", section: "order_dispatch", title: "Dispatch" },
};

const TAG_TONE: Record<DeptCell["state"], string> = {
  done: "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300",
  pending: "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300",
  na: "border-transparent bg-slate-100 text-slate-500 dark:bg-white/10 dark:text-slate-400",
};

/** Central Visibility's clearance: Clear (the default), or Hold with its reason. */
export function ClearanceChip({ status, reason }: { status: string | null; reason: string | null }) {
  if (status === "Hold") {
    return (
      <span title={reason ?? undefined} className="inline-flex flex-col">
        <span className="inline-flex w-fit rounded-full bg-rose-50 px-2 py-0.5 text-xs font-medium text-rose-700">Hold</span>
        {reason && <span className="mt-0.5 text-[11px] text-muted">{reason}</span>}
      </span>
    );
  }
  return <span className="inline-flex rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">Clear</span>;
}

export function OrdersTable({
  result,
  canDelete = false,
  role,
  deptStatuses = {},
}: {
  // One server-fetched page; every filter and the paging ran in SQL.
  result: PageResult<OrderListRow> & { options: OrderListOptions };
  canDelete?: boolean;
  // The viewer's role — the department pop-ups on a row edit as it.
  role: string;
  // Where every department stands on each SO of the page, by SO id.
  deptStatuses?: Record<string, SoDeptStatus>;
}) {
  const orders = result.rows;
  const router = useRouter();
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [addFor, setAddFor] = useState<OrderListRow | null>(null);
  // The one department pop-up open, and the one discussion.
  const [popup, setPopup] = useState<{ order: OrderListRow; what: PopupKind } | null>(null);
  const [chatFor, setChatFor] = useState<OrderListRow | null>(null);
  const [detailsFor, setDetailsFor] = useState<OrderListRow | null>(null);
  // A Rep views the list; nothing on it changes anything.
  const readOnly = role === "rep";
  // The filter lives in the URL, so it narrows the whole table rather than
  // only the page already loaded.
  const { get: getParam } = useUrlTable();
  const filtered = isOrderListFiltered(
    parseOrderListFilter((key) => getParam(key) || undefined)
  );
  const pageRows = orders;
  // expand-toggle + 18 data columns + open/add-on + optional delete.
  const baseCols = 20;
  const colSpan = baseCols + (canDelete ? 1 : 0);
  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleDelete(order: OrderListRow) {
    const label = order.so_no ?? `#${order.sl_no}`;
    if (!confirm(`Delete SO ${label}? This permanently removes it and all its EC/department data.`)) {
      return;
    }
    setDeletingId(order.id);
    const res = await deleteOrderAction(order.id);
    setDeletingId(null);
    if (!res.ok) alert(res.error);
    else router.refresh();
  }

  // An empty table means one of two very different things — say which, so a
  // search that matched nothing isn't read as an empty tracker.
  const emptyMessage = filtered ? "No orders match these filters." : "No orders yet.";

  return (
    <div>
      <OrderListFilterBar options={result.options} total={result.total} noDispatchTarget />

      <div className="rounded-xl border border-card-border bg-surface shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1700px] text-sm">
            <thead>
              <tr className="border-b border-card-border text-left text-xs font-semibold uppercase tracking-wide text-muted">
                <th className="w-8 px-2 py-3" />
                <th className="px-4 py-3"><SortHeader label="Sl. No." sortKey="sl" /></th>
                <th className="px-4 py-3">SO No.</th>
                <th className="px-4 py-3"><SortHeader label="SO Date" sortKey="so_date" /></th>
                <th className="px-3 py-3">Chat</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Client Name</th>
                <th className="px-4 py-3">Client Code</th>
                <th className="px-4 py-3">Rep</th>
                <th className="px-4 py-3">Zone</th>
                <th className="px-4 py-3">Bill Mode</th>
                <th className="px-4 py-3 text-right">Order Value</th>
                <th className="px-4 py-3">Departments</th>
                <th className="px-4 py-3">Payment terms, PIs &amp; payment</th>
                <th className="px-4 py-3 whitespace-nowrap"><SortHeader label="Readiness Date" sortKey="readiness" /></th>
                <th className="px-4 py-3">Planning</th>
                <th className="px-4 py-3">Assembly &amp; Packing</th>
                <th className="px-4 py-3">Dispatch</th>
                <th className="px-4 py-3 text-center normal-case"><SortHeader label="ECs" sortKey="ecs" /></th>
                <th className="px-4 py-3" />
                {canDelete && <th className="px-4 py-3" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-card-border">
              {pageRows.length === 0 && (
                <tr>
                  <td colSpan={colSpan} className="px-4 py-10 text-center text-sm text-muted">
                    {emptyMessage}
                  </td>
                </tr>
              )}
              {pageRows.map((order) => {
                const isOpen = expanded.has(order.id);
                const orderPage = `/risansi/orders/${order.id}`;
                const status = deptStatuses[order.id];
                const soLabel = order.so_no ?? `#${order.sl_no}`;
                const planning = planningText(order, status);
                const { cell: assembly, text: assemblyText, line: assemblyLine } = assemblyView(order, status, formatDate);
                const dispatch = order.dispatch_status || "Pending";
                // A cancelled or diverted SO is nobody's work: no departments, no progress.
                const closed = CLOSED.includes(dispatch);
                return (
                  <Fragment key={order.id}>
                    {/* A click on the row opens its Order details; the chevron
                        shows its ECs; every other control does its own job. */}
                    <tr
                      onClick={() => setDetailsFor(order)}
                      // Every cell starts at the top, so the row reads straight across;
                      // a cancelled or diverted SO is red end to end.
                      className={`cursor-pointer align-top text-foreground transition-colors ${
                        closed
                          ? "bg-rose-50 hover:bg-rose-100 dark:bg-rose-500/15 dark:hover:bg-rose-500/20"
                          : (dispatchRowTone({ dispatch_status: dispatch }) ?? "hover:bg-background/60")
                      }`}
                    >
                      <td className="px-2 py-3 text-center" onClick={(e) => e.stopPropagation()}>
                        <button
                          type="button"
                          onClick={() => toggle(order.id)}
                          aria-label={isOpen ? "Hide ECs" : "Show ECs"}
                          aria-expanded={isOpen}
                          className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-input-border text-muted-foreground transition-colors hover:bg-background"
                        >
                          {isOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                        </button>
                      </td>
                      <td className="px-4 py-3 font-medium tabular-nums">{order.sl_no}</td>
                      {/* The SO and its holds; Clear / Hold is changed from the badge. */}
                      <td className="px-4 py-3 whitespace-nowrap align-top">
                        <div className="font-medium">{cell(order.so_no)}</div>
                        <span onClick={(e) => e.stopPropagation()}>
                          <ClearanceBadge order={order as unknown as Record<string, unknown>} readOnly={readOnly} />
                        </span>
                        {order.accounts_hold_status === "Hold" && (
                          <span
                            title={[order.accounts_hold_reason, order.accounts_hold_remarks].filter(Boolean).join(" — ")}
                            className="mt-1 flex w-fit max-w-[12rem] flex-col rounded-md bg-rose-50 px-1.5 py-0.5 text-[11px] leading-tight text-rose-700 dark:bg-rose-500/10 dark:text-rose-300"
                          >
                            <span className="font-semibold">Accounts hold</span>
                            {order.accounts_hold_reason && <span className="whitespace-normal">{order.accounts_hold_reason}</span>}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-muted">{formatDate(order.so_date)}</td>
                      <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
                        <button
                          type="button"
                          onClick={() => setChatFor(order)}
                          aria-label={`Discussion for SO ${soLabel}`}
                          title="Discussion"
                          className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-input-border text-foreground transition-colors hover:bg-background"
                        >
                          <MessageSquare className="h-3.5 w-3.5" />
                        </button>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">{cell(order.order_type)}</td>
                      <td className="min-w-[14rem] px-4 py-3">{cell(order.client_name)}</td>
                      <td className="px-4 py-3 whitespace-nowrap">{cell(order.client_code)}</td>
                      <td className="px-4 py-3">{cell(order.reps)}</td>
                      <td className="px-4 py-3 whitespace-nowrap">{cell(order.zone)}</td>
                      <td className="px-4 py-3 whitespace-nowrap">{billModeLabel(order.bill_mode, order.bill_type) || "—"}</td>
                      <td className="px-4 py-3 text-right tabular-nums whitespace-nowrap">
                        {/* With its unit; a USD order shows its INR figure beneath. */}
                        {order.order_value ? (
                          <>
                            {formatValue(order.order_value)}{" "}
                            <span className="text-xs text-muted">{order.order_currency || "INR"}</span>
                            {(order.order_currency ?? "INR").toUpperCase() !== "INR" && order.order_value_inr && (
                              <div className="text-xs text-muted">{formatValue(order.order_value_inr)} INR</div>
                            )}
                          </>
                        ) : (
                          "—"
                        )}
                      </td>
                      {/* The departments the SO has reached, each opening its pop-up. */}
                      <td className="px-4 py-3 align-top" onClick={(e) => e.stopPropagation()}>
                        <div className="flex min-w-[12rem] max-w-[18rem] flex-wrap gap-1">
                          {closed && (
                            <span className="inline-flex rounded-md bg-slate-100 px-1.5 py-0.5 text-[11px] font-semibold text-slate-600 dark:bg-white/10 dark:text-slate-300">
                              {dispatch}
                            </span>
                          )}
                          {!closed && reachedDepts(order, status).map((t) => (
                            <button
                              key={t.key}
                              type="button"
                              onClick={() => setPopup({ order, what: DEPT_POPUP[t.key] })}
                              title={`${t.name}: ${t.cell.label} — open`}
                              className={`inline-flex max-w-[12rem] items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] leading-tight transition-opacity hover:opacity-80 ${TAG_TONE[t.cell.state]}`}
                            >
                              <span className="font-semibold">{t.name}</span>
                              <span className="truncate">{t.cell.label}</span>
                            </button>
                          ))}
                        </div>
                      </td>
                      {/* Each term with its PI and what came in — as Accounts sees it. */}
                      <td className="px-4 py-3 align-top" onClick={(e) => e.stopPropagation()}>
                        <TermPis
                          orderId={order.id}
                          soLabel={soLabel}
                          terms={order.term_lines ?? []}
                          pis={order.pi_docs ?? []}
                          canEdit={false}
                          payments={{ canEdit: false }}
                        />
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap align-top text-muted">
                        {!closed && order.readiness_from
                          ? order.readiness_to && order.readiness_to !== order.readiness_from
                            ? `${formatDate(order.readiness_from)} – ${formatDate(order.readiness_to)}`
                            : formatDate(order.readiness_from)
                          : "—"}
                      </td>
                      <td className="px-4 py-3 align-top" onClick={(e) => e.stopPropagation()}>
                        <StatusText
                          text={closed ? null : planning}
                          tone={planning && READY.includes(planning.toLowerCase()) ? "done" : "pending"}
                          onClick={() => setPopup({ order, what: { kind: "ec", dept: "planning" } })}
                        />
                      </td>
                      <td className="px-4 py-3 align-top" onClick={(e) => e.stopPropagation()}>
                        <StatusText
                          text={closed ? null : assemblyText}
                          tone={assembly?.state ?? "pending"}
                          line={closed ? undefined : assemblyLine}
                          onClick={() => setPopup({ order, what: { kind: "ec", dept: "assembly" } })}
                        />
                      </td>
                      <td className="px-4 py-3 align-top" onClick={(e) => e.stopPropagation()}>
                        <StatusText
                          text={dispatch}
                          tone={closed ? "na" : dispatch.toLowerCase() === "pending" ? "pending" : "done"}
                          onClick={() => setPopup({ order, what: { kind: "so", section: "order_dispatch", title: "Dispatch" } })}
                        />
                      </td>
                      <td className="px-4 py-3 text-center tabular-nums">{order.ec_count}</td>
                      <td
                        className="px-4 py-3 whitespace-nowrap"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div className="flex items-center gap-2">
                          <Link
                            href={orderPage}
                            className="inline-flex h-8 items-center rounded-lg border border-primary/40 bg-primary/10 px-3 text-xs font-semibold text-primary transition-colors hover:border-primary hover:bg-primary hover:text-primary-foreground"
                          >
                            Open
                          </Link>
                          {canDelete && (
                            <button
                              type="button"
                              onClick={() => setAddFor(order)}
                              aria-label={`${order.order_type ?? "Pump"} Add-On`}
                              title={`${order.order_type ?? "Pump"} Add-On`}
                              className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground transition-colors hover:bg-primary-hover"
                            >
                              <Plus className="h-4 w-4" />
                            </button>
                          )}
                        </div>
                      </td>
                      {canDelete && (
                        <td
                          className="px-4 py-3 text-right"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <button
                            type="button"
                            onClick={() => handleDelete(order)}
                            disabled={deletingId === order.id}
                            aria-label="Delete order"
                            className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-rose-200 text-rose-600 transition-colors hover:bg-rose-50 disabled:opacity-50"
                          >
                            {deletingId === order.id ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Trash2 className="h-4 w-4" />
                            )}
                          </button>
                        </td>
                      )}
                    </tr>
                    {isOpen && (
                      <tr className="bg-background/40">
                        <td colSpan={colSpan} className="p-0">
                          <ItemRows orderId={order.id} items={order.items ?? []} orderType={order.order_type} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
        <UrlPagination
          page={result.page}
          totalPages={result.totalPages}
          from={result.from}
          to={result.to}
          total={result.total}
        />
      </div>

      {popup && (
        <OrderPopupHost
          orderId={popup.order.id}
          soLabel={popup.order.so_no ?? `#${popup.order.sl_no}`}
          role={role}
          what={popup.what}
          version={result}
          onClose={() => setPopup(null)}
        />
      )}
      {detailsFor && (
        <OrderDetailsModal
          orderId={detailsFor.id}
          onClose={() => setDetailsFor(null)}
          addOnLabel={canDelete ? `${detailsFor.order_type ?? "Pump"} Add-On` : undefined}
          onAddOn={() => {
            const order = detailsFor;
            setDetailsFor(null);
            setAddFor(order);
          }}
          onEdit={readOnly ? undefined : () => {
            const order = detailsFor;
            setDetailsFor(null);
            setPopup({ order, what: { kind: "so", section: "orders", title: "Order details" } });
          }}
        />
      )}
      {chatFor && (
        <OrderThreadModal
          orderId={chatFor.id}
          role={role}
          soLabel={chatFor.so_no ?? String(chatFor.sl_no)}
          onClose={() => setChatFor(null)}
        />
      )}
      {addFor && (
        <AddOnForm
          orderId={addFor.id}
          soLabel={addFor.so_no ?? `#${addFor.sl_no}`}
          // Without this the modal always fell back to the Pump form, even
          // when the button said "Spare Add-On".
          orderType={addFor.order_type}
          boiFlag={addFor.boi}
          onClose={() => setAddFor(null)}
        />
      )}
    </div>
  );
}
