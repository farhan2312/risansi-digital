"use client";

import { Fragment, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Layers, Loader2, MessageSquare, Plus, Trash2 } from "lucide-react";
import { ClearanceBadge, OrderPopupHost, type PopupKind } from "./order-popups";
import { OmHoldChip } from "./om-hold";
import { TermPis } from "./term-pis";
import { OrderThreadModal } from "./order-thread-modal";
import { OrderDetailsModal } from "./order-details-modal";
import { billModeLabel } from "@/lib/order-schema";
import { dispatchRowTone } from "@/lib/dept-view";
import { canManageEcs, isCentral, isReadOnlyViewer } from "@/lib/roles";
import { READY_LOT_LIMIT } from "@/lib/order-schema";
import { PACKED_FOR, PACKING_IN_PROGRESS, type SoLot } from "@/lib/ready-lots";
import { ReadyLotHistoryButton } from "./ready-lot-history";
import { PackingPlanHistoryButton } from "./packing-plan-history";
import { CLOSED, READY, assemblyView, planningText, reachedDepts, type ReachedDept } from "@/lib/order-row-view";
import type { DeptCell, OrderListOptions, OrderListRow, SoDeptStatus } from "@/lib/orders";
import { deleteItemAction, deleteOrderAction, getOrderEcsAction } from "@/app/risansi/orders/actions";
import { OmEcsModal } from "./om-ecs-modal";
import { UrlPagination, useUrlTable } from "./url-table";
import type { PageResult } from "@/lib/pagination";
import { AddOnForm } from "./add-on-form";
import { SortHeader } from "./sort-header";
import { OrderListFilterBar } from "./order-list-filter-bar";
import { KpiStrip } from "./kpi-strip";
import type { KpiCard } from "@/lib/kpis";
import { isOrderListFiltered, ordersKind, parseOrderListFilter } from "@/lib/order-list-filter";
import type { PumpSummary } from "@/lib/pump-summary";
import { PumpLeadCells, PumpLeadGroupHeads, PumpLeadSubHeads, PumpTailCells } from "./pump-dept-cells";

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
 * An SO's ECs in a pop-up, opened from the button at the start of its row:
 * Order Making's EC pop-up — every EC as a button, the one picked in full
 * with its BOI items — where those who manage ECs add, edit and delete them.
 */
function EcsPopup({ order, canManage, onClose }: { order: OrderListRow; canManage: boolean; onClose: () => void }) {
  const router = useRouter();
  const [data, setData] = useState<{ order: Record<string, unknown>; items: Record<string, unknown>[] } | null>(null);
  const [failed, setFailed] = useState(false);
  // Read again after an EC is added, edited or deleted.
  const [version, setVersion] = useState(0);
  const [form, setForm] = useState<{ item: Record<string, unknown> | null } | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    getOrderEcsAction(order.id)
      .then((r) => live && (r ? setData(r) : setFailed(true)))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [order.id, version]);

  async function remove(item: Record<string, unknown>) {
    const ec = String(item.ec_no ?? "") || "this EC";
    if (!confirm(`Delete ${ec}? This removes the EC and all its department data.`)) return;
    setDeletingId(String(item.id));
    const res = await deleteItemAction(String(item.id));
    setDeletingId(null);
    if (!res.ok) alert(res.error);
    else {
      setVersion((v) => v + 1);
      router.refresh();
    }
  }

  if (!data) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
        <div className="flex items-center gap-2 rounded-xl bg-surface px-5 py-4 text-sm text-muted shadow-xl">
          {failed ? "Could not load the ECs." : (<><Loader2 className="h-4 w-4 animate-spin" /> Loading ECs…</>)}
        </div>
      </div>
    );
  }
  return (
    <>
      <OmEcsModal
        order={data.order}
        items={data.items}
        canManage={canManage}
        deletingId={deletingId}
        onAdd={() => setForm({ item: null })}
        onEdit={(item) => setForm({ item })}
        onDelete={remove}
        onClose={onClose}
      />
      {form && (
        <AddOnForm
          orderId={order.id}
          soLabel={order.so_no ?? `#${order.sl_no}`}
          orderType={(data.order.order_type as string | null) ?? null}
          boiFlag={(data.order.boi as string | null) ?? null}
          item={form.item}
          onClose={() => {
            setForm(null);
            setVersion((v) => v + 1);
          }}
        />
      )}
    </>
  );
}

