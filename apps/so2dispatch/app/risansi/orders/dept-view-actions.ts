"use server";

import { getCurrentUser } from "@/lib/session";
import {
  canEditChild,
  canEditQcDocuments,
  canEditSection,
  canViewAll,
  canViewDepartment,
  isCentral,
} from "@/lib/roles";
import {
  listBoiVendors,
  listDeptCompletions,
  listItemsForPurchasePage,
  listItemsForSectionPage,
  listVendorList,
  orderEcKind,
  type BoiVendor,
} from "@/lib/orders";
import {
  ASSEMBLY_CONTEXT_FIELDS,
  DRAWING_CONTEXT_FIELDS,
  PLANNING_CONTEXT_FIELDS,
  QC_CONTEXT_FIELDS,
  type OrderField,
  type OrderTable,
} from "@/lib/order-schema";
import { parseDeptFilter } from "@/lib/order-list-filter";
import { unreadByOrder } from "@/lib/order-messages";
import { countEcDocuments } from "@/lib/drawing-docs-db";
import { soDrawingState } from "@/lib/drawing-filter";
import { ecPurchaseState, soPurchaseState } from "@/lib/purchase-filter";
import { soQcState } from "@/lib/qc-filter";
import type { DeptCompletion } from "@/lib/dept-completion";
import type { PageResult } from "@/lib/pagination";

export type ViewDept = "drawing" | "purchase" | "quality" | "planning" | "assembly";
type Row = Record<string, unknown>;

export type DeptViewData = {
  dept: ViewDept;
  /** Planning / Assembly & Packing: the SO's side, Spare or Pump. */
  ecKind: "spare" | "pump";
  queue: PageResult<Row>;
  completions: DeptCompletion[];
  unreadThreads: Record<string, number>;
  canEdit: boolean;
  canEditCentral: boolean;
  drawingDocCounts?: Record<string, number>;
  vendors?: string[];
  vendorList?: BoiVendor[];
};

const TABLE: Record<ViewDept, OrderTable> = {
  drawing: "order_drawing",
  purchase: "order_purchase",
  quality: "order_qc",
  planning: "order_planning",
  assembly: "order_assembly_dispatch",
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const context = (fields: OrderField[]) =>
  fields.map((f) => ({ column: f.column, type: f.type, from: f.from ?? ("orders" as const) }));

/**
 * One SO's rows in a department, read as that department's own page reads
 * them — for the Orders list's pop-up, which shows the department's own
 * screen for just that SO.
 */
export async function orderDeptViewAction(
  orderId: string,
  dept: ViewDept
): Promise<{ ok: true; data: DeptViewData } | { ok: false; error: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "You are not signed in." };
  if (!UUID_RE.test(orderId) || !(dept in TABLE)) return { ok: false, error: "Not found." };
  const table = TABLE[dept];
  if (!canViewAll(user.role) && !canViewDepartment(user.role, table)) return { ok: false, error: "No access." };

  // This SO only (the id is checked above, so it can go in as text).
  const only = `o.id = '${orderId}'::uuid`;
  const ecKind = (await orderEcKind(orderId)) ?? "spare";
  const types = ecKind === "pump" ? ["Pump", "ROLB"] : ["Spare"];
  const page = { page: 1, search: "" };

  let queue: PageResult<Row>;
  let canEdit = false;
  const extra: Partial<DeptViewData> = {};
  if (dept === "purchase") {
    queue = (await listItemsForPurchasePage({ ...page, extraRestrict: only })) as unknown as PageResult<Row>;
    canEdit = canEditChild(user.role, "order_boi_items");
    // Each SO's and EC's state, from all its items (as the Purchase page does).
    const pumps = queue.rows.filter((r) => String(r.item_type ?? "").trim().toLowerCase() !== "spare");
    const so = soPurchaseState(pumps);
    for (const r of queue.rows) Object.assign(r, { pur_so_state: so, pur_ec_state: ecPurchaseState(r) });
    const [vendors, vendorList] = await Promise.all([listBoiVendors(), listVendorList()]);
    Object.assign(extra, { vendors, vendorList });
  } else {
    const fields =
      dept === "drawing"
        ? DRAWING_CONTEXT_FIELDS
        : dept === "quality"
          ? QC_CONTEXT_FIELDS
          : dept === "planning"
            ? PLANNING_CONTEXT_FIELDS
            : ASSEMBLY_CONTEXT_FIELDS;
    const typed = dept === "planning" || dept === "assembly";
    // Assembly & Packing's Pump view: the SO only once Planning has something ready on it.
    const pumpReady =
      dept === "assembly" && ecKind === "pump"
        ? `EXISTS (SELECT 1 FROM order_items s JOIN order_planning pl ON pl.item_id = s.id
                    WHERE s.order_id = o.id AND s.item_type IN ('Pump', 'ROLB')
                      AND (pl.actual_spare_status IN ('Partial ready', 'Fully ready') OR COALESCE(pl.ready_qty, 0) > 0))`
        : "TRUE";
    queue = await listItemsForSectionPage(table, context(fields), {
      ...page,
      filter: typed ? { ...parseDeptFilter(() => undefined, dept), types } : undefined,
      extraRestrict: `${only} AND ${pumpReady}`,
    });
    canEdit =
      dept === "drawing"
        ? canEditChild(user.role, "order_drawing_revisions")
        : dept === "quality"
          ? canEditQcDocuments(user.role)
          : canEditSection(user.role, table);
    if (dept === "drawing") {
      const st = soDrawingState(queue.rows);
      for (const r of queue.rows) Object.assign(r, { so_drawing_closed: st.closed, so_drawing_closed_date: st.date });
    }
    if (dept === "quality") {
      const st = soQcState(queue.rows);
      for (const r of queue.rows) Object.assign(r, { qc_so_state: st });
    }
  }

  const orderIds = [orderId];
  const [completions, unreadThreads, drawingDocCounts] = await Promise.all([
    listDeptCompletions(orderIds),
    unreadByOrder(orderIds, user),
    dept === "planning" || dept === "purchase"
      ? countEcDocuments(queue.rows.map((r) => String(r.id)), user.role)
      : Promise.resolve(undefined),
  ]);

  return {
    ok: true,
    data: {
      dept,
      ecKind,
      queue,
      completions,
      unreadThreads,
      canEdit,
      canEditCentral: isCentral(user.role),
      drawingDocCounts,
      ...extra,
    },
  };
}
