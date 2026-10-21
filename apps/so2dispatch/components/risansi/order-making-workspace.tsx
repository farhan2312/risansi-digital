"use client";

import { KpiStrip } from "./kpi-strip";
import type { KpiCard } from "@/lib/kpis";
import { Fragment, useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, FileText, Loader2, MessageSquare, Pencil, Plus, UserRound, Users, X } from "lucide-react";
import { OrderThreadModal } from "./order-thread-modal";
import { OmHoldBadge } from "./om-hold";
import { canManageEcs } from "@/lib/roles";
import { AddOnForm } from "./add-on-form";
import { OmEcsModal } from "./om-ecs-modal";
import { DATE_PRESETS, presetRange } from "@/lib/order-list-filter";
import {
  BILL_MODE_FILTER_OPTIONS,
  OM_DATE_FIELDS,
  OM_FILTER_KEYS,
  isOrderMakingFiltered,
  UNASSIGNED,
  type OrderMakingFilter,
} from "@/lib/order-making-filter";
import type { SoMember, SoMemberSummary } from "@/lib/so-assignment";
import { assignSoAction } from "@/app/risansi/departments/order-making/actions";
import type { OrderListOptions } from "@/lib/orders";
import { SortHeader } from "./sort-header";
import { createOrderAction, deleteItemAction, updateOrderSectionAction } from "@/app/risansi/orders/actions";
import type { NewOrderInput } from "@/lib/orders";
import {
  ORDER_MAKING_EDITABLE,
  ORDER_MAKING_FIELDS,
  ORDER_MAKING_SO_EDITABLE,
  ORDER_TYPE_OPTIONS,
  SO_DETAIL_COLUMNS,
  dependsOnSatisfied,
  selectOptionsFor,
  withValueRules,
  type OrderField,
} from "@/lib/order-schema";
import type { OrderMakingRow } from "@/lib/orders";
import type { PageResult } from "@/lib/pagination";
import type { MarketIntellClient } from "@/lib/market-intell";
import { UrlPagination, UrlSearchInput, useUrlTable } from "./url-table";
import { MultiSelectFilter, SingleSelectFilter } from "./multi-select-filter";
import { ClientLookup } from "./client-lookup";
import { formatDisplay } from "./editable-section";

const str = (v: unknown) => (v === null || v === undefined ? "" : String(v));
const field = (column: string) => ORDER_MAKING_FIELDS.find((f) => f.column === column)!;

const inputClass =
  "h-10 w-full rounded-[10px] border border-input-border bg-surface px-3 text-[14px] text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-ring/20 disabled:cursor-not-allowed disabled:opacity-50";

/**
 * Order Making's list: every SO newest first with its Client and Purchase
 * Order details, how many of those are still blank, and an Edit that opens
 * just those fields. Nothing else of the SO is shown.
 */