const TEXT_TONE: Record<DeptCell["state"], string> = {
  done: "text-emerald-700 dark:text-emerald-400",
  pending: "text-foreground",
  na: "text-muted-foreground",
};

/** A status as text (no pill) that opens its department, with a line under it. */
function StatusText({ text, tone = "pending", line, hold = false, onClick }: {
  text: string | null;
  tone?: DeptCell["state"];
  line?: string;
  /** Central Visibility holds the SO: it reads Hold. */
  hold?: boolean;
  onClick: () => void;
}) {
  if (hold) {
    return (
      <button type="button" onClick={onClick} title="On hold — open" className="-m-1 flex flex-col items-start rounded-md p-1 text-left transition-colors hover:bg-background">
        <span className="text-[13px] font-medium text-rose-700 dark:text-rose-400">Hold</span>
      </button>
    );
  }
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

/** Lot 1 to n: one column each under Planning and under Assembly & Packing. */
const LOT_COLUMNS = Array.from({ length: READY_LOT_LIMIT }, (_, i) => i + 1);

function LotButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title="Open"
      className="-m-1 flex flex-col items-start rounded-md p-1 text-left transition-colors hover:bg-background"
    >
      {children}
    </button>
  );
}

/** Planning's half of a lot: its readiness status and date. */
function PlanningLotCell({ lot, onClick }: { lot: SoLot | undefined; onClick: () => void }) {
  if (!lot) return <span className="text-xs text-muted-foreground">—</span>;
  return (
    <LotButton onClick={onClick}>
      <span className={`text-[13px] font-medium ${lot.status === "Fully ready" ? TEXT_TONE.done : TEXT_TONE.pending}`}>
        {lot.status || "—"}
      </span>
      <span className="text-[11px] text-muted">Ready {formatDate(lot.ready_date)}</span>
      {lot.differ && <span className="text-[11px] font-medium text-amber-700">ECs differ</span>}
    </LotButton>
  );
}

/**
 * Assembly & Packing's half of a lot: packed, and on which slip; or its
 * packing plan, red once that date has passed unpacked; or In Progress.
 */
function PackingLotCell({ lot, today, onClick }: { lot: SoLot | undefined; today: string; onClick: () => void }) {
  if (!lot) return <span className="text-xs text-muted-foreground">—</span>;
  if (lot.packed_date) {
    return (
      <LotButton onClick={onClick}>
        <span className={`text-[13px] font-medium ${TEXT_TONE.done}`}>
          {PACKED_FOR[lot.status ?? ""] ?? "Packed"} {formatDate(lot.packed_date)}
        </span>
        {lot.slips.length > 0 ? (
          <span className="text-[11px] text-muted">{lot.slips.join(", ")}</span>
        ) : (
          <span className="mt-0.5 w-fit rounded bg-rose-50 px-1 text-[10.5px] font-semibold text-rose-700">No slip</span>
        )}
      </LotButton>
    );
  }
  const plan = lot.packing_plan_date;
  const late = !!plan && plan < today;
  const extras = [lot.packing_shift, lot.pdi ? `PDI ${lot.pdi}` : ""].filter(Boolean).join(" · ");
  return (
    <LotButton onClick={onClick}>
      {plan ? (
        <span className={`text-[13px] font-medium ${late ? "text-rose-600" : "text-foreground"}`}>
          Pack {formatDate(plan)}
        </span>
      ) : (
        <span className="text-[13px] font-medium text-amber-700">{PACKING_IN_PROGRESS}</span>
      )}
      {(extras || late) && (
        <span className={`text-[11px] ${late ? "font-medium text-rose-600" : "text-muted"}`}>
          {[extras, late ? "overdue" : ""].filter(Boolean).join(" · ")}
        </span>
      )}
    </LotButton>
  );
}

