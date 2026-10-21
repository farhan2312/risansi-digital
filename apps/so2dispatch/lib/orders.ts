import { query, withTransaction } from "@/lib/db";
import type { PoolClient } from "pg";
import {
  TARGET_BY_KEY,
  type TargetDate,
  type TargetKey,
  type TargetRevision,
} from "@/lib/target-dates";
import {
  deptForTable,
  targetKeyForDept,
  type DeptCompletion,
  type DeptKey,
} from "@/lib/dept-completion";
import {
  deptInvolvementSql,
  deptQueueSql,
  releasedSql,
  boiReceivedSql,
  orderOpenSql,
  orderStatusSql,
  spareEcSql,
  assemblyDueSql,
} from "@/lib/dept-view";
import { autoTargets, spareDeliveryDate } from "@/lib/target-rules";
import { DEFAULT_GST_RATE } from "@/lib/order-validation";
import { PLANNING_READY_SQL } from "@/lib/reminders";
import type { LockFacts } from "@/lib/order-lock";
import type { SoLot } from "@/lib/ready-lots";
import {
  isPerEcDept,
  NOT_APPLICABLE,
  PENDING,
  type DeptFilterKey,
} from "@/lib/dept-status";
import { FIELD_FILTER_FIELDS, NOT_SET, type OrderListFilter, type SignOff } from "@/lib/order-list-filter";
import { sharedFacets, UNASSIGNED, type OrderMakingFilter } from "@/lib/order-making-filter";
import { appliesSql, filledSql, SO_DETAILS_FILLED_SQL, SO_DETAILS_MISSING_SQL } from "@/lib/order-gaps";
import {
  PAGE_SIZE,
  clampPage,
  likePattern,
  offsetFor,
  pageResult,
  type PageResult,
  pageWithTotal,
} from "@/lib/pagination";
import { ecDrawingDoneSql } from "@/lib/drawing-filter";
import { listTeams } from "@/lib/market-intell";
import {
  CHILD_FIELDS,
  PUMP_LIKE,
  READY_LOT_LIMIT,
  PAYMENT_HOLD_VALUE,
  coerceField,
  ORDER_MAKING_FIELDS,
  SO_DETAIL_COLUMNS,
  SECTION_BY_TABLE,
  type ChildTable,
  type OrderTable,
} from "@/lib/order-schema";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Columns still dropped from `orders` (trimmed to Client + Purchase Order
// Details + the SO-level commercial flags). A context field referencing one of
// these resolves to NULL rather than erroring with "column does not exist".
// The per-pump attributes now live on order_items, not orders.
const DROPPED_ORDER_COLUMNS = new Set([
  "ec_no",
  "ec_generated_date",
  "ec_rcvd_operations_date",
  "ec_sent_production_date",
  "file_no",
  "item",
  "model_no",
  "pump_qty",
  "pump_sno",
  "orientation",
  "liquid_application",
  "version",
  "project",
]);

type Row = Record<string, unknown>;

// ---------------------------------------------------------------------------
// SO (orders) — Client + Purchase Order Details + SO-level commercial flags
// ---------------------------------------------------------------------------

/** One EC/pump summary, embedded in the SO list and SO detail. Dispatch
 *  status is intentionally absent — it's an SO-level value, carried on
 *  OrderListRow, not per EC. */
export type ItemSummary = {
  id: string;
  seq: number;
  ec_no: string | null;
  ec_date: string | null;
  item_type: string | null;
  pump_type: string | null;
  model_no: string | null;
  internal_model: string | null;
  version: string | null;
  quantity: string | null;
};

/** A row in the master SO list — one per sales order, with its EC items. */
export type OrderListRow = {
  id: string;
  sl_no: number;
  so_no: string | null;
  so_date: string | null;
  client_name: string | null;
  client_code: string | null;
  reps: string | null;
  zone: string | null;
  po_no: string | null;
  order_type: string | null;
  order_value: string | null;
  /** The value's currency (INR when not given), and a USD order's INR figure. */
  order_currency: string | null;
  order_value_inr: string | null;
  // Whether this SO has bought-out items at all: the EC form only offers the
  // BOI list when it is Yes.
  boi: string | null;
  payment_status: string | null;
  // SO-level, derived from this SO's invoices (see recomputeDispatchStatus).
  dispatch_status: string | null;
  /** Central Visibility's clearance, and why a held SO is held. */
  clearance_status: string | null;
  clearance_hold_reason: string | null;
  /** Order Making's own hold: held, the SO goes to no department. */
  om_status?: string | null;
  om_hold_reason?: string | null;
  om_hold_remarks?: string | null;
  ec_count: number;
  items: ItemSummary[];
  // The Orders list page only: the rest of the holds, the payment terms with
  // their PIs and payments, and Planning's readiness across the ECs.
  clearance_remarks?: string | null;
  bill_mode?: string | null;
  bill_type?: string | null;
  accounts_hold_status?: string | null;
  accounts_hold_reason?: string | null;
  accounts_hold_remarks?: string | null;
  term_lines?: Row[];
  pi_docs?: Row[];
  readiness_from?: string | null;
  readiness_to?: string | null;
  readiness_status?: string | null;
  // When it was last made ready and last packed, and whether it has reached
  // Dispatch (a numbered packing slip).
  ready_on?: string | null;
  packed_on?: string | null;
  /** Assembly & Packing's next packing plan on the SO's Spare lots. */
  packing_plan?: { date: string; shift: string | null; pdi: string | null } | null;
  in_dispatch?: boolean;
  /** A Spare SO's readiness lots, Lot 1 to n across its ECs (Planning and Assembly & Packing columns). */
  lots?: SoLot[];
};

/** Fields captured when creating an SO (the core `orders` identity row). */
export type NewOrderInput = {
  so_no?: string;
  so_date?: string;
  client_code?: string;
  client_type?: string;
  client_name?: string;
  reps?: string;
  market_type?: string;
  zone?: string;
  industry_type?: string;
  order_type?: string;
  bill_type?: string;
  bill_mode?: string;
  complaint_no?: string;
  complaint_date?: string;
  complaint_ec_no?: string;
  file_no?: string;
  discount_percent?: string;
  gst_percent?: string;
  taxable_value?: string;
  po_received_date?: string;
  ec_sent_operation_date?: string;
  packing_forwarding_percent?: string;
  performance_curve_required?: string;
  boi?: string;
  qc_required?: string;
  quotation_no?: string;
  po_no?: string;
  customer_po_date?: string;
  freight_terms?: string;
  packing_requirement?: string;
  delivery_date_as_per_so?: string;
  so_handover_date?: string;
  payment_terms?: string;
  payment_terms_remarks?: string;
  order_value_inr?: string;
  ld?: string;
  ld_date?: string;
  order_value?: string;
  order_currency?: string;
  total_quantity?: string;
  drg_target_date?: string;
  dispatch_target_date?: string;
  dispatch_target_revised_date?: string;
  qc_doc_target_date?: string;
  purchase_target_date?: string;
  dispatch_team_target_date?: string;
  packing_details_required?: string;
  clearance_status?: string;
  clearance_hold_reason?: string;
  clearance_remarks?: string;
};

/** Fields captured when adding an EC/pump item (the Add-On form). */
export type NewItemInput = {
  ec_no?: string;
  ec_date?: string;
  item_type?: string;
  pump_type?: string;
  model_no?: string;
  internal_model?: string;
  quantity?: string;
  orientation?: string;
  suction?: string;
  delivery?: string;
  pump_sno?: string;
  application?: string;
  version?: string;
  // Name plate (Pump Add-On).
  capacity?: string;
  capacity_unit?: string;
  head?: string;
  head_unit?: string;
  drive_motor_rating?: string;
  drive_motor_rating_unit?: string;
  drive_motor_speed?: string;
  pump_speed?: string;
  liquid?: string;
  tag_no?: string;
  /** This pump's own BOI, Yes or No. */
  boi?: string;
};

function nullify(value?: string): string | null {
  const trimmed = (value ?? "").trim();
  return trimmed === "" ? null : trimmed;
}

function toInt(value?: string): number | null {
  const trimmed = (value ?? "").trim();
  if (trimmed === "") return null;
  const n = Number.parseInt(trimmed, 10);
  return Number.isNaN(n) ? null : n;
}

function toNumeric(value?: string): number | null {
  const trimmed = (value ?? "").trim();
  if (trimmed === "") return null;
  const n = Number(trimmed);
  return Number.isNaN(n) ? null : n;
}

// Sl. No. is a display serial: the list reads 1, 2, 3… with no holes, so it
// is handed out on create and closed up again on delete. Both take this lock
// first, so two people adding orders at the same moment cannot pick the same
// number.
const SL_NO_LOCK = "SELECT pg_advisory_xact_lock(hashtext('orders.sl_no'))";

/**
 * Renumber the orders 1..N in the order they already had, and leave the
 * identity sequence past the end so a default-valued insert still lands clear
 * of every row.
 */
async function resequenceSerialNumbers(client: PoolClient): Promise<void> {
  await client.query(
    `WITH ranked AS (
        SELECT id, row_number() OVER (ORDER BY sl_no, created_at, id) AS n
          FROM orders
     )
     UPDATE orders o SET sl_no = ranked.n
       FROM ranked
      WHERE o.id = ranked.id AND o.sl_no <> ranked.n`
  );
  await client.query(
    `SELECT setval(
        pg_get_serial_sequence('orders', 'sl_no'),
        GREATEST((SELECT COALESCE(max(sl_no), 0) FROM orders), 1)
     )`
  );
}

/** Insert a new SO. Its EC items and department detail are added afterwards. */
export async function createOrder(
  input: NewOrderInput
): Promise<{ id: string; sl_no: number }> {
  return withTransaction(async (client) => {
    await client.query(SL_NO_LOCK);
    const result = await client.query<{ id: string; sl_no: number }>(
      `INSERT INTO orders (
          sl_no,
          so_no, so_date, client_code, client_type, client_name, reps,
          market_type, zone, industry_type, quotation_no, po_no, customer_po_date,
          order_value, order_currency, qc_required, payment_terms, ld, ld_date,
          freight_terms, packing_requirement, delivery_date_as_per_so,
          order_type, bill_type, boi,
          total_quantity, drg_target_date, dispatch_target_date,
          dispatch_target_revised_date, qc_doc_target_date, purchase_target_date,
          packing_details_required, dispatch_team_target_date, so_handover_date,
          payment_terms_remarks, order_value_inr, bill_mode,
          complaint_no, complaint_date,
          clearance_status, clearance_hold_reason, clearance_remarks,
          complaint_ec_no, file_no, discount_percent, gst_percent, taxable_value,
          po_received_date, ec_sent_operation_date, packing_forwarding_percent,
          performance_curve_required
       ) VALUES (
          -- The next free number, under the lock above.
          (SELECT COALESCE(max(sl_no), 0) + 1 FROM orders),
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,
          $22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,
          $37,$38,$39,$40,$41,$42,$43,$44,$45,$46,$47,$48,$49,$50
       )
       RETURNING id, sl_no::int AS sl_no`,
      [
        nullify(input.so_no),
        nullify(input.so_date),
        nullify(input.client_code),
        nullify(input.client_type),
        nullify(input.client_name),
        nullify(input.reps),
        nullify(input.market_type),
        nullify(input.zone),
        nullify(input.industry_type),
        nullify(input.quotation_no),
        nullify(input.po_no),
        nullify(input.customer_po_date),
        toNumeric(input.order_value),
        nullify(input.order_currency),
        nullify(input.qc_required),
        nullify(input.payment_terms),
        nullify(input.ld),
        nullify(input.ld_date),
        nullify(input.freight_terms),
        nullify(input.packing_requirement),
        nullify(input.delivery_date_as_per_so),
        nullify(input.order_type),
        nullify(input.bill_type),
        nullify(input.boi),
        toInt(input.total_quantity),
        nullify(input.drg_target_date),
        nullify(input.dispatch_target_date),
        nullify(input.dispatch_target_revised_date),
        nullify(input.qc_doc_target_date),
        nullify(input.purchase_target_date),
        nullify(input.packing_details_required),
        nullify(input.dispatch_team_target_date),
        nullify(input.so_handover_date),
        nullify(input.payment_terms_remarks),
        // Only a non-INR order carries a conversion.
        (input.order_currency ?? "INR").toUpperCase() === "INR"
          ? null
          : toNumeric(input.order_value_inr),
        nullify(input.bill_mode),
        nullify(input.complaint_no),
        nullify(input.complaint_date),
        // Clear unless held.
        nullify(input.clearance_status) ?? "Clear",
        // A reason only goes with a Hold.
        input.clearance_status === "Hold" ? nullify(input.clearance_hold_reason) : null,
        input.clearance_status === "Hold" ? nullify(input.clearance_remarks) : null,
        // An FR's complaint EC only goes with an FR.
        input.bill_mode === "FR" ? nullify(input.complaint_ec_no) : null,
        nullify(input.file_no),
        toNumeric(input.discount_percent),
        toNumeric(input.gst_percent),
        toNumeric(input.taxable_value),
        // An FR has no PO.
        input.bill_mode === "FR" ? null : nullify(input.po_received_date),
        nullify(input.ec_sent_operation_date),
        toNumeric(input.packing_forwarding_percent),
        // A Spare has no drawing to curve.
        input.order_type === "Spare" ? null : nullify(input.performance_curve_required),
      ]
    );
    return result.rows[0];
  });
}

// ---------------------------------------------------------------------------
// EC items (order_items) — one row per pump/spare under an SO
// ---------------------------------------------------------------------------

// Either the pool or one transaction's client: both run a parameterized query
// the same way, so a write can be reused inside a transaction.
type Exec = <T extends Record<string, unknown>>(
  text: string,
  params?: unknown[]
) => Promise<{ rows: T[] }>;

/** What Central Visibility fills in per bought-out item on the EC form. */
export type NewBoiItem = {
  boi_item: string;
  boi_item_other?: string;
  boi_make?: string;
  boi_qty?: number | null;
  boi_description?: string;
};

/**
 * Add an EC and, in the same transaction, the bought-out items it was filed
 * with — Central Visibility lists them on the EC form (which offers the list
 * only on an SO whose BOI is Yes), Purchase then records what happened to each.
 */
export async function createItemWithBoiItems(
  orderId: string,
  input: NewItemInput,
  boi: NewBoiItem[]
): Promise<{ id: string; seq: number }> {
  if (boi.length === 0) return createItem(orderId, input);
  return withTransaction(async (client) => {
    const exec: Exec = (text, params) => client.query(text, params);
    const item = await createItem(orderId, input, exec);
    for (const row of boi) {
      await exec(
        `INSERT INTO order_boi_items (item_id, boi_item, boi_item_other, boi_make, boi_qty, boi_description)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          item.id,
          nullify(row.boi_item),
          nullify(row.boi_item_other),
          nullify(row.boi_make),
          row.boi_qty ?? null,
          nullify(row.boi_description),
        ]
      );
    }
    return item;
  });
}

/** Add an EC/pump item to an SO (the Add-On form). */
export async function createItem(
  orderId: string,
  input: NewItemInput,
  // Pass a transaction's client to insert the EC alongside other writes.
  exec: Exec = query
): Promise<{ id: string; seq: number }> {
  const result = await exec<{ id: string; seq: number }>(
    `INSERT INTO order_items (
        order_id, ec_no, ec_date, item_type, pump_type, model_no, internal_model,
        quantity, orientation, suction, delivery, pump_sno, application, version,
        capacity, capacity_unit, head, head_unit, drive_motor_rating, drive_motor_rating_unit,
        drive_motor_speed, pump_speed, liquid, tag_no, boi
     ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,
        $15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25
     )
     RETURNING id, seq::int AS seq`,
    [
      orderId,
      nullify(input.ec_no),
      nullify(input.ec_date),
      nullify(input.item_type),
      nullify(input.pump_type),
      nullify(input.model_no),
      nullify(input.internal_model),
      toInt(input.quantity),
      nullify(input.orientation),
      nullify(input.suction),
      nullify(input.delivery),
      nullify(input.pump_sno),
      nullify(input.application),
      nullify(input.version),
      toNumeric(input.capacity),
      nullify(input.capacity_unit),
      toNumeric(input.head),
      nullify(input.head_unit),
      toNumeric(input.drive_motor_rating),
      nullify(input.drive_motor_rating_unit),
      toNumeric(input.drive_motor_speed),
      toNumeric(input.pump_speed),
      nullify(input.liquid),
      nullify(input.tag_no),
      nullify(input.boi),
    ]
  );
  return result.rows[0];
}

/** Save the Order Copy file bytes onto an EC (Spare form's file upload). */
export async function setItemOrderCopy(
  itemId: string,
  file: { name: string; mimeType: string | null; size: number; data: Buffer }
): Promise<void> {
  if (!UUID_RE.test(itemId)) return;
  await query(
    `UPDATE order_items
        SET order_copy_file_name = $2,
            order_copy_mime_type = $3,
            order_copy_file_size = $4,
            order_copy_file_data = $5
      WHERE id = $1`,
    [itemId, file.name, file.mimeType, file.size, file.data]
  );
}

/** Fetch the Order Copy file bytes for one EC (download route). */
export async function getItemOrderCopy(
  itemId: string
): Promise<{ file_name: string; mime_type: string | null; file_data: Buffer } | null> {
  if (!UUID_RE.test(itemId)) return null;
  const result = await query<{
    order_copy_file_name: string | null;
    order_copy_mime_type: string | null;
    order_copy_file_data: Buffer | null;
  }>(
    `SELECT order_copy_file_name, order_copy_mime_type, order_copy_file_data
       FROM order_items WHERE id = $1`,
    [itemId]
  );
  const row = result.rows[0];
  if (!row?.order_copy_file_data || !row.order_copy_file_name) return null;
  return {
    file_name: row.order_copy_file_name,
    mime_type: row.order_copy_mime_type,
    file_data: row.order_copy_file_data,
  };
}

/** Delete an EC item (cascades to its department detail and lots). */
export async function deleteItem(id: string): Promise<void> {
  if (!UUID_RE.test(id)) return;
  await query(`DELETE FROM order_items WHERE id = $1`, [id]);
}

/** The EC items under one SO (summary shape). */
export async function listItems(orderId: string): Promise<ItemSummary[]> {
  if (!UUID_RE.test(orderId)) return [];
  const result = await query<ItemSummary>(
    `SELECT it.id,
            it.seq::int AS seq,
            it.ec_no,
            to_char(it.ec_date, 'YYYY-MM-DD') AS ec_date,
            it.item_type,
            it.pump_type,
            it.model_no,
            it.quantity::text AS quantity,
            ${DISPATCH_STATUS} AS dispatch_status
       FROM order_items it
       JOIN orders o ON o.id = it.order_id
      WHERE it.order_id = $1
      ORDER BY it.seq ASC`,
    [orderId]
  );
  return result.rows;
}

// ---------------------------------------------------------------------------
// Detail reads
// ---------------------------------------------------------------------------

// SO detail — the "Open" view: Client + Purchase Order + Billing + Accounts,
// plus the list of its EC items.
export type OrderDetail = {
  order: Row;
  order_billing: Row | null;
  order_accounts: Row | null;
  order_payment_terms: Row[];
  order_billing_docs: Row[];
  order_invoices: Row[];
  /** The SO's packing slips (both kinds); an older one may name its EC. */
  order_packing_slips: Row[];
  items: Row[];
};

/** SO detail: core + billing + accounts + dispatch + its PI list + EC items. */
export async function getOrderDetail(id: string): Promise<OrderDetail | null> {
  if (!UUID_RE.test(id)) return null;
  const result = await query<OrderDetail>(
    `SELECT
        -- The order, plus what its payment terms say about who still has work
        -- to do on it: the forms read the lock off this row.
        to_jsonb(o) || jsonb_build_object(
          'after_receipt_only', ${AFTER_RECEIPT_ONLY},
          -- Who set the order status, by name, for the banner.
          'status_set_by_name', (SELECT u.full_name FROM users u WHERE u.id = o.status_set_by),
          -- A Spare's readiness lots across its ECs, for the packing slips' Lot ticks.
          'lot_count', COALESCE((SELECT max(c) FROM (SELECT count(*)::int AS c FROM order_ready_lots lc
                                   JOIN order_items li ON li.id = lc.item_id
                                  WHERE li.order_id = o.id GROUP BY lc.item_id) x), 0),
          'packed_lots', COALESCE((SELECT jsonb_agg(DISTINCT n) FROM (
                                     SELECT (row_number() OVER (PARTITION BY lp.item_id ORDER BY lp.seq))::int AS n, lp.packed_date
                                       FROM order_ready_lots lp JOIN order_items pi2 ON pi2.id = lp.item_id
                                      WHERE pi2.order_id = o.id) y WHERE y.packed_date IS NOT NULL), '[]'::jsonb)
        ) AS order,
        to_jsonb(b)  AS order_billing,
        to_jsonb(ac) AS order_accounts,
        COALESCE((SELECT jsonb_agg(to_jsonb(pt) ORDER BY pt.seq)
                  FROM order_payment_terms pt WHERE pt.order_id = o.id),
                 '[]'::jsonb) AS order_payment_terms,
        COALESCE((SELECT jsonb_agg(to_jsonb(d) ORDER BY d.seq)
                  FROM order_billing_docs d WHERE d.order_id = o.id),
                 '[]'::jsonb) AS order_billing_docs,
        COALESCE((SELECT jsonb_agg((to_jsonb(inv) - 'lr_file_data') || jsonb_build_object(
                    'slips', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                         'id', ps.id, 'packing_slip_no', ps.packing_slip_no,
                         'packing_slip_date', ps.packing_slip_date, 'quantity', ps.quantity, 'lot_nos', ps.lot_nos)
                         ORDER BY ps.seq)
                       FROM order_invoice_slips l JOIN order_packing_slips ps ON ps.id = l.packing_slip_id
                      WHERE l.invoice_id = inv.id), '[]'::jsonb)) ORDER BY inv.seq)
                  FROM order_invoices inv WHERE inv.order_id = o.id),
                 '[]'::jsonb) AS order_invoices,
        COALESCE((SELECT jsonb_agg(to_jsonb(ps) || jsonb_build_object(
                    'ec_no', (SELECT si.ec_no FROM order_items si WHERE si.id = ps.item_id),
                    'invoice_id', (SELECT l.invoice_id FROM order_invoice_slips l WHERE l.packing_slip_id = ps.id))
                  ORDER BY ps.seq)
                    FROM order_packing_slips ps WHERE ps.order_id = o.id),
                 '[]'::jsonb) AS order_packing_slips,
        -- EC items only. Dispatch status is NOT aliased in here: it's an
        -- SO-level value (o.dispatch_status above), and copying it onto every
        -- EC made identical values look per-EC.
        COALESCE((
          SELECT jsonb_agg((to_jsonb(it) - 'order_copy_file_data') ORDER BY it.seq)
            FROM order_items it
           WHERE it.order_id = o.id
        ), '[]'::jsonb) AS items
       FROM orders o
       LEFT JOIN order_billing b   ON b.order_id  = o.id
       LEFT JOIN order_accounts ac ON ac.order_id = o.id
      WHERE o.id = $1`,
    [id]
  );
  return result.rows[0] ?? null;
}

// EC item detail — the item attributes plus its per-EC department sections.
// The SO-level billing/accounts are included too (repeated per EC) so a bulk
// export can carry every column on one row.
export type ItemDetail = {
  item: Row;
  order: Row;
  order_billing: Row | null;
  order_accounts: Row | null;
  order_drawing: Row | null;
  order_purchase: Row | null;
  order_qc: Row | null;
  order_planning: Row | null;
  order_assembly_dispatch: Row | null;
  order_lots: Row[];
  order_boi_items: Row[];
  order_billing_docs: Row[];
  order_packing_slips: Row[];
  order_drawing_revisions: Row[];
  order_ready_lots: Row[];
};

const ITEM_DETAIL_SELECT = `
    to_jsonb(it) - 'order_copy_file_data' AS item,
    to_jsonb(o)  AS order,
    to_jsonb(b)  AS order_billing,
    to_jsonb(ac) AS order_accounts,
    to_jsonb(dr) AS order_drawing,
    to_jsonb(pu) AS order_purchase,
    to_jsonb(qc) AS order_qc,
    to_jsonb(pl) AS order_planning,
    to_jsonb(ad) AS order_assembly_dispatch,
    COALESCE((SELECT jsonb_agg(to_jsonb(l) ORDER BY l.created_at)
              FROM order_lots l WHERE l.item_id = it.id), '[]'::jsonb) AS order_lots,
    COALESCE((SELECT jsonb_agg(to_jsonb(bi) ORDER BY bi.created_at)
              FROM order_boi_items bi WHERE bi.item_id = it.id), '[]'::jsonb) AS order_boi_items,
    COALESCE((SELECT jsonb_agg(to_jsonb(bd) ORDER BY bd.seq)
              FROM order_billing_docs bd WHERE bd.order_id = o.id), '[]'::jsonb) AS order_billing_docs,
    COALESCE((SELECT jsonb_agg(to_jsonb(ps) ORDER BY ps.seq)
              FROM order_packing_slips ps WHERE ps.item_id = it.id), '[]'::jsonb) AS order_packing_slips,
    COALESCE((SELECT jsonb_agg(to_jsonb(rv) || jsonb_build_object('doc_count', (SELECT count(*) FROM order_drawing_documents dd WHERE dd.revision_id = rv.id)) ORDER BY rv.seq)
              FROM order_drawing_revisions rv WHERE rv.item_id = it.id), '[]'::jsonb) AS order_drawing_revisions,
    COALESCE((SELECT jsonb_agg(to_jsonb(rl) ORDER BY rl.seq)
              FROM order_ready_lots rl WHERE rl.item_id = it.id), '[]'::jsonb) AS order_ready_lots
   FROM order_items it
   JOIN orders o                        ON o.id  = it.order_id
   LEFT JOIN order_billing b            ON b.order_id  = o.id
   LEFT JOIN order_accounts ac          ON ac.order_id = o.id
   LEFT JOIN order_drawing dr           ON dr.item_id = it.id
   LEFT JOIN order_purchase pu          ON pu.item_id = it.id
   LEFT JOIN order_qc qc                ON qc.item_id = it.id
   LEFT JOIN order_planning pl          ON pl.item_id = it.id
   LEFT JOIN order_assembly_dispatch ad ON ad.item_id = it.id`;

/** Full per-EC record: item + parent SO + all department detail + lots. */
export async function getItemDetail(itemId: string): Promise<ItemDetail | null> {
  if (!UUID_RE.test(itemId)) return null;
  const result = await query<ItemDetail>(
    `SELECT ${ITEM_DETAIL_SELECT} WHERE it.id = $1`,
    [itemId]
  );
  return result.rows[0] ?? null;
}

/**
 * Per-EC records for bulk export (same shape as getItemDetail). `orderIds`
 * limits to items under those SOs; omitted, returns every item. Ordered by
 * SO Sl. No. then EC sequence.
 */
export async function listItemDetails(orderIds?: string[]): Promise<ItemDetail[]> {
  const result = await query<ItemDetail>(
    `SELECT ${ITEM_DETAIL_SELECT}
      ${orderIds ? "WHERE it.order_id = ANY($1)" : ""}
      ORDER BY o.sl_no ASC, it.seq ASC`,
    orderIds ? [orderIds] : []
  );
  return result.rows;
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

/** One EC with every per-EC section and child list hanging off it. */
export type OrderExportItem = {
  item: Row;
  order_drawing: Row | null;
  order_purchase: Row | null;
  order_qc: Row | null;
  order_planning: Row | null;
  order_assembly_dispatch: Row | null;
  // No order_lots: no section declares that child list, so nothing in the app
  // can create a lot row. The table and the dispatch register that reads it
  // are still here, but the export has nothing to show from them.
  order_boi_items: Row[];
  order_packing_slips: Row[];
  order_drawing_revisions: Row[];
  // File attachments: name/size/date only — never the bytes.
  order_qc_documents: Row[];
  order_qc_requirement_documents: Row[];
};

/** One SO with its SO-level sections, its PI/invoice lists, and its ECs. */
export type OrderExportRow = {
  order: Row;
  order_billing: Row | null;
  order_accounts: Row | null;
  order_payment_terms: Row[];
  order_billing_docs: Row[];
  order_invoices: Row[];
  order_packing_slips: Row[];
  items: OrderExportItem[];
};

/**
 * The whole tracker shaped the way the export sheet reads it: SO first, its
 * ECs nested underneath. Unlike listItemDetails (one flat row per EC) this
 * keeps SOs that have no EC yet — they are real orders and belong in the file.
 * `orderIds` limits to those SOs; omitted, returns every one.
 */
export async function listOrderExports(
  orderIds?: string[]
): Promise<OrderExportRow[]> {
  const result = await query<OrderExportRow>(
    `SELECT to_jsonb(o)  AS order,
            to_jsonb(b)  AS order_billing,
            to_jsonb(ac) AS order_accounts,
                COALESCE((SELECT jsonb_agg(to_jsonb(pt) ORDER BY pt.seq)
                        FROM order_payment_terms pt WHERE pt.order_id = o.id),
                     '[]'::jsonb) AS order_payment_terms,
            COALESCE((SELECT jsonb_agg(to_jsonb(d) ORDER BY d.seq)
                        FROM order_billing_docs d WHERE d.order_id = o.id),
                     '[]'::jsonb) AS order_billing_docs,
            COALESCE((SELECT jsonb_agg((to_jsonb(inv) - 'lr_file_data') ORDER BY inv.seq)
                        FROM order_invoices inv WHERE inv.order_id = o.id),
                     '[]'::jsonb) AS order_invoices,
            COALESCE((SELECT jsonb_agg(to_jsonb(ps) || jsonb_build_object(
                        'ec_no', (SELECT si.ec_no FROM order_items si WHERE si.id = ps.item_id))
                      ORDER BY ps.seq)
                        FROM order_packing_slips ps WHERE ps.order_id = o.id),
                     '[]'::jsonb) AS order_packing_slips,
            COALESCE((
              SELECT jsonb_agg(jsonb_build_object(
                       'item', to_jsonb(it) - 'order_copy_file_data',
                       'order_drawing', to_jsonb(dr),
                       'order_purchase', to_jsonb(pu),
                       'order_qc', to_jsonb(qc),
                       'order_planning', to_jsonb(pl),
                       'order_assembly_dispatch', to_jsonb(ad),
                       'order_boi_items', COALESCE((
                         SELECT jsonb_agg(to_jsonb(bi) ORDER BY bi.created_at)
                           FROM order_boi_items bi WHERE bi.item_id = it.id), '[]'::jsonb),
                       'order_qc_documents', COALESCE((
                         SELECT jsonb_agg(jsonb_build_object(
                                  'file_name', qd.file_name,
                                  'file_size', qd.file_size,
                                  'uploaded_at', qd.uploaded_at
                                ) ORDER BY qd.uploaded_at)
                           FROM order_qc_documents qd WHERE qd.item_id = it.id), '[]'::jsonb),
                       'order_qc_requirement_documents', COALESCE((
                         SELECT jsonb_agg(jsonb_build_object(
                                  'file_name', qr.file_name,
                                  'file_size', qr.file_size,
                                  'uploaded_at', qr.uploaded_at
                                ) ORDER BY qr.uploaded_at)
                           FROM order_qc_requirement_documents qr WHERE qr.item_id = it.id), '[]'::jsonb),
                       'order_packing_slips', COALESCE((
                         SELECT jsonb_agg(to_jsonb(ps) ORDER BY ps.seq)
                           FROM order_packing_slips ps WHERE ps.item_id = it.id), '[]'::jsonb),
                       'order_drawing_revisions', COALESCE((
                         SELECT jsonb_agg(to_jsonb(rv) || jsonb_build_object('doc_count', (SELECT count(*) FROM order_drawing_documents dd WHERE dd.revision_id = rv.id)) ORDER BY rv.seq)
                           FROM order_drawing_revisions rv WHERE rv.item_id = it.id), '[]'::jsonb)
                     ) ORDER BY it.seq)
                FROM order_items it
                LEFT JOIN order_drawing dr            ON dr.item_id = it.id
                LEFT JOIN order_purchase pu           ON pu.item_id = it.id
                LEFT JOIN order_qc qc                 ON qc.item_id = it.id
                LEFT JOIN order_planning pl           ON pl.item_id = it.id
                LEFT JOIN order_assembly_dispatch ad  ON ad.item_id = it.id
               WHERE it.order_id = o.id
            ), '[]'::jsonb) AS items
       FROM orders o
       LEFT JOIN order_billing b   ON b.order_id  = o.id
       LEFT JOIN order_accounts ac ON ac.order_id = o.id
      WHERE ($1::uuid[] IS NULL OR o.id = ANY($1))
      ORDER BY o.sl_no ASC`,
    [orderIds ?? null]
  );
  return result.rows;
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

/**
 * Update one section of an SO or EC. `id` is the order_id for SO-scope sections
 * (orders/billing/accounts/dispatch) or the item_id for item-scope sections (the EC
 * attributes + drawing/purchase/qc/planning/dispatch). Base tables (orders,
 * order_items) UPDATE by their own id; detail tables upsert on their key column.
 * Column names are validated against the section schema, never taken raw.
 */
export async function updateOrderSection(
  id: string,
  table: OrderTable,
  values: Record<string, string>
): Promise<void> {
  const section = SECTION_BY_TABLE.get(table);
  if (!section) throw new Error(`Unknown section table: ${table}`);

  // Computed fields (e.g. Balance of Payment) are never written from input —
  // they're derived server-side below.
  const fieldByColumn = new Map(section.fields.map((f) => [f.column, f]));
  const columns = Object.keys(values).filter(
    // Computed values are derived server-side; readOnly ones are owned by a
    // dedicated flow (target dates keep a revision history), so neither is
    // written from a section save even if the request carries them.
    (c) =>
      fieldByColumn.has(c) &&
      !fieldByColumn.get(c)!.computed &&
      !fieldByColumn.get(c)!.readOnly
  );

  if (columns.length > 0) {
    const coerced = columns.map((c) =>
      coerceField(fieldByColumn.get(c)!.type, values[c])
    );

    if (table === "orders" || table === "order_items") {
      // Base identity tables update by their own id.
      const setClause = columns.map((c, i) => `${c} = $${i + 2}`).join(", ");
      await query(`UPDATE ${table} SET ${setClause} WHERE id = $1`, [
        id,
        ...coerced,
      ]);
    } else {
      // 1:1 detail tables upsert on their key column: order_id for SO-scope
      // (billing/accounts), item_id for item-scope (drawing/purchase/qc/…).
      const keyCol = section.scope === "so" ? "order_id" : "item_id";
      const insertCols = [keyCol, ...columns];
      const placeholders = insertCols.map((_, i) => `$${i + 1}`).join(", ");
      const updateClause = columns.map((c) => `${c} = EXCLUDED.${c}`).join(", ");
      await query(
        `INSERT INTO ${table} (${insertCols.join(", ")}) VALUES (${placeholders})
         ON CONFLICT (${keyCol}) DO UPDATE SET ${updateClause}`,
        [id, ...coerced]
      );
    }
  }

  // Balance of Payment = order value − amount received. Recompute whenever
  // the accounts row or the SO's order value changes (both keyed by SO id).
  if (table === "order_accounts" || table === "orders") {
    await recomputeAccountsBalance(id);
  }
  // Dispatch status compares invoices against the SO's quantity/value, so a
  // change to either side restates it.
  if (table === "orders") {
    await recomputeDispatchStatus(id);
  } else if (table === "order_assembly_dispatch") {
    // Packed or not decides Lot vs Fully dispatched.
    await recomputeDispatchStatusForItem(id);
  }
}

/**
 * Replace a Spare EC's readiness lots, and — when there are any — make the
 * latest one its Actual Spare Status and Readiness Date. One transaction, so
 * the status never disagrees with its lots. The lots are validated by the
 * caller (lib/ready-lots.ts).
 */
/**
 * A pump EC's Actual Pump Status, from its Ready Qty against its quantity —
 * the rule pumpEcStatus states for the browser. A Spare EC is left alone.
 */
export async function syncPumpEcStatus(itemId: string): Promise<void> {
  if (!UUID_RE.test(itemId)) return;
  await query(
    `UPDATE order_planning pl
        SET actual_pump_status = CASE
              WHEN COALESCE(pl.ready_qty, 0) <= 0 THEN 'Pending'
              WHEN COALESCE(it.quantity, 0) > 0 AND pl.ready_qty >= it.quantity THEN 'Fully ready'
              ELSE 'Partially ready' END
       FROM order_items it
      WHERE it.id = pl.item_id AND pl.item_id = $1 AND it.item_type = ANY($2)`,
    [itemId, PUMP_LIKE]
  );
}

/**
 * A pump EC whose lots name it: its Ready Qty is what they hold, and its
 * status follows (syncPumpEcStatus). An EC whose lots carry no quantities
 * keeps the Ready Qty typed for it.
 */
export async function syncReadyQtyFromLots(itemId: string): Promise<void> {
  if (!UUID_RE.test(itemId)) return;
  await query(
    `UPDATE order_planning pl
        SET ready_qty = (SELECT COALESCE(sum(rl.qty), 0)::int FROM order_ready_lots rl
                          WHERE rl.item_id = pl.item_id AND rl.status IS DISTINCT FROM 'In plan')
       FROM order_items it
      WHERE it.id = pl.item_id AND pl.item_id = $1 AND it.item_type = ANY($2)
        AND EXISTS (SELECT 1 FROM order_ready_lots rl WHERE rl.item_id = pl.item_id AND rl.qty IS NOT NULL)`,
    [itemId, PUMP_LIKE]
  );
  await syncPumpEcStatus(itemId);
}

export async function saveReadyLots(
  itemId: string,
  lots: { status: string; ready_date: string | null; qty?: number | null }[],
  // Who made the change, for the lots' history.
  actor?: { id: string; role: string }
): Promise<void> {
  if (!UUID_RE.test(itemId)) return;
  // A Fully ready lot may have no date: stored as none, not as "".
  lots = lots.map((l) => ({ status: l.status, ready_date: l.ready_date || null, qty: l.qty ?? null }));
  await withTransaction(async (c) => {
    // Lot by lot in place, so what Assembly & Packing recorded against a lot
    // (its packing date) stays with it; a lot whose status changes carries
    // its packing status along.
    const existing = await c.query<{ id: string; status: string | null; ready_date: string | null }>(
      `SELECT id, status, to_char(ready_date, 'YYYY-MM-DD') AS ready_date
         FROM order_ready_lots WHERE item_id = $1 ORDER BY seq`,
      [itemId]
    );
    // What changed, lot by lot, into the history.
    const log = (
      lotNo: number,
      action: "added" | "changed" | "removed",
      now: { status: string | null; ready_date: string | null },
      prev: { status: string | null; ready_date: string | null } | null
    ) =>
      c.query(
        `INSERT INTO order_ready_lot_history
           (item_id, lot_no, action, status, ready_date, prev_status, prev_ready_date,
            changed_by, changed_by_role)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          itemId,
          lotNo,
          action,
          now.status,
          now.ready_date,
          prev?.status ?? null,
          prev?.ready_date ?? null,
          actor?.id ?? null,
          actor?.role ?? null,
        ]
      );
    for (let i = 0; i < Math.max(lots.length, existing.rows.length); i++) {
      const was = existing.rows[i];
      const lot = lots[i];
      if (lot && !was) await log(i + 1, "added", lot, null);
      else if (!lot && was) await log(i + 1, "removed", was, was);
      else if (lot && was && (lot.status !== was.status || lot.ready_date !== was.ready_date)) {
        await log(i + 1, "changed", lot, was);
      }
    }
    for (let i = 0; i < lots.length; i++) {
      const lot = lots[i];
      const id = existing.rows[i]?.id;
      if (id) {
        await c.query(
          `UPDATE order_ready_lots
              SET status = $2, ready_date = $3, qty = $4,
                  packing_status = CASE WHEN packed_date IS NULL THEN NULL
                                        WHEN $2 = 'Fully ready' THEN 'Fully packed'
                                        ELSE 'Partially packed' END
            WHERE id = $1`,
          [id, lot.status, lot.ready_date, lot.qty ?? null]
        );
      } else {
        await c.query(
          `INSERT INTO order_ready_lots (item_id, status, ready_date, qty) VALUES ($1, $2, $3, $4)`,
          [itemId, lot.status, lot.ready_date, lot.qty ?? null]
        );
      }
    }
    const extra = existing.rows.slice(lots.length).map((r) => r.id);
    if (extra.length > 0) {
      await c.query(`DELETE FROM order_ready_lots WHERE id = ANY($1::uuid[])`, [extra]);
    }
    await syncPackedFromLots(c, itemId);
    const last = lots[lots.length - 1];
    if (last) {
      // Fully ready with no date of its own: the readiness date stays the last
      // one given — an earlier lot's, or the EC's own while it was In plan —
      // and remembers which status it belongs to.
      let date = last.ready_date;
      let dateStatus: string | null = null;
      if (!date && last.status === "Fully ready") {
        const earlier = [...lots.slice(0, -1)].reverse().find((l) => l.ready_date);
        if (earlier) {
          date = earlier.ready_date;
          dateStatus = earlier.status;
        } else {
          const cur = await c.query<{ status: string | null; ready_date: string | null; date_status: string | null }>(
            `SELECT actual_spare_status AS status,
                    to_char(planning_readiness_date, 'YYYY-MM-DD') AS ready_date,
                    readiness_date_status AS date_status
               FROM order_planning WHERE item_id = $1`,
            [itemId]
          );
          const was = cur.rows[0];
          if (was?.ready_date) {
            date = was.ready_date;
            dateStatus = was.status === "Fully ready" ? was.date_status : was.status;
          }
        }
      }
      // The SO's status is its latest lot's (on a pump EC too, where it is the
      // SO's readiness; Actual Pump Status stays the EC's own).
      await c.query(
        `INSERT INTO order_planning (item_id, actual_spare_status, planning_readiness_date, readiness_date_status)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (item_id) DO UPDATE
            SET actual_spare_status = EXCLUDED.actual_spare_status,
                planning_readiness_date = EXCLUDED.planning_readiness_date,
                readiness_date_status = EXCLUDED.readiness_date_status`,
        [itemId, [...lots].reverse().find((l) => l.status !== "In plan")?.status ?? "In plan", date, dateStatus]
      );
    }
  });
}

