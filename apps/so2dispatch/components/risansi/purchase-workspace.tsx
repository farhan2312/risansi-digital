"use client";

import { Fragment, useEffect, useState } from "react";
import { ChevronDown, MessageSquare, Plus } from "lucide-react";
import type { PurchaseQueueRow } from "@/lib/orders";
import { BOI_ITEM_FIELDS } from "@/lib/order-schema";
import { isCentral } from "@/lib/roles";
import { OrderChildList } from "./order-children";
import { EcDrawingDocsButton } from "./drawing-docs";
import { SortHeader } from "./sort-header";
import { HoldBadge } from "./hold-badge";
import { dispatchRowTone } from "@/lib/dept-view";
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

function rowSearchText(o: PurchaseQueueRow): string {
  return [o.sl_no, o.so_no, o.ec_no].filter(Boolean).join(" ");
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
  drawingDocCounts = {},
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
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
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
    const row = rows.find((r) => r.id === openItemId);
    if (row && (row.boi ?? "") === "Yes") {
      const soKey = String(row.so_no ?? row.sl_no ?? "");
      if (soKey) setExpanded((prev) => new Set(prev).add(soKey));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openItemId]);

  const focusClass = useFocusRow([openItemId, focusOrderId], rows.length > 0);
  useConsumeFocusParam(queue.page);

  function toggle(key: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }


  // Group EC queue rows by SO so the workspace lists one row per SO with a
  // chevron to reveal the ECs and their per-EC "Manage" buttons.
  type SoGroup = { key: string; head: PurchaseQueueRow; ecs: PurchaseQueueRow[] };
  const soGroups: SoGroup[] = Array.from(
    pageRows.reduce((map, r) => {
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
          />
        ) : (
          <UrlSearchInput placeholder={"Search SO, EC…"} />
        )}
      </div>

      <div className="rounded-xl border border-card-border bg-surface shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-sm">
            <thead>
              <tr className="border-b border-card-border text-left text-xs font-semibold uppercase tracking-wide text-muted">
                <th className="w-8 px-2 py-3" />
                <th className="px-4 py-3"><SortHeader label="Sl." sortKey="sl" /></th>
                <th className="px-4 py-3">SO No.</th>
                <th className="px-4 py-3">Chat</th>
                <th className="px-4 py-3"><SortHeader label="SO Date" sortKey="so_date" /></th>
                <th className="px-4 py-3">Order Type</th>
                <th className="px-4 py-3">BOI</th>
                <th className="px-4 py-3">LD</th>
                <th className="px-4 py-3">LD Date</th>
                <th className="px-4 py-3">Purchase Target</th>
                <th className="px-4 py-3 text-center normal-case">ECs</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-card-border">
              {soGroups.length === 0 && (
                <tr>
                  <td colSpan={11} className="px-4 py-10 text-center text-sm text-muted">
                    {emptyMessage}
                  </td>
                </tr>
              )}
              {soGroups.map((g) => {
                const isOpen = expanded.has(g.key);
                const boiYes = (g.head.boi ?? "") === "Yes";
                return (
                  <Fragment key={g.key}>
                    <tr
                      data-focus-row={String(g.head.order_id)}
                      className={`text-foreground transition-colors ${
                        dispatchRowTone(g.head) ?? "hover:bg-background/60"
                      } ${focusClass(String(g.head.order_id))}`}
                    >
                      <td className="px-2 py-3 text-center">
                        <button
                          type="button"
                          onClick={() => toggle(g.key)}
                          aria-label={isOpen ? "Collapse" : "Expand"}
                          aria-expanded={isOpen}
                          className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-input-border text-muted-foreground transition-colors hover:bg-background"
                        >
                          {isOpen ? (
                            <ChevronDown className="h-3.5 w-3.5" />
                          ) : (
                            <Plus className="h-3.5 w-3.5" />
                          )}
                        </button>
                      </td>
                      <td className="px-4 py-3 font-medium tabular-nums">{g.head.sl_no}</td>
                      <td className="px-4 py-3 whitespace-nowrap">{g.head.so_no ?? "—"}
                        <HoldBadge order={g.head} />
                      </td>
                      <td className="px-4 py-3">
                        <button
                          type="button"
                          onClick={() =>
                            setThreadFor({ orderId: String(g.head.order_id), soLabel: g.head.so_no ?? String(g.head.sl_no) })
                          }
                          aria-label="Chat"
                          title="Chat"
                          className="relative inline-flex h-8 w-8 items-center justify-center rounded-lg border border-input-border text-foreground transition-colors hover:bg-background"
                        >
                          <MessageSquare className="h-3.5 w-3.5" />
                          {(unreadThreads[String(g.head.order_id)] ?? 0) > 0 && (
                            <span className="absolute -right-1.5 -top-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-600 px-1 text-[10px] font-bold text-white">
                              {unreadThreads[String(g.head.order_id)]}
                            </span>
                          )}
                        </button>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-muted">{formatDate(g.head.so_date)}</td>
                      <td className="px-4 py-3 whitespace-nowrap">{g.head.order_type ?? "—"}</td>
                      <td className="px-4 py-3">{g.head.boi ?? "—"}</td>
                      <td className="px-4 py-3">{g.head.ld ?? "—"}</td>
                      <td className="px-4 py-3 whitespace-nowrap text-muted">
                        {formatDate(g.head.ld_date)}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-muted">
                        {formatDate(g.head.purchase_target_date)}
                      </td>
                      <td className="px-4 py-3 text-center tabular-nums">
                        {g.ecs.length}
                      </td>
                    </tr>
                    {isOpen && (
                      <tr className="bg-background/40">
                        <td colSpan={11} className="p-0">
                          <div className="space-y-4 px-4 py-3">
                            {g.ecs.map((row) => (
                              <div
                                key={row.id}
                                data-focus-row={String(row.id)}
                                className={`rounded-lg border border-card-border bg-surface p-3 shadow-sm ${focusClass(
                                  String(row.id)
                                )}`}
                              >
                                <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-sm">
                                  <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-slate-600">
                                    EC · {row.ec_no ?? "—"}
                                  </span>
                                  <span className="ml-auto" />
                                  {/* Drawing documents shared with Purchase
                                      against this EC's revisions. */}
                                  <EcDrawingDocsButton
                                    itemId={String(row.id)}
                                    label={[row.so_no, row.ec_no].filter(Boolean).join(" · ")}
                                    count={drawingDocCounts[String(row.id)] ?? 0}
                                  />
                                  <DeptCompleteCheck
                                    scopeId={String(row.id)}
                                    dept="purchase"
                                    label={String(row.ec_no ?? row.id)}
                                    completion={completionFor(
                                      completions,
                                      "purchase",
                                      String(row.id),
                                      true
                                    )}
                                    canEdit={canEdit}
                                  />
                                </div>
                                {boiYes ? (
                                  // Central Visibility decides which items are
                                  // bought out and describes them; Purchase only
                                  // records the receipt date and remarks. So the
                                  // item/make fields are read-only here, and the
                                  // add and delete controls belong to Central.
                                  <OrderChildList
                                    orderId={row.id}
                                    table="order_boi_items"
                                    title="Bought-out items"
                                    fields={BOI_ITEM_FIELDS}
                                    rows={(row.boi_items ?? []) as Row[]}
                                    canEdit={canEdit}
                                    canEditCentral={isCentral(role)}
                                    canAdd={isCentral(role)}
                                    // Add every item first, then commit them
                                    // together — one Save for the whole list.
                                    bulkSave
                                  />
                                ) : (
                                  <p className="text-xs text-muted">
                                    No BOI — nothing to record for this EC.
                                  </p>
                                )}
                              </div>
                            ))}
                          </div>
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
          page={queue.page}
          totalPages={queue.totalPages}
          from={queue.from}
          to={queue.to}
          total={queue.total}
        />
      </div>

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