/** The pop-up each department tag opens. */
const DEPT_POPUP: Record<ReachedDept["key"], PopupKind> = {
  drawing: { kind: "ec", dept: "drawing" },
  purchase: { kind: "ec", dept: "purchase" },
  quality: { kind: "ec", dept: "quality" },
  planning: { kind: "ec", dept: "planning" },
  assembly: { kind: "ec", dept: "assembly" },
  billing: { kind: "so", section: "order_billing", title: "Proforma Invoice" },
  accounts: { kind: "so", section: "order_accounts", title: "Accounts" },
  dispatch: { kind: "so", section: "order_dispatch", title: "Dispatch" },
};

const HOLD_TAG = "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300";
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

/** An SO's packing slips and dispatches (invoice, how it went, docket & LR), for the Orders list. */
export type SoDispatchDocs = { packing_slips: Record<string, unknown>[]; invoices: Record<string, unknown>[] };

const s = (v: unknown) => (v === null || v === undefined ? "" : String(v).trim());
const inr = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 });

/** One line of a docs cell: the main text, and a muted line under it. */
function DocLine({ main, sub, tone }: { main: string; sub?: string; tone?: "pending" | "muted" }) {
  return (
    <span className="block">
      <span className={`block whitespace-nowrap text-[13px] font-medium ${tone === "pending" ? "text-amber-700 dark:text-amber-400" : tone === "muted" ? "text-muted-foreground" : "text-foreground"}`}>{main}</span>
      {sub && <span className="block whitespace-nowrap text-[11px] text-muted">{sub}</span>}
    </span>
  );
}

/**
 * Packing Slips, Invoice, Dispatch, Docket & LR: one cell each, a line per
 * slip or per dispatch, opening the SO's Dispatch pop-up.
 */
function DispatchDocCells({ docs, onOpen }: { docs: SoDispatchDocs | undefined; onOpen: () => void }) {
  const slips = docs?.packing_slips ?? [];
  const invoices = docs?.invoices ?? [];
  const lots = (v: unknown) => (Array.isArray(v) && v.length ? (v as number[]).map((n) => `L${n}`).join("+") : "");
  const td = (first: boolean, children: React.ReactNode) => (
    <td className={`px-4 py-3 align-top ${first ? "border-l border-card-border" : ""}`} onClick={(e) => e.stopPropagation()}>
      <button type="button" onClick={onOpen} title="Open Dispatch" className="-m-1 flex flex-col items-start gap-1.5 rounded-md p-1 text-left transition-colors hover:bg-background">
        {children}
      </button>
    </td>
  );
  const none = <span className="text-xs text-muted-foreground">—</span>;
  return (
    <>
      {td(
        true,
        slips.length
          ? slips.map((p, i) => (
              <DocLine
                key={i}
                main={s(p.packing_slip_no) || "—"}
                sub={[formatDate(s(p.packing_slip_date) || null), s(p.quantity) && `Qty ${s(p.quantity)}`, lots(p.lot_nos)].filter((x) => x && x !== "—").join(" · ")}
                tone={s(p.invoice_id) ? undefined : "pending"}
              />
            ))
          : none
      )}
      {td(
        false,
        invoices.length
          ? invoices.map((v, i) => {
              const no = s(v.invoice_no) || s(v.challan_no);
              const date = s(v.invoice_date) || s(v.challan_date);
              const value = s(v.invoice_value) || s(v.challan_value);
              return no || date ? (
                <DocLine key={i} main={no || "—"} sub={[date ? formatDate(date.slice(0, 10)) : "", value && `₹${inr.format(Number(value))}`].filter(Boolean).join(" · ")} />
              ) : (
                <DocLine key={i} main="Invoice pending" tone="pending" />
              );
            })
          : none
      )}
      {td(
        false,
        invoices.length
          ? invoices.map((v, i) =>
              s(v.delivery_mode) ? (
                <DocLine key={i} main={s(v.delivery_mode)} sub={[s(v.transporter_name), s(v.courier_mode), s(v.vehicle_no)].filter(Boolean).join(" · ")} />
              ) : (
                <DocLine key={i} main="Dispatch pending" tone="pending" />
              )
            )
          : none
      )}
      {td(
        false,
        invoices.length
          ? invoices.map((v, i) =>
              s(v.docket_no) ? (
                <DocLine
                  key={i}
                  main={s(v.docket_no)}
                  sub={[s(v.booking_date) && `Booked ${formatDate(s(v.booking_date).slice(0, 10))}`, s(v.delivery_date) && `Delivered ${formatDate(s(v.delivery_date).slice(0, 10))}`, s(v.lr_link) ? "LR" : ""].filter(Boolean).join(" · ")}
                />
              ) : (
                <DocLine key={i} main={s(v.delivery_mode) ? "Docket pending" : "—"} tone={s(v.delivery_mode) ? "pending" : "muted"} />
              )
            )
          : none
      )}
    </>
  );
}