/**
 * A Spare SO is planned as one, so an EC added to it takes the SO's planning
 * from the Spare ECs already there (the one Planning saved last): status,
 * readiness date, readiness remarks and the readiness lots. Packing is not
 * copied — Assembly & Packing has not packed the new EC. Returns whether
 * anything was copied.
 */
export async function inheritSparePlanning(
  itemId: string,
  actor?: { id: string; role: string }
): Promise<boolean> {
  if (!UUID_RE.test(itemId)) return false;
  const lead = await query<{
    item_id: string;
    status: string | null;
    ready_date: string | null;
    remarks: string | null;
    date_status: string | null;
  }>(
    `SELECT p.item_id, p.actual_spare_status AS status,
            to_char(p.planning_readiness_date, 'YYYY-MM-DD') AS ready_date,
            p.spare_readiness_remarks AS remarks,
            p.readiness_date_status AS date_status
       FROM order_items me
       JOIN orders o ON o.id = me.order_id
       JOIN order_items s ON s.order_id = me.order_id AND s.id <> me.id
       JOIN order_planning p ON p.item_id = s.id
      WHERE me.id = $1
        AND ${spareEcSql("me", "o")}
        AND ${spareEcSql("s", "o")}
        AND (NULLIF(btrim(p.actual_spare_status), '') IS NOT NULL
             OR p.planning_readiness_date IS NOT NULL
             OR EXISTS (SELECT 1 FROM order_ready_lots l WHERE l.item_id = s.id))
      ORDER BY p.updated_at DESC NULLS LAST, s.seq
      LIMIT 1`,
    [itemId]
  );
  const from = lead.rows[0];
  if (!from) {
    // Nothing planned on this SO yet: a Spare starts at Date awaited.
    await query(
      `INSERT INTO order_planning (item_id, actual_spare_status)
       SELECT me.id, $2 FROM order_items me JOIN orders o ON o.id = me.order_id
        WHERE me.id = $1 AND ${spareEcSql("me", "o")}
       ON CONFLICT (item_id) DO UPDATE SET actual_spare_status = EXCLUDED.actual_spare_status
        WHERE NULLIF(btrim(order_planning.actual_spare_status), '') IS NULL`,
      [itemId, SPARE_PLANNING_START]
    );
    return false;
  }

  const lots = await query<{ status: string; ready_date: string }>(
    `SELECT status, to_char(ready_date, 'YYYY-MM-DD') AS ready_date
       FROM order_ready_lots WHERE item_id = $1 ORDER BY seq`,
    [from.item_id]
  );
  // The lots carry the status and date with them, and their own history.
  if (lots.rows.length > 0) await saveReadyLots(itemId, lots.rows, actor);
  await query(
    `INSERT INTO order_planning (item_id, actual_spare_status, planning_readiness_date, spare_readiness_remarks, readiness_date_status)
     VALUES ($1, $2, $3::date, $4, $5)
     ON CONFLICT (item_id) DO UPDATE
        SET actual_spare_status = EXCLUDED.actual_spare_status,
            planning_readiness_date = EXCLUDED.planning_readiness_date,
            spare_readiness_remarks = EXCLUDED.spare_readiness_remarks,
            readiness_date_status = EXCLUDED.readiness_date_status`,
    [itemId, from.status, from.ready_date, from.remarks, from.date_status]
  );
  if (lots.rows.length === 0 && actor) {
    await logReadinessChange(
      itemId,
      { status: null, ready_date: null },
      { status: from.status, ready_date: from.ready_date },
      actor
    );
  }
  await recomputeDispatchStatusForItem(itemId);
  return true;
}

/**
 * Record when Assembly & Packing packed each readiness lot of a Spare EC. The
 * packing status follows the lot: Partial ready → Partially packed, Fully
 * ready → Fully packed. Only the lots of this EC are touched.
 */
export async function saveLotPacking(
  itemId: string,
  entries: { id: string; packed_date: string; packing_plan_date?: string; packing_shift?: string; pdi?: string }[],
  actor?: { id: string; role: string }
): Promise<void> {
  if (!UUID_RE.test(itemId)) return;
  await withTransaction(async (c) => {
    // The plan as it stood, to record what changed (Assembly & Packing's
    // packing date moves are kept like Planning's readiness date moves).
    const prev = await c.query<{ id: string; n: number; packing_plan_date: string | null; packing_shift: string | null; pdi: string | null }>(
      `SELECT id, (row_number() OVER (ORDER BY seq))::int AS n,
              to_char(packing_plan_date, 'YYYY-MM-DD') AS packing_plan_date, packing_shift, pdi
         FROM order_ready_lots WHERE item_id = $1`,
      [itemId]
    );
    const before = new Map(prev.rows.map((r) => [r.id, r]));
    const blank = (v: string | null | undefined) => (v ?? "").trim() || null;
    for (const e of entries) {
      if (!UUID_RE.test(e.id)) continue;
      const was = before.get(e.id);
      const plan = e.packing_plan_date !== undefined;
      await c.query(
        `UPDATE order_ready_lots
            SET packed_date = NULLIF($3, '')::date,
                packing_status = CASE WHEN NULLIF($3, '') IS NULL THEN NULL
                                      WHEN status = 'Fully ready' THEN 'Fully packed'
                                      ELSE 'Partially packed' END,
                packing_plan_date = CASE WHEN $4 THEN NULLIF($5, '')::date ELSE packing_plan_date END,
                packing_shift = CASE WHEN $4 THEN NULLIF($6, '') ELSE packing_shift END,
                pdi = CASE WHEN $4 THEN NULLIF($7, '') ELSE pdi END
          WHERE id = $1 AND item_id = $2`,
        [e.id, itemId, e.packed_date, plan, e.packing_plan_date ?? "", e.packing_shift ?? "", e.pdi ?? ""]
      );
      if (
        plan &&
        was &&
        (blank(was.packing_plan_date) !== blank(e.packing_plan_date) ||
          blank(was.packing_shift) !== blank(e.packing_shift) ||
          blank(was.pdi) !== blank(e.pdi))
      ) {
        await c.query(
          `INSERT INTO order_packing_plan_history
             (item_id, lot_id, lot_no, plan_date, prev_plan_date, shift, prev_shift, pdi, prev_pdi, changed_by, changed_by_role)
           VALUES ($1, $2, $3, $4::date, $5::date, $6, $7, $8, $9, $10, $11)`,
          [
            itemId, e.id, was.n,
            blank(e.packing_plan_date), blank(was.packing_plan_date),
            blank(e.packing_shift), blank(was.packing_shift),
            blank(e.pdi), blank(was.pdi),
            actor?.id ?? null, actor?.role ?? null,
          ]
        );
      }
    }
    await syncPackedFromLots(c, itemId);
  });
  await recomputeDispatchStatusForItem(itemId);
}

/**
 * A change to Planning's status or readiness date on an EC without lots — the
 * lots keep their own entries. Recorded as lot 0, action 'readiness'.
 */
export async function logReadinessChange(
  itemId: string,
  prev: { status: string | null; ready_date: string | null },
  now: { status: string | null; ready_date: string | null },
  actor: { id: string; role: string }
): Promise<void> {
  if (!UUID_RE.test(itemId)) return;
  if (prev.status === now.status && prev.ready_date === now.ready_date) return;
  await query(
    `INSERT INTO order_ready_lot_history
       (item_id, lot_no, action, status, ready_date, prev_status, prev_ready_date,
        changed_by, changed_by_role)
     VALUES ($1, 0, 'readiness', $2, $3, $4, $5, $6, $7)`,
    [itemId, now.status, now.ready_date, prev.status, prev.ready_date, actor.id, actor.role]
  );
}

/** An SO's Rep (orders.reps), for checking a Rep may see it. */
export async function getOrderRep(orderId: string): Promise<string | null> {
  if (!UUID_RE.test(orderId)) return null;
  const r = await query<{ reps: string | null }>(`SELECT reps FROM orders WHERE id = $1`, [orderId]);
  return r.rows[0]?.reps ?? null;
}

/** Where a Spare's planning starts: no readiness date from Planning yet. */
export const SPARE_PLANNING_START = "Date awaited";

/** One change to an SO's readiness lots, as the history shows it. */
export type ReadyLotEvent = {
  lot_no: number;
  action: "added" | "changed" | "removed" | "readiness" | "recorded";
  status: string | null;
  ready_date: string | null;
  prev_status: string | null;
  prev_ready_date: string | null;
  changed_by_name: string | null;
  changed_by_role: string | null;
  changed_at: string;
};

/**
 * An SO's readiness-lot history, newest first. Planning edits an SO as one,
 * so the same change lands on every EC: it is shown once. A lot from before
 * the history was kept shows as "recorded" when it was made.
 */
export async function listReadyLotHistory(orderId: string): Promise<ReadyLotEvent[]> {
  if (!UUID_RE.test(orderId)) return [];
  const r = await query<ReadyLotEvent>(
    `WITH ev AS (
       SELECT DISTINCT ON (h.lot_no, h.action, h.status, h.ready_date, h.prev_status,
                           h.prev_ready_date, h.changed_by, date_trunc('minute', h.changed_at))
              h.lot_no, h.action, h.status, to_char(h.ready_date, 'YYYY-MM-DD') AS ready_date,
              h.prev_status, to_char(h.prev_ready_date, 'YYYY-MM-DD') AS prev_ready_date,
              u.full_name AS changed_by_name, h.changed_by_role, h.changed_at
         FROM order_ready_lot_history h
         JOIN order_items i ON i.id = h.item_id
         LEFT JOIN users u ON u.id = h.changed_by
        WHERE i.order_id = $1
        ORDER BY h.lot_no, h.action, h.status, h.ready_date, h.prev_status, h.prev_ready_date,
                 h.changed_by, date_trunc('minute', h.changed_at), h.changed_at
     ),
     before_history AS (
       -- Lots made before their history was kept: one entry each, on the first EC.
       -- As it stood before its first recorded change, where there is one.
       SELECT DISTINCT ON (x.n) x.n AS lot_no, 'recorded'::text AS action,
              COALESCE(fc.prev_status, x.status) AS status,
              COALESCE(fc.prev_ready_date, to_char(x.ready_date, 'YYYY-MM-DD')) AS ready_date,
              NULL::text AS prev_status, NULL::text AS prev_ready_date,
              NULL::text AS changed_by_name, NULL::text AS changed_by_role, x.created_at AS changed_at
         FROM (SELECT rl.*, row_number() OVER (PARTITION BY rl.item_id ORDER BY rl.seq)::int AS n, it.seq AS ec_seq
                 FROM order_ready_lots rl JOIN order_items it ON it.id = rl.item_id
                WHERE it.order_id = $1) x
         LEFT JOIN LATERAL (SELECT ev.prev_status, ev.prev_ready_date FROM ev
                             WHERE ev.lot_no = x.n AND ev.action = 'changed'
                             ORDER BY ev.changed_at LIMIT 1) fc ON true
        WHERE NOT EXISTS (SELECT 1 FROM ev WHERE ev.lot_no = x.n AND ev.action = 'added')
        ORDER BY x.n, x.ec_seq
     ),
     plain_before AS (
       -- No lots and nothing recorded yet: where Planning stands now, on the first EC.
       SELECT 0 AS lot_no, 'recorded'::text AS action,
              COALESCE(NULLIF(pl.actual_spare_status, ''), NULLIF(pl.actual_pump_status, ''), pl.planning_status) AS status,
              to_char(pl.planning_readiness_date, 'YYYY-MM-DD') AS ready_date,
              NULL::text AS prev_status, NULL::text AS prev_ready_date,
              NULL::text AS changed_by_name, NULL::text AS changed_by_role,
              COALESCE(pl.updated_at, pl.created_at) AS changed_at
         FROM order_items it JOIN order_planning pl ON pl.item_id = it.id
        WHERE it.order_id = $1 AND pl.planning_readiness_date IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM ev)
          AND NOT EXISTS (SELECT 1 FROM before_history)
        ORDER BY it.seq
        LIMIT 1
     )
     SELECT lot_no, action, status, ready_date, prev_status, prev_ready_date,
            changed_by_name, changed_by_role, changed_at::text AS changed_at
       FROM (SELECT * FROM ev UNION ALL SELECT * FROM before_history
             UNION ALL SELECT * FROM plain_before) all_ev
      ORDER BY changed_at DESC, lot_no DESC`,
    [orderId]
  );
  return r.rows;
}

/**
 * Readiness histories for many SOs at once — the Planning PDF. Only SOs with
 * changes recorded are read; the rest have nothing to tell. A few at a time,
 * so a long queue does not flood the database.
 */
export async function listReadyLotHistories(orderIds: string[]): Promise<Map<string, ReadyLotEvent[]>> {
  const out = new Map<string, ReadyLotEvent[]>();
  const ids = orderIds.filter((id) => UUID_RE.test(id));
  if (ids.length === 0) return out;
  const r = await query<{ order_id: string }>(
    `SELECT DISTINCT it.order_id
       FROM order_items it
      WHERE it.order_id = ANY($1::uuid[])
        AND EXISTS (SELECT 1 FROM order_ready_lot_history h WHERE h.item_id = it.id)`,
    [ids]
  );
  const todo = r.rows.map((x) => x.order_id);
  for (let i = 0; i < todo.length; i += 8) {
    const batch = todo.slice(i, i + 8);
    const res = await Promise.all(batch.map((id) => listReadyLotHistory(id)));
    batch.forEach((id, k) => out.set(id, res[k]));
  }
  return out;
}

/**
 * A Spare EC is packed when a lot is Fully packed: its Actual Material Packing
 * Date is that lot's date — the one every "packed" check, alert and Dispatch's
 * ready shortlist already reads. With lots but none Fully packed, it is not
 * packed yet. An EC without lots is left alone.
 */
/**
 * A pump EC is packed once its lots have packed all of it: its Actual
 * Material Packing Date is then the last of those lots' packed dates, and
 * none until then. Lots without quantities leave it as the Spare rule set it.
 */
export async function syncPumpPackedDate(itemId: string): Promise<void> {
  if (!UUID_RE.test(itemId)) return;
  await query(
    `WITH l AS (
       SELECT COALESCE(sum(rl.qty) FILTER (WHERE rl.packed_date IS NOT NULL), 0) AS packed,
              max(rl.packed_date) AS last_packed,
              bool_or(rl.qty IS NOT NULL) AS named
         FROM order_ready_lots rl WHERE rl.item_id = $1
     )
     INSERT INTO order_assembly_dispatch (item_id, actual_packing_date)
     SELECT it.id, CASE WHEN COALESCE(it.quantity, 0) > 0 AND l.packed >= it.quantity THEN l.last_packed END
       FROM order_items it, l
      WHERE it.id = $1 AND it.item_type = ANY($2) AND l.named
     ON CONFLICT (item_id) DO UPDATE SET actual_packing_date = EXCLUDED.actual_packing_date`,
    [itemId, PUMP_LIKE]
  );
}

