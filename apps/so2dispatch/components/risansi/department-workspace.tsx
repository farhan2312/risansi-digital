"use client";

import { Fragment, useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import {
  ChevronDown,
  ClipboardList,
  Loader2,
  Package,
  MessageSquare,
  Paperclip,
  Pencil,
  Plus,
  X,
} from "lucide-react";
import { updateOrderSectionAction, updateSectionForSoAction } from "@/app/risansi/orders/actions";
import {
  CHILD_FIELDS,
  readyLotsOpen,
  SECTION_BY_TABLE,
  canonicalSelectValue,
  dependsOnSatisfied,
  selectOptionsFor,
  type OrderField,
  type OrderTable,
} from "@/lib/order-schema";
import { OrderChildList } from "./order-children";
import { SortHeader } from "./sort-header";
import { HoldBadge } from "./hold-badge";
import { AccountsHoldButton } from "./accounts-hold";
import { TermPis } from "./term-pis";
import { PackingSlipsInline } from "./packing-slips-inline";
import { ReadyLotHistoryButton } from "./ready-lot-history";
import { ReadyLotsEditor } from "./ready-lots-editor";
import {
  PACKING_LOTS_FIELD,
  READY_LOTS_FIELD,
  lotsError,
  lotsFromRows,
  lotsSummary,
  packingError,
  packingLotsFromRows,
  type PackingLot,
  type ReadyLot,
} from "@/lib/ready-lots";
import { PackingLotsEditor } from "./packing-lots-editor";
import { PACKED_FOR } from "@/lib/ready-lots";
import { UrlPagination, UrlSearchInput, useUrlTable } from "./url-table";
import { OrderListFilterBar } from "./order-list-filter-bar";
import type { OrderListOptions } from "@/lib/orders";
import { DEPT_VIEWS, dispatchRowTone } from "@/lib/dept-view";
import { useConsumeFocusParam, useFocusRow } from "./use-focus-row";
import { lockReason } from "@/lib/order-lock";
import type { PageResult } from "@/lib/pagination";
import { QcDocumentsModal } from "./qc-documents-modal";
import { OrderDetailsModal } from "./order-details-modal";
import { BoiItemsModal } from "./boi-items-modal";
import { EcDrawingDocsButton, RevisionDocsButton } from "./drawing-docs";
import { OrderThreadModal } from "./order-thread-modal";
import {
  TargetHistoryCell,
  targetForColumn,
} from "./target-history-cell";
import { completionFor, DeptCompleteCheck } from "./dept-complete-check";
import { SIGN_OFF_ENABLED } from "@/lib/dept-completion";
import {
  deptForTable,
  isPerEcDept,
  type DeptCompletion,
} from "@/lib/dept-completion";
import type { QcDocTable } from "@/lib/orders";

// Only the QC workspace passes this today; kept generic (a list, so more than
// one document set can be attached) in case another department needs file
// attachments later.
type DocumentsConfig = {
  table: QcDocTable;
  label: string;
  canEdit: boolean;
  counts: Record<string, number>;
};

type Row = Record<string, unknown>;

function toInput(value: unknown): string {
  return value === null || value === undefined ? "" : String(value);
}

function formatValue(field: OrderField, value: unknown): string {
  const s = toInput(value);
  if (s === "") return "—";
  if (field.type === "date") {
    const d = new Date(s);
    if (!Number.isNaN(d.getTime())) {
      return d.toLocaleDateString("en-GB", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      });
    }
  }
  if (field.type === "select") {
    const v = canonicalSelectValue(field, s);
    return field.options?.find((o) => o.value === v)?.label ?? v;
  }
  return s;
}

const money = new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Amounts shown with their currency: the order value in its own, the rest (with GST) in INR. */
const MONEY_COLUMNS = ["order_value", "order_value_gst", "amount_received", "balance_of_payment"];

/**
 * A context value as shown: the order value with its currency (INR / USD),
 * the value with GST, what came in and the balance — always in INR — likewise;
 * anything else as it is.
 */
function contextValue(field: OrderField, row: Row, value: unknown = row[field.column]): string {
  if (!MONEY_COLUMNS.includes(field.column)) return formatValue(field, value);
  const n = Number(toInput(value));
  if (toInput(value) === "" || !Number.isFinite(n)) return "—";
  const currency = field.column === "order_value" ? toInput(row.order_currency) || "INR" : "INR";
  return `${money.format(n)} ${currency}`;
}

// Build the search matcher + placeholder from what each department actually
// shows: Billing/Accounts (SO-scope) search by SO + Client Name; the per-EC
// departments search by SO + EC + item type (Client Name is hidden for them).
function searchConfigFor(table: OrderTable): {
  match: (o: Row) => string;
  placeholder: string;
} {
  const scope = SECTION_BY_TABLE.get(table)?.scope;
  const showEcNo = scope !== "so";
  const showParty = table === "order_billing" || table === "order_accounts";

  const cols: string[] = ["sl_no", "so_no"];
  const words: string[] = ["SO"];
  if (showEcNo) {
    cols.push("ec_no", "item_type");
    words.push("EC", "item");
  }
  if (showParty) {
    cols.push("client_name");
    words.push("client");
  }
  return {
    match: (o) => cols.map((k) => (o[k] == null ? "" : String(o[k]))).join(" "),
    placeholder: `Search ${words.join(", ")}…`,
  };
}

/** "SO26/1/1455 · EC-1 · Rev. 2" — the heading of a revision's documents. */
function revisionDocsLabel(ec: Row, rev: Row): string {
  const no = toInput(rev.revision_no).trim();
  return [toInput(ec.so_no), toInput(ec.ec_no), no ? `Rev. ${no}` : "First issue"]
    .filter(Boolean)
    .join(" · ");
}

// A dependsOn'd field (e.g. a billing document field gated on the order's
// bill_type) only applies to a row whose data satisfies the condition.
function fieldApplies(field: OrderField, row: Row): boolean {
  return dependsOnSatisfied(field, (col) => toInput(row[col]));
}