export function OrdersTable({
  result,
  canDelete = false,
  role,
  deptStatuses = {},
  pumpSummaries,
  dispatchDocs = {},
}: {
  /** Each SO's packing slips and dispatches, by SO id. */
  dispatchDocs?: Record<string, SoDispatchDocs>;
  /** The Pump view: each pump SO's standing in every department (lib/pump-summary). */
  pumpSummaries?: Record<string, PumpSummary>;
  // One server-fetched page; every filter and the paging ran in SQL.
  result: PageResult<OrderListRow> & { options: OrderListOptions; kpis?: KpiCard[] };
  canDelete?: boolean;
  // The viewer's role — the department pop-ups on a row edit as it.
  role: string;
  // Where every department stands on each SO of the page, by SO id.
  deptStatuses?: Record<string, SoDeptStatus>;
}) {
  const orders = result.rows;
  const router = useRouter();
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [ecsFor, setEcsFor] = useState<OrderListRow | null>(null);
  const [addFor, setAddFor] = useState<OrderListRow | null>(null);
  // The one department pop-up open, and the one discussion.
  const [popup, setPopup] = useState<{ order: OrderListRow; what: PopupKind } | null>(null);
  const [chatFor, setChatFor] = useState<OrderListRow | null>(null);
  const [detailsFor, setDetailsFor] = useState<OrderListRow | null>(null);
  // A Rep or Rep Manager views the list; nothing on it changes anything.
  // A Rep or CRM reads the list; they change nothing on it.
  const readOnly = isReadOnlyViewer(role);
  // The filter lives in the URL, so it narrows the whole table rather than
  // only the page already loaded.
  const { get: getParam } = useUrlTable();
  const filtered = isOrderListFiltered(
    parseOrderListFilter((key) => getParam(key) || undefined)
  );
  const pageRows = orders;
  // The Pump view: a column group per department (Drawing, Purchase, Quality,
  // Planning, Assembly & Packing) in place of Spare's lots by department.
  const pump = ordersKind(getParam("type")) === "pump" && !!pumpSummaries;
  // Its department columns: Drawing 4, Purchase 1, Quality 1, Planning 2 and
  // its lots, Assembly & Packing 3.
  const pumpDeptCols = 4 + 1 + 1 + 2 + LOT_COLUMNS.length + 3;
  // expand-toggle + 19 data columns (Planning and Assembly & Packing three lot
  // columns each) + open/add-on + optional delete. The Pump view has no Type,
  // Departments, Readiness or Packing Date column, and its department groups.
  // (+4: Packing Slips, Invoice, Dispatch, Docket & LR.)
  const baseCols = (pump ? 16 + pumpDeptCols : 25) + 4;
  // The readiness history is Planning's and Central's, as on the Planning page.
  const seesReadinessHistory = isCentral(role) || role === "planning";
  // Today in the browser's calendar, to mark a packing plan that has passed.
  const today = new Date().toLocaleDateString("en-CA");
  const colSpan = baseCols + (canDelete ? 1 : 0);

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
      {/* Spare or Pump, as a toggle in place of the Type filter. */}
      <OrderListFilterBar options={result.options} total={result.total} noDispatchTarget kindToggle={ordersKind(getParam("type"))} />
      <KpiStrip cards={result.kpis ?? []} />

      <div className="rounded-xl border border-card-border bg-surface shadow-sm">
        {/* The header row stays under the top bar as the page scrolls (AppShell). */}
        <div className="overflow-x-auto" data-sticky-head>
          <table className={`w-full ${pump ? "min-w-[2800px]" : "min-w-[2150px]"} text-sm`}>
            <thead className="relative z-10 bg-surface data-[stuck=1]:shadow-[0_2px_6px_-2px_rgba(0,0,0,0.18)] [&_th]:bg-surface">
              <tr className="text-left text-xs font-semibold uppercase tracking-wide text-muted">
                <th rowSpan={2} className="w-8 px-2 py-3" />
                <th rowSpan={2} className="px-4 py-3"><SortHeader label="Sl. No." sortKey="sl" /></th>
                <th rowSpan={2} className="px-4 py-3">SO No.</th>
                <th rowSpan={2} className="px-4 py-3"><SortHeader label="SO Date" sortKey="so_date" /></th>
                <th rowSpan={2} className="px-3 py-3">Chat</th>
                {!pump && <th rowSpan={2} className="px-4 py-3">Type</th>}
                <th rowSpan={2} className="px-4 py-3">Client Name</th>
                <th rowSpan={2} className="px-4 py-3">Client Code</th>
                <th rowSpan={2} className="px-4 py-3"><SortHeader label="Rep" sortKey="rep" /></th>
                <th rowSpan={2} className="px-4 py-3">Zone</th>
                <th rowSpan={2} className="px-4 py-3">Bill Mode</th>
                <th rowSpan={2} className="px-4 py-3 text-right">Order Value</th>
                <th rowSpan={2} className="px-4 py-3">Departments</th>
                <th rowSpan={2} className="px-4 py-3">Payment terms, PIs &amp; payment</th>
                {pump ? (
                  // A pump SO: each department's own columns.
                  <PumpLeadGroupHeads lotCount={LOT_COLUMNS.length} />
                ) : (
                  <>
                    <th rowSpan={2} className="px-4 py-3 whitespace-nowrap"><SortHeader label="Readiness Date" sortKey="readiness" /></th>
                    {/* Assembly & Packing's planned packing date: the SO's next among its unpacked lots. */}
                    <th rowSpan={2} className="px-4 py-3 whitespace-nowrap"><SortHeader label="Packing Date" sortKey="packing" /></th>
                    {/* A Spare's readiness lots, one column each, under each department. */}
                    <th colSpan={LOT_COLUMNS.length} className="border-l border-card-border px-4 pt-3 pb-1 text-center">Planning</th>
                    <th colSpan={LOT_COLUMNS.length} className="border-l border-card-border px-4 pt-3 pb-1 text-center">Assembly &amp; Packing</th>
                  </>
                )}
                <th rowSpan={2} className="border-l border-card-border px-4 py-3 whitespace-nowrap">Packing Slips</th>
                <th rowSpan={2} className="px-4 py-3">Invoice</th>
                <th rowSpan={2} className="px-4 py-3">Dispatch</th>
                <th rowSpan={2} className="px-4 py-3 whitespace-nowrap">Docket &amp; LR</th>
                <th rowSpan={2} className="border-l border-card-border px-4 py-3 whitespace-nowrap">Dispatch Status</th>
                <th rowSpan={2} className="px-4 py-3 text-center normal-case"><SortHeader label="ECs" sortKey="ecs" /></th>
                <th rowSpan={2} className="px-4 py-3" />
                {canDelete && <th rowSpan={2} className="px-4 py-3" />}
              </tr>
              <tr className="border-b border-card-border text-left text-[11px] font-semibold uppercase tracking-wide text-muted">
                {pump ? (
                  <PumpLeadSubHeads lotCount={LOT_COLUMNS.length} />
                ) : (
                  <>
                    {LOT_COLUMNS.map((n) => (
                      <th key={`p${n}`} className={`px-4 pb-2 whitespace-nowrap ${n === 1 ? "border-l border-card-border" : ""}`}>Lot {n}</th>
                    ))}
                    {LOT_COLUMNS.map((n) => (
                      <th key={`a${n}`} className={`px-4 pb-2 whitespace-nowrap ${n === 1 ? "border-l border-card-border" : ""}`}>Lot {n}</th>
                    ))}
                  </>
                )}
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
                const orderPage = `/risansi/orders/${order.id}`;
                const status = deptStatuses[order.id];
                const soLabel = order.so_no ?? `#${order.sl_no}`;
                const planning = planningText(order, status);
                const { cell: assembly, text: assemblyText, line: assemblyLine } = assemblyView(order, status, formatDate);
                const dispatch = order.dispatch_status || "Pending";
                // A cancelled or diverted SO is nobody's work: no departments, no progress.
                const closed = CLOSED.includes(dispatch);
                // Central Visibility holds it: every department reads Hold until cleared.
                const held = !closed && order.clearance_status === "Hold";
                const lots = order.lots ?? [];
                const hasLots = lots.length > 0;
                const planDate =
                  order.packing_plan?.date ??
                  lots.reduce<string | null>(
                    (latest, l) => (l.packing_plan_date && (!latest || l.packing_plan_date > latest) ? l.packing_plan_date : latest),
                    null
                  );
                return (
                  <Fragment key={order.id}>
                    {/* A click on the row opens its Order details; the first
                        button its ECs; every other control does its own job. */}
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
                          onClick={() => setEcsFor(order)}
                          aria-label="Show ECs"
                          title={`ECs (${(order.items ?? []).length})`}
                          className="inline-flex h-6 min-w-6 items-center justify-center gap-0.5 rounded-md border border-input-border px-1 text-muted-foreground transition-colors hover:border-primary/40 hover:bg-primary/10 hover:text-primary"
                        >
                          <Layers className="h-3.5 w-3.5" />
                          {(order.items ?? []).length > 0 && (
                            <span className="text-[10px] font-semibold tabular-nums">{(order.items ?? []).length}</span>
                          )}
                        </button>
                      </td>
                      <td className="px-4 py-3 font-medium tabular-nums">{order.sl_no}</td>
                      {/* The SO and its holds; Clear / Hold is changed from the badge. */}
                      <td className="px-4 py-3 whitespace-nowrap align-top">
                        <div className="font-medium">{cell(order.so_no)}</div>
                        <span onClick={(e) => e.stopPropagation()}>
                          <ClearanceBadge order={order as unknown as Record<string, unknown>} readOnly={readOnly} />
                          {/* Held by Order Making: no department has it yet. */}
                          <OmHoldChip order={order as unknown as Record<string, unknown>} />
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
                      {!pump && <td className="px-4 py-3 whitespace-nowrap">{cell(order.order_type)}</td>}
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
                      {(
                      <td className="px-4 py-3 align-top" onClick={(e) => e.stopPropagation()}>
                        <div className="flex min-w-[12rem] max-w-[18rem] flex-wrap gap-1">
                          {closed && (
                            <span className="inline-flex rounded-md bg-slate-100 px-1.5 py-0.5 text-[11px] font-semibold text-slate-600 dark:bg-white/10 dark:text-slate-300">
                              {dispatch}
                            </span>
                          )}
                          {/* Sent to Billing alone: no department works on it. */}
                          {!closed && order.only_billing === "Yes" && (
                            <span
                              title={order.only_billing_remarks ?? undefined}
                              className="inline-flex rounded-md bg-violet-50 px-1.5 py-0.5 text-[11px] font-semibold text-violet-700 dark:bg-violet-500/10 dark:text-violet-300"
                            >
                              Only billing
                            </span>
                          )}
                          {!closed && order.only_billing !== "Yes" && reachedDepts(order, status).map((t) => (
                            <button
                              key={t.key}
                              type="button"
                              onClick={() => setPopup({ order, what: DEPT_POPUP[t.key] })}
                              title={`${t.name}: ${t.cell.label} — open`}
                              className={`inline-flex max-w-[12rem] items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] leading-tight transition-opacity hover:opacity-80 ${
                                t.cell.label === "Hold" ? HOLD_TAG : TAG_TONE[t.cell.state]
                              }`}
                            >
                              <span className="font-semibold">{t.name}</span>
                              <span className="truncate">{t.cell.label}</span>
                            </button>
                          ))}
                        </div>
                      </td>
                      )}
                      {/* Each term with its PI and what came in — as Accounts sees it. */}
                      <td className="px-4 py-3 align-top" onClick={(e) => e.stopPropagation()}>
                        {/* An FR order is a replacement: no payment terms to show. */}
                        {order.bill_mode === "FR" ? (
                          <span className="text-xs font-medium text-muted">Replacement · no payment terms</span>
                        ) : (
                          <TermPis
                            orderId={order.id}
                            soLabel={soLabel}
                            terms={order.term_lines ?? []}
                            pis={order.pi_docs ?? []}
                            canEdit={false}
                            payments={{ canEdit: false }}
                          />
                        )}
                      </td>
                      {order.only_billing === "Yes" ? (
                        // Sent to Billing alone: no department works on it, so no status across their columns.
                        <td
                          colSpan={pump ? pumpDeptCols : 2 + LOT_COLUMNS.length * 2}
                          className="border-l border-card-border px-4 py-3 align-top"
                          title={order.only_billing_remarks ?? undefined}
                        >
                          <span className="inline-flex rounded-md bg-violet-50 px-1.5 py-0.5 text-[11px] font-semibold text-violet-700 dark:bg-violet-500/10 dark:text-violet-300">
                            Only billing
                          </span>
                          <span className="ml-2 text-xs text-muted">No department works on this SO</span>
                        </td>
                      ) : pump ? (
                        // A pump SO, department by department; cancelled or diverted, nobody's work.
                        closed || !pumpSummaries?.[order.id] ? (
                          <td colSpan={pumpDeptCols} className="border-l border-card-border px-4 py-3 align-top text-xs text-muted-foreground">—</td>
                        ) : (
                          <>
                            <PumpLeadCells
                              s={pumpSummaries[order.id]}
                              today={today}
                              onOpen={(d) => setPopup({ order, what: DEPT_POPUP[d] })}
                            />
                            {hasLots ? (
                              LOT_COLUMNS.map((n) => (
                                <td key={`p${n}`} className="whitespace-nowrap px-4 py-3 align-top" onClick={(e) => e.stopPropagation()}>
                                  <PlanningLotCell
                                    lot={lots[n - 1]}
                                    onClick={() => setPopup({ order, what: { kind: "ec", dept: "planning" } })}
                                  />
                                </td>
                              ))
                            ) : (
                              <td colSpan={LOT_COLUMNS.length} className="px-4 py-3 align-top text-xs text-muted-foreground">No lots yet</td>
                            )}
                            <PumpTailCells
                              s={pumpSummaries[order.id]}
                              today={today}
                              onOpen={(d) => setPopup({ order, what: DEPT_POPUP[d] })}
                            />
                          </>
                        )
                      ) : (
                        <>
                          <td className="px-4 py-3 whitespace-nowrap align-top text-muted" onClick={(e) => e.stopPropagation()}>
                            {(() => {
                              const readiness =
                                !closed && order.readiness_from
                                  ? order.readiness_to && order.readiness_to !== order.readiness_from
                                    ? `${formatDate(order.readiness_from)} – ${formatDate(order.readiness_to)}`
                                    : formatDate(order.readiness_from)
                                  : "—";
                              // How the readiness dates moved: Planning and Central see it, as on Planning.
                              return seesReadinessHistory && !closed && (readiness !== "—" || hasLots) ? (
                                <ReadyLotHistoryButton
                                  orderId={order.id}
                                  label={readiness === "—" ? "History" : readiness}
                                  soLabel={soLabel}
                                />
                              ) : (
                                readiness
                              );
                            })()}
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap align-top text-muted" onClick={(e) => e.stopPropagation()}>
                            {/* Assembly & Packing's next planned packing date, and how it moved. */}
                            {/* Only the planned date: the next one among unpacked lots, or once all are
                                packed the last one planned. Packed or not is the lot columns' to say. */}
                            {!closed && planDate ? (
                              <>
                                <PackingPlanHistoryButton
                                  orderId={order.id}
                                  label={formatDate(planDate)}
                                  soLabel={soLabel}
                                />
                                {order.packing_plan?.shift && (
                                  <span className="block text-[11px] text-muted">{order.packing_plan.shift} shift</span>
                                )}
                              </>
                            ) : (
                              "—"
                            )}
                          </td>
                          {/* Planning and Assembly & Packing lot by lot for a Spare; the SO's own status otherwise. */}
                          {hasLots && !closed && !held ? (
                            LOT_COLUMNS.map((n) => (
                              <td
                                key={`p${n}`}
                                className={`px-4 py-3 align-top ${n === 1 ? "border-l border-card-border" : ""}`}
                                onClick={(e) => e.stopPropagation()}
                              >
                                <PlanningLotCell
                                  lot={lots[n - 1]}
                                  onClick={() => setPopup({ order, what: { kind: "ec", dept: "planning" } })}
                                />
                              </td>
                            ))
                          ) : (
                            <td colSpan={LOT_COLUMNS.length} className="border-l border-card-border px-4 py-3 align-top" onClick={(e) => e.stopPropagation()}>
                              <StatusText
                                hold={held}
                                text={closed ? null : planning}
                                tone={planning && READY.includes(planning.toLowerCase()) ? "done" : "pending"}
                                onClick={() => setPopup({ order, what: { kind: "ec", dept: "planning" } })}
                              />
                            </td>
                          )}
                          {hasLots && !closed && !held ? (
                            LOT_COLUMNS.map((n) => (
                              <td
                                key={`a${n}`}
                                className={`px-4 py-3 align-top ${n === 1 ? "border-l border-card-border" : ""}`}
                                onClick={(e) => e.stopPropagation()}
                              >
                                <PackingLotCell
                                  lot={lots[n - 1]}
                                  today={today}
                                  onClick={() => setPopup({ order, what: { kind: "ec", dept: "assembly" } })}
                                />
                              </td>
                            ))
                          ) : (
                            <td colSpan={LOT_COLUMNS.length} className="border-l border-card-border px-4 py-3 align-top" onClick={(e) => e.stopPropagation()}>
                              <StatusText
                                hold={held}
                                text={closed ? null : assemblyText}
                                tone={assembly?.state ?? "pending"}
                                line={closed ? undefined : assemblyLine}
                                onClick={() => setPopup({ order, what: { kind: "ec", dept: "assembly" } })}
                              />
                            </td>
                          )}
                        </>
                      )}
                      <DispatchDocCells
                        docs={dispatchDocs[order.id]}
                        onOpen={() => setPopup({ order, what: { kind: "so", section: "order_dispatch", title: "Dispatch" } })}
                      />
                      <td className="border-l border-card-border px-4 py-3 align-top" onClick={(e) => e.stopPropagation()}>
                        <StatusText
                          hold={held || dispatch === "Hold"}
                          text={order.only_billing === "Yes" && dispatch === "Pending" ? "—" : dispatch}
                          tone={closed || order.only_billing === "Yes" ? "na" : dispatch.toLowerCase() === "pending" ? "pending" : "done"}
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

      {ecsFor && <EcsPopup order={ecsFor} canManage={!readOnly && canManageEcs(role)} onClose={() => setEcsFor(null)} />}
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
            setPopup({ order, what: { kind: "so", section: "orders", title: "Order details", edit: true } });
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