async function syncPackedFromLots(c: PoolClient, itemId: string): Promise<void> {
  await c.query(
    `WITH l AS (
       SELECT count(*) AS n,
              max(packed_date) FILTER (WHERE packing_status = 'Fully packed') AS packed
         FROM order_ready_lots WHERE item_id = $1
     )
     INSERT INTO order_assembly_dispatch (item_id, actual_packing_date)
     SELECT $1, l.packed FROM l WHERE l.n > 0
     ON CONFLICT (item_id) DO UPDATE SET actual_packing_date = EXCLUDED.actual_packing_date`,
    [itemId]
  );
}

/** Recompute the SO's accounts balance from order value and amount received. */
async function recomputeAccountsBalance(orderId: string): Promise<void> {
  if (!UUID_RE.test(orderId)) return;
  await query(
    `UPDATE order_accounts a
        SET balance_of_payment = ${ORDER_VALUE_GST_SQL("o", "a")} - COALESCE(a.amount_received, 0)
       FROM orders o
      WHERE a.order_id = o.id AND o.id = $1`,
    [orderId]
  );
}

/** What Accounts records against one PI. */
export type PiPayment = {
  payment_status: string;
  confirmed_date: string;
  amount_received: string;
  hold_reason: string;
};

/**
 * Accounts records a payment against one PI, then the SO's Accounts row is
 * restated from its PIs (rollUpPiPayments).
 */
export async function savePiPayment(orderId: string, piId: string, p: PiPayment): Promise<boolean> {
  if (!UUID_RE.test(orderId) || !UUID_RE.test(piId)) return false;
  const r = await query(
    `UPDATE order_billing_docs
        SET pi_payment_status = NULLIF($3, ''),
            pi_confirmed_date = NULLIF($4, '')::date,
            pi_amount_received = NULLIF($5, '')::numeric,
            pi_hold_reason = CASE WHEN $3 = $6 THEN NULLIF($7, '') END
      WHERE id = $1 AND order_id = $2`,
    [piId, orderId, p.payment_status.trim(), p.confirmed_date.trim(), p.amount_received.trim(), PAYMENT_HOLD_VALUE, p.hold_reason.trim()]
  );
  if (!r.rowCount) return false;
  await rollUpPiPayments(orderId);
  return true;
}

/**
 * Accounts records a payment against a payment term line that has no PI yet.
 * Refused once the line has its PI — the payment then goes on the PI.
 */
export async function saveTermPayment(orderId: string, termId: string, p: PiPayment): Promise<boolean> {
  if (!UUID_RE.test(orderId) || !UUID_RE.test(termId)) return false;
  const r = await query(
    `UPDATE order_payment_terms t
        SET term_payment_status = NULLIF($3, ''),
            term_confirmed_date = NULLIF($4, '')::date,
            term_amount_received = NULLIF($5, '')::numeric,
            term_hold_reason = CASE WHEN $3 = $6 THEN NULLIF($7, '') END
      WHERE t.id = $1 AND t.order_id = $2
        AND NOT EXISTS (SELECT 1 FROM order_billing_docs b WHERE b.payment_term_id = t.id)`,
    [termId, orderId, p.payment_status.trim(), p.confirmed_date.trim(), p.amount_received.trim(), PAYMENT_HOLD_VALUE, p.hold_reason.trim()]
  );
  if (!r.rowCount) return false;
  await rollUpPiPayments(orderId);
  return true;
}

/**
 * Billing raised (or linked) a PI on a term line that already carries a
 * payment: the payment moves onto the PI, unless the PI has one of its own.
 */
export async function moveTermPaymentToPi(orderId: string, termId: string, piId: string): Promise<void> {
  if (!UUID_RE.test(orderId) || !UUID_RE.test(termId) || !UUID_RE.test(piId)) return;
  const moved = await query(
    `UPDATE order_billing_docs b
        SET pi_payment_status = t.term_payment_status, pi_confirmed_date = t.term_confirmed_date,
            pi_amount_received = t.term_amount_received, pi_hold_reason = t.term_hold_reason
       FROM order_payment_terms t
      WHERE b.id = $1 AND b.order_id = $3 AND t.id = $2 AND t.order_id = $3
        AND COALESCE(t.term_payment_status, t.term_confirmed_date::text, t.term_amount_received::text) IS NOT NULL
        AND COALESCE(b.pi_payment_status, b.pi_confirmed_date::text, b.pi_amount_received::text) IS NULL`,
    [piId, termId, orderId]
  );
  if (moved.rowCount) {
    await query(
      `UPDATE order_payment_terms SET term_payment_status = NULL, term_confirmed_date = NULL,
              term_amount_received = NULL, term_hold_reason = NULL WHERE id = $1`,
      [termId]
    );
    await rollUpPiPayments(orderId);
  }
}

/**
 * The SO's payment, worked out from its payment lines once any carries one —
 * each PI, and each term line with no PI yet: the amount received is their
 * sum, the confirmed date the latest, the hold reason each held line's. The
 * status is the latest payment's (piRollupStatus). An SO whose lines carry no
 * payment yet keeps what was recorded on the SO itself.
 */
export async function rollUpPiPayments(orderId: string): Promise<void> {
  if (!UUID_RE.test(orderId)) return;
  const pis = (
    await query<{ pi_no: string | null; status: string | null; date: string | null; amount: string | null; reason: string | null }>(
      `SELECT pi_no, NULLIF(btrim(pi_payment_status), '') AS status,
              to_char(pi_confirmed_date, 'YYYY-MM-DD') AS date, pi_amount_received::text AS amount,
              NULLIF(btrim(pi_hold_reason), '') AS reason
         FROM order_billing_docs WHERE order_id = $1
       UNION ALL
       -- A term line with no PI yet: its own payment, named after the term.
       SELECT concat_ws(' ', rtrim(rtrim(t.percent::text, '0'), '.') || '%', t.term),
              NULLIF(btrim(t.term_payment_status), ''), to_char(t.term_confirmed_date, 'YYYY-MM-DD'),
              t.term_amount_received::text, NULLIF(btrim(t.term_hold_reason), '')
         FROM order_payment_terms t
        WHERE t.order_id = $1
          AND NOT EXISTS (SELECT 1 FROM order_billing_docs b WHERE b.payment_term_id = t.id)`,
      [orderId]
    )
  ).rows;
  if (!pis.some((p) => p.status || p.date || p.amount)) return;

  const status = piRollupStatus(pis);
  const amounts = pis.map((p) => p.amount).filter((a): a is string => !!a);
  const received = amounts.length ? amounts.reduce((n, a) => n + Number(a), 0).toFixed(2) : null;
  const dates = pis.map((p) => p.date).filter((d): d is string => !!d).sort();
  const reasons = pis
    .filter((p) => p.status === PAYMENT_HOLD_VALUE && p.reason)
    .map((p) => (pis.length > 1 ? `PI ${p.pi_no ?? "—"}: ${p.reason}` : p.reason!))
    .join("; ");

  await query(
    `INSERT INTO order_accounts (order_id, payment_status, payment_confirmed_date, amount_received, hold_reason)
     VALUES ($1, $2, $3::date, $4::numeric, NULLIF($5, ''))
     ON CONFLICT (order_id) DO UPDATE SET
       payment_status = EXCLUDED.payment_status,
       payment_confirmed_date = EXCLUDED.payment_confirmed_date,
       amount_received = EXCLUDED.amount_received,
       hold_reason = EXCLUDED.hold_reason`,
    [orderId, status, dates.length ? dates[dates.length - 1] : null, received, reasons]
  );
  await recomputeAccountsBalance(orderId);
}

/**
 * The SO's payment status: the latest PI payment's — the PI with the latest
 * Payment Confirmed Date, else (none dated) the last PI given a status. A PI
 * on hold still puts the whole SO on hold, so the escalation is not lost
 * behind a later payment. PIs come in the order they were raised.
 */
export function piRollupStatus(pis: { status: string | null; date: string | null }[]): string | null {
  const withStatus = pis.filter((p) => p.status);
  if (withStatus.some((p) => p.status === PAYMENT_HOLD_VALUE)) return PAYMENT_HOLD_VALUE;
  if (!withStatus.length) return null;
  const dated = withStatus.filter((p) => p.date);
  if (dated.length) {
    // The last of the latest-dated, so a later PI wins a tie.
    const latest = dated.reduce((best, p) => (p.date! >= best.date! ? p : best));
    return latest.status;
  }
  return withStatus[withStatus.length - 1].status;
}

/** The reasons Accounts can put an SO on hold for, A–Z. */
export async function listAccountsHoldReasons(): Promise<string[]> {
  const r = await query<{ label: string }>(`SELECT label FROM accounts_hold_reasons ORDER BY lower(label)`);
  return r.rows.map((x) => x.label);
}

