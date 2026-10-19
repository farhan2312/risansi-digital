"use client";

import { Fragment, useEffect, useState } from "react";
import { History, MessageSquare, PackageSearch, X } from "lucide-react";
import type { PurchaseQueueRow } from "@/lib/orders";
import { isCentral } from "@/lib/roles";
import { BoiItemForm } from "./boi-item-form";
import { SortHeader } from "./sort-header";
import { HoldBadge } from "./hold-badge";
import { boiInHand, boiStatus, dispatchRowTone } from "@/lib/dept-view";
import { UrlPagination, UrlSearchInput, useUrlTable } from "./url-table";
import { OrderListFilterBar } from "./order-list-filter-bar";
import type { OrderListOptions } from "@/lib/orders";
import { DEPT_VIEWS } from "@/lib/dept-view";
import { useConsumeFocusParam, useFocusRow } from "./use-focus-row";
import type { PageResult } from "@/lib/pagination";
import { OrderThreadModal } from "./order-thread-modal";
import { completionFor, DeptCompleteCheck } from "./dept-complete-check";
import type { DeptCompletion } from "@/lib/dept-completion";

type Row = Record<string, unknown>;

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


export function PurchaseWorkspace({
  queue,
  canEdit,
  openItemId,
  openThreadId,
  focusOrderId,
  role,
  unreadThreads = {},
  completions = [],
  filterOptions,
}: {
  // One server-fetched page of SOs, with every EC of those SOs.
  queue: PageResult<PurchaseQueueRow>;
  canEdit: boolean;
  openItemId?: string;
  // Deep-link from the discussion icon: open this SO's thread on load.
  openThreadId?: string;
  // The SO a notification deep link resolved to — scrolled to and highlighted.
  focusOrderId?: string;
  // The viewer's role — decides which discussion lane they get.
  role: string;
  // Unread discussion messages keyed by order id, for the row badge.
  unreadThreads?: Record<string, number>;
  // Purchase's sign-offs for the SOs on this page.
  completions?: DeptCompletion[];
  // Facet values for the filter bar; omitted, the plain search box stays.
  filterOptions?: OrderListOptions;
  // Drawing documents shared with Purchase, per EC id.
  drawingDocCounts?: Record<string, number>;
}) {
  const rows = queue.rows;
  const { get: getParam } = useUrlTable();
  // An empty table means one of two very different things — say which, so a
  // search that matched nothing isn't read as an empty queue.
  const emptyMessage = getParam("q")
    ? "No orders match your search."
    : "No orders yet.";
  // The EC whose bought-out items are open in the pop-up.
  const [boiFor, setBoiFor] = useState<string | null>(null);
  // …and which of its items is shown (the first until another is picked).
  const [boiItem, setBoiItem] = useState<string | null>(null);
  // A bought-out item whose Vendor Expected Date history is open.
  const [historyFor, setHistoryFor] = useState<Row | null>(null);
  const [threadFor, setThreadFor] = useState<{
    orderId: string;
    soLabel: string;
  } | null>(null);

  // Deep link from the discussion icon: open that SO's thread on arrival.
  useEffect(() => {
    if (!openThreadId) return;
    const row = rows.find((r) => String(r.order_id) === openThreadId);
    if (!row) return;
    setThreadFor({
      orderId: openThreadId,
      soLabel: String(row.so_no ?? row.sl_no ?? ""),
    });
  }, [openThreadId, rows]);

  const pageRows = rows;

  useEffect(() => {
    if (!openItemId) return;
    // A notification about an EC opens its bought-out items.
    if (rows.some((r) => r.id === openItemId)) setBoiFor(openItemId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openItemId]);

  const focusClass = useFocusRow([openItemId, focusOrderId], rows.length > 0);
  useConsumeFocusParam(queue.page);



  // Group EC queue rows by SO so the workspace lists one row per SO with a
  // chevron to reveal the ECs and their per-EC "Manage" buttons.
  type SoGroup = { key: string; head: PurchaseQueueRow; ecs: PurchaseQueueRow[] };
  // Purchase is for pumps: a Spare EC has nothing bought out.
  const soGroups: SoGroup[] = Array.from(
    pageRows.filter((r) => String(r.item_type ?? "").trim().toLowerCase() !== "spare").reduce((map, r) => {
      const key = String(r.so_no ?? r.sl_no ?? "");
      const g = map.get(key);
      if (g) g.ecs.push(r);
      else map.set(key, { key, head: r, ecs: [r] });
      return map;
    }, new Map<string, SoGroup>())
  ).map(([, g]) => g);

  return (
    <div>
      <div className="mb-3">
        {/* The same filter bar the orders list carries, with this
            department pinned: its own statuses, its own target. */}
        {filterOptions && "purchase" ? (
          <OrderListFilterBar
            options={filterOptions}
            total={queue.total}
            dept={"purchase"}
            hasTarget={DEPT_VIEWS["purchase"].hasTarget}
            searchPlaceholder={"Search SO, EC…"}
            noTypeFilter
          />
        ) : (
          <UrlSearchInput placeholder={"Search SO, EC…"} />
        )}
      </div>

      <div className="rounded-xl border border-card-border bg-surface shadow-sm">
        {/* The header row stays under the top bar as the page scrolls (AppShell). */}
        <div className="overflow-x-auto" data-sticky-head>
          <table className="w-full min-w-[2200px] text-sm">
            <thead className="relative z-10 bg-surface data-[stuck=1]:shadow-[0_2px_6px_-2px_rgba(0,0,0,0.18)] [&_th]:bg-surface">
              <tr className="text-left text-xs font-semibold uppercase tracking-wide text-muted">
                <th colSpan={9} className="px-3 pt-2.5 pb-1">SO</th>
                <th colSpan={7} className="border-l border-card-border px-3 pt-2.5 pb-1 text-center">EC</th>
              </tr>
              <tr className="border-b border-card-border text-left text-[11px] font-semibold uppercase tracking-wide text-muted">
                <th className="px-3 py-2"><SortHeader label="Sl." sortKey="sl" /></th>
                <th className="px-3 py-2">SO No.</th>
                <th className="px-3 py-2">Chat</th>
                <th className="px-3 py-2"><SortHeader label="SO Date" sortKey="so_date" /></th>
                <th className="px-3 py-2">BOI</th>
                <th className="px-3 py-2">LD</th>
                <th className="px-3 py-2">LD Date</th>
                <th className="px-3 py-2 whitespace-nowrap">Purchase Target</th>
                <th className="px-3 py-2">SO Status</th>
                <th className="border-l border-card-border px-3 py-2">EC No.</th>
                <th className="px-3 py-2">EC Date</th>
                <th className="px-3 py-2">Pump Type</th>
                <th className="px-3 py-2">Model No.</th>
                <th className="px-3 py-2">EC Status</th>
                <th className="px-3 py-2">Bought-out items</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {soGroups.length === 0 && (
                <tr>
                  <td colSpan={16} className="px-4 py-10 text-center text-sm text-muted">
                    {emptyMessage}
                  </td>
                </tr>
              )}
              {soGroups.map((g) => {
                const span = g.ecs.length;
                const soCell = "px-3 py-2 align-top border-b border-card-border";
                // Closed once every EC with bought-out items has them all in hand.
                const ecStates = g.ecs.map(ecState);
                const soState = ecStates.every((s) => s === "na") ? "na" : ecStates.some((s) => s === "open") ? "open" : "closed";
                return (
                  <Fragment key={g.key}>
                    {g.ecs.map((row, k) => {
                      const last = k === g.ecs.length - 1;
                      const ecCell = `px-3 py-2 ${last ? "border-b border-card-border" : "border-b border-card-border/50"}`;
                      const items = (row.boi_items ?? []) as Row[];
                      const got = items.filter(boiInHand).length;
                      return (
                        <tr
                          key={row.id}
                          data-focus-row={String(row.id)}
                          className={`text-foreground ${dispatchRowTone(g.head) ?? "hover:bg-background/40"} ${focusClass(String(row.id))}`}
                        >
                          {k === 0 && (
                            <>
                              <td rowSpan={span} data-focus-row={String(g.head.order_id)} className={`${soCell} font-medium tabular-nums ${focusClass(String(g.head.order_id))}`}>
                                {g.head.sl_no}
                              </td>
                              <td rowSpan={span} className={`${soCell} whitespace-nowrap font-semibold`}>
                                {g.head.so_no ?? "—"}
                                <HoldBadge order={g.head} />
                              </td>
                              <td rowSpan={span} className={soCell}>
                                <button
                                  type="button"
                                  onClick={() =>
                                    setThreadFor({ orderId: String(g.head.order_id), soLabel: g.head.so_no ?? String(g.head.sl_no) })
                                  }
                                  aria-label="Chat"
                                  title="Chat"
                                  className="relative inline-flex h-7 w-7 items-center justify-center rounded-lg border border-input-border text-foreground transition-colors hover:bg-background"
                                >
                                  <MessageSquare className="h-3.5 w-3.5" />
                                  {(unreadThreads[String(g.head.order_id)] ?? 0) > 0 && (
                                    <span className="absolute -right-1.5 -top-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-600 px-1 text-[10px] font-bold text-white">
                                      {unreadThreads[String(g.head.order_id)]}
                                    </span>
                                  )}
                                </button>
                              </td>
                              <td rowSpan={span} className={`${soCell} whitespace-nowrap text-muted`}>{formatDate(g.head.so_date)}</td>
                              <td rowSpan={span} className={soCell}>{g.head.boi ?? "—"}</td>
                              <td rowSpan={span} className={soCell}>{g.head.ld ?? "—"}</td>
                              <td rowSpan={span} className={`${soCell} whitespace-nowrap text-muted`}>{formatDate(g.head.ld_date)}</td>
                              <td rowSpan={span} className={`${soCell} whitespace-nowrap text-muted`}>{formatDate(g.head.purchase_target_date)}</td>
                              <td rowSpan={span} className={soCell}>
                                <StateChip state={soState} />
                              </td>
                            </>
                          )}
                          <td className={`${ecCell} border-l border-card-border whitespace-nowrap font-semibold`}>{row.ec_no ?? "—"}</td>
                          <td className={`${ecCell} whitespace-nowrap text-muted`}>{formatDate(row.ec_date ?? null)}</td>
                          <td className={`${ecCell} whitespace-nowrap`}>{row.pump_type ?? "—"}</td>
                          <td className={`${ecCell} whitespace-nowrap`}>{row.model_no ?? "—"}</td>
                          <td className={ecCell}>
                            <StateChip state={ecState(row)} />
                            {items.length > 0 && (
                              <span className={`block text-[11px] font-semibold ${got === items.length ? "text-emerald-700" : "text-amber-700"}`}>
                                {got}/{items.length} in hand
                              </span>
                            )}
                          </td>
                          {/* Each item and where it stands, without opening anything. */}
                          <td className={ecCell}>
                            {items.length === 0 ? (
                              <span className="text-xs text-muted">{(row.ec_boi ?? "") === "Yes" ? "None listed" : "No BOI"}</span>
                            ) : (
                              <BoiDetailTable
                                items={items}
                                onHistory={(b) => setHistoryFor(b)}
                                onOpen={(b) => {
                                  setBoiFor(row.id);
                                  setBoiItem(String(b.id));
                                }}
                              />
                            )}
                          </td>
                          <td className={`${ecCell} whitespace-nowrap`}>
                            <span className="inline-flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => {
                                  setBoiFor(row.id);
                                  setBoiItem(null);
                                }}
                                className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-primary/40 bg-primary/10 px-3 text-xs font-semibold text-primary transition-colors hover:bg-primary hover:text-primary-foreground"
                              >
                                <PackageSearch className="h-3.5 w-3.5" />
                                BOI
                              </button>
                              <DeptCompleteCheck
                                scopeId={String(row.id)}
                                dept="purchase"
                                label={String(row.ec_no ?? row.id)}
                                completion={completionFor(completions, "purchase", String(row.id), true)}
                                canEdit={canEdit}
                              />
                            </span>
                          </td>
                        </tr>
                      );
                    })}
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

      {/* One EC's bought-out items, as cards to fill: the item, RIL stock, the vendor order. */}
      {(() => {
        const ec = boiFor ? rows.find((r) => r.id === boiFor) : null;
        if (!ec) return null;
        return (
          <div
            role="dialog"
            aria-modal="true"
            aria-label={`Bought-out items of ${ec.ec_no ?? "EC"}`}
            className="fixed inset-0 z-40 flex items-end justify-center bg-black/40 sm:items-center sm:p-6"
            onClick={() => {
              setBoiFor(null);
              setBoiItem(null);
            }}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              className="max-h-[92vh] w-full max-w-6xl overflow-y-auto rounded-t-2xl bg-surface p-5 shadow-xl sm:rounded-2xl"
            >
              <div className="mb-4 flex items-start justify-between gap-3">
                <div>
                  <h2 className="font-display text-lg font-semibold text-foreground">
                    Bought-out items · EC {ec.ec_no ?? "—"}
                  </h2>
                  <p className="text-xs text-muted">
                    {[ec.so_no, ec.pump_type, ec.model_no, ec.quantity != null ? `Qty ${ec.quantity}` : ""].filter(Boolean).join(" · ")}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setBoiFor(null)}
                  aria-label="Close"
                  className="rounded-lg p-1.5 text-muted transition-colors hover:bg-background hover:text-foreground"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              {(() => {
                const all = (ec.boi_items ?? []) as Row[];
                const shown = all.find((b) => String(b.id) === boiItem) ?? all[0];
                return (
                  <>
                    {all.length > 0 && (
                      <div role="tablist" aria-label="Bought-out items" className="mb-4 flex flex-wrap gap-2">
                        {all.map((b) => {
                          const on = shown && String(b.id) === String(shown.id);
                          return (
                            <button
                              key={String(b.id)}
                              type="button"
                              role="tab"
                              aria-selected={!!on}
                              onClick={() => setBoiItem(String(b.id))}
                              className={`inline-flex flex-col items-start rounded-lg border px-3 py-1.5 text-left transition-colors ${
                                on ? "border-primary bg-primary text-primary-foreground" : "border-input-border text-foreground hover:bg-background"
                              }`}
                            >
                              <span className="text-sm font-semibold">{boiName(b)}</span>
                              <span className={`text-[11px] ${on ? "text-primary-foreground/80" : "text-muted"}`}>
                                {boiStatus(b).label}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    )}
              {shown ? (
                <BoiItemForm
                  key={String(shown.id)}
                  item={shown}
                  ecId={ec.id}
                  canEdit={canEdit}
                  canEditItem={isCentral(role)}
                />
              ) : (
                <p className="text-sm text-muted">No bought-out items listed on this EC.</p>
              )}
                  </>
                );
              })()}
            </div>
          </div>
        );
      })()}

      {historyFor && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Vendor expected date history"
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-6"
          onClick={() => setHistoryFor(null)}
        >
          <div onClick={(e) => e.stopPropagation()} className="w-full max-w-md rounded-t-2xl bg-surface p-5 shadow-xl sm:rounded-2xl">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <h2 className="font-display text-base font-semibold text-foreground">Vendor expected date history</h2>
                <p className="text-xs text-muted">
                  {[boiName(historyFor), historyFor.vendor_name ? String(historyFor.vendor_name) : ""].filter(Boolean).join(" · ")}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setHistoryFor(null)}
                aria-label="Close"
                className="rounded-lg p-1.5 text-muted hover:bg-background hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <ExpectedHistory item={historyFor} />
          </div>
        </div>
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

/** Each change to a bought-out item's Vendor Expected Date: from, to, who and when. */
function ExpectedHistory({ item }: { item: Row }) {
  const events = (Array.isArray(item.expected_history) ? item.expected_history : []) as Row[];
  const day = (v: unknown) =>
    v ? new Date(String(v)).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "no date";
  if (events.length === 0) return <p className="text-xs text-muted">No changes yet.</p>;
  return (
    <ol className="space-y-1 text-xs">
      {events.map((e, i) => (
        <li key={i} className="flex flex-wrap gap-x-2">
          <span className="text-muted line-through">{day(e.prev)}</span>
          <span>→</span>
          <span className="font-semibold text-foreground">{day(e.next)}</span>
          <span className="text-muted">
            · {new Date(String(e.at)).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "numeric", minute: "2-digit" })}
            {e.by ? ` · ${String(e.by)}` : ""}
          </span>
        </li>
      ))}
    </ol>
  );
}

/**
 * An EC is Closed once every bought-out item it lists is in hand (RIL stock
 * plus what the vendor delivered); Open while any is not; N/A with none.
 */
function ecState(row: PurchaseQueueRow): "open" | "closed" | "na" {
  const items = (row.boi_items ?? []) as Row[];
  if (items.length === 0) return "na";
  return items.every(boiInHand) ? "closed" : "open";
}

function StateChip({ state }: { state: "open" | "closed" | "na" }) {
  const cls =
    state === "closed"
      ? "bg-emerald-50 text-emerald-700"
      : state === "open"
        ? "bg-amber-50 text-amber-700"
        : "bg-gray-100 text-gray-500";
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${cls}`}>
      {state === "closed" ? "Close" : state === "open" ? "Open" : "N/A"}
    </span>
  );
}

/** A bought-out item's name: the list's, or what Others was called. */
function boiName(b: Row): string {
  const item = String(b.boi_item ?? "").trim();
  return item === "Others" ? String(b.boi_item_other ?? "").trim() || "Others" : item || "Item";
}

/** An item's status as a tag: vendor order's, else RIL stock's (boiStatus). */
function BoiTag({ item }: { item: Row }) {
  const s = boiStatus(item);
  const cls =
    s.tone === "done" ? "bg-emerald-50 text-emerald-700" : s.tone === "part" ? "bg-sky-50 text-sky-700" : "bg-amber-50 text-amber-700";
  return <span className={`rounded-full px-1.5 text-[10px] font-semibold ${cls}`}>{s.label}</span>;
}

/**
 * Every bought-out item of an EC with all its details, on the front: the item,
 * RIL stock allocated, the vendor order and what has come in, and its status.
 * A row opens that item's form.
 */
function BoiDetailTable({
  items,
  onOpen,
  onHistory,
}: {
  items: Row[];
  onOpen: (b: Row) => void;
  onHistory: (b: Row) => void;
}) {
  const t = (v: unknown) => (v == null || String(v).trim() === "" ? "—" : String(v));
  const d = (v: unknown) => (v ? formatDate(String(v)) : "—");
  const money = (v: unknown) =>
    v == null || v === "" ? "—" : Number(v).toLocaleString("en-IN", { maximumFractionDigits: 2 });
  const head = [
    "Item", "Make", "Qty", "Description", "RIL Allocated", "Vendor", "RIL PO No.", "RIL PO Date",
    "Vendor SO No.", "Vendor SO Date", "Order Qty", "Expected", "Rate", "Total", "Recd Qty", "Recd Date", "Status",
  ];
  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="text-left text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          {head.map((h) => (
            <th key={h} className="whitespace-nowrap px-1.5 pb-1">{h}</th>
          ))}
        </tr>
      </thead>
      <tbody className="divide-y divide-card-border/60">
        {items.map((b) => {
          const vendor = b.vendor_order === "Yes";
          const v = (x: unknown) => (vendor ? x : null);
          return (
            <tr
              key={String(b.id)}
              onClick={() => onOpen(b)}
              title="Open this item"
              className="cursor-pointer align-top hover:bg-background"
            >
              <td className="whitespace-nowrap px-1.5 py-1 font-semibold text-foreground">{boiName(b)}</td>
              <td className="whitespace-nowrap px-1.5 py-1">{t(b.boi_make)}</td>
              <td className="px-1.5 py-1 tabular-nums">{t(b.boi_qty)}</td>
              <td className="max-w-[14rem] px-1.5 py-1 text-muted">{t(b.boi_description)}</td>
              <td className="px-1.5 py-1 tabular-nums">{t(b.stock_allocated_qty)}</td>
              <td className="whitespace-nowrap px-1.5 py-1">
                {vendor ? [b.vendor_code, b.vendor_name].filter((x) => x != null && String(x).trim()).join(" · ") || "—" : "No order"}
              </td>
              <td className="whitespace-nowrap px-1.5 py-1">{t(v(b.ril_po_no))}</td>
              <td className="whitespace-nowrap px-1.5 py-1">{d(v(b.ril_po_date))}</td>
              <td className="whitespace-nowrap px-1.5 py-1">{t(v(b.vendor_so_no))}</td>
              <td className="whitespace-nowrap px-1.5 py-1">{d(v(b.vendor_so_date))}</td>
              <td className="px-1.5 py-1 tabular-nums">{t(v(b.order_qty))}</td>
              <td className="whitespace-nowrap px-1.5 py-1">
                {d(v(b.expected_receipt_date))}
                {/* How the vendor's date has moved. */}
                {vendor && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onHistory(b);
                    }}
                    title={`Expected date history${Array.isArray(b.expected_history) && b.expected_history.length ? ` (${b.expected_history.length} change${b.expected_history.length === 1 ? "" : "s"})` : ""}`}
                    aria-label="Expected date history"
                    className="ml-1 inline-flex h-5 w-5 items-center justify-center rounded text-muted hover:bg-surface hover:text-primary"
                  >
                    <History className="h-3.5 w-3.5" />
                  </button>
                )}
              </td>
              <td className="px-1.5 py-1 tabular-nums">{money(v(b.rate_per_unit))}</td>
              <td className="px-1.5 py-1 tabular-nums">{money(v(b.total_value))}</td>
              <td className="px-1.5 py-1 tabular-nums">{t(v(b.received_qty))}</td>
              <td className="whitespace-nowrap px-1.5 py-1">{d(v(b.receipt_date))}</td>
              <td className="whitespace-nowrap px-1.5 py-1"><BoiTag item={b} /></td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