export function DepartmentWorkspace({
  table,
  fields,
  queue,
  readonlyFields = [],
  canEdit = true,
  canEditCentral = true,
  documents = [],
  openOrderId,
  openThreadId,
  focusOrderId,
  role,
  unreadThreads = {},
  completions = [],
  drawingDocCounts,
  filterOptions,
}: {
  table: OrderTable;
  fields: OrderField[];
  // One server-fetched page of the queue: search and paging ran in SQL, and
  // paging is on SOs so an SO's ECs never straddle two pages.
  queue: PageResult<Row>;
  readonlyFields?: OrderField[];
  canEdit?: boolean;
  // Whether the current user may edit `centralOnly` fields (Central Visibility).
  canEditCentral?: boolean;
  // QC document attachments — omitted everywhere except the QC workspace.
  documents?: DocumentsConfig[];
  // Deep-link from a notification: open this order's edit modal on load.
  openOrderId?: string;
  // Deep-link from the discussion icon: open this SO's thread on load.
  openThreadId?: string;
  // The SO that `openOrderId` / `openThreadId` belongs to. The server already
  // paged onto it; this is what we scroll to and highlight.
  focusOrderId?: string;
  // The viewer's role — decides which discussion lane they get.
  role: string;
  // Unread discussion messages keyed by order id, for the row badge.
  unreadThreads?: Record<string, number>;
  // This department's sign-offs across the SOs on this page.
  completions?: DeptCompletion[];
  // Drawing documents shared with this department, per EC id. Set only for
  // the departments documents can be assigned to (Planning).
  drawingDocCounts?: Record<string, number>;
  // Facet values for the filter bar. Omitted, the queue keeps its plain
  // search box.
  filterOptions?: OrderListOptions;
}) {
  const [editRow, setEditRow] = useState<Row | null>(null);
  // Planning / Assembly & Packing edit a whole SO at once: one form for all
  // its ECs.
  const [editSo, setEditSo] = useState<{ orderId: string; head: Row; count: number } | null>(null);
  // Accounts: a click on an SO's row opens its Order details.
  const [detailsFor, setDetailsFor] = useState<string | null>(null);
  const [docsPanel, setDocsPanel] = useState<{ row: Row; config: DocumentsConfig } | null>(
    null
  );
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const orders = queue.rows;
  const { get: getParam } = useUrlTable();
  const [threadFor, setThreadFor] = useState<{
    orderId: string;
    soLabel: string;
  } | null>(null);

  // Deep link from the discussion icon: open that SO's thread on arrival.
  useEffect(() => {
    if (!openThreadId) return;
    const row = orders.find((r) => String(r.order_id ?? r.id) === openThreadId);
    if (!row) return;
    setThreadFor({
      orderId: openThreadId,
      soLabel: String(row.so_no ?? row.sl_no ?? ""),
    });
  }, [openThreadId, orders]);


  const { placeholder: searchPlaceholder } = searchConfigFor(table);

  // A section that is only a child list (Drawing → revisions) has nothing for
  // the edit modal to show, so a notification lands on the EC itself — its SO
  // expanded, the EC scrolled to and ringed — where the revisions are.
  const hasEditForm = fields.length > 0 || documents.length > 0;

  useEffect(() => {
    if (!openOrderId) return;
    const row = orders.find((o) => String(o.id) === openOrderId);
    if (!row) return;
    // Expand that row's SO so the queue reveals it (and, with an edit form,
    // shows it once the modal is closed).
    const soKey = String(row.so_no ?? row.sl_no ?? "");
    if (soKey) setExpanded((prev) => new Set(prev).add(soKey));
    if (canEdit && hasEditForm) setEditRow(row);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openOrderId]);

  // Reveal the deep-linked SO's ECs, then scroll to the exact row.
  useEffect(() => {
    if (!focusOrderId) return;
    const row = orders.find((o) => String(o.order_id ?? o.id) === focusOrderId);
    const soKey = row ? String(row.so_no ?? row.sl_no ?? "") : "";
    if (soKey) setExpanded((prev) => new Set(prev).add(soKey));
  }, [focusOrderId, orders]);

  const focusClass = useFocusRow([openOrderId, focusOrderId], orders.length > 0);
  useConsumeFocusParam(queue.page);

  function toggleSo(key: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }


  // Read-only context splits by scope: SO-level values (from `orders`)
  // belong on the SO header row, while anything read from an item-keyed
  // table — Planning's Assembly Date, say — differs per EC and has to sit
  // in the EC subtable, or the SO row would show the first EC's value as
  // if it applied to all of them.
  // Which department this workspace signs off, and at which level — derived
  // from the section rather than passed in, since the workspace already knows.
  const dept = deptForTable(table);
  const completePerEc = dept ? isPerEcDept(dept) : false;
  function completeCell(scopeId: string, label: string) {
    if (!dept) return null;
    return (
      <DeptCompleteCheck
        scopeId={scopeId}
        dept={dept}
        label={label}
        completion={completionFor(completions, dept, scopeId, completePerEc)}
        canEdit={canEdit}
      />
    );
  }

  const soContext = readonlyFields.filter((f) => !f.from || f.from === "orders");

  // A department works to its target dates but cannot set them, so the value
  // carries the history behind it — a date that has moved twice reads very
  // differently from one that never has.
  function contextCell(f: OrderField, row: Row) {
    const value = contextValue(f, row);
    const target = targetForColumn(f.column);
    const orderId = toInput(row.order_id ?? row.id);
    if (!target || !orderId) return value;
    return (
      <TargetHistoryCell orderId={orderId} target={target} value={value} />
    );
  }
  const ecContext = readonlyFields.filter((f) => f.from && f.from !== "orders");

  // Party is customer-identifying info; only Billing & Operations and
  // Accounts need it for their day-to-day work.
  const showParty = table === "order_billing" || table === "order_accounts";

  // SO-scope sections (Billing/Accounts) have no per-EC breakdown, so EC No.
  // would always be blank — hide the column entirely.
  const scope = SECTION_BY_TABLE.get(table)?.scope;
  const showEcNo = scope !== "so";
  // Item-scope departments (Drawing/Purchase/QC/Planning/Dispatch) group by SO
  // with a chevron toggle to reveal each SO's ECs. SO-scope pages stay flat.
  const groupBySo = scope === "item";

  // Cascade: only show a conditional field's column when at least one order in
  // the queue actually matches its condition (e.g. Tax columns appear only if
  // some SO's bill_type is Tax).
  const visibleFields = fields.filter(
    (f) => !f.listHidden && (!f.dependsOn || orders.some((o) => fieldApplies(f, o)))
  );
  // A section can be purely a child list (Drawing → revisions). Then the flat
  // per-EC table and its Edit button carry nothing, so we skip them entirely.
  const hasFlatColumns = visibleFields.length > 0 || documents.length > 0;
  // Inside one SO, only the columns that apply to its own ECs — a Spare SO
  // shows no pump-only or pump-and-planning columns.
  // SO-level editing and summary: Planning and Assembly & Packing.
  const soEdit = groupBySo && (table === "order_planning" || table === "order_assembly_dispatch");
  const isSpareRow = (ec: Row) => toInput(ec.item_type).trim().toLowerCase() === "spare";
  const shortDate = (v: unknown) => {
    const s = toInput(v).slice(0, 10);
    if (!s) return "";
    const d = new Date(s);
    return Number.isNaN(d.getTime())
      ? s
      : d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
  };
  /** One EC's status and date as its department reads it. */
  const ecStatusDate = (ec: Row, dept: string = table): { status: string; date: string } => {
    if (dept === "order_planning") {
      return {
        status:
          toInput(ec.actual_spare_status) ||
          toInput(ec.actual_pump_status) ||
          toInput(ec.planning_status) ||
          (isSpareRow(ec) ? "Date awaited" : "Pending"),
        date:
          shortDate(ec.planning_readiness_date) +
          (toInput(ec.readiness_date_status) && toInput(ec.planning_readiness_date)
            ? ` (${toInput(ec.readiness_date_status)})`
            : ""),
      };
    }
    const lots = packingLotsFromRows(ec.ready_lots);
    const last = lots[lots.length - 1];
    if (last) {
      return last.packed_date
        ? { status: PACKED_FOR[last.status] ?? "Packed", date: `Packed ${shortDate(last.packed_date)}` }
        : { status: last.status, date: last.ready_date ? `Ready ${shortDate(last.ready_date)}` : "" };
    }
    return toInput(ec.actual_packing_date)
      ? { status: "Fully packed", date: `Packed ${shortDate(ec.actual_packing_date)}` }
      : { status: isSpareRow(ec) ? "—" : "Pending", date: "" };
  };
  // Planning and Assembly & Packing edit the SO as one; an EC has its own Edit
  // only where that can't be done — an SO mixing Pump and Spare ECs.
  const ecEditFor = (ecs: Row[]) => !soEdit || new Set(ecs.map(isSpareRow)).size > 1;
  /** The date column's name: what the date is. */
  const soDateLabel = table === "order_planning" ? "Readiness Date" : "Ready / Packed On";
  /**
   * How many days an SO is late against Planning's readiness date: from the
   * earliest one among its ECs not done yet — for Planning, not ready (a Spare
   * Fully ready, a Pump Assembled or Packed); for Assembly & Packing, not
   * packed. The rule each Overdue filter uses. 0 when on time.
   */
  const readinessOverdueDays = (ecs: Row[]) => {
    const ready = (ec: Row) =>
      ["fully ready", "assembled", "packed"].includes(
        (toInput(ec.actual_spare_status) || toInput(ec.actual_pump_status)).trim().toLowerCase()
      );
    // What Assembly & Packing owes on an EC (lib/dept-view assemblyDueSql): its
    // unpacked lots' ready dates, or the readiness date until it is packed.
    const owed = (ec: Row): string[] => {
      const lots = Array.isArray(ec.ready_lots) ? (ec.ready_lots as Row[]) : [];
      if (lots.length) {
        return lots.filter((l) => !toInput(l.packed_date)).map((l) => toInput(l.ready_date).slice(0, 10));
      }
      return toInput(ec.actual_packing_date) ? [] : [toInput(ec.planning_readiness_date).slice(0, 10)];
    };
    const dates = (
      table === "order_assembly_dispatch"
        ? ecs.flatMap(owed)
        : ecs.filter((ec) => !ready(ec)).map((ec) => toInput(ec.planning_readiness_date).slice(0, 10))
    )
      .filter(Boolean)
      .sort();
    if (dates.length === 0) return 0;
    const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
    const days = Math.round(
      (new Date(`${today}T00:00:00Z`).getTime() - new Date(`${dates[0]}T00:00:00Z`).getTime()) / 86_400_000
    );
    return days > 0 ? days : 0;
  };
  /** The SO's: its ECs' status and date when they agree, "Mixed" when not. */
  const soSummary = (ecs: Row[], dept: string = table) => {
    const each = ecs.map((ec) => ecStatusDate(ec, dept));
    const one = (k: "status" | "date") => {
      const set = new Set(each.map((e) => e[k]));
      return set.size === 1 ? [...set][0] || "—" : "Mixed";
    };
    return { status: one("status"), date: one("date") };
  };
  const ecContextFor = (ecs: Row[]) =>
    ecContext.filter((f) => !f.dependsOn || ecs.some((ec) => fieldApplies(f, ec)));
  // Assembly & Packing: a Spare's readiness lots, and how far packing has got.
  const showLots = (ecs: Row[]) =>
    table === "order_assembly_dispatch" &&
    ecs.some((ec) => Array.isArray(ec.ready_lots) && (ec.ready_lots as unknown[]).length > 0);
  const lotsCell = (ec: Row) => {
    const lots = packingLotsFromRows(ec.ready_lots);
    if (lots.length === 0) return "—";
    const d = (v: string) =>
      v ? new Date(v).toLocaleDateString("en-GB", { day: "2-digit", month: "short" }) : "";
    return (
      <div className="space-y-0.5">
        {lots.map((l, i) => (
          <div key={l.id || i} className="whitespace-nowrap text-xs">
            <span className="font-semibold text-muted-foreground">Lot {i + 1}</span> · {l.status}{" "}
            {d(l.ready_date)} →{" "}
            {l.packed_date ? (
              <span className="font-medium text-foreground">
                {PACKED_FOR[l.status] ?? "Packed"} {d(l.packed_date)}
              </span>
            ) : (
              <span className="text-amber-700">not packed</span>
            )}
          </div>
        ))}
      </div>
    );
  };
  const fieldsFor = (ecs: Row[]) =>
    visibleFields.filter((f) => !f.dependsOn || ecs.some((ec) => fieldApplies(f, ec)));

  // Item-scope layout: one row per SO (with the SO's readonly context) + a
  // nested EC subtable for that SO's department fields.
  //
  // The server pages on SOs, so every EC of every SO on this page is
  // already here — grouping is just a reshape, never a re-paginate.
  type SoGroup = { key: string; head: Row; ecs: Row[] };
  const soGroups: SoGroup[] = groupBySo
    ? Array.from(
        orders.reduce((map, r) => {
          const key = String(r.so_no ?? r.sl_no ?? "");
          const g = map.get(key);
          if (g) g.ecs.push(r);
          else map.set(key, { key, head: r, ecs: [r] });
          return map;
        }, new Map<string, SoGroup>())
      ).map(([, g]) => g)
    : [];
  // SO-scope path maps these directly; item-scope iterates soGroups.
  const pageRows = orders;

  // Per-EC child list carried by this section (packing slips), plus its gate
  // against the SO and the label/kind it files rows under.
  const section = SECTION_BY_TABLE.get(table);
  const childTable = section?.childTable;
  const childKind = section?.childKind;
  const childTitle =
    childTable === "order_drawing_revisions"
      ? "Drawing Revisions"
      : childTable === "order_boi_items"
        ? "Bought-out items"
        : childKind === "tentative"
          ? "Tentative packing Details"
          : "Actual packing Details";
  // The gate is a property of each SO (e.g. its Market Type), so it's
  // evaluated against that SO's own row, not the queue as a whole.
  function childGateOkFor(head: Row): boolean {
    const gate = section?.childGate;
    if (!gate) return true;
    return "present" in gate
      ? toInput(head[gate.column]).trim() !== ""
      : toInput(head[gate.column]) === gate.value;
  }
  // The queue query ships each EC's slips inline as `child_rows`.
  function childRowsFor(ec: Row): Row[] {
    return (ec.child_rows ?? []) as Row[];
  }

  // Opens this SO's discussion. Department users see only their own lane;
  // Central sees every department's.
  function ChatButton({ orderId, soLabel }: { orderId: string; soLabel: string }) {
    const unread = unreadThreads[orderId] ?? 0;
    return (
      <button
        type="button"
        onClick={() => setThreadFor({ orderId, soLabel })}
        aria-label={`Discussion for SO ${soLabel}`}
        title="Chat"
        className="relative inline-flex h-8 w-8 items-center justify-center rounded-lg border border-input-border text-foreground transition-colors hover:bg-background"
      >
        <MessageSquare className="h-3.5 w-3.5" />
        {unread > 0 && (
          <span className="absolute -right-1.5 -top-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-600 px-1 text-[10px] font-bold text-white">
            {unread}
          </span>
        )}
      </button>
    );
  }

  // An empty table means one of two very different things — say which, so a
  // search that matched nothing isn't read as an empty queue.
  const emptyMessage = getParam("q")
    ? "No orders match your search."
    : "No orders yet.";

  const colCount = groupBySo
    ? 4 + (showParty ? 1 : 0) + soContext.length + 1 + // toggle + Sl. + SO + client_name? + context + ECs + chat
      (soEdit ? 2 + (canEdit ? 1 : 0) + (table === "order_planning" ? 2 : 0) : 0) + // SO status + date (+ assembly, dispatch) + edit
      (section?.soChild ? 1 : 0) // packing slips on the row
    : 3 +
      (showEcNo ? 1 : 0) +
      (showParty ? 1 : 0) +
      soContext.length +
      visibleFields.length +
      (canEdit ? 1 : 0) +
      documents.length;
  const title = SECTION_BY_TABLE.get(table)?.title ?? "Details";

  return (
    <div>
      <div className="mb-3">
        {/* The same filter bar the orders list carries, with this
            department pinned: its own statuses, its own target. */}
        {filterOptions && dept ? (
          <OrderListFilterBar
            options={filterOptions}
            total={queue.total}
            dept={dept}
            hasTarget={DEPT_VIEWS[dept].hasTarget}
            searchPlaceholder={searchPlaceholder}
          />
        ) : (
          <UrlSearchInput placeholder={searchPlaceholder} />
        )}
      </div>

      <div className="rounded-xl border border-card-border bg-surface shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-sm">
            <thead>
              <tr className="border-b border-card-border text-left text-xs font-semibold uppercase tracking-wide text-muted">
                {groupBySo && <th className="w-8 px-2 py-3" />}
                <th className="px-4 py-3"><SortHeader label="Sl." sortKey="sl" /></th>
                <th className="px-4 py-3">SO No.</th>
                <th className="px-4 py-3">Chat</th>
                {!groupBySo && showEcNo && <th className="px-4 py-3">EC No.</th>}
                {showParty && <th className="px-4 py-3">Client Name</th>}
                {soContext.map((f) => (
                  <th
                    key={f.column}
                    className="px-3 py-3 whitespace-nowrap text-muted-foreground"
                  >
                    {f.column === "so_date" ? (
                      <SortHeader label={f.label} sortKey="so_date" />
                    ) : table === "order_accounts" && f.column === "payment_terms" ? (
                      "Payment terms & PIs"
                    ) : (
                      f.label
                    )}
                  </th>
                ))}
                {groupBySo ? (
                  <>
                    <th className="px-4 py-3 text-center normal-case">ECs</th>
                    {soEdit && (
                      <>
                        <th className="px-4 py-3">Status</th>
                        <th className="px-4 py-3 whitespace-nowrap">
                          {table === "order_planning" || table === "order_assembly_dispatch" ? (
                            <SortHeader label={soDateLabel} sortKey="readiness" />
                          ) : (
                            soDateLabel
                          )}
                        </th>
                        {/* Planning sees how far Assembly & Packing and Dispatch have got. */}
                        {table === "order_planning" && (
                          <>
                            <th className="px-4 py-3 whitespace-nowrap">Assembly &amp; Packing</th>
                            <th className="px-4 py-3">Dispatch</th>
                          </>
                        )}
                        {canEdit && <th className="px-4 py-3 text-right">Edit</th>}
                      </>
                    )}
                    {section?.soChild && <th className="px-4 py-3">{section.soChild.title}</th>}
                  </>
                ) : (
                  <>
                    {visibleFields.map((f) => (
                      <th key={f.column} className="px-3 py-3 whitespace-nowrap">
                        {f.label}
                      </th>
                    ))}
                    {documents.map((doc) => (
                      <th key={doc.table} className="px-3 py-3 whitespace-nowrap">
                        {doc.label}
                      </th>
                    ))}
                    {SIGN_OFF_ENABLED && dept && !completePerEc && (
                  <th className="px-3 py-3">Complete</th>
                )}
                {canEdit && <th className="px-4 py-3 text-right">Edit</th>}
                  </>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-card-border">
              {(groupBySo ? soGroups.length === 0 : pageRows.length === 0) && (
                <tr>
                  <td
                    colSpan={colCount}
                    className="px-4 py-10 text-center text-sm text-muted"
                  >
                    {emptyMessage}
                  </td>
                </tr>
              )}
              {!groupBySo &&
                pageRows.map((order) => (
                  <tr
                    key={String(order.id)}
                    data-focus-row={String(order.id)}
                    // Accounts: the row opens its Order details — not a click on
                    // the row's own buttons and fields.
                    onClick={
                      table === "order_accounts"
                        ? (e) => {
                            if ((e.target as HTMLElement).closest("button, a, input, select, textarea, label, [role=dialog]")) return;
                            setDetailsFor(String(order.id));
                          }
                        : undefined
                    }
                    title={table === "order_accounts" ? "Click for order details" : undefined}
                    className={`text-foreground ${
                      dispatchRowTone(order) ?? (table === "order_accounts" ? "hover:bg-background/60" : "")
                    } ${table === "order_accounts" ? "cursor-pointer" : ""} ${focusClass(String(order.id))}`}
                  >
                    <td className="px-4 py-3 font-medium tabular-nums">
                      {String(order.sl_no ?? "—")}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {toInput(order.so_no) || "—"}
                      <HoldBadge order={order} />
                      {/* Accounts can hold the SO for a payment reason. */}
                      {table === "order_accounts" && canEdit && <AccountsHoldButton order={order} />}
                    </td>
                    <td className="px-4 py-3">
                      <ChatButton
                        orderId={String(order.order_id ?? order.id)}
                        soLabel={toInput(order.so_no) || String(order.sl_no ?? "")}
                      />
                    </td>
                    {showEcNo && (
                      <td className="px-4 py-3 whitespace-nowrap">
                        {toInput(order.ec_no) || "—"}
                      </td>
                    )}
                    {showParty && (
                      <td className="px-4 py-3">{toInput(order.client_name) || "—"}</td>
                    )}
                    {soContext.map((f) =>
                      // Accounts: each payment term with the PI raised against it.
                      table === "order_accounts" && f.column === "payment_terms" ? (
                        <td key={f.column} className="px-3 py-3 align-top">
                          <TermPis
                            orderId={String(order.id)}
                            soLabel={toInput(order.so_no) || String(order.sl_no ?? "")}
                            terms={(order.term_lines ?? []) as Row[]}
                            pis={(order.pi_docs ?? []) as Row[]}
                            canEdit={false}
                            payments={{ canEdit: canEdit && !lockReason(table, order) }}
                          />
                        </td>
                      ) : (
                      <td
                        key={f.column}
                        className="px-3 py-3 whitespace-nowrap text-muted"
                      >
                        {contextCell(f, order)}
                      </td>
                      )
                    )}
                    {visibleFields.map((f) => (
                      <td key={f.column} className="px-3 py-3 whitespace-nowrap">
                        {!fieldApplies(f, order)
                          ? "—"
                          : table === "order_accounts"
                            ? contextValue(f, order)
                            : formatValue(f, order[f.column])}
                      </td>
                    ))}
                    {documents.map((doc) => (
                      <td key={doc.table} className="px-3 py-3 whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => setDocsPanel({ row: order, config: doc })}
                          className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-input-border px-3 text-xs font-medium text-foreground transition-colors hover:bg-background"
                        >
                          <Paperclip className="h-3.5 w-3.5" />
                          {doc.counts[String(order.id)] ?? 0} file
                          {(doc.counts[String(order.id)] ?? 0) === 1 ? "" : "s"}
                        </button>
                      </td>
                    ))}
                    {SIGN_OFF_ENABLED && dept && !completePerEc && (
                      <td className="px-3 py-3">
                        {completeCell(
                          String(order.id),
                          toInput(order.so_no) || String(order.sl_no ?? "")
                        )}
                      </td>
                    )}
                    {canEdit && (
                      <td className="px-4 py-3 text-right">
                        {lockReason(table, order) ? (
                          // Accounts on an order paid after receipt: nothing
                          // to record, so no form to open.
                          <span className="text-xs text-muted-foreground">—</span>
                        ) : (
                        <button
                          type="button"
                          onClick={() => setEditRow(order)}
                          className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-input-border px-3 text-xs font-medium text-foreground transition-colors hover:bg-background"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                          Edit
                        </button>
                        )}
                      </td>
                    )}
                  </tr>
                ))}

              {groupBySo &&
                soGroups.map((g) => {
                  const isOpen = expanded.has(g.key);
                  return (
                    <Fragment key={g.key}>
                      <tr
                        data-focus-row={String(g.head.order_id ?? g.head.id)}
                        className={`text-foreground transition-colors ${
                          dispatchRowTone(g.head) ?? "hover:bg-background/60"
                        } ${focusClass(String(g.head.order_id ?? g.head.id))}`}
                      >
                        <td className="px-2 py-3 text-center">
                          <button
                            type="button"
                            onClick={() => toggleSo(g.key)}
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
                        <td className="px-4 py-3 font-medium tabular-nums">
                          {String(g.head.sl_no ?? "—")}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          {toInput(g.head.so_no) || "—"}
                          <HoldBadge order={g.head} />
                        </td>
                        <td className="px-4 py-3">
                          <ChatButton
                            orderId={String(g.head.order_id ?? g.head.id)}
                            soLabel={toInput(g.head.so_no) || String(g.head.sl_no ?? "")}
                          />
                        </td>
                        {showParty && (
                          <td className="px-4 py-3">
                            {toInput(g.head.client_name) || "—"}
                          </td>
                        )}
                        {soContext.map((f) => (
                          <td
                            key={f.column}
                            className="px-3 py-3 whitespace-nowrap text-muted"
                          >
                            {contextCell(f, g.head)}
                          </td>
                        ))}
                        <td className="px-4 py-3 text-center tabular-nums">
                          {g.ecs.length}
                        </td>
                        {soEdit && (() => {
                          const sum = soSummary(g.ecs);
                          const mixed = new Set(g.ecs.map(isSpareRow)).size > 1;
                          return (
                            <>
                              <td className="px-4 py-3 whitespace-nowrap">{sum.status}</td>
                              <td className="px-4 py-3 whitespace-nowrap text-muted">
                                {/* Planning and Central can see how the lots moved; Assembly
                                    works from the latest. */}
                                {/* A Fully ready SO has no date left to show, but its
                                    history still says when it moved. */}
                                {table === "order_planning" &&
                                (role === "planning" || role === "central_visibility" || role === "admin") &&
                                (sum.date !== "—" || sum.status === "Fully ready") ? (
                                  <ReadyLotHistoryButton
                                    orderId={String(g.head.order_id)}
                                    label={sum.date === "—" ? "History" : sum.date}
                                    soLabel={toInput(g.head.so_no) || String(g.head.sl_no ?? "")}
                                  />
                                ) : (
                                  sum.date
                                )}
                                {(table === "order_planning" || table === "order_assembly_dispatch") && (() => {
                                  const late = readinessOverdueDays(g.ecs);
                                  return late > 0 ? (
                                    <div className="mt-0.5 text-[11px] font-medium text-rose-600">
                                      Overdue by {late} day{late === 1 ? "" : "s"}
                                    </div>
                                  ) : null;
                                })()}
                              </td>
                              {table === "order_planning" && (() => {
                                const asm = soSummary(g.ecs, "order_assembly_dispatch");
                                return (
                                  <>
                                    <td className="px-4 py-3 whitespace-nowrap">
                                      {asm.status}
                                      {asm.date !== "—" && asm.date !== "Mixed" && (
                                        <div className="text-[11px] text-muted">{asm.date}</div>
                                      )}
                                    </td>
                                    <td className="px-4 py-3 whitespace-nowrap">{toInput(g.head.so_dispatch_status) || "Pending"}</td>
                                  </>
                                );
                              })()}
                              {canEdit && (
                                <td className="px-4 py-3 text-right">
                                  {mixed || lockReason(table, g.head) ? (
                                    <span
                                      className="text-xs text-muted-foreground"
                                      title={mixed ? "Pump and Spare ECs — edit each EC" : undefined}
                                    >
                                      —
                                    </span>
                                  ) : (
                                    <button
                                      type="button"
                                      onClick={() =>
                                        setEditSo({
                                          orderId: String(g.head.order_id),
                                          head: g.ecs[0],
                                          count: g.ecs.length,
                                        })
                                      }
                                      className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-primary/40 bg-primary/10 px-3 text-xs font-semibold text-primary transition-colors hover:bg-primary hover:text-primary-foreground"
                                    >
                                      <Pencil className="h-3.5 w-3.5" />
                                      Edit SO
                                    </button>
                                  )}
                                </td>
                              )}
                            </>
                          );
                        })()}
                        {/* Assembly & Packing: the SO's packing slips, on the row. */}
                        {section?.soChild && (
                          <td className="px-4 py-3 align-top">
                            <PackingSlipsInline
                              orderId={String(g.head.order_id)}
                              soLabel={toInput(g.head.so_no) || String(g.head.sl_no ?? "")}
                              slips={(g.head.so_child_rows ?? []) as Row[]}
                              context={{
                                market_type: g.head.market_type,
                                packing_details_required: g.head.packing_details_required,
                              }}
                              gateOk={
                                !section.soChild.gate ||
                                toInput(g.head[section.soChild.gate.column]).trim() !== ""
                              }
                              canEdit={canEdit}
                              canEditCentral={canEditCentral}
                            />
                          </td>
                        )}
                      </tr>
                      {isOpen && (
                        <tr className="bg-background/40">
                          <td colSpan={colCount} className="p-0">
                            {hasFlatColumns && (
                            <div className="overflow-x-auto px-4 py-3">
                              <table className="w-full text-sm">
                                <thead>
                                  <tr className="text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                                    <th className="px-3 py-2">EC No.</th>
                                    {showLots(g.ecs) && (
                                      <th className="px-3 py-2 whitespace-nowrap">Readiness lots</th>
                                    )}
                                    {ecContextFor(g.ecs).map((f) => (
                                      <th
                                        key={f.column}
                                        className="px-3 py-2 whitespace-nowrap"
                                      >
                                        {f.label}
                                      </th>
                                    ))}
                                    {fieldsFor(g.ecs).map((f) => (
                                      <th
                                        key={f.column}
                                        className="px-3 py-2 whitespace-nowrap"
                                      >
                                        {f.label}
                                      </th>
                                    ))}
                                    {documents.map((doc) => (
                                      <th
                                        key={doc.table}
                                        className="px-3 py-2 whitespace-nowrap"
                                      >
                                        {doc.label}
                                      </th>
                                    ))}
                                    {SIGN_OFF_ENABLED && dept && completePerEc && (
                                      <th className="px-3 py-2">Complete</th>
                                    )}
                                    {canEdit && ecEditFor(g.ecs) && (
                                      <th className="px-3 py-2 text-right">Edit</th>
                                    )}
                                  </tr>
                                </thead>
                                <tbody>
                                  {g.ecs.map((ec) => (
                                    <tr
                                      key={String(ec.id)}
                                      data-focus-row={String(ec.id)}
                                      className={`text-foreground ${focusClass(String(ec.id))}`}
                                    >
                                      <td className="px-3 py-2 whitespace-nowrap font-medium">
                                        {toInput(ec.ec_no) || "—"}
                                      </td>
                                      {showLots(g.ecs) && (
                                        <td className="px-3 py-2">{lotsCell(ec)}</td>
                                      )}
                                      {ecContextFor(g.ecs).map((f) => (
                                        <td
                                          key={f.column}
                                          className="px-3 py-2 whitespace-nowrap text-muted"
                                        >
                                          {fieldApplies(f, ec) ? formatValue(f, ec[f.column]) : "—"}
                                        </td>
                                      ))}
                                      {fieldsFor(g.ecs).map((f) => (
                                        <td
                                          key={f.column}
                                          className="px-3 py-2 whitespace-nowrap"
                                        >
                                          {fieldApplies(f, ec)
                                            ? formatValue(f, ec[f.column])
                                            : "—"}
                                        </td>
                                      ))}
                                      {documents.map((doc) => (
                                        <td
                                          key={doc.table}
                                          className="px-3 py-2 whitespace-nowrap"
                                        >
                                          <button
                                            type="button"
                                            onClick={() =>
                                              setDocsPanel({ row: ec, config: doc })
                                            }
                                            className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-input-border px-2.5 text-xs font-medium text-foreground transition-colors hover:bg-background"
                                          >
                                            <Paperclip className="h-3.5 w-3.5" />
                                            {doc.counts[String(ec.id)] ?? 0} file
                                            {(doc.counts[String(ec.id)] ?? 0) === 1
                                              ? ""
                                              : "s"}
                                          </button>
                                        </td>
                                      ))}
                                      {SIGN_OFF_ENABLED && dept && completePerEc && (
                                        <td className="px-3 py-2">
                                          {completeCell(
                                            String(ec.id),
                                            toInput(ec.ec_no) || String(ec.id)
                                          )}
                                        </td>
                                      )}
                                      {canEdit && ecEditFor(g.ecs) && (
                                        <td className="px-3 py-2 text-right">
                                          <button
                                            type="button"
                                            onClick={() => setEditRow(ec)}
                                            className="inline-flex h-7 items-center gap-1 rounded-lg border border-input-border px-2.5 text-xs font-medium text-foreground transition-colors hover:bg-background"
                                          >
                                            <Pencil className="h-3.5 w-3.5" />
                                            Edit
                                          </button>
                                        </td>
                                      )}
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                            )}

                            <div className="px-4 py-3">
                              {/* Sections with a per-EC child list render it per EC. */}
                              {childTable && (
                                <div className="mt-4 space-y-4">
                                  {!childGateOkFor(g.head) ? (
                                    <p className="text-xs text-muted">
                                      Packing Details Required is not set to Yes
                                      on this order.
                                    </p>
                                  ) : (
                                    g.ecs.map((ec) => (
                                      <div
                                        key={`slips-${String(ec.id)}`}
                                        // Without the flat EC table this card is
                                        // the EC's only row — the deep-link target.
                                        data-focus-row={hasFlatColumns ? undefined : String(ec.id)}
                                        className={`rounded-lg border border-card-border bg-surface p-3 shadow-sm transition-colors ${
                                          hasFlatColumns ? "" : focusClass(String(ec.id))
                                        }`}
                                      >
                                        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                                          <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-slate-600">
                                            EC · {toInput(ec.ec_no) || "—"}
                                          </span>
                                          {/* Sections with flat fields already
                                              carry the sign-off in their EC
                                              table; this is for the ones whose
                                              ECs only appear here (Drawing). */}
                                          {!hasFlatColumns &&
                                            completeCell(
                                              String(ec.id),
                                              toInput(ec.ec_no) || String(ec.id)
                                            )}
                                        </div>
                                        {/* A Spare's readiness first: it is what
                                            the packing that follows depends on. */}
                                        <OrderChildList
                                          orderId={String(ec.id)}
                                          table={childTable}
                                          title={childTitle}
                                          fields={CHILD_FIELDS[childTable]}
                                          rows={childRowsFor(ec)}
                                          canEdit={canEdit}
                                          canEditCentral={canEditCentral}
                                          kind={childKind}
                                          context={{
                                            market_type: ec.market_type,
                                            packing_details_required:
                                              ec.packing_details_required,
                                          }}
                                          rowAction={
                                            childTable === "order_drawing_revisions"
                                              ? (rev) => (
                                                  <RevisionDocsButton
                                                    revisionId={String(rev.id)}
                                                    label={revisionDocsLabel(ec, rev)}
                                                    count={Number(rev.doc_count ?? 0)}
                                                  />
                                                )
                                              : undefined
                                          }
                                        />
                                      </div>
                                    ))
                                  )}
                                </div>
                              )}
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

      {editSo && canEdit && (
        <EditSectionModal
          orderId={String(editSo.head.id)}
          soTarget={{ orderId: editSo.orderId, count: editSo.count }}
          table={table}
          title={title}
          fields={fields}
          readonlyFields={readonlyFields}
          canEditCentral={canEditCentral}
          data={editSo.head}
          onClose={() => setEditSo(null)}
        />
      )}

      {editRow && canEdit && (
        <EditSectionModal
          orderId={String(editRow.id)}
          table={table}
          title={title}
          fields={fields}
          readonlyFields={readonlyFields}
          canEditCentral={canEditCentral}
          data={editRow}
          drawingDocCount={
            drawingDocCounts ? (drawingDocCounts[String(editRow.id)] ?? 0) : undefined
          }
          onClose={() => setEditRow(null)}
        />
      )}

      {detailsFor && <OrderDetailsModal orderId={detailsFor} onClose={() => setDetailsFor(null)} />}
      {docsPanel && (
        <QcDocumentsModal
          table={docsPanel.config.table}
          title={docsPanel.config.label}
          orderId={String(docsPanel.row.id)}
          label={[
            docsPanel.row.so_no,
            docsPanel.row.ec_no,
            showParty ? docsPanel.row.client_name : null,
          ]
            .filter(Boolean)
            .map(String)
            .join(" · ")}
          canEdit={docsPanel.config.canEdit}
          onClose={() => setDocsPanel(null)}
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

function EditSectionModal({
  orderId,
  table,
  title,
  fields,
  readonlyFields,
  canEditCentral,
  data,
  drawingDocCount,
  onClose,
  soTarget,
}: {
  orderId: string;
  /** Set for an SO-level edit: the form's values go to every EC of this SO. */
  soTarget?: { orderId: string; count: number };
  table: OrderTable;
  title: string;
  fields: OrderField[];
  readonlyFields: OrderField[];
  canEditCentral: boolean;
  data: Row;
  // Set when this department can be sent drawing documents; the button shows
  // whenever it is, so a department can check even when the count is zero.
  drawingDocCount?: number;
  onClose: () => void;
}) {
  const router = useRouter();
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      fields.map((f) => [f.column, canonicalSelectValue(f, toInput(data[f.column]) || f.defaultValue || "")])
    )
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showOrder, setShowOrder] = useState(false);
  const [showBoi, setShowBoi] = useState(false);
  // A Spare's readiness lots live in Planning's form; once there is one, the
  // status and readiness date are the latest lot's.
  const spareLots =
    table === "order_planning" && toInput(data.item_type).trim().toLowerCase() === "spare";
  const [lots, setLots] = useState<ReadyLot[]>(() => lotsFromRows(data.ready_lots));
  const lotsLead = spareLots ? lotsSummary(lots) : null;
  // …and Assembly & Packing records when each lot was packed.
  const spareAssembly =
    table === "order_assembly_dispatch" && toInput(data.item_type).trim().toLowerCase() === "spare";
  const [packLots, setPackLots] = useState<PackingLot[]>(() => packingLotsFromRows(data.ready_lots));

  async function save(e: FormEvent) {
    e.preventDefault();
    const lotProblem = spareLots ? lotsError(lots) : spareAssembly ? packingError(packLots) : null;
    if (lotProblem) {
      setError(lotProblem);
      return;
    }
    setSaving(true);
    setError(null);
    const res = await (soTarget
      ? (t: string, v: Record<string, string>) => updateSectionForSoAction(soTarget.orderId, t, v)
      : (t: string, v: Record<string, string>) => updateOrderSectionAction(orderId, t, v))(
      table,
      spareLots
        ? {
            ...values,
            ...(lotsLead
              ? { actual_spare_status: lotsLead.status, planning_readiness_date: lotsLead.date }
              : {}),
            [READY_LOTS_FIELD]: JSON.stringify(lots),
          }
        : spareAssembly
          ? { ...values, [PACKING_LOTS_FIELD]: JSON.stringify(packLots) }
          : values
    );
    setSaving(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    router.refresh();
    onClose();
  }

  const showParty = table === "order_billing" || table === "order_accounts";
  const PI_ROLLED_UP = ["payment_status", "payment_confirmed_date", "amount_received", "hold_reason"];
  const identity = [data.so_no, data.ec_no].filter(Boolean).join(" · ");
  const inputClass =
    "h-10 w-full rounded-[10px] border border-input-border bg-surface px-3 text-[14px] text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-ring/20 disabled:cursor-not-allowed disabled:opacity-50";

  // Accounts: Order Value (+GST) follows the GST % being typed — the stored
  // figure re-based from the saved rate onto the new one (blank = 18%).
  // …and the balance follows both it and the amount received being typed.
  const liveBalance = (): unknown => {
    const total = Number(liveValueWithGst());
    if (!Number.isFinite(total) || toInput(data.order_value_gst) === "") return data.balance_of_payment;
    const received = Number(toInput(values.amount_received) || "0");
    if (!Number.isFinite(received)) return data.balance_of_payment;
    return (Math.round((total - received) * 100) / 100).toFixed(2);
  };
  const liveValueWithGst = (): unknown => {
    const stored = Number(data.order_value_gst);
    if (!Number.isFinite(stored) || toInput(data.order_value_gst) === "") return data.order_value_gst;
    const rate = (v: unknown) => {
      const n = Number(toInput(v) || "18");
      return Number.isFinite(n) ? n : 18;
    };
    const base = stored / (1 + rate(data.gst_rate) / 100);
    return (Math.round(base * (1 + rate(values.gst_rate) / 100) * 100) / 100).toFixed(2);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} aria-hidden />
      <div className="relative max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-t-2xl border border-card-border bg-card p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] shadow-xl sm:rounded-2xl sm:p-6 sm:pb-6">
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute right-4 top-4 text-muted-foreground hover:text-foreground"
        >
          <X className="h-5 w-5" />
        </button>

        <div className="flex items-center justify-between gap-3 pr-8">
          <h2 className="font-display text-lg font-semibold text-foreground">
            {title}
            {soTarget && (
              <span className="ml-2 align-middle rounded-full bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">
                All {soTarget.count} EC{soTarget.count === 1 ? "" : "s"}
              </span>
            )}
          </h2>
          {/* Planning schedules around bought-out receipts, so they can read
              this EC's BOI rows — filled by Central and Purchase, never here.
              Only worth offering when the SO is actually flagged BOI = Yes. */}
          {/* A Spare has no drawing, so no drawing documents to read. */}
          {drawingDocCount !== undefined && toInput(data.item_type).trim().toLowerCase() !== "spare" && (
            <EcDrawingDocsButton
              itemId={orderId}
              label={identity || "This EC"}
              count={drawingDocCount}
            />
          )}
          {table === "order_planning" && String(data.boi ?? "") === "Yes" && (
            <button
              type="button"
              onClick={() => setShowBoi(true)}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-input-border px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-background"
            >
              <Package className="h-3.5 w-3.5" />
              View BOI items
            </button>
          )}
          {/* orderId is the SO's order_id only for SO-scope sections — the rest
              are keyed by item_id. Accounts sees PIs and order details on its
              list row, so its form carries neither button. */}
          {table === "order_billing" && (
            <div className="flex shrink-0 items-center gap-2">
              <button
                type="button"
                onClick={() => setShowOrder(true)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-input-border px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-background"
              >
                <ClipboardList className="h-3.5 w-3.5" />
                View order details
              </button>
            </div>
          )}
        </div>
        <p className="mb-5 text-sm text-muted">
          Order #{String(data.sl_no ?? "—")}
          {soTarget
            ? ` · ${toInput(data.so_no)} · saved to every EC of this SO (shown from ${toInput(data.ec_no) || "the first EC"})`
            : identity
              ? ` · ${identity}`
              : ""}
          {showParty && data.client_name ? ` · ${String(data.client_name)}` : ""}
        </p>

        {/* The modal shows one EC, so its row carries both the SO-level and
            the per-EC context — no need to split them here. */}
        {readonlyFields.length > 0 && (
          <div className="mb-5 grid grid-cols-1 gap-x-6 gap-y-3 rounded-xl bg-background/60 p-4 sm:grid-cols-2">
            {readonlyFields
              .filter((f) => dependsOnSatisfied(f, (col) => toInput(data[col])))
              .map((f) => (
              <div key={f.column}>
                <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  {f.label}
                </div>
                <div className="text-sm text-muted">
                  {contextValue(f, data, f.column === "order_value_gst" ? liveValueWithGst() : data[f.column])}
                </div>
              </div>
            ))}
          </div>
        )}

        <form onSubmit={save}>
          {error && (
            <div className="mb-4 rounded-[10px] border border-danger-border bg-danger-bg px-4 py-2.5 text-sm text-danger">
              {error}
            </div>
          )}

          <div className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
            {spareAssembly && (
              <PackingLotsEditor lots={packLots} onChange={setPackLots} editing />
            )}
            {fields.map((field) => {
              // Cascade: a dependsOn'd field (e.g. billing docs gated on the
              // order's bill_type) is hidden entirely when its condition, read
              // from the edit values then the row data, isn't met.
              if (
                !dependsOnSatisfied(
                  field,
                  (col) => values[col] ?? toInput(data[col])
                )
              ) {
                return null;
              }
              // A Spare with lots: its status and readiness date follow the
              // latest lot, and the lots sit right under the status.
              if (
                lotsLead &&
                (field.column === "actual_spare_status" || field.column === "planning_readiness_date")
              ) {
                return (
                  <Fragment key={field.column}>
                    <div>
                      <label className="mb-1.5 flex items-center gap-1.5 text-[13px] font-medium text-brand-label">
                        {field.label}
                        <span className="rounded bg-slate-100 px-1 text-[9px] font-semibold text-slate-500">
                          from lots
                        </span>
                      </label>
                      <div className="flex h-10 items-center px-1 text-[14px] text-foreground">
                        {field.column === "actual_spare_status"
                          ? lotsLead.status || "—"
                          : formatValue(field, lotsLead.date)}
                      </div>
                    </div>
                    {field.column === "actual_spare_status" && (
                      <ReadyLotsEditor lots={lots} onChange={setLots} editing />
                    )}
                  </Fragment>
                );
              }
              // Computed and (for non-central users) centralOnly fields are
              // shown read-only rather than as inputs. So is an SO's payment
              // once it has a PI: Accounts records it against each PI.
              const fromPis = table === "order_accounts" && PI_ROLLED_UP.includes(field.column) &&
                Array.isArray(data.pi_docs) && data.pi_docs.length > 0;
              if (field.computed || fromPis || (field.centralOnly && !canEditCentral)) {
                return (
                  <div key={field.column}>
                    <label className="mb-1.5 flex items-center gap-1.5 text-[13px] font-medium text-brand-label">
                      {field.label}
                      <span className="rounded bg-slate-100 px-1 text-[9px] font-semibold text-slate-500">
                        {field.computed ? "auto" : fromPis ? "from PIs" : "read-only"}
                      </span>
                    </label>
                    <div className="flex h-10 items-center px-1 text-[14px] text-muted">
                      {formatValue(
                        field,
                        field.column === "balance_of_payment" ? liveBalance() : data[field.column]
                      )}
                    </div>
                  </div>
                );
              }
              return (
                <Fragment key={field.column}>
                <div>
                  <label className="mb-1.5 block text-[13px] font-medium text-brand-label">
                    {field.label}
                  </label>
                  {field.type === "select" ? (
                    <select
                      value={values[field.column] ?? ""}
                      onChange={(e) => {
                        const next = e.target.value;
                        setValues((v) => ({ ...v, [field.column]: next }));
                        // Partial / Fully ready opens Lot 1 with that status.
                        if (
                          spareLots &&
                          field.column === "actual_spare_status" &&
                          lots.length === 0 &&
                          (next === "Partial ready" || next === "Fully ready")
                        ) {
                          setLots([{ status: next, ready_date: "" }]);
                        }
                      }}
                      className={`${inputClass} cursor-pointer`}
                    >
                      <option value="">—</option>
                      {selectOptionsFor(field, values[field.column] ?? "").map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type={
                        field.type === "date"
                          ? "date"
                          : field.type === "text"
                            ? "text"
                            : "number"
                      }
                      step={field.type === "number" ? "any" : undefined}
                      min={field.min}
                      value={values[field.column] ?? ""}
                      onChange={(e) =>
                        setValues((v) => ({ ...v, [field.column]: e.target.value }))
                      }
                      className={inputClass}
                    />
                  )}
                </div>
                {/* Partial / Fully ready with no lot yet: the lots open here. */}
                {spareLots &&
                  field.column === "actual_spare_status" &&
                  readyLotsOpen(values.actual_spare_status) && (
                    <ReadyLotsEditor lots={lots} onChange={setLots} editing />
                  )}
                </Fragment>
              );
            })}
          </div>

          <div className="mt-6 flex gap-3">
            <button
              type="button"
              onClick={onClose}
              className="h-11 flex-1 rounded-[10px] border border-input-border bg-surface text-sm font-medium text-foreground transition-colors hover:bg-background"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex h-11 flex-1 items-center justify-center gap-2 rounded-[10px] bg-primary text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary-hover disabled:opacity-70"
            >
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              {saving ? "Saving…" : "Save changes"}
            </button>
          </div>
        </form>
      </div>

      {showOrder && (
        <OrderDetailsModal orderId={orderId} onClose={() => setShowOrder(false)} />
      )}
      {/* Item-scope sections key `orderId` by item_id, which is exactly what
          the BOI rows hang off. */}
      {showBoi && (
        <BoiItemsModal
          itemId={orderId}
          label={identity}
          onClose={() => setShowBoi(false)}
        />
      )}
    </div>
  );
}