/** Add a reason to Accounts' list (a no-op when it is already there, in any case). */
export async function addAccountsHoldReason(label: string, by: string): Promise<string> {
  const clean = label.replace(/\s+/g, " ").trim();
  const existing = await query<{ label: string }>(
    `SELECT label FROM accounts_hold_reasons WHERE lower(label) = lower($1)`,
    [clean]
  );
  if (existing.rows[0]) return existing.rows[0].label;
  await query(`INSERT INTO accounts_hold_reasons (label, created_by) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [clean, by]);
  return clean;
}

/** Put an SO on Accounts hold, or lift it. Returns the status it had before. */
export async function setAccountsHold(
  orderId: string,
  hold: { status: "Hold" | "Clear"; reason: string; remarks: string }
): Promise<string | null> {
  if (!UUID_RE.test(orderId)) return null;
  const before = await query<{ status: string | null }>(
    `SELECT accounts_hold_status AS status FROM orders WHERE id = $1`,
    [orderId]
  );
  await query(
    `UPDATE orders
        SET accounts_hold_status = $2,
            accounts_hold_reason = CASE WHEN $2 = 'Hold' THEN NULLIF($3, '') END,
            accounts_hold_remarks = CASE WHEN $2 = 'Hold' THEN NULLIF($4, '') END,
            accounts_hold_at = CASE WHEN $2 = 'Hold' THEN COALESCE(CASE WHEN accounts_hold_status = 'Hold' THEN accounts_hold_at END, now()) END
      WHERE id = $1`,
    [orderId, hold.status, hold.reason.trim(), hold.remarks.trim()]
  );
  return before.rows[0]?.status ?? null;
}

/**
 * Whether the SO has payment lines — a PI or a payment term. Then Accounts
 * records against each line, not the SO.
 */
export async function orderHasPi(orderId: string): Promise<boolean> {
  if (!UUID_RE.test(orderId)) return false;
  const r = await query<{ has: boolean }>(
    `SELECT (EXISTS (SELECT 1 FROM order_billing_docs WHERE order_id = $1)
            OR EXISTS (SELECT 1 FROM order_payment_terms WHERE order_id = $1)) AS has`,
    [orderId]
  );
  return r.rows[0]?.has ?? false;
}

/**
 * The SO's value with GST, as orderValueWithGst: the INR value (a foreign
 * order's conversion) × (1 + the rate Accounts set, 18% when blank).
 */
export const ORDER_VALUE_GST_SQL = (o: string, a: string): string => `round(
    COALESCE(CASE WHEN upper(COALESCE(${o}.order_currency, 'INR')) <> 'INR' THEN ${o}.order_value_inr END, ${o}.order_value)
    * (1 + COALESCE(${a}.gst_rate, ${DEFAULT_GST_RATE}) / 100.0), 2)`;

// Which parent column each 1:many child hangs off: per-SO tables key on
// order_id, per-EC tables on item_id.
export const CHILD_PARENT_COLUMN: Record<ChildTable, "order_id" | "item_id"> = {
  order_payment_terms: "order_id",
  order_lots: "item_id",
  order_boi_items: "item_id",
  // Packing slips belong to the SO (an older slip may still name its EC).
  order_packing_slips: "order_id",
  order_drawing_revisions: "item_id",
  order_ready_lots: "item_id",
  order_billing_docs: "order_id",
  order_invoices: "order_id",
};

/**
 * Add a blank child row. `kind` is only meaningful for packing slips, where
 * Planning files 'tentative' rows and Packing files 'actual' ones.
 */
export async function addChildRow(
  table: ChildTable,
  parentId: string,
  kind?: string
): Promise<{ id: string } | null> {
  const keyCol = CHILD_PARENT_COLUMN[table];
  // A Spare is readied in at most three lots.
  if (table === "order_ready_lots") {
    const n = await query<{ n: number }>(
      `SELECT count(*)::int AS n FROM order_ready_lots WHERE item_id = $1`,
      [parentId]
    );
    if ((n.rows[0]?.n ?? 0) >= READY_LOT_LIMIT) return null;
  }
  // A drawing version: of a GAD or a Performance Curve, numbered on from
  // that document's last.
  if (table === "order_drawing_revisions") {
    const docType = kind === "Performance Curve" ? "Performance Curve" : "GAD";
    const res = await query<{ id: string }>(
      `INSERT INTO order_drawing_revisions (item_id, doc_type, revision_no)
       VALUES ($1, $2, (SELECT (count(*) + 1)::text FROM order_drawing_revisions
                         WHERE item_id = $1 AND doc_type = $2))
       RETURNING id`,
      [parentId, docType]
    );
    return res.rows[0] ?? null;
  }
  const useKind = table === "order_packing_slips" && kind;
  const result = await query<{ id: string }>(
    useKind
      ? `INSERT INTO ${table} (${keyCol}, kind) VALUES ($1, $2) RETURNING id`
      : `INSERT INTO ${table} (${keyCol}) VALUES ($1) RETURNING id`,
    useKind ? [parentId, kind] : [parentId]
  );
  const row = result.rows[0] ?? null;
  if (row && table === "order_invoices") await recomputeDispatchStatus(parentId);
  return row;
}

/**
 * Bulk-insert PI rows into an SO's Operation card (order_billing_docs), for
 * the PI Excel upload. Each row is a { pi_no, pi_date, pi_value }; blank dates
 * and values become NULL. Returns how many were inserted.
 */
/**
 * Insert PIs under an order, returning each new row's id and PI No. so the
 * caller can notify about them one by one.
 */
export async function insertBillingDocs(
  orderId: string,
  rows: { pi_no: string; pi_date: string | null; pi_value: string | null }[]
): Promise<{ id: string; pi_no: string }[]> {
  if (!UUID_RE.test(orderId) || rows.length === 0) return [];
  const inserted: { id: string; pi_no: string }[] = [];
  for (const r of rows) {
    const res = await query<{ id: string; pi_no: string }>(
      `INSERT INTO order_billing_docs (order_id, pi_no, pi_date, pi_value)
       VALUES ($1, $2, $3::date, $4::numeric)
       RETURNING id, pi_no`,
      [orderId, r.pi_no, r.pi_date, r.pi_value]
    );
    if (res.rows[0]) inserted.push(res.rows[0]);
  }
  return inserted;
}

/** Update a child row's fields, validated against the child schema. */
export async function updateChildRow(
  table: ChildTable,
  id: string,
  values: Record<string, string>
): Promise<void> {
  if (!UUID_RE.test(id)) return;
  const byColumn = new Map(CHILD_FIELDS[table].map((f) => [f.column, f]));
  const columns = Object.keys(values).filter((c) => {
    const f = byColumn.get(c);
    return f !== undefined && !f.computed && !f.readOnly;
  });
  if (columns.length > 0) {
    const coerced = columns.map((c) =>
      coerceField(byColumn.get(c)!.type, values[c])
    );
    const setClause = columns.map((c, i) => `${c} = $${i + 2}`).join(", ");
    await query(`UPDATE ${table} SET ${setClause} WHERE id = $1`, [id, ...coerced]);
  }
  // Invoiced quantity/value drives the SO's dispatch status.
  if (table === "order_invoices") {
    await recomputeDispatchStatusForInvoice(id);
  }
}

/**
 * Recompute an SO's dispatch status from its invoices:
 *   • no invoice started            → Pending
 *   • invoiced qty AND value reach the SO's → Fully dispatch
 *   • otherwise (partially invoiced) → LOT dispatch
 *
 * Note: the ops spec writes "invoice > SO → Lot dispatch", which reads as a
 * typo — a lot (partial) dispatch is when the invoice falls SHORT of the SO.
 * Implemented as partial → LOT dispatch.
 */
export async function recomputeDispatchStatus(orderId: string): Promise<void> {
  if (!UUID_RE.test(orderId)) return;
  // An SO with packing slips is dispatched slip by slip: nothing sent yet is
  // Pending; everything packed and every slip sent is Fully dispatched;
  // anything in between — a partly packed SO, or slips still waiting — is a
  // Lot dispatch. An SO without slips keeps the older reading off its
  // invoices' quantity and value.
  await query(
    `UPDATE orders o
        SET dispatch_status = CASE
              WHEN EXISTS (SELECT 1 FROM order_packing_slips s WHERE s.order_id = o.id AND s.kind = 'actual') THEN
                CASE
                  WHEN NOT EXISTS (${SENT_SLIPS_SQL("o")}) THEN 'Pending'
                  WHEN ${SO_FULLY_PACKED_SQL("o")}
                   AND NOT EXISTS (SELECT 1 FROM order_packing_slips s
                                    WHERE s.order_id = o.id AND s.kind = 'actual'
                                      AND NOT EXISTS (${SENT_SLIPS_SQL("o")} AND l.packing_slip_id = s.id))
                   -- A Spare's readiness lots: every packed lot must be on a
                   -- slip that has gone out — packing a lot never makes the
                   -- SO Fully dispatched by itself.
                   AND NOT EXISTS (${UNSENT_PACKED_LOT_SQL("o")})
                    THEN 'Fully dispatch'
                  ELSE 'LOT dispatch'
                END
              WHEN inv.n IS NULL OR inv.n = 0 THEN 'Pending'
              WHEN COALESCE(inv.qty, 0) >= COALESCE(o.total_quantity, 0)
               AND COALESCE(inv.val, 0) >= COALESCE(o.order_value, 0)
                THEN 'Fully dispatch'
              ELSE 'LOT dispatch'
            END
       FROM (
         -- Count a row as "started" if EITHER the invoice or the challan
         -- side has been filled in — Challan orders don't carry
         -- invoice_no/qty/value, they carry challan_value instead.
         SELECT COUNT(*) FILTER (
                  WHERE invoice_no IS NOT NULL OR challan_no IS NOT NULL
                        OR invoice_date IS NOT NULL OR challan_date IS NOT NULL
                        OR invoice_value IS NOT NULL OR challan_value IS NOT NULL
                ) AS n,
                SUM(COALESCE(invoice_quantity, challan_quantity, packing_quantity, 0)) AS qty,
                SUM(COALESCE(invoice_value, challan_value, 0)) AS val
           FROM order_invoices WHERE order_id = $1
       ) inv
      WHERE o.id = $1`,
    [orderId]
  );
  // A Lot / Fully dispatched status carried in from the migration sheet (set
  // by no one) stands in for invoices not entered yet; the first real invoice
  // takes over. One set by hand stays until it is changed by hand.
  await query(
    `UPDATE orders o
        SET status_override = NULL, status_reason = NULL, status_diverted_to = NULL,
            status_set_at = now()
      WHERE o.id = $1
        AND o.status_override IN ('Fully dispatch', 'LOT dispatch')
        AND o.status_set_by IS NULL
        AND EXISTS (SELECT 1 FROM order_invoices i
                     WHERE i.order_id = o.id
                       AND (i.invoice_no IS NOT NULL OR i.challan_no IS NOT NULL
                            OR i.invoice_date IS NOT NULL OR i.challan_date IS NOT NULL
                            OR i.invoice_value IS NOT NULL OR i.challan_value IS NOT NULL))`,
    [orderId]
  );
}

/**
 * When Packing saves an actual packing slip, upsert a matching invoice row
 * for Billing (one invoice per slip). EC / Packing Slip No. / Packing Qty
 * are copied to the invoice as read-only display columns so Billing's
 * add-on header shows which slip they're invoicing. Subsequent packing-slip
 * saves re-sync those three columns; Billing's own invoice fields are
 * untouched. Returns the SO/EC/slip context (for the follow-on notification)
 * or null if the slip isn't 'actual'.
 */
export async function packingSlipReady(
  packingSlipId: string
): Promise<{
  order_id: string;
  ec_no: string | null;
  packing_slip_no: string | null;
  quantity: number | null;
} | null> {
  if (!UUID_RE.test(packingSlipId)) return null;
  const result = await query<{
    order_id: string;
    ec_no: string | null;
    packing_slip_no: string | null;
    quantity: number | null;
  }>(
    // No card is raised here any more: Dispatch raises its own, choosing the
    // slips it sends out. The slip only moves the dispatch status (it may
    // change what "all dispatched" means) and tells Dispatch it is ready.
    `SELECT ps.order_id,
            (SELECT it.ec_no FROM order_items it WHERE it.id = ps.item_id) AS ec_no,
            ps.packing_slip_no, ps.quantity
       FROM order_packing_slips ps
      WHERE ps.id = $1 AND ps.kind = 'actual'`,
    [packingSlipId]
  );
  const row = result.rows[0] ?? null;
  if (row) await recomputeDispatchStatus(row.order_id);
  return row;
}

/**
 * The order columns the section locks are judged on (lib/order-lock). Takes
 * an SO id, or a child row whose parent it resolves first, so an action can
 * check before it writes.
 */
export async function lockFactsForOrder(orderId: string): Promise<LockFacts | null> {
  if (!UUID_RE.test(orderId)) return null;
  const result = await query<LockFacts>(
    `SELECT ${AFTER_RECEIPT_ONLY} AS after_receipt_only, bill_type, status_override
       FROM orders o WHERE o.id = $1`,
    [orderId]
  );
  return result.rows[0] ?? null;
}

export type OrderStatusState = {
  so_no: string | null;
  sl_no: number;
  status_override: string | null;
  dispatch_status: string | null;
};

/** What an order's status stands at before a change: set, and from invoices. */
export async function getOrderStatusState(orderId: string): Promise<OrderStatusState | null> {
  if (!UUID_RE.test(orderId)) return null;
  const r = await query<OrderStatusState>(
    `SELECT so_no, sl_no::int AS sl_no, status_override, dispatch_status
       FROM orders WHERE id = $1`,
    [orderId]
  );
  return r.rows[0] ?? null;
}

/**
 * Set — or with null, clear — the status Central Visibility gives an order.
 * Cleared, the status follows the invoices again. The reason and the
 * diverted-to note belong to the setting, so clearing clears them too.
 */
export async function setOrderStatus(input: {
  orderId: string;
  status: string | null;
  reason: string | null;
  divertedTo: string | null;
  actorId: string;
}): Promise<void> {
  if (!UUID_RE.test(input.orderId)) return;
  await query(
    `UPDATE orders
        SET status_override    = $2,
            status_reason      = CASE WHEN $2::text IS NULL THEN NULL ELSE $3 END,
            status_diverted_to = CASE WHEN $2::text = 'Diverted' THEN $4 ELSE NULL END,
            status_set_at      = now(),
            status_set_by      = $5
      WHERE id = $1`,
    [input.orderId, input.status, input.reason, input.divertedTo, input.actorId]
  );
}

/**
 * Work out a USD order's INR value: its USD value × the rate kept on the
 * order, or — for an order not yet converted — today's rate, which is then
 * kept with it, so a later change of rate never re-prices an older order. An
 * order not in USD carries neither. Without a rate set yet, a USD order is
 * left as it is. A Challan is set to 0 INR first. Writes only when something changes.
 */
export async function applyUsdConversion(orderId: string, rate: number | null): Promise<void> {
  if (!UUID_RE.test(orderId)) return;
  // A Spare has no bought-out items and no quality documents.
  await query(
    `UPDATE orders SET boi = 'No', qc_required = 'No'
      WHERE id = $1 AND order_type = 'Spare'
        AND (boi IS DISTINCT FROM 'No' OR qc_required IS DISTINCT FROM 'No')`,
    [orderId]
  );
  // A Challan carries no value: 0 INR, whatever was typed.
  await query(
    `UPDATE orders
        SET order_value = 0, order_currency = 'INR', order_value_inr = NULL, order_fx_rate = NULL
      WHERE id = $1 AND bill_type = 'Challan'
        AND (order_value IS DISTINCT FROM 0 OR COALESCE(order_currency, '') <> 'INR'
             OR order_value_inr IS NOT NULL OR order_fx_rate IS NOT NULL)`,
    [orderId]
  );
  await query(
    `WITH next AS (
       SELECT o.id,
              CASE WHEN upper(COALESCE(o.order_currency, '')) = 'USD'
                   THEN COALESCE(o.order_fx_rate, $2::numeric) END AS fx,
              o.order_value, o.order_currency, o.order_value_inr AS inr_now,
              o.order_fx_rate AS fx_now
         FROM orders o WHERE o.id = $1
     ),
     calc AS (
       SELECT id, fx, fx_now, inr_now,
              CASE WHEN upper(COALESCE(order_currency, '')) <> 'USD' THEN NULL
                   WHEN order_value IS NULL OR fx IS NULL THEN inr_now
                   ELSE round(order_value * fx, 2) END AS inr
         FROM next
     )
     UPDATE orders o
        SET order_fx_rate = calc.fx, order_value_inr = calc.inr
       FROM calc
      WHERE o.id = calc.id
        AND (calc.fx IS DISTINCT FROM calc.fx_now OR calc.inr IS DISTINCT FROM calc.inr_now)`,
    [orderId, rate]
  );
  // A new INR figure (or a Challan's 0) moves what the payments count against.
  await recomputeAccountsBalance(orderId);
}

/** The lock facts of the order an EC belongs to. */
export async function lockFactsForItem(itemId: string): Promise<LockFacts | null> {
  if (!UUID_RE.test(itemId)) return null;
  const r = await query<{ order_id: string }>(
    `SELECT order_id FROM order_items WHERE id = $1`,
    [itemId]
  );
  return r.rows[0] ? lockFactsForOrder(r.rows[0].order_id) : null;
}

export async function lockFactsForChild(
  table: ChildTable,
  childId: string
): Promise<LockFacts | null> {
  const orderId = await getChildOrderId(table, childId);
  return orderId ? lockFactsForOrder(orderId) : null;
}

/** Look up an SO's display label (so_no, falling back to #sl_no). */
export async function getOrderLabel(orderId: string): Promise<string | null> {
  if (!UUID_RE.test(orderId)) return null;
  const result = await query<{ so_no: string | null; sl_no: number }>(
    `SELECT so_no, sl_no::int AS sl_no FROM orders WHERE id = $1`,
    [orderId]
  );
  const row = result.rows[0];
  if (!row) return null;
  return row.so_no ?? `#${row.sl_no}`;
}

/**
 * For any child row: return its parent order_id (needed to notify + revalidate
 * even when the caller only has the child id).
 */
export async function getChildOrderId(
  table: ChildTable,
  id: string
): Promise<string | null> {
  if (!UUID_RE.test(id)) return null;
  const parent = CHILD_PARENT_COLUMN[table];
  if (parent === "order_id") {
    const result = await query<{ order_id: string }>(
      `SELECT order_id FROM ${table} WHERE id = $1`,
      [id]
    );
    return result.rows[0]?.order_id ?? null;
  }
  const result = await query<{ order_id: string }>(
    `SELECT it.order_id
       FROM ${table} t JOIN order_items it ON it.id = t.item_id
      WHERE t.id = $1`,
    [id]
  );
  return result.rows[0]?.order_id ?? null;
}

/** Recompute via an invoice id (resolves its SO first). */
async function recomputeDispatchStatusForInvoice(invoiceId: string): Promise<void> {
  const result = await query<{ order_id: string }>(
    `SELECT order_id FROM order_invoices WHERE id = $1`,
    [invoiceId]
  );
  const orderId = result.rows[0]?.order_id;
  if (orderId) await recomputeDispatchStatus(orderId);
}

/** Save an invoice's LR attachment bytes. */
export async function setInvoiceLrFile(
  invoiceId: string,
  file: { name: string; mimeType: string | null; size: number; data: Buffer }
): Promise<void> {
  if (!UUID_RE.test(invoiceId)) return;
  await query(
    `UPDATE order_invoices
        SET lr_file_name = $2, lr_mime_type = $3, lr_file_size = $4, lr_file_data = $5
      WHERE id = $1`,
    [invoiceId, file.name, file.mimeType, file.size, file.data]
  );
}

/** Fetch an invoice's LR attachment for download. */
export async function getInvoiceLrFile(
  invoiceId: string
): Promise<{ file_name: string; mime_type: string | null; file_data: Buffer } | null> {
  if (!UUID_RE.test(invoiceId)) return null;
  const result = await query<{
    lr_file_name: string | null;
    lr_mime_type: string | null;
    lr_file_data: Buffer | null;
  }>(
    `SELECT lr_file_name, lr_mime_type, lr_file_data FROM order_invoices WHERE id = $1`,
    [invoiceId]
  );
  const row = result.rows[0];
  if (!row?.lr_file_data || !row.lr_file_name) return null;
  return {
    file_name: row.lr_file_name,
    mime_type: row.lr_mime_type,
    file_data: row.lr_file_data,
  };
}

/** Delete a child row by id. */
export async function deleteChildRow(
  table: ChildTable,
  id: string
): Promise<void> {
  if (!UUID_RE.test(id)) return;
  if (table === "order_invoices") {
    // Capture the SO before the row goes, then restate its dispatch status.
    const owner = await query<{ order_id: string }>(
      `SELECT order_id FROM order_invoices WHERE id = $1`,
      [id]
    );
    const orderId = owner.rows[0]?.order_id;
    await query(`DELETE FROM ${table} WHERE id = $1`, [id]);
    if (orderId) await recomputeDispatchStatus(orderId);
    return;
  }
  // A slip gone changes what "every slip sent" means.
  const slipOrder = table === "order_packing_slips" ? await getChildOrderId(table, id) : null;
  await query(`DELETE FROM ${table} WHERE id = $1`, [id]);
  if (slipOrder) await recomputeDispatchStatus(slipOrder);
}

/**
 * Delete an SO (cascades to its items, detail and lot rows), then close the
 * hole it leaves in the Sl. No. column — every order after it moves up one.
 */
export async function deleteOrder(id: string): Promise<void> {
  if (!UUID_RE.test(id)) return;
  await withTransaction(async (client) => {
    await client.query(SL_NO_LOCK);
    await client.query(`DELETE FROM orders WHERE id = $1`, [id]);
    await resequenceSerialNumbers(client);
  });
}

// ---------------------------------------------------------------------------
// QC documents (per EC)
// ---------------------------------------------------------------------------

// order_qc_documents: QC's own output (certs/reports), filled by QC.
// order_qc_requirement_documents: reference/requirement files Central
// Visibility uploads for QC to work from — the reverse direction.
export type QcDocTable = "order_qc_documents" | "order_qc_requirement_documents";

const QC_DOC_TABLES: readonly QcDocTable[] = [
  "order_qc_documents",
  "order_qc_requirement_documents",
];

// Table names are interpolated directly into SQL below (they can't be query
// params), so every entry point re-validates against this allow-list — the
// caller's TypeScript type isn't a guarantee once it crosses a Server Action.
function isQcDocTable(table: string): table is QcDocTable {
  return (QC_DOC_TABLES as readonly string[]).includes(table);
}

export type QcDocumentMeta = {
  id: string;
  file_name: string;
  mime_type: string | null;
  file_size: number | null;
  uploaded_at: string;
};

/** File counts keyed by item_id, for a QC document list view (no bytes). */
export async function listQcDocumentCounts(
  table: QcDocTable
): Promise<Record<string, number>> {
  if (!isQcDocTable(table)) return {};
  const result = await query<{ item_id: string; count: string }>(
    `SELECT item_id, COUNT(*)::text AS count
       FROM ${table}
      GROUP BY item_id`
  );
  return Object.fromEntries(result.rows.map((r) => [r.item_id, Number(r.count)]));
}

/** Attached documents for one EC item (metadata only, no bytes). */
export async function listQcDocuments(
  table: QcDocTable,
  itemId: string
): Promise<QcDocumentMeta[]> {
  if (!isQcDocTable(table) || !UUID_RE.test(itemId)) return [];
  const result = await query<QcDocumentMeta>(
    `SELECT id, file_name, mime_type, file_size,
            to_char(uploaded_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS uploaded_at
       FROM ${table}
      WHERE item_id = $1
      ORDER BY uploaded_at DESC`,
    [itemId]
  );
  return result.rows;
}

/** A single document's bytes, for download. Tries both QC document tables. */
export async function getQcDocumentFile(
  id: string
): Promise<{ file_name: string; mime_type: string | null; file_data: Buffer } | null> {
  if (!UUID_RE.test(id)) return null;
  for (const table of QC_DOC_TABLES) {
    const result = await query<{
      file_name: string;
      mime_type: string | null;
      file_data: Buffer;
    }>(`SELECT file_name, mime_type, file_data FROM ${table} WHERE id = $1`, [id]);
    if (result.rows[0]) return result.rows[0];
  }
  return null;
}

/** Attach one document to an EC item. */
export async function insertQcDocument(
  table: QcDocTable,
  itemId: string,
  file: { name: string; mimeType: string | null; size: number; data: Buffer }
): Promise<void> {
  if (!isQcDocTable(table) || !UUID_RE.test(itemId)) return;
  await query(
    `INSERT INTO ${table} (item_id, file_name, mime_type, file_size, file_data)
     VALUES ($1, $2, $3, $4, $5)`,
    [itemId, file.name, file.mimeType, file.size, file.data]
  );
}

/** Remove a document. */
export async function deleteQcDocument(table: QcDocTable, id: string): Promise<void> {
  if (!isQcDocTable(table) || !UUID_RE.test(id)) return;
  await query(`DELETE FROM ${table} WHERE id = $1`, [id]);
}

// ---------------------------------------------------------------------------
// Dispatch register (per lot, per EC)
// ---------------------------------------------------------------------------

export type DispatchRegisterRow = {
  id: string;
  sl_no: number;
  so_no: string | null;
  ec_no: string | null;
  client_name: string | null;
  lot_no: string | null;
  lot_dispatch_date: string | null;
  invoice_date: string | null;
  dispatch_status: string | null;
};

/** Every dispatched lot (has a lot-wise dispatch date), for the register. */
export async function listDispatchRegister(): Promise<DispatchRegisterRow[]> {
  const result = await query<DispatchRegisterRow>(
    `SELECT o.id,
            o.sl_no::int AS sl_no,
            o.so_no,
            to_char(o.so_date, 'YYYY-MM-DD') AS so_date,
            o.order_type,
            it.ec_no,
            o.client_name,
            l.lot_no,
            to_char(l.lot_dispatch_date, 'YYYY-MM-DD') AS lot_dispatch_date,
            to_char(l.invoice_date, 'YYYY-MM-DD') AS invoice_date,
            ${DISPATCH_STATUS} AS dispatch_status
       FROM order_lots l
       JOIN order_items it ON it.id = l.item_id
       JOIN orders o ON o.id = it.order_id
      WHERE l.lot_dispatch_date IS NOT NULL
      ORDER BY l.lot_dispatch_date DESC, o.sl_no ASC`
  );
  return result.rows;
}

// ---------------------------------------------------------------------------
// Dashboard overview (one row per EC)
// ---------------------------------------------------------------------------

export type OrderOverviewRow = {
  // The EC's id, or null on an order that has no ECs yet — those still get a
  // row so the pipeline can list the SO.
  id: string | null;
  order_id: string;
  sl_no: number;
  so_no: string | null;
  ec_no: string | null;
  item_type: string | null;
  client_name: string | null;
  client_code: string | null;
  industry_type: string | null;
  market_type: string | null;
  // Filter dimensions: who owns the order, where it is, and when it started.
  zone: string | null;
  reps: string | null;
  order_type: string | null;
  bill_type: string | null;
  so_date: string | null;
  ec_date: string | null;
  order_value: string | null;
  /** order_value in INR — the conversion for a non-INR order. For totals. */
  order_value_inr: string | null;
  has_pi: boolean;
  /** Fully raised / Partially raised / Pending / N/A / Challan filed — see BILLING_STATE. */
  billing_state: string | null;
  payment_status: string | null;
  drg_status: string | null;
  boi: string | null;
  purchase_done: boolean;
  qc_submitted: boolean;
  qc_required: string | null;
  planning_status: string | null;
  /** Planning's own date for the EC: when it says it will be ready. */
  planning_readiness_date: string | null;
  // Assembly & Packing is per EC, like the four above it — the Departments
  // popup shows all five side by side, and the pipeline matches it.
  assembly_done: boolean;
  /** Where the EC stands for Assembly & Packing (see ASSEMBLY_STATE_SQL). */
  assembly_state: string | null;
  /** Packed for Dispatch's purposes — a packing slip filed, or an EC packed. */
  so_packed: boolean;
  dispatch_status: string | null;
  // Each department's own deadline, so the pipeline can show a status beside
  // the date it is being judged against. All live on the SO — one target
  // applies across every EC of the order.
  payment_terms: string | null;
  // True when every payment term is counted from receipt: no PI is due and
  // Accounts has nothing to confirm until the money arrives. See lib/dept-view.
  after_receipt_only: boolean;
  drg_target_date: string | null;
  purchase_target_date: string | null;
  qc_doc_target_date: string | null;
  dispatch_team_target_date: string | null;
  dispatch_target_date: string | null;
  dispatch_target_revised_date: string | null;
  /** The EC's position on its SO; null on a bare SO row. */
  ec_seq?: number | null;
};

/**
 * One row per EC item with a representative status from each department.
 * order_value carries the SO value only on the SO's first EC (null on the
 * rest) so a "total order value" sum isn't inflated by multi-EC orders.
 */
/**
 * One pipeline row per EC (or a bare row for an SO with none): the columns
 * listOrdersOverview returns, as SQL, so the dashboard's pipeline can wrap the
 * same definition in its filter, its page and its counts.
 */
// A function rather than a constant: it quotes SQL fragments declared
// further down this module.
const overviewColumns = () => `it.id,
            o.id AS order_id,
            o.sl_no::int AS sl_no,
            o.so_no,
            it.ec_no,
            it.item_type,
            o.client_name,
            o.client_code,
            o.industry_type,
            o.market_type,
            o.zone,
            o.reps,
            o.order_type,
            o.bill_type,
            to_char(o.so_date, 'YYYY-MM-DD') AS so_date,
            to_char(it.ec_date, 'YYYY-MM-DD') AS ec_date,
            -- Order value belongs to the SO, so it is printed once: on the
            -- first EC, or on the bare SO row when there are none.
            CASE WHEN it.seq IS NULL
                   OR it.seq = MIN(it.seq) OVER (PARTITION BY o.id)
                 THEN o.order_value::text END AS order_value,
            -- The same, in INR: a USD order counts at its conversion, so
            -- totals across orders add up in one currency.
            CASE WHEN it.seq IS NULL
                   OR it.seq = MIN(it.seq) OVER (PARTITION BY o.id)
                 THEN (${ORDER_VALUE_INR})::text END AS order_value_inr,
            -- Billing's progress: a PI with a number on it, or a challan.
            ${BILLING_RAISED} AS has_pi,
            ${BILLING_STATE} AS billing_state,
            a.payment_status,
            -- Drawing progress derives from the EC revision list: the
            -- furthest hand-off any revision has reached — approved, then
            -- issued to client, then issued to operations — else null.
            (SELECT CASE
                      WHEN bool_or(lower(coalesce(rv.approved,'')) = 'yes')
                        THEN 'Drg approved'
                      WHEN bool_or(lower(coalesce(rv.issued_to_client,'')) = 'yes')
                        THEN 'Drg. issued to Client'
                      WHEN bool_or(lower(coalesce(rv.issued_to_operations,'')) = 'yes')
                        THEN 'Drg. issued to Operations'
                      ELSE NULL
                    END
               FROM order_drawing_revisions rv WHERE rv.item_id = it.id AND rv.doc_type = 'GAD') AS drg_status,
            o.boi,
            (CASE
               WHEN COALESCE(o.boi, '') <> 'Yes' THEN true
               WHEN NOT EXISTS (SELECT 1 FROM order_boi_items bi WHERE bi.item_id = it.id) THEN false
               WHEN EXISTS (SELECT 1 FROM order_boi_items bi WHERE bi.item_id = it.id AND NOT ${boiReceivedSql("bi")}) THEN false
               ELSE true
             END) AS purchase_done,
            (qc.qc_doc_actual_date IS NOT NULL) AS qc_submitted,
            o.qc_required,
            -- Planning files its status on whichever of the three columns
            -- applies, so read them in the same order getOrderDeptStatus and
            -- the order-list filter do. Reading planning_status alone showed
            -- only the free-text one and missed both selects.
            COALESCE(NULLIF(pl.actual_pump_status, ''),
                     NULLIF(pl.actual_spare_status, ''),
                     NULLIF(pl.planning_status, '')) AS planning_status,
            to_char(pl.planning_readiness_date, 'YYYY-MM-DD') AS planning_readiness_date,
            (ad.actual_packing_date IS NOT NULL) AS assembly_done,
            CASE WHEN it.id IS NULL THEN NULL ELSE ${ASSEMBLY_STATE_SQL("it")} END AS assembly_state,
            ${SO_PACKED_SQL("o")} AS so_packed,
            ${DISPATCH_STATUS} AS dispatch_status,
            ${PAYMENT_TERMS_SQL("o")} AS payment_terms,
            ${AFTER_RECEIPT_ONLY} AS after_receipt_only,
            to_char(o.drg_target_date, 'YYYY-MM-DD') AS drg_target_date,
            to_char(o.purchase_target_date, 'YYYY-MM-DD') AS purchase_target_date,
            to_char(o.qc_doc_target_date, 'YYYY-MM-DD') AS qc_doc_target_date,
            to_char(o.dispatch_team_target_date, 'YYYY-MM-DD') AS dispatch_team_target_date,
            to_char(o.dispatch_target_date, 'YYYY-MM-DD') AS dispatch_target_date,
            to_char(o.dispatch_target_revised_date, 'YYYY-MM-DD')
              AS dispatch_target_revised_date,
            it.seq::int AS ec_seq`;

const OVERVIEW_FROM = `FROM orders o
       LEFT JOIN order_items it             ON it.order_id = o.id
       LEFT JOIN order_billing b            ON b.order_id = o.id
       LEFT JOIN order_accounts a           ON a.order_id = o.id
       LEFT JOIN order_drawing dr           ON dr.item_id = it.id
       LEFT JOIN order_qc qc                ON qc.item_id = it.id
       LEFT JOIN order_planning pl          ON pl.item_id = it.id
       LEFT JOIN order_assembly_dispatch ad ON ad.item_id = it.id`;

export async function listOrdersOverview(
  // A department's own dashboard passes itself, so orders it has nothing to do
  // with are out of its rows and out of its figures. Omitted (Central, Admin)
  // returns every order.
  dept?: DeptKey
): Promise<OrderOverviewRow[]> {
  const result = await query<OrderOverviewRow>(
    `SELECT ${overviewColumns()}
       ${OVERVIEW_FROM}
      WHERE ${
        // Drawing's rows are ECs: a Spare EC is out, whatever the SO around it.
        dept === "drawing"
          ? `NOT (${spareEcSql("it", "o")}) AND ${orderOpenSql("o")} AND ${releasedSql("o")}`
          : dept
            ? deptQueueSql(dept)
            : "TRUE"
      }
      ORDER BY o.sl_no ASC, it.seq ASC NULLS FIRST`
  );
  return result.rows;
}

// ---------------------------------------------------------------------------
// Payment holds (SO level)
// ---------------------------------------------------------------------------

export type PaymentHoldRow = {
  id: string;
  sl_no: number;
  so_no: string | null;
  client_name: string | null;
  hold_reason: string | null;
  order_value: string | null;
};

/** Payment Holds show this many per page. */
export const HOLDS_PAGE_SIZE = 25;

/** One page of the SOs whose payment is on Hold (escalated to Central Visibility). */
export async function listPaymentHoldsPage(page: number): Promise<PageResult<PaymentHoldRow>> {
  const from = `FROM orders o
                 JOIN order_accounts a ON a.order_id = o.id
                WHERE lower(a.payment_status) = 'outstanding hold'
                  AND ${orderOpenSql("o")}`;
  return pageWithTotal(
    page,
    (p) =>
      query<PaymentHoldRow & { total_count: string }>(
        `SELECT o.id,
                o.sl_no::int AS sl_no,
                o.so_no,
                to_char(o.so_date, 'YYYY-MM-DD') AS so_date,
                o.order_type,
                o.client_name,
                o.order_value::text AS order_value,
                a.hold_reason,
                count(*) OVER ()::text AS total_count
           ${from}
          ORDER BY o.sl_no ASC, o.id ASC
          LIMIT $1 OFFSET $2`,
        [HOLDS_PAGE_SIZE, offsetFor(p, HOLDS_PAGE_SIZE)]
      ),
    async () => {
      const r = await query<{ count: string }>(`SELECT count(*)::text AS count ${from}`);
      return Number(r.rows[0]?.count ?? 0);
    },
    HOLDS_PAGE_SIZE
  );
}

// ---------------------------------------------------------------------------
// Department workspace queues
// ---------------------------------------------------------------------------

type ContextColumn = { column: string; type: string; from?: OrderTable };

function contextTypeCast(type: string): string {
  return type === "date" ? "date" : "text";
}

/**
 * SO-keyed workspace queue (Billing & Operations, Accounts): one row per SO
 * plus that section's fields. Date/number columns are returned as strings.
 */
export async function listOrdersForSection(
  table: OrderTable,
  contextColumns: ContextColumn[] = [],
  // When given, only these SOs are read — how the paged wrapper keeps the
  // query to one page instead of scanning the whole queue.
  orderIds?: string[]
): Promise<Row[]> {
  const section = SECTION_BY_TABLE.get(table);
  if (!section || section.scope !== "so" || table === "orders") return [];

  const detailSelects = section.fields
    .map((f) =>
      // Accounts: the balance as it stands — the value with GST less what came
      // in — even on an SO Accounts has not opened yet (no row stored).
      table === "order_accounts" && f.column === "balance_of_payment"
        ? `(${ORDER_VALUE_GST_SQL("o", "d")} - COALESCE(d.amount_received, 0))::text AS balance_of_payment`
        : detailSelect("d", f)
    )
    .join(", ");

  const extraJoins = new Map<string, string>();
  const contextSelects = contextColumns
    .map((f) => {
      const from = f.from ?? "orders";
      if (from === "orders" && DROPPED_ORDER_COLUMNS.has(f.column)) {
        return `, NULL::${contextTypeCast(f.type)} AS ${f.column}`;
      }
      if (from === "orders" && f.column === "payment_terms") {
        return `, ${PAYMENT_TERMS_SQL("o")} AS payment_terms`;
      }
      // Accounts: the value with GST, from the SO and its accounts row (d).
      if (f.column === "order_value_gst" && table === "order_accounts") {
        return `, (${ORDER_VALUE_GST_SQL("o", "d")})::text AS order_value_gst`;
      }
      let alias: string;
      if (from === "orders") alias = "o";
      else if (from === table) alias = "d";
      else {
        alias = from;
        extraJoins.set(from, alias);
      }
      return f.type === "date"
        ? `, to_char(${alias}.${f.column}, 'YYYY-MM-DD') AS ${f.column}`
        : `, ${alias}.${f.column}`;
    })
    .join("");

  const extraJoinSql = [...extraJoins.entries()]
    .map(([t, a]) => `LEFT JOIN ${t} ${a} ON ${a}.order_id = o.id`)
    .join("\n       ");

  // Accounts is not involved for Challan orders — Billing collects payment
  // against the challan directly, so those SOs shouldn't sit in the Accounts
  // queue at all.
  const clauses: string[] = [];
  if (table === "order_accounts") {
    clauses.push(`COALESCE(o.bill_type, '') <> 'Challan'`);
  }
  if (orderIds) clauses.push(`o.id = ANY($1)`);
  const whereSql = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";

  const result = await query<Row>(
    `SELECT o.id,
            o.sl_no::int AS sl_no,
            o.so_no,
            NULL::text AS ec_no,
            o.client_name,
            o.clearance_status, o.clearance_hold_reason, o.clearance_remarks,
            ${DISPATCH_STATUS} AS so_dispatch_status,
            o.accounts_hold_status, o.accounts_hold_reason, o.accounts_hold_remarks,
            -- The order value's currency, shown beside it (Accounts).
            o.order_currency,
            -- Accounts: the payment term lines and the PI raised against each.
            ${table === "order_accounts" ? `COALESCE((SELECT jsonb_agg(jsonb_build_object(
                        'id', t.id, 'term', t.term, 'percent', t.percent::text,
                        'days', t.days, 'documents', t.documents,
                        'term_payment_status', t.term_payment_status,
                        'term_confirmed_date', to_char(t.term_confirmed_date, 'YYYY-MM-DD'),
                        'term_amount_received', t.term_amount_received::text,
                        'term_hold_reason', t.term_hold_reason) ORDER BY t.seq)
                      FROM order_payment_terms t WHERE t.order_id = o.id), '[]'::jsonb) AS term_lines,
            COALESCE((SELECT jsonb_agg(to_jsonb(pd) ORDER BY pd.seq)
                      FROM order_billing_docs pd WHERE pd.order_id = o.id), '[]'::jsonb) AS pi_docs,` : ""}
            -- What the payment terms say about whether this department
            -- still has anything to record here (lib/order-lock).
            ${AFTER_RECEIPT_ONLY} AS after_receipt_only${detailSelects ? `,\n            ${detailSelects}` : ""}${contextSelects}
       FROM orders o
       LEFT JOIN ${table} d ON d.order_id = o.id
       ${extraJoinSql}
       ${whereSql}
      ORDER BY o.sl_no ASC`,
    orderIds ? [orderIds] : []
  );
  return result.rows;
}

/**
 * Item-keyed workspace queue (Drawing, Purchase, QC, Planning, Assembly &
 * Dispatch): one row per EC joined to its parent SO plus that section's fields.
 * The row `id` is the item_id (edit target). Date/number columns are strings.
 */
export async function listItemsForSection(
  table: OrderTable,
  contextColumns: ContextColumn[] = [],
  // When given, only these SOs are read — how the paged wrapper keeps the
  // query to one page instead of scanning the whole queue.
  orderIds?: string[]
): Promise<Row[]> {
  const section = SECTION_BY_TABLE.get(table);
  if (!section || section.scope !== "item" || table === "order_items") return [];

  const detailSelects = section.fields.map((f) => detailSelect("d", f)).join(", ");

  // Context columns come from the item (it), the parent SO (o), the section
  // table (d), or another item-keyed detail table joined by its own alias.
  const extraJoins = new Map<string, string>();
  const contextSelects = contextColumns
    .map((f) => {
      const from = f.from ?? "order_items";
      if (from === "orders" && f.column === "payment_terms") {
        return `, ${PAYMENT_TERMS_SQL("o")} AS payment_terms`;
      }
      let alias: string;
      if (from === "orders") alias = "o";
      else if (from === "order_items") alias = "it";
      else if (from === table) alias = "d";
      else {
        alias = from;
        extraJoins.set(from, alias);
      }
      return f.type === "date"
        ? `, to_char(${alias}.${f.column}, 'YYYY-MM-DD') AS ${f.column}`
        : `, ${alias}.${f.column}`;
    })
    .join("");

  const extraJoinSql = [...extraJoins.entries()]
    .map(([t, a]) => `LEFT JOIN ${t} ${a} ON ${a}.item_id = it.id`)
    .join("\n       ");

  // QC isn't involved when the SO is flagged QC Needed = No, nor Drawing on a
  // Spare EC.
  const clauses: string[] = [];
  if (table === "order_qc") {
    clauses.push(`(o.qc_required IS NULL OR o.qc_required <> 'No')`);
  }
  if (deptForTable(table) === "drawing") {
    clauses.push(`NOT (${spareEcSql("it", "o")})`);
  }
  if (deptForTable(table) === "assembly") {
    clauses.push(SPARE_READY_FOR_ASSEMBLY("it"));
  }
  if (orderIds) clauses.push(`it.order_id = ANY($1)`);
  const whereSql = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";

  // Sections backed by a per-EC child list (Planning/Packing → packing slips)
  // carry those rows inline so the workspace can edit them without a round
  // trip. `client_type` rides along for the export-only column gate.
  // childKind is a schema constant, never user input — still pinned to the
  // known values so it can never widen what goes into the SQL text.
  const slipKind = section.childKind === "tentative" ? "tentative" : "actual";
  const childSelect =
    section.childTable === "order_packing_slips"
      ? `, o.market_type, o.packing_details_required,
         COALESCE((SELECT jsonb_agg(to_jsonb(ps) ORDER BY ps.seq)
                     FROM order_packing_slips ps
                    WHERE ps.item_id = it.id
                      AND ps.kind = '${slipKind}'),
                  '[]'::jsonb) AS child_rows`
      : section.childTable === "order_drawing_revisions"
        ? `, COALESCE((SELECT jsonb_agg(to_jsonb(rv) || jsonb_build_object('doc_count', (SELECT count(*) FROM order_drawing_documents dd WHERE dd.revision_id = rv.id)) ORDER BY rv.seq)
                         FROM order_drawing_revisions rv
                        WHERE rv.item_id = it.id),
                      '[]'::jsonb) AS child_rows,
           -- Part drawings, when Planning has asked for them.
           (SELECT pl.part_drawing FROM order_planning pl WHERE pl.item_id = it.id) AS part_drawing,
           COALESCE((SELECT jsonb_agg(to_jsonb(pd) ORDER BY pd.seq)
                             FROM order_part_drawings pd WHERE pd.item_id = it.id), '[]'::jsonb) AS part_drawings`
        : "";
  const soChildSelect =
    section.soChild?.table === "order_packing_slips"
      ? `, o.market_type, o.packing_details_required,
         COALESCE((SELECT jsonb_agg(to_jsonb(ps) ORDER BY ps.seq)
                     FROM order_packing_slips ps
                    WHERE ps.order_id = it.order_id
                      AND ps.kind = '${section.soChild.kind === "tentative" ? "tentative" : "actual"}'),
                  '[]'::jsonb) AS so_child_rows`
      : "";
  const readyLotsSelect =
    table === "order_planning" || table === "order_assembly_dispatch"
      ? `, COALESCE((SELECT jsonb_agg(to_jsonb(rl) || jsonb_build_object('plan_moves',
                       (SELECT count(*) FROM order_packing_plan_history ph
                         WHERE ph.lot_id = rl.id AND ph.prev_plan_date IS NOT NULL
                           AND ph.plan_date IS DISTINCT FROM ph.prev_plan_date)) ORDER BY rl.seq)
                     FROM order_ready_lots rl WHERE rl.item_id = it.id),
                  '[]'::jsonb) AS ready_lots${
           table === "order_planning"
             ? // …and where Assembly & Packing has got to on it, and the SO's packing slips.
               `, d.readiness_date_status, ${ASSEMBLY_STATE_SQL("it")} AS assembly_state,
                 to_jsonb(it) - 'order_copy_file_data' AS ec,
                 -- The EC's GAD versions: Planning sees where it stands and,
                 -- once issued to them, its date and SharePoint link.
                 COALESCE((SELECT jsonb_agg(to_jsonb(rv) ORDER BY rv.seq)
                             FROM order_drawing_revisions rv
                            WHERE rv.item_id = it.id AND rv.doc_type = 'GAD'), '[]'::jsonb) AS gad_versions,
                 -- Part drawings: whether Planning asked for them, and the parts.
                 d.part_drawing,
                 -- The parts the EC is short of.
                 COALESCE((SELECT jsonb_agg(to_jsonb(ps) ORDER BY ps.seq)
                             FROM order_part_shortages ps WHERE ps.item_id = it.id), '[]'::jsonb) AS part_shortages,
                 COALESCE((SELECT jsonb_agg(to_jsonb(pd) ORDER BY pd.seq)
                             FROM order_part_drawings pd WHERE pd.item_id = it.id), '[]'::jsonb) AS part_drawings,
                 (SELECT to_char(pad.actual_packing_date, 'YYYY-MM-DD')
                    FROM order_assembly_dispatch pad WHERE pad.item_id = it.id) AS actual_packing_date,
                 COALESCE((SELECT jsonb_agg(jsonb_build_object(
                             'packing_slip_no', ps.packing_slip_no,
                             'packing_slip_date', to_char(ps.packing_slip_date, 'YYYY-MM-DD'),
                             'lot_nos', ps.lot_nos) ORDER BY ps.seq)
                             FROM order_packing_slips ps
                            WHERE ps.order_id = it.order_id AND ps.kind = 'actual'
                              AND NULLIF(btrim(ps.packing_slip_no), '') IS NOT NULL), '[]'::jsonb) AS so_slips`
             : // Assembly & Packing is overdue against Planning's readiness date.
               `, (SELECT to_char(rpl.planning_readiness_date, 'YYYY-MM-DD')
                    FROM order_planning rpl WHERE rpl.item_id = it.id) AS planning_readiness_date,
                 -- A pump: the EC itself, what Planning has ready on it and its
                 -- SO status there, and its assembly plan entries.
                 to_jsonb(it) - 'order_copy_file_data' AS ec,
                 (SELECT rpl.ready_qty FROM order_planning rpl WHERE rpl.item_id = it.id) AS ready_qty,
                 (SELECT rpl.actual_spare_status FROM order_planning rpl WHERE rpl.item_id = it.id) AS ppc_status`
         }`
      : "";

  const result = await query<Row>(
    `SELECT it.id,
            it.order_id,
            it.seq::int AS seq,
            o.sl_no::int AS sl_no,
            o.so_no,
            it.ec_no,
            it.item_type,
            o.client_name,
            o.clearance_status, o.clearance_hold_reason, o.clearance_remarks,
            ${DISPATCH_STATUS} AS so_dispatch_status,
            o.accounts_hold_status, o.accounts_hold_reason, o.accounts_hold_remarks
            ${childSelect}${soChildSelect}${readyLotsSelect}${detailSelects ? `,\n            ${detailSelects}` : ""}${contextSelects}
       FROM order_items it
       JOIN orders o ON o.id = it.order_id
       LEFT JOIN ${table} d ON d.item_id = it.id
       ${extraJoinSql}
      ${whereSql}
      ORDER BY o.sl_no ASC, it.seq ASC`,
    orderIds ? [orderIds] : []
  );
  return result.rows;
}

export type BillingQueueRow = {
  id: string;
  /** Dispatch: the SO's stage in Invoice → Dispatch → Docket & LR. */
  dispatch_stage?: string | null;
  /** Billing: Fully raised / Partially raised / Pending / N/A. */
  billing_state?: string | null;
  sl_no: number;
  so_no: string | null;
  so_date: string | null;
  order_type: string | null;
  client_name: string | null;
  bill_type: string | null;
  payment_terms: string | null;
  // Closes the PI list on this order (lib/order-lock).
  after_receipt_only: boolean;
  freight_terms: string | null;
  packing_requirement: string | null;
  order_value: string | null;
  order_currency: string | null;
  // Challan-only, when bill_type = Challan (used by the flat edit modal).
  challan_no: string | null;
  challan_date: string | null;
  challan_value: string | null;
  fr_reason: string | null;
  dispatch_status: string | null;
  pi_docs: Row[];
  /** The SO's payment term lines, in order — each takes one PI (Billing). */
  term_lines: Row[];
  /** Planning's readiness across the SO's ECs: earliest and latest date, and the status when every EC shares it. */
  readiness_from: string | null;
  readiness_to: string | null;
  readiness_status: string | null;
  invoices: Row[];
  /** The SO's actual packing slips, each with the dispatch it went out on. */
  packing_slips: Row[];
};

/**
 * Billing, Accounts and Dispatch queue: one row per SO, with the read-only
 * SO context and
 * that SO's list of PIs (order_billing_docs) for inline management.
 */
export async function listOrdersForBilling(
  orderIds?: string[]
): Promise<BillingQueueRow[]> {
  const result = await query<BillingQueueRow>(
    `SELECT o.id,
            o.sl_no::int AS sl_no,
            o.so_no,
            to_char(o.so_date, 'YYYY-MM-DD') AS so_date,
            o.order_type,
            o.client_name,
            o.clearance_status, o.clearance_hold_reason, o.clearance_remarks,
            ${DISPATCH_STATUS} AS so_dispatch_status,
            ${dispatchStageSql("o")} AS dispatch_stage,
            ${BILLING_STATE} AS billing_state,
            o.accounts_hold_status, o.accounts_hold_reason, o.accounts_hold_remarks,
            o.bill_type,
            ${PAYMENT_TERMS_SQL("o")} AS payment_terms,
            ${AFTER_RECEIPT_ONLY} AS after_receipt_only,
            o.freight_terms,
            o.packing_requirement,
            o.order_value::text AS order_value,
            o.order_currency,
            b.challan_no,
            to_char(b.challan_date, 'YYYY-MM-DD') AS challan_date,
            b.challan_value::text AS challan_value,
            b.fr_reason,
            ${DISPATCH_STATUS} AS dispatch_status,
            COALESCE((SELECT jsonb_agg(to_jsonb(d) ORDER BY d.seq)
                      FROM order_billing_docs d WHERE d.order_id = o.id),
                     '[]'::jsonb) AS pi_docs,
            COALESCE((SELECT jsonb_agg(jsonb_build_object(
                        'id', t.id, 'term', t.term, 'percent', t.percent::text,
                        'days', t.days, 'documents', t.documents,
                        'term_payment_status', t.term_payment_status,
                        'term_confirmed_date', to_char(t.term_confirmed_date, 'YYYY-MM-DD'),
                        'term_amount_received', t.term_amount_received::text,
                        'term_hold_reason', t.term_hold_reason) ORDER BY t.seq)
                      FROM order_payment_terms t WHERE t.order_id = o.id),
                     '[]'::jsonb) AS term_lines,
            -- Planning's readiness, for Billing to see when the SO will be ready.
            (SELECT to_char(min(rp.planning_readiness_date), 'YYYY-MM-DD')
               FROM order_items ri JOIN order_planning rp ON rp.item_id = ri.id
              WHERE ri.order_id = o.id) AS readiness_from,
            (SELECT to_char(max(rp.planning_readiness_date), 'YYYY-MM-DD')
               FROM order_items ri JOIN order_planning rp ON rp.item_id = ri.id
              WHERE ri.order_id = o.id) AS readiness_to,
            (SELECT CASE WHEN count(DISTINCT st) = 1 AND count(st) = count(*) THEN max(st) END
               FROM (SELECT COALESCE(NULLIF(rp.actual_spare_status, ''), NULLIF(rp.actual_pump_status, ''),
                                     NULLIF(rp.planning_status, '')) AS st
                       FROM order_items ri LEFT JOIN order_planning rp ON rp.item_id = ri.id
                      WHERE ri.order_id = o.id) s) AS readiness_status,
            COALESCE((SELECT jsonb_agg((to_jsonb(inv) - 'lr_file_data') || jsonb_build_object(
                        'slips', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                         'id', ps.id, 'packing_slip_no', ps.packing_slip_no,
                         'packing_slip_date', ps.packing_slip_date, 'quantity', ps.quantity, 'lot_nos', ps.lot_nos)
                         ORDER BY ps.seq)
                       FROM order_invoice_slips l JOIN order_packing_slips ps ON ps.id = l.packing_slip_id
                      WHERE l.invoice_id = inv.id), '[]'::jsonb)) ORDER BY inv.seq)
                      FROM order_invoices inv WHERE inv.order_id = o.id),
                     '[]'::jsonb) AS invoices,
            COALESCE((SELECT jsonb_agg(jsonb_build_object(
                        'id', ps.id, 'packing_slip_no', ps.packing_slip_no,
                        'packing_slip_date', ps.packing_slip_date, 'quantity', ps.quantity, 'lot_nos', ps.lot_nos,
                        'invoice_id', (SELECT l.invoice_id FROM order_invoice_slips l WHERE l.packing_slip_id = ps.id))
                        ORDER BY ps.seq)
                      FROM order_packing_slips ps WHERE ps.order_id = o.id AND ps.kind = 'actual'
                       -- A blank slip (no number yet) is not ready to go; one already on a
                       -- dispatch still shows there.
                       AND (NULLIF(btrim(ps.packing_slip_no), '') IS NOT NULL
                            OR EXISTS (SELECT 1 FROM order_invoice_slips l WHERE l.packing_slip_id = ps.id))),
                     '[]'::jsonb) AS packing_slips
       FROM orders o
       LEFT JOIN order_billing b ON b.order_id = o.id
      WHERE ($1::uuid[] IS NULL OR o.id = ANY($1))
      ORDER BY o.sl_no ASC`,
    [orderIds ?? null]
  );
  return result.rows;
}

export type PurchaseQueueRow = {
  id: string;
  order_id: string;
  sl_no: number;
  so_no: string | null;
  so_date: string | null;
  order_type: string | null;
  ec_no: string | null;
  boi: string | null;
  ld: string | null;
  ld_date: string | null;
  purchase_target_date: string | null;
  boi_items: Row[];
  /** The EC itself: its type, model, qty and own BOI. */
  item_type?: string | null;
  model_no?: string | null;
  pump_type?: string | null;
  quantity?: number | null;
  ec_boi?: string | null;
  ec_date?: string | null;
};

/**
 * Purchase workspace queue: one row per EC with the SO's BOI flag, the purchase
 * target date, and that EC's BOI items (for the manage-items list).
 */
export async function listItemsForPurchase(
  orderIds?: string[]
): Promise<PurchaseQueueRow[]> {
  // BOI = No SOs don't need Purchase involvement — hide them from the queue.
  const result = await query<PurchaseQueueRow>(
    `SELECT it.id,
            it.order_id,
            o.sl_no::int AS sl_no,
            o.so_no,
            to_char(o.so_date, 'YYYY-MM-DD') AS so_date,
            o.order_type,
            it.ec_no,
            it.item_type, it.model_no, it.pump_type, it.quantity, it.boi AS ec_boi,
            to_char(it.ec_date, 'YYYY-MM-DD') AS ec_date,
            o.clearance_status, o.clearance_hold_reason, o.clearance_remarks,
            ${DISPATCH_STATUS} AS so_dispatch_status,
            o.accounts_hold_status, o.accounts_hold_reason, o.accounts_hold_remarks,
            o.boi,
            o.ld,
            to_char(o.ld_date, 'YYYY-MM-DD') AS ld_date,
            to_char(o.purchase_target_date, 'YYYY-MM-DD') AS purchase_target_date,
            COALESCE((SELECT jsonb_agg(to_jsonb(bi) || jsonb_build_object('expected_history', COALESCE((
                        SELECT jsonb_agg(jsonb_build_object(
                                 'prev', to_char(h.prev_date, 'YYYY-MM-DD'),
                                 'next', to_char(h.new_date, 'YYYY-MM-DD'),
                                 'by', u.full_name, 'role', h.changed_by_role,
                                 'at', to_char(h.changed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))
                                 ORDER BY h.changed_at DESC)
                          FROM order_boi_expected_history h LEFT JOIN users u ON u.id = h.changed_by
                         WHERE h.boi_item_id = bi.id), '[]'::jsonb)) ORDER BY bi.created_at)
                      FROM order_boi_items bi WHERE bi.item_id = it.id), '[]'::jsonb) AS boi_items
       FROM order_items it
       JOIN orders o ON o.id = it.order_id
      WHERE o.boi = 'Yes'
        AND ($1::uuid[] IS NULL OR it.order_id = ANY($1))
      ORDER BY o.sl_no ASC, it.seq ASC`,
    [orderIds ?? null]
  );
  return result.rows;
}

function detailSelect(
  alias: string,
  f: { column: string; type: string; defaultValue?: string }
): string {
  // A field with a default shows it while nothing is stored (GST 18%).
  if (f.defaultValue !== undefined && (f.type === "int" || f.type === "number")) {
    return `COALESCE(${alias}.${f.column}, ${Number(f.defaultValue)})::text AS ${f.column}`;
  }
  if (f.type === "date") {
    return `to_char(${alias}.${f.column}, 'YYYY-MM-DD') AS ${f.column}`;
  }
  if (f.type === "int" || f.type === "number") {
    return `${alias}.${f.column}::text AS ${f.column}`;
  }
  return `${alias}.${f.column}`;
}

/**
 * Dispatch status, with "nothing dispatched" spelled the same way everywhere.
 *
 * The column is derived — recomputeDispatchStatus writes 'Pending' when no
 * invoice has been filled in — but it is stored, so an order the recompute has
 * never run for keeps NULL. Both mean the same thing, and an order with no
 * invoices has no other state it could be in, so a blank reads as Pending
 * rather than as an unknown.
 */
// The order status as everyone sees it: what Central Visibility set (cancelled,
// diverted, or a dispatch state), else what the invoices say.
const DISPATCH_STATUS = orderStatusSql("o");

/**
 * An order's value in INR: its own value when priced in INR (or with no
 * currency given), its recorded conversion otherwise. What totals add up.
 */
const ORDER_VALUE_INR = `CASE WHEN upper(COALESCE(NULLIF(o.order_currency, ''), 'INR')) = 'INR'
                             THEN o.order_value ELSE o.order_value_inr END`;

/**
 * Whether Billing has actually raised a PI (or filed a challan) on this SO.
 *
 * Adding a PI inserts a blank row, so testing that a row exists reported an
 * untouched card as done. The PI number is what identifies a PI — the same
 * field the "PI created" notification waits for — so that is the test.
 *
 * Self-contained subqueries rather than a joined alias, so every caller can
 * drop it in wherever `o` is the order.
 */
const BILLING_RAISED = `(EXISTS (SELECT 1 FROM order_billing_docs d
                                 WHERE d.order_id = o.id
                                   AND COALESCE(d.pi_no, '') <> '')
                         OR EXISTS (SELECT 1 FROM order_billing bl
                                     WHERE bl.order_id = o.id
                                       AND COALESCE(bl.challan_no, '') <> ''))`;

/**
 * How far Billing has raised the SO's PIs, against its payment terms:
 *   Fully raised      every term line that takes a PI has one (with a number)
 *   Partially raised  some do
 *   Pending           none do
 *   N/A               every term line is After Receipt — no PI is due
 * After Receipt lines are not counted. An SO with no term lines yet reads
 * Fully raised once any PI has a number, else Pending. A Challan order is
 * Challan filed once its challan has a number.
 */
const BILLING_STATE = `(CASE
    WHEN btrim(COALESCE(o.bill_type, '')) = 'Challan' THEN
      CASE WHEN EXISTS (SELECT 1 FROM order_billing bl WHERE bl.order_id = o.id AND COALESCE(bl.challan_no, '') <> '')
           THEN 'Challan filed' ELSE 'Pending' END
    WHEN NOT EXISTS (SELECT 1 FROM order_payment_terms bt WHERE bt.order_id = o.id) THEN
      CASE WHEN EXISTS (SELECT 1 FROM order_billing_docs d WHERE d.order_id = o.id AND COALESCE(d.pi_no, '') <> '')
           THEN 'Fully raised' ELSE 'Pending' END
    WHEN NOT EXISTS (SELECT 1 FROM order_payment_terms bt WHERE bt.order_id = o.id
                       AND btrim(COALESCE(bt.term, '')) <> 'After Receipt') THEN 'N/A'
    WHEN NOT EXISTS (SELECT 1 FROM order_payment_terms bt WHERE bt.order_id = o.id
                       AND btrim(COALESCE(bt.term, '')) <> 'After Receipt'
                       AND NOT EXISTS (SELECT 1 FROM order_billing_docs d
                                        WHERE d.payment_term_id = bt.id AND COALESCE(d.pi_no, '') <> '')) THEN 'Fully raised'
    WHEN EXISTS (SELECT 1 FROM order_payment_terms bt WHERE bt.order_id = o.id
                   AND btrim(COALESCE(bt.term, '')) <> 'After Receipt'
                   AND EXISTS (SELECT 1 FROM order_billing_docs d
                                WHERE d.payment_term_id = bt.id AND COALESCE(d.pi_no, '') <> '')) THEN 'Partially raised'
    ELSE 'Pending' END)`;

// ---------------------------------------------------------------------------
// Master SO list
// ---------------------------------------------------------------------------

/** All SOs for the master table, each with its EC items, ordered by Sl. No. */
/**
 * One page of the orders list, filtered in SQL.
 *
 * Search covers the SO's own columns plus its ECs (an EC number or model is
 * how people find an order), so it has to run here — filtering the 30 rows
 * already on screen would miss matches on every other page.
 */
// The orders-list filter, shared by the paged table and the Excel export so
// "Export N filtered" can never disagree with the rows on screen.
// $1 = zones (null for all), $2 = search pattern (null for all).
/** The free-text search on the orders list, against placeholder `p`. */
function orderSearchSql(p: string): string {
  return `(o.so_no ILIKE ${p} OR o.client_name ILIKE ${p}
          OR o.client_code ILIKE ${p} OR o.po_no ILIKE ${p}
          OR o.sl_no::text ILIKE ${p}
          OR EXISTS (SELECT 1 FROM order_items s
                      WHERE s.order_id = o.id
                        AND (s.ec_no ILIKE ${p} OR s.item_type ILIKE ${p}
                             OR s.model_no ILIKE ${p})))`;
}

/**
 * SQL for "this SO is <status> in <dept>", where <status> is the department's
 * own word for it — Drawing's "Approved", Accounts' payment status — not a
 * flattened done/pending. Each arm mirrors getOrderDeptStatus, so a row the
 * filter returns is a row whose "Departments" popup says the same thing.
 *
 * Per-EC departments match when ANY EC is in that state: one unfinished EC is
 * what actually holds an order up.
 */

/** Values come from fixed lists, but never interpolate one unescaped. */
function lit(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

const DRG_APPROVED = `EXISTS (SELECT 1 FROM order_drawing_revisions rv
                              WHERE rv.item_id = it.id AND rv.doc_type = 'GAD'
                                AND lower(coalesce(rv.approved, '')) = 'yes')`;
const DRG_ISSUED = `EXISTS (SELECT 1 FROM order_drawing_revisions rv
                            WHERE rv.item_id = it.id AND rv.doc_type = 'GAD'
                              AND lower(coalesce(rv.issued_to_client, '')) = 'yes')`;
const DRG_TO_OPS = `EXISTS (SELECT 1 FROM order_drawing_revisions rv
                            WHERE rv.item_id = it.id AND rv.doc_type = 'GAD'
                              AND lower(coalesce(rv.issued_to_operations, '')) = 'yes')`;
const BOI_RECEIVED = `EXISTS (SELECT 1 FROM order_boi_items bi WHERE bi.item_id = it.id)
                      AND NOT EXISTS (SELECT 1 FROM order_boi_items bi
                                       WHERE bi.item_id = it.id
                                         AND NOT ${boiReceivedSql("bi")})`;
const QC_SUBMITTED = `EXISTS (SELECT 1 FROM order_qc q
                              WHERE q.item_id = it.id
                                AND q.qc_doc_actual_date IS NOT NULL)`;
/**
 * Something on this order is packed and it has not all gone out yet — what
 * Dispatch can act on today. Reads Assembly & Packing's own packing date, so
 * the two departments agree on what "packed" means.
 */
/**
 * The SO has been packed, as far as Dispatch is concerned: Assembly & Packing
 * has filed a packing slip for it (the slip is what raises Dispatch's card),
 * or packed one of its ECs. Dispatch works the SO, not the EC.
 */
const SO_PACKED_SQL = (o: string) => `(EXISTS (SELECT 1 FROM order_packing_slips sps
                    WHERE sps.order_id = ${o}.id AND sps.kind = 'actual'
                      AND (NULLIF(btrim(sps.packing_slip_no), '') IS NOT NULL
                           OR sps.packing_slip_date IS NOT NULL))
         OR EXISTS (SELECT 1 FROM order_items it2
                      JOIN order_assembly_dispatch ad2 ON ad2.item_id = it2.id
                     WHERE it2.order_id = ${o}.id AND ad2.actual_packing_date IS NOT NULL))`;

const READY_TO_DISPATCH = `(${SO_PACKED_SQL("o")}
                            AND lower(${orderStatusSql("o")}) <> 'fully dispatch'
                            AND ${orderOpenSql("o")})`;

/**
 * The ECs of an SO that one department works on, in EC order, with their
 * type and readiness lots (ids by position) — what an SO-level edit in
 * Planning or Assembly & Packing writes to.
 */
export async function listSoEcsForSection(
  orderId: string,
  table: OrderTable
): Promise<{ id: string; ec_no: string | null; spare: boolean; lot_ids: string[] }[]> {
  if (!UUID_RE.test(orderId)) return [];
  const r = await query<{ id: string; ec_no: string | null; spare: boolean; lot_ids: string[] }>(
    `SELECT it.id, it.ec_no, (${spareEcSql("it", "o")}) AS spare,
            ARRAY(SELECT rl.id::text FROM order_ready_lots rl
                   WHERE rl.item_id = it.id ORDER BY rl.seq) AS lot_ids
       FROM order_items it JOIN orders o ON o.id = it.order_id
      WHERE it.order_id = $1
        ${table === "order_assembly_dispatch" ? `AND ${SPARE_READY_FOR_ASSEMBLY("it")}` : ""}
      ORDER BY it.seq`,
    [orderId]
  );
  return r.rows;
}

/**
 * Where an EC stands for Assembly & Packing. A Spare with readiness lots is
 * its latest lot: "Partial ready" / "Fully ready" until packed, then
 * "Partially packed" / "Fully packed". Otherwise "Fully packed" once the
 * packing date is in, else "Pending". One expression, so the status column,
 * the filter and the dashboards agree.
 */
export const ASSEMBLY_STATE_SQL = (it: string) => `(CASE
    WHEN EXISTS (SELECT 1 FROM order_ready_lots asl WHERE asl.item_id = ${it}.id AND asl.status IS DISTINCT FROM 'In plan')
      THEN (SELECT COALESCE(asl.packing_status, 'In Progress') FROM order_ready_lots asl
             WHERE asl.item_id = ${it}.id AND asl.status IS DISTINCT FROM 'In plan' ORDER BY asl.seq DESC LIMIT 1)
    WHEN EXISTS (SELECT 1 FROM order_assembly_dispatch asd
                  WHERE asd.item_id = ${it}.id AND asd.actual_packing_date IS NOT NULL)
      THEN 'Fully packed'
    ELSE 'Pending' END)`;

/**
 * An EC Assembly & Packing works on: any Pump, and a Spare only once Planning
 * has a readiness lot for it (Partial or Fully ready).
 */
const SPARE_READY_FOR_ASSEMBLY = (it: string) =>
  `(NOT (${spareEcSql(it, "o")})
     OR EXISTS (SELECT 1 FROM order_ready_lots rl WHERE rl.item_id = ${it}.id AND rl.status IS DISTINCT FROM 'In plan'))`;

const PACKED = `EXISTS (SELECT 1 FROM order_assembly_dispatch ad
                        WHERE ad.item_id = it.id
                          AND ad.actual_packing_date IS NOT NULL)`;
// Planning files its status on whichever of the three columns applies.
const PLANNING_STATUS = `COALESCE(NULLIF(pl.actual_pump_status, ''),
                                  NULLIF(pl.actual_spare_status, ''),
                                  NULLIF(pl.planning_status, ''))`;
const planningIs = (value: string) =>
  `EXISTS (SELECT 1 FROM order_planning pl
            WHERE pl.item_id = it.id AND ${PLANNING_STATUS} = ${lit(value)})`;
const PLANNING_ANY = `EXISTS (SELECT 1 FROM order_planning pl
                              WHERE pl.item_id = it.id
                                AND ${PLANNING_STATUS} IS NOT NULL)`;

const NO_BOI = `COALESCE(o.boi, '') <> 'Yes'`;
const NO_QC = `COALESCE(o.qc_required, '') = 'No'`;
// A Spare EC is supplied as it is: Drawing has nothing to draw.
const NO_DRG = spareEcSql("it", "o");
// Paid only on receipt: no PI is due and Accounts has nothing to confirm, so
// both departments read N/A on these orders. Read from the order's payment
// terms — every line counted from receipt, and at least one line — which is
// the SQL twin of isAfterReceiptOnly. A line with no term chosen yet counts
// against, since the terms are not fully stated.
/**
 * The SO's payment terms in one line, from its term lines — the prose column
 * is no longer typed into — falling back to the terms as written on an older
 * SO. Same wording as paymentTermsText.
 */
const PAYMENT_TERMS_SQL = (a: string) => `COALESCE(
  (SELECT string_agg(
            concat_ws(' ',
              CASE WHEN ptx.percent IS NOT NULL
                   THEN rtrim(rtrim(ptx.percent::text, '0'), '.') || '%' END,
              NULLIF(TRIM(ptx.term), ''))
            || CASE WHEN NULLIF(TRIM(ptx.documents), '') IS NOT NULL THEN ' (' || TRIM(ptx.documents) || ')' ELSE '' END
            || CASE WHEN ptx.days IS NOT NULL THEN ', ' || ptx.days || ' days' ELSE '' END,
            ' + ' ORDER BY ptx.seq)
     FROM order_payment_terms ptx
    WHERE ptx.order_id = ${a}.id
      AND (NULLIF(TRIM(ptx.term), '') IS NOT NULL OR ptx.percent IS NOT NULL)),
  NULLIF(TRIM(${a}.payment_terms), ''))`;

const AFTER_RECEIPT_ONLY = `(EXISTS (SELECT 1 FROM order_payment_terms pt
                                      WHERE pt.order_id = o.id)
                            AND NOT EXISTS (SELECT 1 FROM order_payment_terms pt
                                             WHERE pt.order_id = o.id
                                               AND btrim(coalesce(pt.term, ''))
                                                     NOT IN ('After Receipt')))`;
// Paid after receipt used to make Billing and Accounts N/A; they now record a
// PI and a payment on every order, so it matches nothing.
const PAID_AFTER_RECEIPT = "FALSE";
const IS_CHALLAN = `COALESCE(o.bill_type, '') = 'Challan'`;
const BILL_RAISED = BILLING_RAISED;
const PAYMENT_SET = `EXISTS (SELECT 1 FROM order_accounts a
                             WHERE a.order_id = o.id
                               AND COALESCE(a.payment_status, '') <> '')`;

/**
 * Whether a department has any work on this order — the same rule its queue
 * uses. Lets a notice skip a department with nothing to do: a Drawing target
 * on an order of Spares only, say.
 */
export async function deptInvolvedInOrder(dept: DeptKey, orderId: string): Promise<boolean> {
  if (!UUID_RE.test(orderId)) return false;
  const r = await query<{ involved: boolean }>(
    `SELECT (${deptInvolvementSql(dept, "o")}) AS involved FROM orders o WHERE o.id = $1`,
    [orderId]
  );
  return r.rows[0]?.involved === true;
}

/** The state of one EC (`it`) for a per-EC department. */
function ecState(dept: DeptFilterKey, status: string): string {
  switch (dept) {
    case "drawing": {
      if (status === NOT_APPLICABLE) return NO_DRG;
      // Approval outranks issue, matching the popup's precedence.
      const applies = `NOT (${NO_DRG})`;
      if (status === "Approved") return `${applies} AND ${DRG_APPROVED}`;
      if (status === "Issued to Client") {
        return `${applies} AND ${DRG_ISSUED} AND NOT ${DRG_APPROVED}`;
      }
      if (status === "Issued to Operations") {
        return `${applies} AND ${DRG_TO_OPS} AND NOT ${DRG_ISSUED} AND NOT ${DRG_APPROVED}`;
      }
      return `${applies} AND NOT ${DRG_APPROVED} AND NOT ${DRG_ISSUED} AND NOT ${DRG_TO_OPS}`;
    }
    case "purchase":
      if (status === NOT_APPLICABLE) return NO_BOI;
      if (status === "Received") return `NOT (${NO_BOI}) AND (${BOI_RECEIVED})`;
      return `NOT (${NO_BOI}) AND NOT (${BOI_RECEIVED})`;
    case "quality":
      if (status === NOT_APPLICABLE) return NO_QC;
      if (status === "Submitted") return `NOT (${NO_QC}) AND ${QC_SUBMITTED}`;
      return `NOT (${NO_QC}) AND NOT ${QC_SUBMITTED}`;
    case "planning":
      return status === PENDING ? `NOT ${PLANNING_ANY}` : planningIs(status);
    default:
      // Assembly & Packing: the same reading as its status column.
      return `${ASSEMBLY_STATE_SQL("it")} = ${lit(status === "Packed" ? "Fully packed" : status)}`;
  }
}

/** An EC's Assembly & Packing state, for Planning's packing sub-filter. */
function packingState(status: string): string {
  return status === "Not packed"
    ? `${ASSEMBLY_STATE_SQL("it")} NOT IN ('Partially packed', 'Fully packed')`
    : `${ASSEMBLY_STATE_SQL("it")} = ${lit(status)}`;
}

/** Planning's status and packing, both on the same EC (`it`). */
function planningPackingOnEc(f: OrderListFilter): string {
  const plan = f.deptStatuses.length
    ? `(${f.deptStatuses.map((s) => `(${ecState("planning", s)})`).join(" OR ")})`
    : "TRUE";
  return `${plan} AND (${f.packingStatuses.map((s) => `(${packingState(s)})`).join(" OR ")})`;
}

/** The state of the SO itself for an SO-scope department. */
function soState(dept: DeptFilterKey, status: string): string {
  if (dept === "billing") {
    // The same reading as the status column (BILLING_STATE).
    return `${BILLING_STATE} = ${lit(status === NOT_APPLICABLE ? "N/A" : status)}`;
  }
  if (dept === "accounts") {
    if (status === NOT_APPLICABLE) return `(${IS_CHALLAN} OR ${PAID_AFTER_RECEIPT})`;
    if (status === PENDING) {
      return `NOT (${IS_CHALLAN}) AND NOT ${PAID_AFTER_RECEIPT} AND NOT ${PAYMENT_SET}`;
    }
    return `NOT (${IS_CHALLAN}) AND NOT ${PAID_AFTER_RECEIPT}
            AND EXISTS (SELECT 1 FROM order_accounts a
                         WHERE a.order_id = o.id
                           AND a.payment_status = ${lit(status)})`;
  }
  // Dispatch: "Pending" is itself a stored value, so it also covers a blank.
  return status === PENDING
    ? `${orderStatusSql("o")} = ${lit(PENDING)}`
    : `${orderStatusSql("o")} = ${lit(status)}`;
}

/** The target column a department is judged against, if it has one. */
const DEPT_TARGET_COLUMN: Partial<Record<DeptFilterKey, string>> = {
  drawing: "o.drg_target_date",
  purchase: "o.purchase_target_date",
  quality: "o.qc_doc_target_date",
  assembly: "o.dispatch_team_target_date",
  // Planning schedules to the dispatch date; a revision supersedes it.
  planning: "COALESCE(o.dispatch_target_revised_date, o.dispatch_target_date)",
  dispatch: "COALESCE(o.dispatch_target_revised_date, o.dispatch_target_date)",
};

/**
 * Finished, in the sense the department itself would recognise — the SQL twin
 * of DEPT_VIEWS[dept].done, per EC (`it`) for the per-EC departments. An EC
 * the department has nothing to do with counts as finished: it is not work
 * anyone is waiting on.
 */
function ecDonePredicate(dept: DeptFilterKey): string {
  switch (dept) {
    case "drawing":
      // Done once Drawing has closed the EC (lib/drawing-filter).
      return `((${NO_DRG}) OR ${ecDrawingDoneSql("it", "o")})`;
    case "purchase":
      return `((${NO_BOI}) OR (${BOI_RECEIVED}))`;
    case "quality":
      return `((${NO_QC}) OR ${QC_SUBMITTED})`;
    case "planning":
      return PLANNING_ANY;
    default:
      return PACKED;
  }
}

/**
 * Past its target with work still outstanding. "Outstanding" is the
 * department's own idea of unfinished — not merely "nothing recorded yet", or
 * a drawing issued but not approved would read as on time while the
 * escalation list chased it.
 */
function deptOverduePredicate(dept: DeptFilterKey): string {
  // Planning is late against its own readiness date: an EC whose date has
  // passed and that is not ready yet.
  if (dept === "planning") {
    return `EXISTS (SELECT 1 FROM order_items it JOIN order_planning opl ON opl.item_id = it.id
                    WHERE it.order_id = o.id
                      AND opl.planning_readiness_date < ${TODAY_IST}
                      AND NOT (${PLANNING_READY_SQL("opl")}))`;
  }
  // Assembly & Packing is late against Planning's readiness date: an EC (or
  // a readiness lot of it) past that date and not packed yet.
  if (dept === "assembly") {
    return `EXISTS (SELECT 1 FROM order_items it
                    WHERE it.order_id = o.id
                      AND ${assemblyDueSql("it")} < ${TODAY_IST})`;
  }
  const column = DEPT_TARGET_COLUMN[dept];
  if (!column) return "FALSE";
  const outstanding = isPerEcDept(dept)
    ? `EXISTS (SELECT 1 FROM order_items it
                WHERE it.order_id = o.id AND NOT (${ecDonePredicate(dept)}))`
    : `lower(${orderStatusSql("o")}) <> 'fully dispatch'`;
  return `(${column} < ${TODAY_IST} AND ${outstanding})`;
}

function deptStatusPredicate(dept: DeptFilterKey, status: string): string {
  if (!isPerEcDept(dept)) return `(${soState(dept, status)})`;
  return `EXISTS (SELECT 1 FROM order_items it
                   WHERE it.order_id = o.id AND (${ecState(dept, status)}))`;
}

/**
 * Whether a department has signed this SO off. Per-EC departments sign off
 * each EC, and an SO qualifies when any of its ECs does — the same "any EC"
 * reading the status filter uses, so an SO that is part-way through shows up
 * under both answers.
 */
function signOffPredicate(dept: DeptFilterKey, signOff: SignOff): string {
  const d = lit(dept);
  if (!isPerEcDept(dept)) {
    const signed = `EXISTS (SELECT 1 FROM order_dept_completions c
                             WHERE c.order_id = o.id AND c.item_id IS NULL
                               AND c.dept = ${d})`;
    return signOff === "completed" ? signed : `NOT ${signed}`;
  }
  return signOff === "completed"
    ? `EXISTS (SELECT 1 FROM order_items it
                JOIN order_dept_completions c ON c.item_id = it.id AND c.dept = ${d}
               WHERE it.order_id = o.id)`
    : `EXISTS (SELECT 1 FROM order_items it
               WHERE it.order_id = o.id
                 AND NOT EXISTS (SELECT 1 FROM order_dept_completions c
                                  WHERE c.item_id = it.id AND c.dept = ${d}))`;
}

/**
 * The WHERE clause for an orders-list filter, with its parameters numbered
 * from $1. Values go in as parameters; the only inlined text is department
 * keys and statuses, which come from fixed lists and pass through lit().
 */
/**
 * The filter as clauses over an `orders o` alias, with parameters numbered
 * from `startAt` — so a queue that already has parameters of its own can AND
 * this in rather than growing a second dialect of the same filter.
 */
function orderListClauses(
  f: OrderListFilter,
  startAt = 0
): { clauses: string[]; params: unknown[] } {
  const params: unknown[] = [];
  const p = (value: unknown) => {
    params.push(value);
    return `$${startAt + params.length}`;
  };
  const clauses: string[] = [];
  // Facets match the trimmed value, the same way their options are listed.
  const facet = (column: string, values: string[]) =>
    `TRIM(COALESCE(${column}, '')) = ANY(${p(values)}::text[])`;

  if (f.search) clauses.push(orderSearchSql(p(likePattern(f.search))));
  if (f.zones.length) clauses.push(facet("o.zone", f.zones));
  if (f.reps.length) clauses.push(facet("o.reps", f.reps));
  if (f.markets.length) clauses.push(facet("o.market_type", f.markets));
  // How the SO is paid: any of the chosen terms among its lines, or "Not set"
  // — no term lines and no terms written out either.
  if (f.paymentTerms.length) {
    const terms = f.paymentTerms.filter((t) => t !== NOT_SET);
    const any: string[] = [];
    if (terms.length) {
      any.push(`EXISTS (SELECT 1 FROM order_payment_terms ptf
                         WHERE ptf.order_id = o.id
                           AND TRIM(COALESCE(ptf.term, '')) = ANY(${p(terms)}::text[]))`);
    }
    if (f.paymentTerms.includes(NOT_SET)) {
      any.push(`(NOT EXISTS (SELECT 1 FROM order_payment_terms ptf
                              WHERE ptf.order_id = o.id AND NULLIF(TRIM(ptf.term), '') IS NOT NULL)
                AND NULLIF(TRIM(o.payment_terms), '') IS NULL)`);
    }
    clauses.push(`(${any.join(" OR ")})`);
  }
  // Clearance: Clear (blank counts as Clear) or Hold; and the reasons for a Hold.
  if (f.clearance.length) {
    clauses.push(`COALESCE(NULLIF(TRIM(o.clearance_status), ''), 'Clear') = ANY(${p(f.clearance)}::text[])`);
  }
  if (f.holdReasons.length) {
    clauses.push(`(COALESCE(o.clearance_status, '') = 'Hold' AND ${facet("o.clearance_hold_reason", f.holdReasons)})`);
  }
  if (f.paymentStatuses.length) {
    const statuses = f.paymentStatuses.filter((m) => m !== NOT_SET);
    const any: string[] = [];
    if (statuses.length) any.push(`EXISTS (SELECT 1 FROM order_accounts pa WHERE pa.order_id = o.id AND ${facet("pa.payment_status", statuses)})`);
    if (f.paymentStatuses.includes(NOT_SET)) {
      any.push(`NOT EXISTS (SELECT 1 FROM order_accounts pa WHERE pa.order_id = o.id AND NULLIF(TRIM(pa.payment_status), '') IS NOT NULL)`);
    }
    clauses.push(`(${any.join(" OR ")})`);
  }
  // The SO's dispatch status, as Dispatch sets it.
  if (f.dispatchStatuses.length) clauses.push(`${orderStatusSql("o")} = ANY(${p(f.dispatchStatuses)}::text[])`);
  // Dispatch: the SO's stage in Invoice → Dispatch → Docket & LR.
  if (f.dispatchStages.length) clauses.push(`${dispatchStageSql("o")} = ANY(${p(f.dispatchStages)}::text[])`);
  if (f.billModes.length) {
    const modes = f.billModes.filter((m) => m !== NOT_SET);
    const any: string[] = [];
    if (modes.length) any.push(facet("o.bill_mode", modes));
    if (f.billModes.includes(NOT_SET)) any.push(`NULLIF(TRIM(o.bill_mode), '') IS NULL`);
    clauses.push(`(${any.join(" OR ")})`);
  }
  if (f.types.length) {
    // The type is the SO's, or any of its ECs' — the pipeline reads each EC
    // by its own item type, falling back to the order's.
    const t = p(f.types);
    clauses.push(`(TRIM(COALESCE(o.order_type, '')) = ANY(${t}::text[])
                   OR EXISTS (SELECT 1 FROM order_items s
                               WHERE s.order_id = o.id
                                 AND TRIM(COALESCE(s.item_type, '')) = ANY(${t}::text[])))`);
  }
  if (f.dept === "planning" && f.packingStatuses.length) {
    // An EC that is both — "Fully ready" and "Fully packed" on the same EC.
    clauses.push(`EXISTS (SELECT 1 FROM order_items it WHERE it.order_id = o.id AND ${planningPackingOnEc(f)})`);
  } else if (f.dept && f.deptStatuses.length) {
    const dept = f.dept;
    clauses.push(`(${f.deptStatuses.map((s) => deptStatusPredicate(dept, s)).join(" OR ")})`);
  }
  // The Orders list: several departments at once — any ticked status within
  // a department, every department ticked.
  for (const [k, statuses] of Object.entries(f.deptStatusMulti ?? {})) {
    if (!statuses?.length) continue;
    const dept = k as DeptFilterKey;
    clauses.push(`(${statuses.map((s) => deptStatusPredicate(dept, s)).join(" OR ")})`);
  }
  if (f.dept && f.signOff) clauses.push(signOffPredicate(f.dept, f.signOff));
  if (f.dept && f.overdue) clauses.push(deptOverduePredicate(f.dept));
  // Packed by Assembly & Packing and not yet gone: Dispatch's own shortlist.
  if (f.ready) clauses.push(READY_TO_DISPATCH);
  // A Spare lot packed but on no packing slip: nothing for Dispatch to send.
  if (f.noSlip) clauses.push(`EXISTS (${PACKED_LOT_WITHOUT_SLIP_SQL("o")})`);
  // One SO field, filled or pending. Pending is blank where the field applies.
  if (f.field) {
    const def = FIELD_FILTER_FIELDS.find((x) => x.column === f.field!.column);
    if (def) {
      clauses.push(
        f.field.state === "filled"
          ? `(${filledSql(def)})`
          : `((${appliesSql(def)}) AND NOT (${filledSql(def)}))`
      );
    }
  }

  if (f.from || f.to) {
    const range = (column: string) =>
      [
        f.from ? `${column} >= ${p(f.from)}::date` : null,
        f.to ? `${column} <= ${p(f.to)}::date` : null,
      ]
        .filter(Boolean)
        .join(" AND ");
    if (f.dateField === "dept_target") {
      // The chosen department own target column. Billing and Accounts have
      // none, so a date range on their queue matches nothing rather than
      // quietly falling through to somebody else date.
      const column = f.dept ? DEPT_TARGET_COLUMN[f.dept] : undefined;
      clauses.push(column ? range(column) : "FALSE");
    } else if (f.dateField === "so_date") clauses.push(range("o.so_date"));
    else if (f.dateField === "dispatch_target") clauses.push(range("o.dispatch_target_date"));
    else if (f.dateField === "readiness") {
      clauses.push(`EXISTS (SELECT 1 FROM order_items s JOIN order_planning rpl ON rpl.item_id = s.id
                             WHERE s.order_id = o.id AND ${range("rpl.planning_readiness_date")})`);
    } else if (f.dateField === "packing") {
      // Assembly & Packing's planned packing date on any of the SO's Spare lots.
      clauses.push(`EXISTS (SELECT 1 FROM order_items s JOIN order_ready_lots prl ON prl.item_id = s.id
                             WHERE s.order_id = o.id AND ${range("prl.packing_plan_date")})`);
    } else if (f.dateField === "ec_date") {
      clauses.push(`EXISTS (SELECT 1 FROM order_items s
                             WHERE s.order_id = o.id AND ${range("s.ec_date")})`);
    } else {
      // Completed on: the chosen department's sign-off, or — with none chosen
      // — any department's, which answers "what got finished this week?".
      const dept = f.dept ? ` AND c.dept = ${lit(f.dept)}` : "";
      clauses.push(`EXISTS (SELECT 1 FROM order_dept_completions c
                             WHERE c.order_id = o.id${dept}
                               AND ${range("c.completed_on")})`);
    }
  }

  return { clauses, params };
}

/**
 * A Rep Manager picked in the Rep filter stands for their team too: the
 * reps who report to them in the sales portal (manager_reps), as Rep Manager
 * accounts see them. Fails narrow: the sales portal unread, the names stay as
 * picked.
 */
async function withRepTeams<F extends { reps: string[] }>(f: F): Promise<F> {
  if (!f.reps.length) return f;
  const managers = await query<{ email: string }>(
    `SELECT lower(trim(email)) AS email FROM users
      WHERE role = 'rep_manager' AND lower(trim(full_name)) = ANY($1::text[])`,
    [f.reps.map((r) => r.trim().toLowerCase())]
  );
  if (managers.rows.length === 0) return f;
  let teams: Map<string, string[]>;
  try {
    teams = await listTeams();
  } catch (error) {
    console.error("withRepTeams: could not read teams:", error);
    return f;
  }
  const names = new Map(f.reps.map((r) => [r.trim().toLowerCase(), r]));
  for (const m of managers.rows) {
    for (const n of teams.get(m.email) ?? []) names.set(n.trim().toLowerCase(), n.trim());
  }
  return { ...f, reps: [...names.values()] };
}

/** The filter as a WHERE clause of its own, for the queries it owns. */
function orderListWhere(f: OrderListFilter): { where: string; params: unknown[] } {
  const { clauses, params } = orderListClauses(f);
  return {
    where: clauses.length ? `WHERE ${clauses.join("\n        AND ")}` : "",
    params,
  };
}

/**
 * Every SO id matching the list filter — the whole result set, not one page.
 * The export needs this because the table only holds the current page's rows.
 */
export async function listOrderIdsMatching(filter: OrderListFilter): Promise<string[]> {
  const { where, params } = orderListWhere(await withRepTeams(filter));
  const result = await query<{ id: string }>(
    `SELECT o.id FROM orders o ${where} ORDER BY o.sl_no ASC`,
    params
  );
  return result.rows.map((r) => r.id);
}

/** The values each facet can take, from the whole table rather than a page. */
export type OrderListOptions = {
  zones: string[];
  reps: string[];
  markets: string[];
  types: string[];
  /** A Rep's names (their own, a Rep Manager's team): the only reps offered. One name is shown fixed. */
  repScope?: string[];
};

/** Each facet's distinct trimmed values, in one trip. */
export async function listOrderListOptions(scope?: { repScope?: string[] }): Promise<OrderListOptions> {
  const options = await allOrderListOptions();
  return scope?.repScope ? { ...options, reps: scope.repScope, repScope: scope.repScope } : options;
}

async function allOrderListOptions(): Promise<OrderListOptions> {
  const r = await query<{ facet: string; value: string }>(
    `SELECT DISTINCT 'zone' AS facet, TRIM(zone) AS value FROM orders WHERE TRIM(COALESCE(zone, '')) <> ''
     UNION SELECT DISTINCT 'rep', TRIM(reps) FROM orders WHERE TRIM(COALESCE(reps, '')) <> ''
     -- A Rep Manager, even with no SOs of their own: picking them shows their team's.
     UNION SELECT DISTINCT 'rep', TRIM(full_name) FROM users WHERE role = 'rep_manager' AND TRIM(COALESCE(full_name, '')) <> ''
     UNION SELECT DISTINCT 'market', TRIM(market_type) FROM orders WHERE TRIM(COALESCE(market_type, '')) <> ''
     UNION SELECT DISTINCT 'type', TRIM(order_type) FROM orders WHERE TRIM(COALESCE(order_type, '')) <> ''
     UNION SELECT DISTINCT 'type', TRIM(item_type) FROM order_items WHERE TRIM(COALESCE(item_type, '')) <> ''
     ORDER BY 1, 2`
  );
  const of = (facet: string) => r.rows.filter((x) => x.facet === facet).map((x) => x.value);
  return { zones: of("zone"), reps: of("rep"), markets: of("market"), types: of("type") };
}

/** The most SOs one PDF carries. */
const ALL_ROWS_CAP = 5000;

export async function listOrdersPage(opts: {
  page: number;
  filter: OrderListFilter;
  /** Sl. No. or SO date; newest Sl. No. first when not given. */
  sort?: QueueSort | null;
  /** Every matching SO on one page (the PDF), up to a safety cap. */
  all?: boolean;
}): Promise<PageResult<OrderListRow> & { options: OrderListOptions }> {
  const { where, params } = orderListWhere(await withRepTeams(opts.filter));
  const limit = `$${params.length + 1}`;
  const offset = `$${params.length + 2}`;

  const [totals, optionRows] = await Promise.all([
    query<{ count: string }>(`SELECT count(*) AS count FROM orders o ${where}`, params),
    listOrderListOptions(opts.filter),
  ]);

  const total = Number(totals.rows[0]?.count ?? 0);
  const page = clampPage(opts.page, total);

  const rows = await (async () =>
    query<OrderListRow>(
      `SELECT o.id,
            o.sl_no::int AS sl_no,
            o.so_no,
            to_char(o.so_date, 'YYYY-MM-DD') AS so_date,
            o.client_name,
            o.client_code,
            o.reps,
            o.zone,
            o.clearance_status,
            o.clearance_hold_reason,
            o.om_status, o.om_hold_reason, o.om_hold_remarks,
            o.po_no,
            o.order_type,
            o.order_value::text AS order_value,
            o.order_currency,
            o.order_value_inr::text AS order_value_inr,
            o.boi,
            a.payment_status,
            ${DISPATCH_STATUS} AS dispatch_status,
            COALESCE(ic.cnt, 0)::int AS ec_count,
            COALESCE((
              SELECT jsonb_agg(to_jsonb(x) ORDER BY x.seq)
                FROM (
                  SELECT it.id,
                         it.seq::int AS seq,
                         it.ec_no,
                         to_char(it.ec_date, 'YYYY-MM-DD') AS ec_date,
                         it.item_type,
                         it.pump_type,
                         it.model_no,
                         it.internal_model,
                         it.version,
                         it.quantity::text AS quantity
                    FROM order_items it
                   WHERE it.order_id = o.id
                ) x
            ), '[]'::jsonb) AS items,
            o.clearance_remarks,
            o.bill_mode, o.bill_type,
            o.accounts_hold_status, o.accounts_hold_reason, o.accounts_hold_remarks,
            COALESCE((SELECT jsonb_agg(jsonb_build_object(
                        'id', t.id, 'term', t.term, 'percent', t.percent::text,
                        'days', t.days, 'documents', t.documents,
                        'term_payment_status', t.term_payment_status,
                        'term_confirmed_date', to_char(t.term_confirmed_date, 'YYYY-MM-DD'),
                        'term_amount_received', t.term_amount_received::text,
                        'term_hold_reason', t.term_hold_reason) ORDER BY t.seq)
                      FROM order_payment_terms t WHERE t.order_id = o.id), '[]'::jsonb) AS term_lines,
            COALESCE((SELECT jsonb_agg(to_jsonb(pd) ORDER BY pd.seq)
                      FROM order_billing_docs pd WHERE pd.order_id = o.id), '[]'::jsonb) AS pi_docs,
            (SELECT to_char(min(rp.planning_readiness_date), 'YYYY-MM-DD')
               FROM order_items ri JOIN order_planning rp ON rp.item_id = ri.id
              WHERE ri.order_id = o.id) AS readiness_from,
            (SELECT to_char(max(rp.planning_readiness_date), 'YYYY-MM-DD')
               FROM order_items ri JOIN order_planning rp ON rp.item_id = ri.id
              WHERE ri.order_id = o.id) AS readiness_to,
            (SELECT CASE WHEN count(DISTINCT st) = 1 AND count(st) = count(*) THEN max(st) END
               FROM (SELECT COALESCE(NULLIF(rp.actual_spare_status, ''), NULLIF(rp.actual_pump_status, ''),
                                     NULLIF(rp.planning_status, '')) AS st
                       FROM order_items ri LEFT JOIN order_planning rp ON rp.item_id = ri.id
                      WHERE ri.order_id = o.id) s) AS readiness_status,
            (SELECT to_char(max(rl.ready_date), 'YYYY-MM-DD')
               FROM order_ready_lots rl JOIN order_items ri ON ri.id = rl.item_id
              WHERE ri.order_id = o.id) AS ready_on,
            -- Assembly & Packing's next plan: the earliest packing date among
            -- the SO's lots not packed yet, with its shift and PDI.
            (SELECT jsonb_build_object('date', to_char(rl.packing_plan_date, 'YYYY-MM-DD'),
                                       'shift', rl.packing_shift, 'pdi', rl.pdi)
               FROM order_ready_lots rl JOIN order_items ri ON ri.id = rl.item_id
              WHERE ri.order_id = o.id AND rl.packed_date IS NULL AND rl.packing_plan_date IS NOT NULL
              ORDER BY rl.packing_plan_date LIMIT 1) AS packing_plan,
            (SELECT to_char(max(d), 'YYYY-MM-DD') FROM (
               SELECT rl.packed_date AS d FROM order_ready_lots rl JOIN order_items ri ON ri.id = rl.item_id
                WHERE ri.order_id = o.id
               UNION ALL
               SELECT ad.actual_packing_date FROM order_assembly_dispatch ad JOIN order_items ri ON ri.id = ad.item_id
                WHERE ri.order_id = o.id) x) AS packed_on,
            EXISTS (SELECT 1 FROM order_packing_slips ps
                     WHERE ps.order_id = o.id AND ps.kind = 'actual'
                       AND NULLIF(btrim(ps.packing_slip_no), '') IS NOT NULL) AS in_dispatch,
            -- Lot n across the SO's ECs (Lot 1 is Lot 1 of every EC): the first
            -- EC's values stand for all; "differ" says when they do not.
            COALESCE((SELECT jsonb_agg(jsonb_build_object(
                        'n', z.n, 'status', z.status, 'ready_date', z.ready_date,
                        'packing_plan_date', z.packing_plan_date, 'packing_shift', z.packing_shift,
                        'pdi', z.pdi, 'packed_date', z.packed_date, 'ecs', z.ecs,
                        'differ', z.differ, 'slips', z.slips) ORDER BY z.n)
               FROM (SELECT lt.n,
                            (array_agg(lt.status ORDER BY lt.ec_no))[1] AS status,
                            (array_agg(to_char(lt.ready_date, 'YYYY-MM-DD') ORDER BY lt.ec_no))[1] AS ready_date,
                            (array_agg(to_char(lt.packing_plan_date, 'YYYY-MM-DD') ORDER BY lt.ec_no))[1] AS packing_plan_date,
                            (array_agg(lt.packing_shift ORDER BY lt.ec_no))[1] AS packing_shift,
                            (array_agg(lt.pdi ORDER BY lt.ec_no))[1] AS pdi,
                            (array_agg(to_char(lt.packed_date, 'YYYY-MM-DD') ORDER BY lt.ec_no))[1] AS packed_date,
                            count(*)::int AS ecs,
                            count(DISTINCT (lt.status, lt.ready_date, lt.packed_date)) > 1 AS differ,
                            COALESCE((SELECT jsonb_agg(btrim(ps.packing_slip_no) ORDER BY ps.seq)
                                        FROM order_packing_slips ps
                                       WHERE ps.order_id = o.id AND ps.kind = 'actual'
                                         AND NULLIF(btrim(ps.packing_slip_no), '') IS NOT NULL
                                         AND lt.n = ANY(ps.lot_nos)), '[]'::jsonb) AS slips
                       FROM (SELECT rl.status, rl.ready_date, rl.packing_plan_date, rl.packing_shift, rl.pdi,
                                    rl.packed_date, ri.ec_no,
                                    row_number() OVER (PARTITION BY rl.item_id ORDER BY rl.seq)::int AS n
                               FROM order_ready_lots rl JOIN order_items ri ON ri.id = rl.item_id
                              WHERE ri.order_id = o.id) lt
                      GROUP BY lt.n) z), '[]'::jsonb) AS lots
       FROM orders o
       LEFT JOIN order_accounts a ON a.order_id = o.id
       LEFT JOIN (
         SELECT order_id, COUNT(*) AS cnt FROM order_items GROUP BY order_id
       ) ic ON ic.order_id = o.id
      ${where}
      ORDER BY ${queueOrderBy(opts.sort) ?? "o.sl_no DESC"}
      LIMIT ${limit} OFFSET ${offset}`,
      opts.all ? [...params, ALL_ROWS_CAP, 0] : [...params, PAGE_SIZE, offsetFor(page)]
    ))();

  return {
    ...pageResult(rows.rows, total, opts.all ? 1 : page),
    options: optionRows,
  };
}
export async function listOrders(): Promise<OrderListRow[]> {
  const result = await query<OrderListRow>(
    `SELECT o.id,
            o.sl_no::int AS sl_no,
            o.so_no,
            to_char(o.so_date, 'YYYY-MM-DD') AS so_date,
            o.client_name,
            o.client_code,
            o.reps,
            o.zone,
            o.clearance_status,
            o.clearance_hold_reason,
            o.om_status, o.om_hold_reason, o.om_hold_remarks,
            o.po_no,
            o.order_type,
            o.order_value::text AS order_value,
            o.order_currency,
            o.order_value_inr::text AS order_value_inr,
            o.boi,
            a.payment_status,
            ${DISPATCH_STATUS} AS dispatch_status,
            COALESCE(ic.cnt, 0)::int AS ec_count,
            COALESCE((
              SELECT jsonb_agg(to_jsonb(x) ORDER BY x.seq)
                FROM (
                  SELECT it.id,
                         it.seq::int AS seq,
                         it.ec_no,
                         to_char(it.ec_date, 'YYYY-MM-DD') AS ec_date,
                         it.item_type,
                         it.pump_type,
                         it.model_no,
                         it.internal_model,
                         it.version,
                         it.quantity::text AS quantity
                    FROM order_items it
                   WHERE it.order_id = o.id
                ) x
            ), '[]'::jsonb) AS items
       FROM orders o
       LEFT JOIN order_accounts a ON a.order_id = o.id
       LEFT JOIN (
         SELECT order_id, COUNT(*) AS cnt FROM order_items GROUP BY order_id
       ) ic ON ic.order_id = o.id
      ORDER BY o.sl_no ASC`
  );
  return result.rows;
}

// ---------------------------------------------------------------------------
// Paged department queues
//
// These page on *SOs*, never on ECs: the workspaces render one card per SO
// with its ECs inside, so paging on EC rows would split an SO across two
// pages. Each query therefore picks the SO ids for the page first, then
// pulls every EC belonging to them.
// ---------------------------------------------------------------------------

/** SO ids for one page of a queue, plus how many SOs matched in total. */
async function pageOfOrderIds(opts: {
  page: number;
  search: string;
  /** Extra SQL restricting which SOs belong in this queue. */
  restrict: string;
  /**
   * Extra SQL matching the search against the SO and its ECs, given the
   * placeholder the term ended up on — the filter's parameters are numbered
   * first, so it is not always $1.
   */
  searchable: (term: string) => string;
  /**
   * Deep link target (from a notification). When this SO is in the queue,
   * the page holding it wins over the requested page — otherwise following
   * a notification for an SO on page 3 would silently land on page 1.
   */
  focusOrderId?: string | null;
  /**
   * The department's own filter bar. Its clauses are numbered first so this
   * queue's own parameters can follow them, and its `search` is skipped —
   * the queue already has the same term, matched against its own columns.
   */
  filter?: OrderListFilter;
  /** The queue's order, as SQL over `o`; newest Sl. No. first when not given. */
  orderBy?: string;
  /** Every matching SO rather than one page — for a printed report. */
  all?: boolean;
}): Promise<{ ids: string[]; total: number; page: number }> {
  const search = opts.search ? likePattern(opts.search) : null;
  const facets = opts.filter
    ? orderListClauses({ ...(await withRepTeams(opts.filter)), search: "" })
    : { clauses: [], params: [] };
  const own = (n: number) => `$${facets.params.length + n}`;
  const where = `WHERE ${opts.restrict}
        ${facets.clauses.map((c) => `AND ${c}`).join("\n        ")}
        AND (${own(1)}::text IS NULL OR ${opts.searchable(own(1))})`;

  const totals = await query<{ count: string }>(
    `SELECT count(*) AS count FROM orders o ${where}`,
    [...facets.params, search]
  );
  const total = Number(totals.rows[0]?.count ?? 0);

  // Rank the target inside this queue's own ordering (sl_no ASC), then
  // convert that position to a page. Rank 0 means it isn't in the queue at
  // all (wrong department, or filtered out by the current search) — then we
  // just honour the requested page.
  let requested = opts.page;
  // (The rank is by Sl. No.; in a queue sorted otherwise the page asked for stands.)
  if (!opts.orderBy && opts.focusOrderId && UUID_RE.test(opts.focusOrderId)) {
    const rank = await query<{ n: string }>(
      `SELECT count(*) AS n FROM orders o ${where}
         AND o.sl_no >= (SELECT sl_no FROM orders WHERE id = ${own(2)})`,
      [...facets.params, search, opts.focusOrderId]
    );
    const n = Number(rank.rows[0]?.n ?? 0);
    if (n > 0) requested = Math.ceil(n / PAGE_SIZE);
  }
  const page = clampPage(requested, total);

  const ids = await query<{ id: string }>(
    `SELECT o.id FROM orders o ${where}
      ORDER BY ${opts.orderBy ?? "o.sl_no DESC"}
      LIMIT ${own(2)} OFFSET ${own(3)}`,
    [...facets.params, search, opts.all ? REPORT_LIMIT : PAGE_SIZE, opts.all ? 0 : offsetFor(page)]
  );

  return { ids: ids.rows.map((r) => r.id), total, page };
}

// Matches the SO's own identity columns or any of its ECs.
const soAndEcSearch = (term: string) => `(o.so_no ILIKE ${term} OR o.client_name ILIKE ${term}
             OR o.sl_no::text ILIKE ${term}
             OR EXISTS (SELECT 1 FROM order_items s
                         WHERE s.order_id = o.id AND s.ec_no ILIKE ${term}))`;

export type OrderMakingRow = Record<string, unknown> & {
  id: string;
  sl_no: number;
  /** Client / Purchase Order fields that apply and are still blank. */
  missing: string[];
  /** Sales Order details that apply and are still blank. */
  so_missing: string[];
  so_assignee_id: string | null;
  so_assignee_name: string | null;
  so_assigned_at: string | null;
  so_details_filled_at: string | null;
  /** How many ECs the SO has, and its BOI flag — for Order Making's Add-On. */
  ec_count: number;
  boi: string | null;
  /** The SO's ECs with their Add-On fields, for Order Making to edit or delete. */
  items: Record<string, unknown>[];
};

/**
 * Order Making's page: one page of SOs, newest first — only their Client and
 * Purchase Order details, and which of those are still blank (where they
 * apply: no PO on an FR order). `missingOnly` keeps the ones still lacking.
 */
export async function listOrdersForOrderMaking(opts: {
  page: number;
  search: string;
  filter: OrderMakingFilter;
  /** An Order Making SO member: only the SOs assigned to them, pending first. */
  assigneeScope?: string | null;
}): Promise<PageResult<OrderMakingRow>> {
  const f = opts.filter;
  // The PO's fields; the Sales Order details are counted on their own.
  const own = ORDER_MAKING_FIELDS.filter(
    // PO Receiving Date came later: shown and filled, but it does not make
    // every SO before it read as missing a PO detail.
    (x) =>
      !x.computed &&
      !SO_DETAIL_COLUMNS.includes(x.column) &&
      x.group !== "Handover" &&
      x.group !== "Order Making Hold" &&
      x.column !== "po_received_date"
  );
  const missingSql = `array_remove(ARRAY[
      ${own.map((x) => `CASE WHEN (${appliesSql(x)}) AND NOT (${filledSql(x)}) THEN ${lit(x.label)} END`).join(",\n      ")}
    ]::text[], NULL)`;
  // Order Making's own facets. Values are checked against fixed lists or as
  // ISO dates before they get here, and still go in quoted.
  const clauses = [orderOpenSql("o")];
  // A member sees only their own; an id that is not one sees nothing.
  if (opts.assigneeScope !== undefined) {
    clauses.push(
      opts.assigneeScope && UUID_RE.test(opts.assigneeScope)
        ? `o.so_assignee_id = ${lit(opts.assigneeScope)}::uuid`
        : "FALSE"
    );
  }
  if (f.assignees.length) {
    const ids = f.assignees.filter((a) => a !== UNASSIGNED);
    const any: string[] = [];
    if (ids.length) any.push(`o.so_assignee_id IN (${ids.map((id) => `${lit(id)}::uuid`).join(", ")})`);
    if (f.assignees.includes(UNASSIGNED)) any.push("o.so_assignee_id IS NULL");
    clauses.push(`(${any.join(" OR ")})`);
  }
  if (f.soState === "filled") clauses.push(SO_DETAILS_FILLED_SQL);
  if (f.soState === "pending") clauses.push(`NOT ${SO_DETAILS_FILLED_SQL}`);
  if (f.missingOnly) clauses.push(`(cardinality(${missingSql}) > 0 OR NOT ${SO_DETAILS_FILLED_SQL})`);
  if (f.billTypes.length) {
    const types = f.billTypes.filter((t) => t !== NOT_SET);
    const any: string[] = [];
    if (types.length) any.push(`TRIM(COALESCE(o.bill_type, '')) IN (${types.map(lit).join(", ")})`);
    if (f.billTypes.includes(NOT_SET)) any.push(`NULLIF(TRIM(o.bill_type), '') IS NULL`);
    clauses.push(`(${any.join(" OR ")})`);
  }
  if (f.dateField === "po_date") {
    if (f.from) clauses.push(`o.customer_po_date >= ${lit(f.from)}::date`);
    if (f.to) clauses.push(`o.customer_po_date <= ${lit(f.to)}::date`);
  }
  const dir = f.sort?.startsWith("-") ? "DESC" : "ASC";
  const orderBy =
    f.sort === "so_date" || f.sort === "-so_date"
      ? `o.so_date ${dir} NULLS LAST, o.sl_no DESC`
      : f.sort === "sl"
        ? "o.sl_no ASC"
        : "o.sl_no DESC";
  // A member works down what is still pending.
  const ordered = opts.assigneeScope && !f.sort ? `(${SO_DETAILS_FILLED_SQL}) ASC, o.sl_no DESC` : orderBy;
  const { ids, total, page } = await pageOfOrderIds({
    page: opts.page,
    search: opts.search,
    restrict: clauses.join(" AND "),
    searchable: (term) =>
      `(o.so_no ILIKE ${term} OR o.client_name ILIKE ${term} OR o.client_code ILIKE ${term}
        OR o.po_no ILIKE ${term} OR o.sl_no::text ILIKE ${term})`,
    filter: sharedFacets(f),
    orderBy: ordered,
  });
  if (ids.length === 0) return pageResult([], total, page);
  const cols = ORDER_MAKING_FIELDS.map((f) =>
    f.type === "date" ? `to_char(o.${f.column}, 'YYYY-MM-DD') AS ${f.column}` : `o.${f.column}`
  ).join(", ");
  const r = await query<OrderMakingRow>(
    `SELECT o.id, o.sl_no::int AS sl_no, ${cols}, ${missingSql} AS missing,
            ${SO_DETAILS_MISSING_SQL} AS so_missing,
            o.so_assignee_id, au.full_name AS so_assignee_name,
            to_char(o.so_assigned_at AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD') AS so_assigned_at,
            to_char(o.so_details_filled_at AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD') AS so_details_filled_at,
            o.clearance_status, o.clearance_hold_reason,
            (SELECT count(*)::int FROM order_items i WHERE i.order_id = o.id) AS ec_count,
            o.boi,
            COALESCE((SELECT jsonb_agg(jsonb_build_object(
                        'id', i.id, 'ec_no', i.ec_no, 'ec_date', to_char(i.ec_date, 'YYYY-MM-DD'),
                        'pump_type', i.pump_type, 'model_no', i.model_no, 'internal_model', i.internal_model,
                        'quantity', i.quantity, 'suction', i.suction, 'delivery', i.delivery,
                        'pump_sno', i.pump_sno, 'application', i.application, 'version', i.version,
                        'capacity', i.capacity, 'capacity_unit', i.capacity_unit, 'head', i.head,
                        'head_unit', i.head_unit, 'drive_motor_rating', i.drive_motor_rating,
                        'drive_motor_rating_unit', i.drive_motor_rating_unit,
                        'drive_motor_speed', i.drive_motor_speed, 'pump_speed', i.pump_speed,
                        'liquid', i.liquid, 'tag_no', i.tag_no, 'boi', i.boi)
                        ORDER BY i.ec_no)
                        FROM order_items i WHERE i.order_id = o.id), '[]'::jsonb) AS items
       FROM orders o
       LEFT JOIN users au ON au.id = o.so_assignee_id
      WHERE o.id = ANY($1::uuid[])`,
    [ids]
  );
  const at = new Map(ids.map((id, i) => [id, i]));
  r.rows.sort((a, b) => (at.get(a.id) ?? 0) - (at.get(b.id) ?? 0));
  return pageResult(r.rows, total, page);
}

/** The most SOs a printed queue report carries. */
const REPORT_LIMIT = 2000;

/** Item-scope department queue, one page of SOs' worth of ECs. */
/**
 * How a queue (or the orders list) can be sorted ("-" = latest first). With
 * none chosen it runs newest Sl. No. first.
 */
export type QueueSort =
  | "sl" | "-sl" | "readiness" | "-readiness" | "packing" | "-packing" | "so_date" | "-so_date" | "ecs" | "-ecs";

const QUEUE_SORTS: QueueSort[] = [
  "sl", "-sl", "readiness", "-readiness", "packing", "-packing", "so_date", "-so_date", "ecs", "-ecs",
];

export function parseQueueSort(value: string | undefined): QueueSort | null {
  return QUEUE_SORTS.includes(value as QueueSort) ? (value as QueueSort) : null;
}

/** A queue sort as SQL over `o`; undated SOs last, newest Sl. No. breaking ties. */
function queueOrderBy(sort: QueueSort | null | undefined): string | undefined {
  if (!sort) return undefined;
  if (sort === "sl") return "o.sl_no ASC";
  if (sort === "-sl") return "o.sl_no DESC";
  const dir = sort.startsWith("-") ? "DESC" : "ASC";
  // How many ECs the SO has (the Orders list).
  if (sort.replace("-", "") === "ecs") {
    return `(SELECT count(*) FROM order_items s WHERE s.order_id = o.id) ${dir}, o.sl_no DESC`;
  }
  // Assembly & Packing's planned packing date: the SO's earliest among its lots.
  if (sort.replace("-", "") === "packing") {
    return `(SELECT min(prl.packing_plan_date) FROM order_items s
               JOIN order_ready_lots prl ON prl.item_id = s.id WHERE s.order_id = o.id) ${dir} NULLS LAST, o.sl_no DESC`;
  }
  const key =
    sort.replace("-", "") === "readiness"
      ? `(SELECT max(rpl.planning_readiness_date) FROM order_items s
           JOIN order_planning rpl ON rpl.item_id = s.id WHERE s.order_id = o.id)`
      : "o.so_date";
  return `${key} ${dir} NULLS LAST, o.sl_no DESC`;
}

export async function listItemsForSectionPage(
  table: OrderTable,
  contextColumns: ContextColumn[],
  opts: {
    page: number;
    search: string;
    focusOrderId?: string | null;
    filter?: OrderListFilter;
    /** Planning / Assembly: by the readiness date (the SO's latest), soonest or latest first. */
    sort?: QueueSort | null;
    /** Every matching SO, not one page — the queue's PDF report. */
    all?: boolean;
    /** A department's own condition on the SO (alias o), e.g. Drawing's status filters. */
    extraRestrict?: string;
  }
): Promise<PageResult<Row>> {
  // A department does not see an order it has nothing to do with (QC when
  // the SO says QC is not needed). One rule, in lib/dept-view.
  const dept = deptForTable(table);
  const restrict = `${dept ? deptQueueSql(dept) : "TRUE"} AND (${opts.extraRestrict ?? "TRUE"})`;

  const { ids, total, page } = await pageOfOrderIds({
    page: opts.page,
    search: opts.search,
    focusOrderId: opts.focusOrderId ?? null,
    restrict:
      dept === "assembly"
        ? `${restrict} AND EXISTS (SELECT 1 FROM order_items s WHERE s.order_id = o.id AND ${SPARE_READY_FOR_ASSEMBLY("s")})`
        : `${restrict} AND EXISTS (SELECT 1 FROM order_items s WHERE s.order_id = o.id)`,
    searchable: soAndEcSearch,
    filter: opts.filter,
    orderBy: queueOrderBy(opts.sort),
    all: opts.all,
  });

  const rows = ids.length === 0 ? [] : await listItemsForSection(table, contextColumns, ids);
  // Keep the page's SO order (the rows come back by Sl. No.); an SO's ECs
  // stay in their own order.
  {
    const at = new Map(ids.map((id, i) => [id, i]));
    rows.sort((a, b) => (at.get(String(a.order_id)) ?? 0) - (at.get(String(b.order_id)) ?? 0));
  }

  return pageResult(rows, total, page);
}

/** SO-scope department queue (Accounts), one page of SOs. */
export async function listOrdersForSectionPage(
  table: OrderTable,
  contextColumns: ContextColumn[],
  opts: {
    page: number;
    search: string;
    focusOrderId?: string | null;
    filter?: OrderListFilter;
    sort?: QueueSort | null;
  }
): Promise<PageResult<Row>> {
  const { ids, total, page } = await pageOfOrderIds({
    page: opts.page,
    search: opts.search,
    focusOrderId: opts.focusOrderId ?? null,
    orderBy: queueOrderBy(opts.sort),
    // Accounts is not involved for Challan orders, so they must be out of
    // the count as well as out of the rows.
    restrict: deptForTable(table)
      ? deptQueueSql(deptForTable(table)!)
      : "TRUE",
    searchable: soAndEcSearch,
    filter: opts.filter,
  });

  const rows = ids.length === 0 ? [] : await listOrdersForSection(table, contextColumns, ids);
  {
    const at = new Map(ids.map((id, i) => [id, i]));
    rows.sort((a, b) => (at.get(String(a.id)) ?? 0) - (at.get(String(b.id)) ?? 0));
  }

  return pageResult(rows, total, page);
}

/** Purchase queue (BOI = Yes), one page of SOs' worth of ECs. */
export async function listItemsForPurchasePage(opts: {
  page: number;
  search: string;
  focusOrderId?: string | null;
  filter?: OrderListFilter;
  sort?: QueueSort | null;
}): Promise<PageResult<PurchaseQueueRow>> {
  const { ids, total, page } = await pageOfOrderIds({
    page: opts.page,
    search: opts.search,
    focusOrderId: opts.focusOrderId ?? null,
    orderBy: queueOrderBy(opts.sort),
    restrict: `${deptQueueSql("purchase")} AND EXISTS (SELECT 1 FROM order_items s WHERE s.order_id = o.id)`,
    searchable: soAndEcSearch,
    filter: opts.filter,
  });

  const rows = ids.length === 0 ? [] : await listItemsForPurchase(ids);
  {
    const at = new Map(ids.map((id, i) => [id, i]));
    rows.sort((a, b) => (at.get(String(a.order_id)) ?? 0) - (at.get(String(b.order_id)) ?? 0));
  }

  return pageResult(rows, total, page);
}

/** Billing and Dispatch queue: one page of SOs, filtered in SQL. */
export async function listOrdersForBillingPage(opts: {
  page: number;
  search: string;
  focusOrderId?: string | null;
  filter?: OrderListFilter;
  /** Dispatch: only SOs with a filled-in packing slip (a number) — there is nothing to send before. */
  onlyPacked?: boolean;
  sort?: QueueSort | null;
  /** Every matching SO rather than one page — for a printed report. */
  all?: boolean;
}): Promise<PageResult<BillingQueueRow>> {
  const { ids, total, page } = await pageOfOrderIds({
    page: opts.page,
    search: opts.search,
    focusOrderId: opts.focusOrderId ?? null,
    orderBy: queueOrderBy(opts.sort),
    // A cancelled or diverted order is no longer Billing's or Dispatch's work.
    restrict: opts.onlyPacked
      ? `${orderOpenSql("o")} AND ${releasedSql("o")} AND EXISTS (SELECT 1 FROM order_packing_slips ps
                                           WHERE ps.order_id = o.id AND ps.kind = 'actual'
                                             AND NULLIF(btrim(ps.packing_slip_no), '') IS NOT NULL)`
      // Billing: not a Challan order — there is no PI to raise on one.
      : deptQueueSql("billing"),
    searchable: (term) =>
      `(o.so_no ILIKE ${term} OR o.client_name ILIKE ${term} OR o.sl_no::text ILIKE ${term})`,
    filter: opts.filter,
    all: opts.all,
  });

  const rows = ids.length === 0 ? [] : await listOrdersForBilling(ids);
  {
    const at = new Map(ids.map((id, i) => [id, i]));
    rows.sort((a, b) => (at.get(String(a.id)) ?? 0) - (at.get(String(b.id)) ?? 0));
  }

  return pageResult(rows, total, page);
}

// ---------------------------------------------------------------------------
// Per-SO department status (the "Departments" popup on the order list)
// ---------------------------------------------------------------------------

export type DeptCell = { state: "done" | "pending" | "na"; label: string };

export type EcDeptStatus = {
  id: string;
  ec_no: string | null;
  item_type: string | null;
  drawing: DeptCell;
  purchase: DeptCell;
  quality: DeptCell;
  planning: DeptCell;
  assembly: DeptCell;
};

/**
 * The date each department is working to. These live on the SO — one target
 * applies across every EC of the order — so the popup prints them once per
 * department rather than repeating the same date down every EC row. Planning
 * has no target of its own; it works to Purchase's and Dispatch's.
 */
export type DeptTargets = {
  drawing: string | null;
  purchase: string | null;
  quality: string | null;
  assembly: string | null;
  dispatch: string | null;
  // Set only when the dispatch date has been revised; it supersedes the above.
  dispatchRevised: string | null;
};

export type SoDeptStatus = {
  billing: DeptCell;
  accounts: DeptCell;
  dispatch: DeptCell;
  targets: DeptTargets;
  ecs: EcDeptStatus[];
};

const NA: DeptCell = { state: "na", label: "N/A" };
const done = (label: string): DeptCell => ({ state: "done", label });
const pending = (label = "Pending"): DeptCell => ({ state: "pending", label });

/** Full department status for one SO — SO-scope depts plus a per-EC matrix. */
export async function getOrderDeptStatus(
  orderId: string
): Promise<SoDeptStatus | null> {
  if (!UUID_RE.test(orderId)) return null;
  return (await listOrderDeptStatuses([orderId])).get(orderId) ?? null;
}

/**
 * The same for many SOs at once — a page of the Orders list — in two reads
 * rather than two per SO.
 */
export async function listOrderDeptStatuses(orderIds: string[]): Promise<Map<string, SoDeptStatus>> {
  const ids = orderIds.filter((id) => UUID_RE.test(id));
  const out = new Map<string, SoDeptStatus>();
  if (ids.length === 0) return out;

  const so = await query<{
    order_id: string;
    dispatch_status: string | null;
    bill_type: string | null;
    after_receipt_only: boolean;
    has_pi: boolean;
    billing_state: string;
    payment_status: string | null;
    drg_target_date: string | null;
    purchase_target_date: string | null;
    qc_doc_target_date: string | null;
    dispatch_team_target_date: string | null;
    dispatch_target_date: string | null;
    dispatch_target_revised_date: string | null;
  }>(
    `SELECT o.id AS order_id, ${DISPATCH_STATUS} AS dispatch_status, o.bill_type,
            ${AFTER_RECEIPT_ONLY} AS after_receipt_only,
            ${BILLING_RAISED} AS has_pi,
            ${BILLING_STATE} AS billing_state,
            a.payment_status,
            to_char(o.drg_target_date, 'YYYY-MM-DD') AS drg_target_date,
            to_char(o.purchase_target_date, 'YYYY-MM-DD') AS purchase_target_date,
            to_char(o.qc_doc_target_date, 'YYYY-MM-DD') AS qc_doc_target_date,
            to_char(o.dispatch_team_target_date, 'YYYY-MM-DD') AS dispatch_team_target_date,
            to_char(o.dispatch_target_date, 'YYYY-MM-DD') AS dispatch_target_date,
            to_char(o.dispatch_target_revised_date, 'YYYY-MM-DD') AS dispatch_target_revised_date
       FROM orders o
       LEFT JOIN order_billing b  ON b.order_id  = o.id
       LEFT JOIN order_accounts a ON a.order_id = o.id
      WHERE o.id = ANY($1::uuid[])`,
    [ids]
  );

  const ecRows = await query<{
    order_id: string;
    id: string;
    ec_no: string | null;
    item_type: string | null;
    boi: string | null;
    spare: boolean;
    drg: string | null;
    purchase: string;
    qc_required: string | null;
    qc_submitted: boolean;
    planning: string | null;
    packed: boolean;
    assembly_state: string | null;
    packing_date: string | null;
  }>(
    `SELECT it.order_id, it.id, it.ec_no, it.item_type, o.boi,
            (${spareEcSql("it", "o")}) AS spare,
            (SELECT CASE
                      WHEN bool_or(lower(coalesce(rv.approved,'')) = 'yes')
                        THEN 'Approved'
                      WHEN bool_or(lower(coalesce(rv.issued_to_client,'')) = 'yes')
                        THEN 'Issued to Client'
                      WHEN bool_or(lower(coalesce(rv.issued_to_operations,'')) = 'yes')
                        THEN 'Issued to Operations'
                      ELSE NULL END
               FROM order_drawing_revisions rv WHERE rv.item_id = it.id AND rv.doc_type = 'GAD') AS drg,
            (CASE
               WHEN COALESCE(o.boi, '') <> 'Yes' THEN 'na'
               WHEN NOT EXISTS (SELECT 1 FROM order_boi_items bi WHERE bi.item_id = it.id) THEN 'pending'
               WHEN EXISTS (SELECT 1 FROM order_boi_items bi WHERE bi.item_id = it.id AND NOT ${boiReceivedSql("bi")}) THEN 'pending'
               ELSE 'done' END) AS purchase,
            o.qc_required,
            (qc.qc_doc_actual_date IS NOT NULL) AS qc_submitted,
            COALESCE(NULLIF(pl.actual_pump_status, ''),
                     NULLIF(pl.actual_spare_status, ''),
                     NULLIF(pl.planning_status, '')) AS planning,
            (ad.actual_packing_date IS NOT NULL) AS packed,
            ${ASSEMBLY_STATE_SQL("it")} AS assembly_state,
            to_char(ad.actual_packing_date, 'YYYY-MM-DD') AS packing_date
       FROM order_items it
       JOIN orders o ON o.id = it.order_id
       LEFT JOIN order_qc qc                ON qc.item_id = it.id
       LEFT JOIN order_planning pl          ON pl.item_id = it.id
       LEFT JOIN order_assembly_dispatch ad ON ad.item_id = it.id
      WHERE it.order_id = ANY($1::uuid[])
      ORDER BY it.seq ASC`,
    [ids]
  );

  const ecsByOrder = new Map<string, EcDeptStatus[]>();
  for (const r of ecRows.rows) {
    const list = ecsByOrder.get(r.order_id) ?? [];
    ecsByOrder.set(r.order_id, list);
    list.push({
      id: r.id,
      ec_no: r.ec_no,
      item_type: r.item_type,
      drawing: r.spare ? NA : r.drg ? done(r.drg) : pending(),
      purchase:
        r.purchase === "na"
          ? NA
          : r.purchase === "done"
            ? done("Received")
            : pending(),
      quality:
        String(r.qc_required ?? "") === "No"
          ? NA
          : r.qc_submitted
            ? done("Submitted")
            : pending(),
      // A Spare starts at Date awaited, not "Pending".
      planning: r.planning ? done(r.planning) : pending(r.spare ? SPARE_PLANNING_START : "Pending"),
      // A Spare reaches Assembly & Packing with its first readiness lot; until
      // then it has no status there at all.
      assembly: r.packed
        ? done(r.assembly_state || "Fully packed")
        : r.spare && (!r.assembly_state || r.assembly_state === "Pending")
          ? { state: "na", label: "—" }
          : pending(r.assembly_state && r.assembly_state !== "Pending" ? r.assembly_state : "Pending"),
    });
  }

  for (const head of so.rows) {
    const ecs = ecsByOrder.get(head.order_id) ?? [];
    const isChallan = String(head.bill_type ?? "") === "Challan";

    // PIs and payments are recorded on every order, whatever its terms.
    const paidAfterReceipt = false;
    out.set(head.order_id, {
      billing:
        paidAfterReceipt || head.billing_state === "N/A"
          ? NA
          : head.billing_state === "Fully raised" || head.billing_state === "Challan filed"
            ? done(head.billing_state)
            : pending(head.billing_state === "Partially raised" ? "Partially raised" : undefined),
      // Accounts is skipped for Challan orders (no A/R), matching the workspace.
      accounts: isChallan || paidAfterReceipt
        ? NA
        : head.payment_status
          ? done(head.payment_status)
          : pending(),
      dispatch:
        head.dispatch_status && head.dispatch_status.toLowerCase() !== "pending"
          ? done(head.dispatch_status)
          : pending(),
      targets: {
        drawing: head.drg_target_date,
        purchase: head.purchase_target_date,
        quality: head.qc_doc_target_date,
        assembly: head.dispatch_team_target_date,
        dispatch: head.dispatch_target_date,
        dispatchRevised: head.dispatch_target_revised_date,
      },
      ecs,
    });
  }
  return out;
}

/**
 * A notification deep link carries an item_id for per-EC events and an
 * order_id otherwise. Both arrive in the same `edit` parameter, so resolve
 * whichever it is to the owning SO — that's what the queues page on.
 */
export async function resolveFocusOrderId(
  id: string | undefined | null
): Promise<string | null> {
  if (!id || !UUID_RE.test(id)) return null;
  const direct = await query<{ id: string }>(
    `SELECT id FROM orders WHERE id = $1`,
    [id]
  );
  if (direct.rows[0]) return direct.rows[0].id;
  const viaItem = await query<{ order_id: string }>(
    `SELECT order_id FROM order_items WHERE id = $1`,
    [id]
  );
  return viaItem.rows[0]?.order_id ?? null;
}

// ---------------------------------------------------------------------------
// Target date history
// ---------------------------------------------------------------------------

/**
 * Undo the most recent value of one target: drop it and fall back to whatever
 * came before, or clear the target when that was its only entry.
 *
 * Only the latest is removable. Deleting from the middle would leave a history
 * that never happened — and the seq numbering, which the unique index relies
 * on, would have a hole in it.
 */
export async function deleteLatestTargetRevision(
  orderId: string,
  target: TargetDate
): Promise<{ removed: string | null; now: string | null }> {
  return withTransaction(async (client) => {
    const latest = await client.query<{ id: string; d: string }>(
      `SELECT id, to_char(target_date, 'YYYY-MM-DD') AS d
         FROM order_target_revisions
        WHERE order_id = $1 AND target_key = $2
        ORDER BY seq DESC
        LIMIT 1
        FOR UPDATE`,
      [orderId, target.key]
    );
    const row = latest.rows[0];
    if (!row) return { removed: null, now: null };

    await client.query(`DELETE FROM order_target_revisions WHERE id = $1`, [
      row.id,
    ]);
    await syncTargetColumns(client, orderId, target);

    const remaining = await client.query<{ d: string }>(
      `SELECT to_char(target_date, 'YYYY-MM-DD') AS d
         FROM order_target_revisions
        WHERE order_id = $1 AND target_key = $2
        ORDER BY seq DESC
        LIMIT 1`,
      [orderId, target.key]
    );
    return { removed: row.d, now: remaining.rows[0]?.d ?? null };
  });
}

/** Every value each of the SO's targets has held, oldest first. */
export async function listTargetRevisions(
  orderId: string
): Promise<TargetRevision[]> {
  if (!UUID_RE.test(orderId)) return [];
  const result = await query<TargetRevision>(
    `SELECT r.id, r.target_key, r.seq::int AS seq,
            to_char(r.target_date, 'YYYY-MM-DD') AS target_date,
            r.reason, u.email AS changed_by_email, r.changed_by_role,
            to_char(r.created_at AT TIME ZONE 'UTC',
                    'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS created_at
       FROM order_target_revisions r
       LEFT JOIN users u ON u.id = r.changed_by
      WHERE r.order_id = $1
      ORDER BY r.target_key, r.seq`,
    [orderId]
  );
  return result.rows;
}

/**
 * Point the `orders` columns at what the history now says.
 *
 * Both the add and the delete path go through here, so the denormalised
 * current value can never disagree with the revisions behind it. Dispatch is
 * the one target with two columns: the original stays put and the latest
 * revision lands in the "revised" column, which is the pair every existing
 * reader COALESCEs. Column names come from TARGET_DATES, never from input.
 */
async function syncTargetColumns(
  client: PoolClient,
  orderId: string,
  target: TargetDate
): Promise<void> {
  const rows = await client.query<{ d: string }>(
    `SELECT to_char(target_date, 'YYYY-MM-DD') AS d
       FROM order_target_revisions
      WHERE order_id = $1 AND target_key = $2
      ORDER BY seq`,
    [orderId, target.key]
  );
  const dates = rows.rows.map((r) => r.d);

  if (target.revisedColumn) {
    await client.query(
      `UPDATE orders SET ${target.column} = $2, ${target.revisedColumn} = $3
        WHERE id = $1`,
      [orderId, dates[0] ?? null, dates.length > 1 ? dates[dates.length - 1] : null]
    );
    return;
  }
  await client.query(`UPDATE orders SET ${target.column} = $2 WHERE id = $1`, [
    orderId,
    dates[dates.length - 1] ?? null,
  ]);
}

/** A dispatch started: its invoice or challan side has something filled in. */
const INVOICE_STARTED = (i: string) => `(${i}.invoice_no IS NOT NULL OR ${i}.challan_no IS NOT NULL
      OR ${i}.invoice_date IS NOT NULL OR ${i}.challan_date IS NOT NULL
      OR ${i}.invoice_value IS NOT NULL OR ${i}.challan_value IS NOT NULL)`;

/** A dispatch's Invoice step is done: Invoice No. and Date (Challan No. and Date on a Challan order). */
const INVOICE_STEP_DONE = (i: string, o: string) => `(CASE WHEN btrim(COALESCE(${o}.bill_type, '')) = 'Challan'
      THEN NULLIF(btrim(${i}.challan_no), '') IS NOT NULL AND ${i}.challan_date IS NOT NULL
      ELSE NULLIF(btrim(${i}.invoice_no), '') IS NOT NULL AND ${i}.invoice_date IS NOT NULL END)`;

/**
 * The SO's stage in Invoice → Dispatch → Docket & LR (DISPATCH_STAGES): its
 * least advanced numbered slip or dispatch, the same steps as the pop-up.
 */
export const dispatchStageSql = (o: string) => `(CASE
    WHEN EXISTS (SELECT 1 FROM order_packing_slips sp
                  WHERE sp.order_id = ${o}.id AND sp.kind = 'actual'
                    AND NULLIF(btrim(sp.packing_slip_no), '') IS NOT NULL
                    AND NOT EXISTS (SELECT 1 FROM order_invoice_slips sl
                                      JOIN order_invoices sv ON sv.id = sl.invoice_id
                                     WHERE sl.packing_slip_id = sp.id AND ${INVOICE_STEP_DONE("sv", o)}))
      THEN 'Invoice pending'
    WHEN EXISTS (SELECT 1 FROM order_invoices sv WHERE sv.order_id = ${o}.id
                    AND ${INVOICE_STEP_DONE("sv", o)} AND NULLIF(btrim(sv.delivery_mode), '') IS NULL)
      THEN 'Dispatch pending'
    WHEN EXISTS (SELECT 1 FROM order_invoices sv WHERE sv.order_id = ${o}.id
                    AND ${INVOICE_STEP_DONE("sv", o)} AND NULLIF(btrim(sv.docket_no), '') IS NULL)
      THEN 'Docket & LR pending'
    ELSE 'Docket & LR done' END)`;

/**
 * A packed readiness lot of the SO not yet on a slip that has gone out: no
 * sent slip names its lot number (its position among its EC's lots). A lot
 * is packed once — partial packing is a lot of its own — so the lot number
 * alone says whether it went.
 */
export const UNSENT_PACKED_LOT_SQL = (o: string) => `SELECT 1 FROM order_ready_lots ul
      JOIN order_items ui ON ui.id = ul.item_id
     WHERE ui.order_id = ${o}.id AND ul.packed_date IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM order_packing_slips us
           JOIN order_invoice_slips usl ON usl.packing_slip_id = us.id
           JOIN order_invoices usi ON usi.id = usl.invoice_id
          WHERE us.order_id = ${o}.id AND us.kind = 'actual'
            AND ${INVOICE_STARTED("usi")}
            AND (SELECT count(*) FROM order_ready_lots u2
                  WHERE u2.item_id = ul.item_id AND u2.seq <= ul.seq) = ANY(us.lot_nos))`;

/**
 * A packed readiness lot of the SO that no numbered packing slip names (by
 * its lot number) — packed, but nothing yet for Dispatch to send.
 */
export const PACKED_LOT_WITHOUT_SLIP_SQL = (o: string) => `SELECT 1 FROM order_ready_lots nl
      JOIN order_items ni ON ni.id = nl.item_id
     WHERE ni.order_id = ${o}.id AND nl.packed_date IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM order_packing_slips ns
          WHERE ns.order_id = ${o}.id AND ns.kind = 'actual'
            AND NULLIF(btrim(ns.packing_slip_no), '') IS NOT NULL
            AND (SELECT count(*) FROM order_ready_lots n2
                  WHERE n2.item_id = nl.item_id AND n2.seq <= nl.seq) = ANY(ns.lot_nos))`;

/** The SO's slips that have gone out: linked to a dispatch that has started. */
const SENT_SLIPS_SQL = (o: string) => `SELECT 1 FROM order_invoice_slips l
      JOIN order_invoices si ON si.id = l.invoice_id
     WHERE si.order_id = ${o}.id AND ${INVOICE_STARTED("si")}`;

/** Every EC of the SO is packed (a Spare's last lot Fully packed sets its date too). */
const SO_FULLY_PACKED_SQL = (o: string) => `(EXISTS (SELECT 1 FROM order_items fi WHERE fi.order_id = ${o}.id)
      AND NOT EXISTS (SELECT 1 FROM order_items fi
                       LEFT JOIN order_assembly_dispatch fa ON fa.item_id = fi.id
                      WHERE fi.order_id = ${o}.id AND fa.actual_packing_date IS NULL))`;

/**
 * Raise a dispatch for some of the SO's packing slips — one invoice / challan
 * card covering all of them. Each slip must be the SO's, an actual one, and
 * not already on a dispatch. Returns the new card's id, or why not.
 */
export async function createDispatchFromSlips(
  orderId: string,
  slipIds: string[]
): Promise<{ id: string } | { error: string }> {
  if (!UUID_RE.test(orderId)) return { error: "Order not found." };
  const ids = [...new Set(slipIds)].filter((s) => UUID_RE.test(s));
  if (ids.length === 0) return { error: "Choose at least one packing slip." };
  const created = await withTransaction(async (c) => {
    const ok = await c.query<{ id: string; packing_slip_no: string | null; quantity: number | null }>(
      `SELECT ps.id, ps.packing_slip_no, ps.quantity FROM order_packing_slips ps
        WHERE ps.id = ANY($2::uuid[]) AND ps.order_id = $1 AND ps.kind = 'actual'
          AND NOT EXISTS (SELECT 1 FROM order_invoice_slips l WHERE l.packing_slip_id = ps.id)
        ORDER BY ps.seq FOR UPDATE`,
      [orderId, ids]
    );
    if (ok.rows.length !== ids.length) return null;
    const qty = ok.rows.reduce((a, r) => a + (Number(r.quantity) || 0), 0);
    const inv = await c.query<{ id: string }>(
      `INSERT INTO order_invoices (order_id, packing_slip_no, packing_quantity)
       VALUES ($1, $2, $3) RETURNING id`,
      [
        orderId,
        ok.rows.map((r) => r.packing_slip_no).filter(Boolean).join(", ") || null,
        ok.rows.some((r) => r.quantity != null) ? qty : null,
      ]
    );
    for (const r of ok.rows) {
      await c.query(`INSERT INTO order_invoice_slips (invoice_id, packing_slip_id) VALUES ($1, $2)`, [
        inv.rows[0].id,
        r.id,
      ]);
    }
    return inv.rows[0].id;
  });
  if (!created) return { error: "A chosen slip is not this SO's, or is already on a dispatch." };
  await recomputeDispatchStatus(orderId);
  return { id: created };
}

/** Restate an SO's dispatch status from one of its ECs. */
async function recomputeDispatchStatusForItem(itemId: string): Promise<void> {
  const r = await query<{ order_id: string }>(`SELECT order_id FROM order_items WHERE id = $1`, [itemId]);
  if (r.rows[0]) await recomputeDispatchStatus(r.rows[0].order_id);
}

/**
 * Record a new value for one target and make it the current one.
 *
 * The history row and the denormalised column on `orders` are written in one
 * transaction: everything else in the app still reads the column, so the two
 * must never drift. `seq` is taken inside the transaction and the table has a
 * unique index on (order_id, target_key, seq), so a double-submit fails loudly
 * instead of writing two revision 3s.
 */
export async function addTargetRevision(input: {
  orderId: string;
  target: TargetDate;
  date: string;
  reason: string | null;
  actorId: string;
  actorRole: string;
}): Promise<{ seq: number }> {
  return withTransaction(async (client) => {
    const next = await client.query<{ seq: number }>(
      `SELECT COALESCE(MAX(seq), 0) + 1 AS seq
         FROM order_target_revisions
        WHERE order_id = $1 AND target_key = $2`,
      [input.orderId, input.target.key]
    );
    const seq = Number(next.rows[0]?.seq ?? 1);

    await client.query(
      `INSERT INTO order_target_revisions
         (order_id, target_key, seq, target_date, reason, changed_by, changed_by_role)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        input.orderId,
        input.target.key,
        seq,
        input.date,
        input.reason,
        input.actorId,
        input.actorRole,
      ]
    );

    await syncTargetColumns(client, input.orderId, input.target);
    return { seq };
  });
}

/**
 * Fill every first target the SO's own dates give (lib/target-rules.ts) that
 * has never been set — no current value and no history. A target someone has
 * set, even once, is theirs: it is revised by hand, never recomputed. Returns
 * what was filled, so the caller can tell the departments.
 */
export async function fillFirstTargets(
  orderId: string,
  actor: { id: string; role: string }
): Promise<{ target: TargetDate; date: string; reason: string }[]> {
  if (!UUID_RE.test(orderId)) return [];
  const r = await query<{
    so_date: string | null;
    order_type: string | null;
    delivery: string | null;
    handover: string | null;
    qty: string | null;
    qc_required: string | null;
    drawing_involved: boolean;
    set_keys: string[];
    drg: boolean;
    purchase: boolean;
    quality: boolean;
    packing: boolean;
    dispatch: boolean;
    created_on: string | null;
  }>(
    `SELECT to_char(o.so_date, 'YYYY-MM-DD') AS so_date,
            o.order_type,
            to_char(o.created_at AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD') AS created_on,
            to_char(o.delivery_date_as_per_so, 'YYYY-MM-DD') AS delivery,
            to_char(o.so_handover_date, 'YYYY-MM-DD') AS handover,
            -- The SO's quantity, else what its ECs add up to.
            COALESCE(o.total_quantity,
                     (SELECT sum(it.quantity) FROM order_items it WHERE it.order_id = o.id))::text AS qty,
            o.qc_required,
            (${deptInvolvementSql("drawing", "o")}) AS drawing_involved,
            ARRAY(SELECT DISTINCT r.target_key FROM order_target_revisions r
                   WHERE r.order_id = o.id) AS set_keys,
            o.drg_target_date IS NOT NULL AS drg,
            o.purchase_target_date IS NOT NULL AS purchase,
            o.qc_doc_target_date IS NOT NULL AS quality,
            o.dispatch_team_target_date IS NOT NULL AS packing,
            (o.dispatch_target_date IS NOT NULL
             OR o.dispatch_target_revised_date IS NOT NULL) AS dispatch
       FROM orders o WHERE o.id = $1`,
    [orderId]
  );
  const o = r.rows[0];
  if (!o) return [];
  // A new Spare with no delivery date as per SO takes SO date + 2 weeks — a
  // plain field, so it stays editable; only a blank is ever filled.
  if (!o.delivery) {
    const delivery = spareDeliveryDate(o);
    if (delivery) {
      await query(
        `UPDATE orders SET delivery_date_as_per_so = $2::date WHERE id = $1 AND delivery_date_as_per_so IS NULL`,
        [orderId, delivery]
      );
      o.delivery = delivery;
    }
  }
  const already = new Set<string>(o.set_keys);
  const columnSet: Record<TargetKey, boolean> = {
    drawing: o.drg,
    purchase: o.purchase,
    quality: o.quality,
    packing: o.packing,
    dispatch: o.dispatch,
  };

  const filled: { target: TargetDate; date: string; reason: string }[] = [];
  for (const auto of autoTargets({
    so_date: o.so_date,
    order_type: o.order_type,
    delivery_date_as_per_so: o.delivery,
    so_handover_date: o.handover,
    total_quantity: o.qty,
    qc_required: o.qc_required,
    drawing_involved: o.drawing_involved,
    created_on: o.created_on,
  })) {
    if (already.has(auto.key) || columnSet[auto.key]) continue;
    const target = TARGET_BY_KEY.get(auto.key);
    if (!target) continue;
    await addTargetRevision({
      orderId,
      target,
      date: auto.date,
      reason: auto.reason,
      actorId: actor.id,
      actorRole: actor.role,
    });
    filled.push({ target, date: auto.date, reason: auto.reason });
  }
  return filled;
}

// ---------------------------------------------------------------------------
// Department completion
// ---------------------------------------------------------------------------

// The business runs on IST calendar days; the DB session is UTC. Same constant
// the reminders and overdue engines use, so "today" means one thing.
const TODAY_IST = "(now() AT TIME ZONE 'Asia/Kolkata')::date";

/** Sign-offs for a set of SOs, for the queue's checkbox column. */
export async function listDeptCompletions(
  orderIds: string[]
): Promise<DeptCompletion[]> {
  const ids = orderIds.filter((id) => UUID_RE.test(id));
  if (ids.length === 0) return [];
  const result = await query<DeptCompletion>(
    `SELECT c.id, c.order_id, c.item_id, c.dept,
            to_char(c.completed_on, 'YYYY-MM-DD') AS completed_on,
            to_char(c.target_date, 'YYYY-MM-DD') AS target_date,
            c.days_taken::int AS days_taken,
            u.email AS completed_by_email, c.completed_by_role
       FROM order_dept_completions c
       LEFT JOIN users u ON u.id = c.completed_by
      WHERE c.order_id = ANY($1)`,
    [ids]
  );
  return result.rows;
}

/**
 * The target a department was ORIGINALLY given: revision 1 of its target date,
 * falling back to the column when an order predates the revision history.
 *
 * Deliberately not the current value — measuring against a date that has since
 * been pushed out would make every late department look on time.
 */
async function originalTargetFor(
  orderId: string,
  dept: DeptKey
): Promise<string | null> {
  const key = targetKeyForDept(dept);
  if (!key) return null;
  const target = TARGET_BY_KEY.get(key)!;

  const first = await query<{ d: string }>(
    `SELECT to_char(target_date, 'YYYY-MM-DD') AS d
       FROM order_target_revisions
      WHERE order_id = $1 AND target_key = $2
      ORDER BY seq
      LIMIT 1`,
    [orderId, key]
  );
  if (first.rows[0]) return first.rows[0].d;

  const column = await query<{ d: string | null }>(
    `SELECT to_char(${target.column}, 'YYYY-MM-DD') AS d FROM orders WHERE id = $1`,
    [orderId]
  );
  return column.rows[0]?.d ?? null;
}

/**
 * Record a department as finished with an SO (or one EC of it). `scopeId` is
 * the item id for the per-EC departments and the order id for the rest.
 *
 * The target and the day count are frozen here rather than derived on read: a
 * target revised after sign-off must not rewrite how long the work took.
 */
export async function completeDept(input: {
  scopeId: string;
  dept: DeptKey;
  actorId: string;
  actorRole: string;
}): Promise<DeptCompletion | null> {
  if (!UUID_RE.test(input.scopeId)) return null;
  const perEc = isPerEcDept(input.dept);

  const orderId = perEc
    ? (
        await query<{ order_id: string }>(
          `SELECT order_id FROM order_items WHERE id = $1`,
          [input.scopeId]
        )
      ).rows[0]?.order_id
    : input.scopeId;
  if (!orderId) return null;

  const target = await originalTargetFor(orderId, input.dept);
  const inserted = await query<{ id: string }>(
    `INSERT INTO order_dept_completions
       (order_id, item_id, dept, completed_on, target_date, days_taken,
        completed_by, completed_by_role)
     VALUES ($1, $2, $3, ${TODAY_IST}, $4::date,
             CASE WHEN $4::date IS NULL THEN NULL
                  ELSE (${TODAY_IST} - $4::date)::int END,
             $5, $6)
     ON CONFLICT DO NOTHING
     RETURNING id`,
    [orderId, perEc ? input.scopeId : null, input.dept, target, input.actorId, input.actorRole]
  );
  // ON CONFLICT means it was already signed off — return what stands.
  if (!inserted.rows[0]) {
    const existing = await listDeptCompletions([orderId]);
    return (
      existing.find(
        (c) =>
          c.dept === input.dept &&
          (perEc ? c.item_id === input.scopeId : c.item_id === null)
      ) ?? null
    );
  }
  const all = await listDeptCompletions([orderId]);
  return all.find((c) => c.id === inserted.rows[0].id) ?? null;
}

/** Undo a sign-off. Returns the order it belonged to, for revalidation. */
export async function uncompleteDept(
  scopeId: string,
  dept: DeptKey
): Promise<string | null> {
  if (!UUID_RE.test(scopeId)) return null;
  const perEc = isPerEcDept(dept);
  const result = await query<{ order_id: string }>(
    perEc
      ? `DELETE FROM order_dept_completions
          WHERE item_id = $1 AND dept = $2 RETURNING order_id`
      : `DELETE FROM order_dept_completions
          WHERE order_id = $1 AND item_id IS NULL AND dept = $2 RETURNING order_id`,
    [scopeId, dept]
  );
  return result.rows[0]?.order_id ?? null;
}

// ---------------------------------------------------------------------------
// Central dashboard: the order pipeline, filtered and paged in SQL
// ---------------------------------------------------------------------------

/** SO cards per pipeline page. */
export const PIPELINE_PAGE_SIZE = 12;

/**
 * The pipeline's filter, row by row. Unlike the orders list, which asks
 * whether an SO has any EC that matches, the pipeline narrows the ECs
 * themselves: filter Drawing to "Approved" and each SO card lists only its
 * approved ECs. An SO is on the page while any of its rows survive.
 */
function pipelineRowWhere(f: OrderListFilter): { where: string; params: unknown[] } {
  const params: unknown[] = [];
  const p = (value: unknown) => {
    params.push(value);
    return `$${params.length}`;
  };
  const clauses: string[] = [];
  const facet = (column: string, values: string[]) =>
    `TRIM(COALESCE(${column}, '')) = ANY(${p(values)}::text[])`;

  if (f.search) {
    const q = p(likePattern(f.search));
    clauses.push(`(o.so_no ILIKE ${q} OR it.ec_no ILIKE ${q}
                   OR o.client_name ILIKE ${q} OR o.client_code ILIKE ${q})`);
  }
  if (f.zones.length) clauses.push(facet("o.zone", f.zones));
  if (f.reps.length) clauses.push(facet("o.reps", f.reps));
  if (f.markets.length) clauses.push(facet("o.market_type", f.markets));
  // An EC is read by its own item type, falling back to the order's.
  if (f.types.length) clauses.push(facet("COALESCE(it.item_type, o.order_type)", f.types));

  if (f.dept === "planning" && f.packingStatuses.length) {
    clauses.push(`(${planningPackingOnEc(f)})`);
  } else if (f.dept && f.deptStatuses.length) {
    const dept = f.dept;
    clauses.push(
      `(${f.deptStatuses.map((s) => isPerEcDept(dept) ? `(${ecState(dept, s)})` : `(${soState(dept, s)})`).join(" OR ")})`
    );
  }
  // This row's own sign-off: its EC's for a per-EC department, its SO's else.
  const signedHere = (dept: DeptFilterKey) =>
    isPerEcDept(dept)
      ? `c.item_id = it.id AND c.dept = ${lit(dept)}`
      : `c.order_id = o.id AND c.item_id IS NULL AND c.dept = ${lit(dept)}`;
  if (f.dept && f.signOff) {
    const signed = `EXISTS (SELECT 1 FROM order_dept_completions c WHERE ${signedHere(f.dept)})`;
    clauses.push(f.signOff === "completed" ? signed : `NOT ${signed}`);
  }
  // A Spare lot packed but on no packing slip.
  if (f.noSlip) clauses.push(`EXISTS (${PACKED_LOT_WITHOUT_SLIP_SQL("o")})`);

  if (f.from || f.to) {
    const range = (column: string) =>
      [
        f.from ? `${column} >= ${p(f.from)}::date` : null,
        f.to ? `${column} <= ${p(f.to)}::date` : null,
      ]
        .filter(Boolean)
        .join(" AND ");
    if (f.dateField === "dept_target") {
      // The chosen department own target column. Billing and Accounts have
      // none, so a date range on their queue matches nothing rather than
      // quietly falling through to somebody else date.
      const column = f.dept ? DEPT_TARGET_COLUMN[f.dept] : undefined;
      clauses.push(column ? range(column) : "FALSE");
    } else if (f.dateField === "so_date") clauses.push(range("o.so_date"));
    else if (f.dateField === "dispatch_target") clauses.push(range("o.dispatch_target_date"));
    else if (f.dateField === "ec_date") clauses.push(range("it.ec_date"));
    else if (f.dateField === "readiness") {
      clauses.push(`EXISTS (SELECT 1 FROM order_planning rpl
                             WHERE rpl.item_id = it.id AND ${range("rpl.planning_readiness_date")})`);
    }
    else if (f.dateField === "packing") {
      clauses.push(`EXISTS (SELECT 1 FROM order_ready_lots prl
                             WHERE prl.item_id = it.id AND ${range("prl.packing_plan_date")})`);
    }
    else {
      // Completed on: the chosen department's sign-off on this row, or with
      // none chosen, any sign-off on this EC or its SO.
      const scope = f.dept
        ? signedHere(f.dept)
        : `(c.item_id = it.id OR (c.item_id IS NULL AND c.order_id = o.id))`;
      clauses.push(`EXISTS (SELECT 1 FROM order_dept_completions c
                             WHERE ${scope} AND ${range("c.completed_on")})`);
    }
  }

  return {
    where: clauses.length ? `WHERE ${clauses.join("\n        AND ")}` : "",
    params,
  };
}

/** The figures above the pipeline, over every row the filter lets through. */
export type PipelineStats = {
  /** SOs with at least one matching row. */
  soTotal: number;
  /** Every SO, unfiltered — the "of N" in "Showing X of N". */
  allSoTotal: number;
  /** Matching ECs (an EC-less SO's bare row is not an EC). */
  ecTotal: number;
  /** Matching SOs on payment hold. */
  holds: number;
  /** Matching ECs past their dispatch target and still not dispatched. */
  overdue: number;
  /** Book value of the matching SOs, each counted once. */
  totalValue: number;
  /** Matching SOs by payment status, lower-cased; "" for none set. */
  payment: Record<string, number>;
  /** Matching SOs by dispatch status, lower-cased. */
  dispatch: Record<string, number>;
};

export type PipelinePage = PageResult<OrderOverviewRow> & {
  stats: PipelineStats;
  options: OrderListOptions;
};

/**
 * One page of the order pipeline — the SOs on it and all their matching
 * rows — plus the figures over everything that matched. Filtering, counting
 * and paging all happen in the database; the browser gets one page.
 */
export async function getPipelinePage(opts: {
  page: number;
  filter: OrderListFilter;
}): Promise<PipelinePage> {
  const { where, params } = pipelineRowWhere(await withRepTeams(opts.filter));
  const rowsCte = `WITH r AS (SELECT ${overviewColumns()} ${OVERVIEW_FROM} ${where})`;

  const fetchPage = (page: number) => {
    const limit = `$${params.length + 1}`;
    const offset = `$${params.length + 2}`;
    return query<OrderOverviewRow>(
      `${rowsCte},
       sos AS (SELECT order_id, min(sl_no) AS sl_no FROM r GROUP BY order_id),
       page AS (SELECT order_id FROM sos ORDER BY sl_no LIMIT ${limit} OFFSET ${offset})
       SELECT r.* FROM r JOIN page USING (order_id)
        ORDER BY r.sl_no, r.ec_seq NULLS FIRST`,
      [...params, PIPELINE_PAGE_SIZE, (Math.max(1, page) - 1) * PIPELINE_PAGE_SIZE]
    );
  };

  const [stats, first, options] = await Promise.all([
    query<{
      so_total: number;
      all_so_total: number;
      ec_total: number;
      holds: number;
      overdue: number;
      total_value: string | null;
      payment: Record<string, number> | null;
      dispatch: Record<string, number> | null;
    }>(
      `${rowsCte},
       so AS (SELECT DISTINCT ON (order_id) * FROM r ORDER BY order_id)
       SELECT (SELECT count(*) FROM so)::int AS so_total,
              (SELECT count(*) FROM orders)::int AS all_so_total,
              (SELECT count(*) FROM r WHERE id IS NOT NULL)::int AS ec_total,
              (SELECT count(*) FROM so
                WHERE lower(TRIM(COALESCE(payment_status, ''))) = 'outstanding hold')::int AS holds,
              -- A revised dispatch date supersedes the original; "Pending"
              -- is how the dispatch status reads before anything has gone.
              (SELECT count(*) FROM r
                WHERE id IS NOT NULL
                  AND COALESCE(dispatch_target_revised_date, dispatch_target_date)
                        < to_char(${TODAY_IST}, 'YYYY-MM-DD')
                  AND lower(TRIM(COALESCE(dispatch_status, ''))) IN ('', 'pending'))::int AS overdue,
              -- Printed once per SO (first EC, or the bare SO row), so every SO
              -- counts once — including SOs with no EC yet.
              (SELECT sum(order_value_inr::numeric) FROM r)::text AS total_value,
              (SELECT jsonb_object_agg(k, n) FROM (
                 SELECT lower(TRIM(COALESCE(payment_status, ''))) AS k, count(*)::int AS n
                   FROM so GROUP BY 1) x) AS payment,
              (SELECT jsonb_object_agg(k, n) FROM (
                 SELECT lower(TRIM(COALESCE(dispatch_status, ''))) AS k, count(*)::int AS n
                   FROM so GROUP BY 1) x) AS dispatch`,
      params
    ),
    fetchPage(opts.page),
    listOrderListOptions(opts.filter),
  ]);

  const st = stats.rows[0];
  const soTotal = st?.so_total ?? 0;
  const totalPages = Math.max(1, Math.ceil(soTotal / PIPELINE_PAGE_SIZE));
  // A page past the end — a narrower filter, say — falls back to the last.
  const page = Math.min(Math.max(1, opts.page), totalPages);
  const rows = page === Math.max(1, opts.page) ? first.rows : (await fetchPage(page)).rows;

  return {
    ...pageResult(rows, soTotal, page, PIPELINE_PAGE_SIZE),
    stats: {
      soTotal,
      allSoTotal: st?.all_so_total ?? 0,
      ecTotal: st?.ec_total ?? 0,
      holds: st?.holds ?? 0,
      overdue: st?.overdue ?? 0,
      totalValue: Number(st?.total_value ?? 0),
      payment: st?.payment ?? {},
      dispatch: st?.dispatch ?? {},
    },
    options,
  };
}