export function OrderMakingWorkspace({
  queue,
  filter,
  options,
  canEdit,
  canCreate = canEdit,
  mode = "po",
  canAssign = false,
  members = [],
  summary = null,
  period = "daily",
  role,
  unreadThreads,
  kpis = [],
}: {
  /** The summary cards under the filter bar. */
  kpis?: KpiCard[];
  queue: PageResult<OrderMakingRow>;
  filter: OrderMakingFilter;
  /** Zones, reps and markets as the orders carry them. */
  options: OrderListOptions;
  canEdit: boolean;
  /** Who opens new SOs: Order Making PO, Central, Admin. */
  canCreate?: boolean;
  /** "so": an Order Making SO member — their own SOs, the Sales Order details only. */
  mode?: "po" | "so";
  /** Who assigns SOs to Order Making SO members. */
  canAssign?: boolean;
  members?: SoMember[];
  summary?: SoMemberSummary | null;
  /** The cards' period: today's assignments (default) or all time. */
  period?: "daily" | "all";
  /** The viewer's role, for the SO discussion. */
  role: string;
  /** Unread discussion messages per SO, for the chat badge. */
  unreadThreads: Record<string, number>;
}) {
  const router = useRouter();
  const [threadFor, setThreadFor] = useState<{ orderId: string; soLabel: string } | null>(null);
  const missingOnly = filter.missingOnly;
  const activePreset =
    DATE_PRESETS.find((p) => {
      const [from, to] = presetRange(p);
      return from === filter.from && to === filter.to;
    }) ?? null;
  const { setParams, pending } = useUrlTable();
  // The Daily / All time toggle switches the moment it is clicked; the cards
  // follow when the counts arrive (dimmed meanwhile).
  const [requestedPeriod, setShownPeriod] = useState<"daily" | "all" | null>(null);
  // When the page catches up (or moves by Back), the page's period rules again.
  const [seenPeriod, setSeenPeriod] = useState(period);
  if (seenPeriod !== period) {
    setSeenPeriod(period);
    setShownPeriod(null);
  }
  const shownPeriod = requestedPeriod ?? period;
  // A row being edited, or "new" for the New order form.
  const [editing, setEditing] = useState<OrderMakingRow | "new" | null>(null);
  // The SO an EC is being added to (Pump or Spare Add-On), by Order Making PO.
  const [addFor, setAddFor] = useState<OrderMakingRow | null>(null);
  // Order Making PO, Order Making SO members (on their own SOs) and Central /
  // Admin fill the EC form, and edit or delete ECs.
  const manageEcs = canManageEcs(role);
  // An EC being edited, and the SOs whose ECs are shown.
  const [editEc, setEditEc] = useState<{ row: OrderMakingRow; item: Record<string, unknown> } | null>(null);
  // The SO whose ECs are open in the pop-up (by id, so a refresh shows the new list).
  const [ecsFor, setEcsFor] = useState<string | null>(null);
  const ecsRow = ecsFor ? queue.rows.find((r) => r.id === ecsFor) ?? null : null;
  const [deletingEc, setDeletingEc] = useState<string | null>(null);
  async function removeEc(item: Record<string, unknown>) {
    const ec = str(item.ec_no) || "this EC";
    if (!confirm(`Delete ${ec}? This removes the EC and all its department data.`)) return;
    setDeletingEc(str(item.id));
    const res = await deleteItemAction(str(item.id));
    setDeletingEc(null);
    if (!res.ok) alert(res.error);
    else router.refresh();
  }
  const [assigning, setAssigning] = useState<string | null>(null);
  async function assign(row: OrderMakingRow, assigneeId: string) {
    setAssigning(row.id);
    const res = await assignSoAction(row.id, assigneeId || null);
    setAssigning(null);
    if (!res.ok) alert(res.error);
    else router.refresh();
  }
  const pickedMember = filter.assignees.length === 1 ? filter.assignees[0] : null;
  const cols: { column: string; label: string }[] = [
    { column: "so_no", label: "SO No." },
    { column: "so_date", label: "SO Date" },
    { column: "client_code", label: "Client Code" },
    { column: "client_name", label: "Client Name" },
    { column: "order_type", label: "Order Type" },
    { column: "bill_mode", label: "Bill Mode" },
    { column: "po_no", label: "PO No." },
    { column: "order_value", label: "Order Value" },
  ];

  return (
    <div>
      {/* Today's assignments or all time, and the same as a PDF grid. */}
      {summary && (
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <div role="group" aria-label="Period" className="inline-flex rounded-lg border border-input-border p-0.5">
            {(["daily", "all"] as const).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => {
                  if (p === shownPeriod) return;
                  setShownPeriod(p);
                  setParams({ period: p === "daily" ? null : p });
                }}
                aria-pressed={shownPeriod === p}
                className={`h-8 rounded-md px-3 text-xs font-semibold transition-colors ${
                  shownPeriod === p ? "bg-primary text-primary-foreground" : "text-muted hover:text-foreground"
                }`}
              >
                {p === "daily" ? "Daily" : "All time"}
              </button>
            ))}
          </div>
          {/* The PDF is the day's assignments only. */}
          {shownPeriod === "daily" && (
          <a
            href="/risansi/departments/order-making/assignments-pdf"
            target="_blank"
            rel="noopener"
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-input-border px-3 text-xs font-semibold text-foreground hover:bg-background"
          >
            <FileText className="h-3.5 w-3.5" />
            Assignment PDF
          </a>
          )}
        </div>
      )}
      {/* Per Order Making SO member: what is assigned, still pending, filled. */}
      {summary && (
        <div
          aria-busy={shownPeriod !== period}
          className={`mb-4 grid grid-cols-2 gap-2 transition-opacity sm:grid-cols-3 lg:grid-cols-5 ${
            shownPeriod !== period && pending ? "pointer-events-none opacity-50" : ""
          }`}
        >
          {summary.members.map((m) => {
            const on = pickedMember === m.id;
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => setParams({ asg: on ? null : m.id, page: null })}
                aria-pressed={on}
                className={`rounded-xl border p-3 text-left shadow-sm transition-colors ${
                  on ? "border-primary bg-primary/[0.06]" : "border-card-border bg-surface hover:bg-background"
                }`}
              >
                <span className="flex items-center gap-1.5 truncate text-sm font-semibold text-foreground">
                  <UserRound className="h-3.5 w-3.5 shrink-0 text-primary" />
                  <span className="truncate">{m.full_name}</span>
                </span>
                <span className="mt-1.5 flex items-baseline gap-3 text-xs text-muted">
                  <span>
                    <span className="text-lg font-bold tabular-nums text-foreground">{m.assigned}</span> assigned
                  </span>
                </span>
                <span className="mt-1 flex gap-3 text-[11px]">
                  <span className="font-semibold text-amber-700">{m.pending} pending</span>
                  <span className="font-semibold text-emerald-700">{m.filled} filled</span>
                </span>
              </button>
            );
          })}
          <button
            type="button"
            onClick={() => setParams({ asg: pickedMember === UNASSIGNED ? null : UNASSIGNED, page: null })}
            aria-pressed={pickedMember === UNASSIGNED}
            className={`rounded-xl border border-dashed p-3 text-left transition-colors ${
              pickedMember === UNASSIGNED ? "border-primary bg-primary/[0.06]" : "border-input-border bg-surface hover:bg-background"
            }`}
          >
            <span className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
              <Users className="h-3.5 w-3.5 text-muted" />
              Unassigned
            </span>
            <span className="mt-1.5 block text-xs text-muted">
              <span className="text-lg font-bold tabular-nums text-foreground">{summary.unassigned.total}</span> SOs
            </span>
            <span className="mt-1 block text-[11px] font-semibold text-amber-700">
              {summary.unassigned.pending} SO details pending
            </span>
          </button>
          {summary.members.length === 0 && (
            <p className="col-span-full text-xs text-muted">
              No Order Making SO members yet — Admin adds them in Users &amp; Access.
            </p>
          )}
        </div>
      )}
      <div className="mb-4 space-y-2 rounded-xl border border-card-border bg-surface p-3 shadow-sm">
      <div className="flex flex-wrap items-center gap-2">
        <UrlSearchInput placeholder="Search SO, client, client code, PO…" />
        <MultiSelectFilter label="Zone" options={options.zones} selected={filter.zones} onChange={(next) => setParams({ zone: next })} />
        <MultiSelectFilter label="Rep" options={options.reps} selected={filter.reps} onChange={(next) => setParams({ rep: next })} />
        <MultiSelectFilter label="Market" options={options.markets} selected={filter.markets} onChange={(next) => setParams({ market: next })} />
        <MultiSelectFilter
          label="Type"
          options={ORDER_TYPE_OPTIONS.map((o) => o.value)}
          selected={filter.types}
          onChange={(next) => setParams({ type: next })}
        />
        <MultiSelectFilter
          label="Bill mode"
          allLabel="Any mode"
          options={BILL_MODE_FILTER_OPTIONS}
          selected={filter.billModes}
          onChange={(next) => setParams({ bmode: next })}
        />
        {canAssign && (
          <SingleSelectFilter
            label="Assigned to"
            allLabel="Anyone"
            options={[{ value: UNASSIGNED, label: "Unassigned" }, ...members.map((m) => ({ value: m.id, label: m.full_name }))]}
            selected={pickedMember}
            onChange={(next) => setParams({ asg: next, page: null })}
          />
        )}
        <SingleSelectFilter
          label="SO details"
          allLabel="Any"
          options={[
            { value: "pending", label: "Pending" },
            { value: "filled", label: "Filled" },
          ]}
          selected={filter.soState}
          onChange={(next) => setParams({ sos: next, page: null })}
        />
        <button
          type="button"
          onClick={() => setParams({ missing: missingOnly ? null : "1" })}
          aria-pressed={missingOnly}
          className={`inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-sm font-medium transition-colors ${
            missingOnly
              ? "border-amber-500/40 bg-amber-500/10 text-amber-700"
              : "border-input-border text-foreground hover:bg-background"
          }`}
        >
          <AlertTriangle className="h-3.5 w-3.5" />
          Details missing only
        </button>
      </div>

      {/* When: by SO date or PO date. */}
      <div className="flex flex-wrap items-center gap-2">
        <SingleSelectFilter
          label="Date"
          allLabel="SO date"
          options={OM_DATE_FIELDS.filter((d) => d.value !== "so_date").map((d) => ({ value: d.value, label: d.label }))}
          selected={filter.dateField === "so_date" ? null : filter.dateField}
          onChange={(next) => setParams({ datefield: next })}
        />
        {DATE_PRESETS.map((label) => (
          <button
            key={label}
            type="button"
            onClick={() => {
              if (activePreset === label) return setParams({ from: null, to: null });
              const [from, to] = presetRange(label);
              setParams({ from, to });
            }}
            className={`inline-flex h-8 items-center rounded-full border px-3 text-xs font-medium transition-colors ${
              activePreset === label
                ? "border-primary/40 bg-primary/[0.06] text-foreground"
                : "border-input-border bg-surface text-muted hover:bg-background hover:text-foreground"
            }`}
          >
            {label}
          </button>
        ))}
        <label className="inline-flex items-center gap-1.5 text-xs text-muted">
          From
          <input
            type="date"
            value={filter.from ?? ""}
            max={filter.to ?? undefined}
            onChange={(e) => setParams({ from: e.target.value || null })}
            className="h-8 rounded-lg border border-input-border bg-surface px-2 text-xs text-foreground focus:border-primary focus:outline-none"
          />
        </label>
        <label className="inline-flex items-center gap-1.5 text-xs text-muted">
          To
          <input
            type="date"
            value={filter.to ?? ""}
            min={filter.from ?? undefined}
            onChange={(e) => setParams({ to: e.target.value || null })}
            className="h-8 rounded-lg border border-input-border bg-surface px-2 text-xs text-foreground focus:border-primary focus:outline-none"
          />
        </label>
        {isOrderMakingFiltered(filter) && (
          <button
            type="button"
            onClick={() => setParams(Object.fromEntries(OM_FILTER_KEYS.map((k) => [k, null])))}
            className="inline-flex h-8 items-center gap-1 rounded-lg border border-input-border bg-surface px-2.5 text-xs font-medium text-foreground transition-colors hover:bg-background"
          >
            <X className="h-3.5 w-3.5" />
            Clear all
          </button>
        )}
        <span className="ml-auto text-xs text-muted">
          <span className="font-semibold text-foreground">{queue.total}</span> SO{queue.total === 1 ? "" : "s"}
        </span>
        {canCreate && (
          <button
            type="button"
            onClick={() => setEditing("new")}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary-hover"
          >
            <Plus className="h-4 w-4" />
            New order
          </button>
        )}
      </div>
      </div>

      <KpiStrip cards={kpis} />

      <div className="rounded-xl border border-card-border bg-surface shadow-sm">
        {/* The header row stays under the top bar as the page scrolls (AppShell). */}
        <div className="overflow-x-auto" data-sticky-head>
          <table className="w-full min-w-[960px] text-sm">
            <thead className="relative z-10 bg-surface data-[stuck=1]:shadow-[0_2px_6px_-2px_rgba(0,0,0,0.18)] [&_th]:bg-surface">
              <tr className="border-b border-card-border text-left text-xs font-semibold uppercase tracking-wide text-muted">
                <th className="px-4 py-3">
                  <SortHeader label="Sl." sortKey="sl" />
                </th>
                {cols.map((c) => (
                  <Fragment key={c.column}>
                    <th className={`px-4 py-3 ${c.column === "order_value" ? "text-right" : ""}`}>
                      {c.column === "so_date" ? <SortHeader label={c.label} sortKey="so_date" /> : c.label}
                    </th>
                    {c.column === "so_no" && <th className="px-4 py-3">Chat</th>}
                  </Fragment>
                ))}
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">PO details</th>
                <th className="px-4 py-3">SO details</th>
                <th className="px-4 py-3">ECs</th>
                {mode === "po" && <th className="px-4 py-3">Assigned to</th>}
                {canEdit && <th className="px-4 py-3" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-card-border">
              {queue.rows.length === 0 && (
                <tr>
                  <td colSpan={cols.length + 8} className="px-4 py-10 text-center text-sm text-muted">
                    {mode === "so"
                      ? "No SOs assigned to you match."
                      : missingOnly
                        ? "Every SO has its client, PO and SO details filled."
                        : "No SOs match."}
                  </td>
                </tr>
              )}
              {queue.rows.map((row) => (
                <Fragment key={row.id}>
                <tr
                  onClick={(e) => {
                    // A click on a control (or inside one of its pop-ups) does its own job.
                    if ((e.target as HTMLElement).closest("button, a, select, input, textarea, label, [role=dialog]")) return;
                    setEcsFor(row.id);
                  }}
                  title="Open the SO's ECs"
                  className="cursor-pointer text-foreground transition-colors hover:bg-background/60"
                >
                  <td className="px-4 py-3 font-medium tabular-nums">{row.sl_no}</td>
                  {cols.map((c) => (
                    <Fragment key={c.column}>
                      <td
                        className={`px-4 py-3 ${
                          c.column === "order_value" ? "text-right tabular-nums" : c.column === "client_name" ? "" : "whitespace-nowrap"
                        }`}
                      >
                        {formatDisplay(field(c.column), row[c.column])}
                        {c.column === "order_value" && str(row.order_currency) ? ` ${str(row.order_currency)}` : ""}
                      </td>
                      {/* The SO's discussion with Central Visibility and the departments. */}
                      {c.column === "so_no" && (
                        <td className="px-4 py-3">
                          <button
                            type="button"
                            onClick={() => setThreadFor({ orderId: row.id, soLabel: str(row.so_no) || String(row.sl_no) })}
                            aria-label="Chat"
                            title="Chat"
                            className="relative inline-flex h-8 w-8 items-center justify-center rounded-lg border border-input-border text-foreground transition-colors hover:bg-background"
                          >
                            <MessageSquare className="h-3.5 w-3.5" />
                            {(unreadThreads[row.id] ?? 0) > 0 && (
                              <span className="absolute -right-1.5 -top-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-600 px-1 text-[10px] font-bold text-white">
                                {unreadThreads[row.id]}
                              </span>
                            )}
                          </button>
                        </td>
                      )}
                    </Fragment>
                  ))}
                  {/* Order Making's own Clear / Hold, the first step. Central's
                      clearance comes after and is not Order Making's to see. */}
                  <td className="px-4 py-3">
                    <OmHoldBadge order={row} readOnly={mode === "so"} />
                  </td>
                  <td className="px-4 py-3">
                    {row.missing.length === 0 ? (
                      <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700">
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        Complete
                      </span>
                    ) : (
                      <span
                        title={row.missing.join(", ")}
                        className="inline-flex rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-semibold text-amber-700"
                      >
                        {row.missing.length} missing
                      </span>
                    )}
                  </td>
                  {/* The Sales Order details: in (and when), or what is still blank. */}
                  <td className="px-4 py-3 whitespace-nowrap">
                    {row.so_missing.length === 0 ? (
                      <span className="inline-flex flex-col">
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700">
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          Filled
                        </span>
                        {row.so_details_filled_at && (
                          <span className="text-[11px] text-muted">{formatDisplay(field("so_date"), row.so_details_filled_at)}</span>
                        )}
                      </span>
                    ) : (
                      <span
                        title={row.so_missing.join(", ")}
                        className="inline-flex rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-semibold text-amber-700"
                      >
                        Pending · {row.so_missing.length} missing
                      </span>
                    )}
                  </td>
                  {/* The SO's ECs: Order Making PO fills the EC form (Pump or Spare Add-On). */}
                  <td className="px-4 py-3 whitespace-nowrap">
                    {/* The row itself opens the ECs; the count is just the count. */}
                    <span className={`mr-2 text-sm tabular-nums ${row.ec_count > 0 ? "text-foreground" : "text-muted"}`}>{row.ec_count}</span>
                    {manageEcs && (
                      <button
                        type="button"
                        onClick={() => setAddFor(row)}
                        title={`${str(row.order_type) || "Pump"} Add-On`}
                        className="inline-flex h-7 items-center gap-1 rounded-lg border border-primary/40 bg-primary/10 px-2 text-[11px] font-semibold text-primary transition-colors hover:bg-primary hover:text-primary-foreground"
                      >
                        <Plus className="h-3.5 w-3.5" />
                        {str(row.order_type) === "Spare" ? "Spare Add-On" : "Pump Add-On"}
                      </button>
                    )}
                  </td>
                  {mode === "po" && (
                    <td className="px-4 py-3 whitespace-nowrap">
                      {canAssign ? (
                        <span className="inline-flex flex-col gap-0.5">
                          <span className="inline-flex items-center gap-1.5">
                            <select
                              value={row.so_assignee_id ?? ""}
                              disabled={assigning === row.id}
                              onChange={(e) => assign(row, e.target.value)}
                              aria-label={`Assign SO details of ${str(row.so_no) || row.sl_no}`}
                              className={`h-8 max-w-[11rem] cursor-pointer rounded-lg border px-2 text-xs ${
                                row.so_assignee_id
                                  ? "border-input-border bg-surface text-foreground"
                                  : "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-300"
                              }`}
                            >
                              <option value="">Unassigned</option>
                              {members.map((m) => (
                                <option key={m.id} value={m.id}>
                                  {m.full_name}
                                </option>
                              ))}
                              {/* Someone no longer active stays shown. */}
                              {row.so_assignee_id && !members.some((m) => m.id === row.so_assignee_id) && (
                                <option value={row.so_assignee_id}>{row.so_assignee_name ?? "Former member"}</option>
                              )}
                            </select>
                            {assigning === row.id && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted" />}
                          </span>
                          {row.so_assigned_at && (
                            <span className="text-[11px] text-muted">since {formatDisplay(field("so_date"), row.so_assigned_at)}</span>
                          )}
                        </span>
                      ) : (
                        <span className="text-xs text-foreground">{row.so_assignee_name ?? "—"}</span>
                      )}
                    </td>
                  )}
                  {canEdit && (
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => setEditing(row)}
                        className={`inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-lg border px-3 text-xs font-medium transition-colors ${
                          mode === "so" && row.so_missing.length > 0
                            ? "border-primary/40 bg-primary/10 text-primary hover:bg-primary hover:text-primary-foreground"
                            : "border-input-border text-foreground hover:bg-background"
                        }`}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                        {mode === "so" ? "SO details" : "Edit"}
                      </button>
                    </td>
                  )}
                </tr>
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
        {ecsRow && (
          <OmEcsModal
            order={ecsRow}
            items={ecsRow.items}
            canManage={manageEcs}
            deletingId={deletingEc}
            onAdd={() => setAddFor(ecsRow)}
            onEdit={(item) => setEditEc({ row: ecsRow, item })}
            onDelete={removeEc}
            onClose={() => setEcsFor(null)}
          />
        )}
        {editEc && (
          <AddOnForm
            orderId={editEc.row.id}
            soLabel={str(editEc.row.so_no) || `#${editEc.row.sl_no}`}
            orderType={str(editEc.row.order_type) || null}
            item={editEc.item}
            onClose={() => setEditEc(null)}
          />
        )}
        {addFor && (
          <AddOnForm
            orderId={addFor.id}
            soLabel={str(addFor.so_no) || `#${addFor.sl_no}`}
            orderType={str(addFor.order_type) || null}
            boiFlag={addFor.boi}
            onClose={() => setAddFor(null)}
          />
        )}
        <div className="border-t border-card-border px-4 py-3">
          <UrlPagination
            page={queue.page}
            totalPages={queue.totalPages}
            from={queue.from}
            to={queue.to}
            total={queue.total}
          />
        </div>
      </div>

      {threadFor && (
        <OrderThreadModal
          orderId={threadFor.orderId}
          role={role}
          soLabel={threadFor.soLabel}
          onClose={() => {
            setThreadFor(null);
            router.refresh();
          }}
        />
      )}
      {editing && (
        <OrderMakingEdit
          row={editing === "new" ? null : editing}
          mode={mode}
          members={canAssign ? members : null}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

/**
 * Order Making's form: a new SO (row null) or an existing one's Client and
 * Purchase Order details — the only ones Order Making owns. The client
 * directory fills the Client fields.
 */
/** The form's parts: the Client, the PO's own details, the Sales Order details, and the Handover. */
const FORM_SECTIONS: { title: string; fields: (f: OrderField) => boolean }[] = [
  { title: "Client", fields: (f) => f.group === "Client" },
  { title: "Purchase Order", fields: (f) => f.group === "Purchase Order" && !SO_DETAIL_COLUMNS.includes(f.column) },
  { title: "Sales Order", fields: (f) => SO_DETAIL_COLUMNS.includes(f.column) },
  { title: "Handover", fields: (f) => f.group === "Handover" },
];

function OrderMakingEdit({
  row,
  mode,
  members,
  onClose,
}: {
  row: OrderMakingRow | null;
  /** "so": an Order Making SO member fills the Sales Order details only. */
  mode: "po" | "so";
  /** Order Making SO members to assign to, for those who assign. */
  members: SoMember[] | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const editable = mode === "so" ? ORDER_MAKING_SO_EDITABLE : ORDER_MAKING_EDITABLE;
  const [assignee, setAssignee] = useState<string>(row?.so_assignee_id ?? "");
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      ORDER_MAKING_EDITABLE.map((f) => [f.column, str(row?.[f.column]).slice(0, f.type === "date" ? 10 : undefined)])
    )
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !saving && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [saving, onClose]);

  const read = (c: string) => values[c] ?? "";
  const set = (c: string, v: string) => setValues((prev) => withValueRules(prev, c, v));

  // Picking a client from the directory fills the Client group.
  function applyClient(client: MarketIntellClient) {
    setValues((prev) => ({
      ...prev,
      client_code: client.code,
      client_name: client.legal_name ?? "",
      market_type: client.market_type ?? "",
      client_type: client.client_type ?? "",
      industry_type: client.industry ?? "",
      zone: client.zone ?? "",
      reps: client.rep_name ?? "",
    }));
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    if (mode === "po" && !values.client_code?.trim()) {
      setError("Client Code is required.");
      return;
    }
    setSaving(true);
    setError(null);
    // Only fields that apply go: a PO typed before switching to FR is not saved.
    const applies = (k: string) => {
      const f = editable.find((x) => x.column === k);
      return !!f && dependsOnSatisfied(f, read);
    };
    const sending = Object.fromEntries(Object.entries(values).filter(([k]) => applies(k)));
    // Blank fields are left out of a new order rather than sent as "".
    const res = row
      ? await updateOrderSectionAction(row.id, "orders", sending)
      : await createOrderAction(
          Object.fromEntries(Object.entries(sending).filter(([, v]) => v.trim() !== "")) as NewOrderInput
        );
    if (!res.ok) {
      setSaving(false);
      setError(res.error);
      return;
    }
    // Who fills the SO details, when it is new or has changed.
    const created = !row && "id" in res ? (res as { id: string }).id : null;
    const orderId: string | null = row ? row.id : created;
    if (members && orderId && assignee !== (row?.so_assignee_id ?? "")) {
      const a = await assignSoAction(orderId, assignee || null);
      if (!a.ok) {
        setSaving(false);
        setError(`Saved, but not assigned: ${a.error}`);
        router.refresh();
        return;
      }
    }
    setSaving(false);
    router.refresh();
    onClose();
  }

  // A Challan order is worth 0 INR: its value and currency are set, not typed.
  const challanLocked = (f: OrderField) =>
    read("bill_mode") === "FR" && (f.column === "order_value" || f.column === "order_currency");
  const input = (f: OrderField) => {
    const on = !challanLocked(f);
    return f.type === "select" ? (
      <select
        id={f.column}
        value={read(f.column)}
        disabled={!on}
        onChange={(e) => set(f.column, e.target.value)}
        className={`${inputClass} cursor-pointer`}
      >
        <option value="">—</option>
        {selectOptionsFor(f, read(f.column)).map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    ) : (
      <input
        id={f.column}
        type={f.type === "date" ? "date" : f.type === "text" ? "text" : "number"}
        step={f.type === "number" ? "any" : undefined}
        min={f.min}
        value={read(f.column)}
        disabled={!on}
        onChange={(e) => set(f.column, e.target.value)}
        className={inputClass}
      />
    );
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={mode === "so" ? "Fill SO details" : "Edit client and purchase order details"}
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-6"
      onClick={() => !saving && onClose()}
    >
      <form
        onSubmit={save}
        onClick={(e) => e.stopPropagation()}
        className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-t-2xl bg-surface p-5 shadow-xl sm:rounded-2xl"
      >
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <h2 className="font-display text-lg font-semibold text-foreground">
              {mode === "so" ? "SO details" : row ? "Client, PO & SO details" : "New order"}
            </h2>
            <p className="text-xs text-muted">
              {row ? `SO ${str(row.so_no) || `#${row.sl_no}`} · ` : ""}
              {mode === "so"
                ? "fill the Sales Order details; the client and PO are Order Making PO's"
                : "Central Visibility is told once the SO details are in, and fills the terms, target dates and ECs"}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            aria-label="Close"
            className="rounded-lg p-1.5 text-muted transition-colors hover:bg-background hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {mode === "po" && <ClientLookup onSelect={applyClient} label="Fill client details from directory" />}

        {error && (
          <div role="alert" className="mb-3 rounded-[10px] border border-danger-border bg-danger-bg px-3 py-2 text-sm text-danger">
            {error}
          </div>
        )}

        {FORM_SECTIONS.map((section) => {
          // Only what applies, as the Order details form: FR takes a
          // complaint instead of a quotation and PO, a Spare has no total
          // quantity.
          const fields = ORDER_MAKING_EDITABLE.filter((f) => section.fields(f) && dependsOnSatisfied(f, read));
          const isSo = section.title === "Sales Order";
          const isHandover = section.title === "Handover";
          // An SO member sees the client and PO as they stand, to fill against;
          // the Handover's date is theirs too.
          const readOnly = mode === "so" && !isSo && !isHandover;
          return (
            <section
              key={section.title}
              className={`mb-4 rounded-xl border p-4 ${isSo && mode === "so" ? "border-primary/40 bg-primary/[0.03]" : "border-card-border"} ${readOnly ? "bg-background/60" : ""}`}
            >
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-foreground">
                  {section.title}
                  {readOnly && <span className="ml-2 text-[11px] font-normal text-muted">view only</span>}
                </h3>
                {/* Who fills it: Order Making PO, Central and Admin assign. */}
                {isSo && members && (
                  <label className="inline-flex items-center gap-2 text-xs text-muted">
                    Assigned to
                    <select
                      value={assignee}
                      onChange={(e) => setAssignee(e.target.value)}
                      className="h-8 cursor-pointer rounded-lg border border-input-border bg-surface px-2 text-xs text-foreground"
                    >
                      <option value="">Unassigned</option>
                      {members.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.full_name}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
              </div>
              {readOnly ? (
                <dl className="grid grid-cols-1 gap-x-5 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
                  {fields.map((f) => (
                    <div key={f.column} className="text-sm">
                      <dt className="text-[12px] text-muted">{f.label}</dt>
                      <dd className="font-medium text-foreground">{formatDisplay(f, read(f.column)) || "—"}</dd>
                    </div>
                  ))}
                </dl>
              ) : (
                <div className="grid grid-cols-1 gap-x-5 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
                  {fields.map((f) => (
                    <label key={f.column} htmlFor={f.column} className="block text-sm">
                      <span className="mb-1 block text-[13px] font-medium text-brand-label">
                        {f.label}
                        {f.column === "client_code" && <span className="text-danger"> *</span>}
                      </span>
                      {input(f)}
                      {challanLocked(f) && (
                        <span className="mt-1 block text-[11px] text-muted">0 INR on a Challan order</span>
                      )}
                    </label>
                  ))}
                </div>
              )}
              {isSo && mode === "po" && (
                <p className="mt-2 text-[11px] text-muted">
                  Usually filled by the Order Making SO member it is assigned to.
                </p>
              )}
            </section>
          );
        })}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="inline-flex h-9 items-center rounded-lg border border-input-border px-4 text-sm font-medium text-foreground transition-colors hover:bg-background"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary-hover disabled:opacity-60"
          >
            {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {mode === "so" ? "Save SO details" : row ? "Save" : "Create order"}
          </button>
        </div>
      </form>
    </div>
  );
}
