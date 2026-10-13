import "server-only";
import { query } from "@/lib/db";
import { CHILD_PARENT_COLUMN } from "@/lib/orders";
import {
  CHILD_FIELDS,
  type ChildTable,
  type OrderField,
} from "@/lib/order-schema";
import type { AuditSubject } from "@/lib/audit";

// What an audit event says about the order it touched: which SO and EC, and
// for a save, which fields changed from what to what. Resolved here once so
// every action records it the same way, instead of each composing its own
// sentence — which is how most order edits ended up logged as just
// "Updated Order details".

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Row = Record<string, unknown>;

/** "SO26/1/1455 · EC/26/1/1455/40093", or just the SO. */
export function subjectLabel(s: AuditSubject | null | undefined): string | null {
  if (!s?.soNo) return null;
  return s.ecNo ? `${s.soNo} · ${s.ecNo}` : s.soNo;
}

export async function subjectForOrder(orderId: string): Promise<AuditSubject> {
  if (!UUID_RE.test(orderId)) return { orderId: null };
  const r = await query<{ so_no: string | null; sl_no: number }>(
    `SELECT so_no, sl_no::int AS sl_no FROM orders WHERE id = $1`,
    [orderId]
  );
  const row = r.rows[0];
  return { orderId, soNo: row ? (row.so_no ?? `#${row.sl_no}`) : null };
}

export async function subjectForItem(itemId: string): Promise<AuditSubject> {
  if (!UUID_RE.test(itemId)) return { itemId: null };
  const r = await query<{
    order_id: string;
    so_no: string | null;
    sl_no: number;
    ec_no: string | null;
  }>(
    `SELECT it.order_id, o.so_no, o.sl_no::int AS sl_no, it.ec_no
       FROM order_items it JOIN orders o ON o.id = it.order_id
      WHERE it.id = $1`,
    [itemId]
  );
  const row = r.rows[0];
  if (!row) return { itemId };
  return {
    orderId: row.order_id,
    itemId,
    soNo: row.so_no ?? `#${row.sl_no}`,
    ecNo: row.ec_no,
  };
}

type SubjectRow = {
  order_id: string;
  item_id: string | null;
  so_no: string | null;
  sl_no: number;
  ec_no: string | null;
};

function toSubject(row: SubjectRow | undefined): AuditSubject {
  if (!row) return {};
  return {
    orderId: row.order_id,
    itemId: row.item_id,
    soNo: row.so_no ?? `#${row.sl_no}`,
    ecNo: row.ec_no,
  };
}

/**
 * A list row's SO and, for the per-EC lists, its EC — in one query, since a
 * save already waits on several round trips to a remote database.
 */
export async function subjectForChild(
  table: ChildTable,
  id: string
): Promise<AuditSubject> {
  if (!UUID_RE.test(id)) return {};
  if (CHILD_PARENT_COLUMN[table] === "item_id") {
    const r = await query<SubjectRow>(
      `SELECT it.order_id, t.item_id, o.so_no, o.sl_no::int AS sl_no, it.ec_no
         FROM ${table} t
         JOIN order_items it ON it.id = t.item_id
         JOIN orders o ON o.id = it.order_id
        WHERE t.id = $1`,
      [id]
    );
    return toSubject(r.rows[0]);
  }
  // SO-level lists. An invoice raised against a packing slip also names its
  // EC, which is worth recording even though the row hangs off the SO.
  const ec =
    table === "order_invoices"
      ? "t.item_id, t.ec_no"
      : "NULL::uuid AS item_id, NULL::text AS ec_no";
  const r = await query<SubjectRow>(
    `SELECT t.order_id, ${ec}, o.so_no, o.sl_no::int AS sl_no
       FROM ${table} t JOIN orders o ON o.id = t.order_id
      WHERE t.id = $1`,
    [id]
  );
  return toSubject(r.rows[0]);
}

/** A Quality document's EC and file name, read before it is deleted. */
export async function qcDocumentSubject(
  table: "order_qc_documents" | "order_qc_requirement_documents",
  id: string
): Promise<{ subject: AuditSubject; fileName: string | null }> {
  if (!UUID_RE.test(id)) return { subject: {}, fileName: null };
  const r = await query<SubjectRow & { file_name: string | null }>(
    `SELECT it.order_id, d.item_id, o.so_no, o.sl_no::int AS sl_no, it.ec_no,
            d.file_name
       FROM ${table} d
       JOIN order_items it ON it.id = d.item_id
       JOIN orders o ON o.id = it.order_id
      WHERE d.id = $1`,
    [id]
  );
  const row = r.rows[0];
  return { subject: toSubject(row), fileName: row?.file_name ?? null };
}

/**
 * A list row's own field values — only the schema's columns, never `*`, so an
 * invoice's LR file bytes are not dragged along to write one audit line.
 */
export async function childValues(table: ChildTable, id: string): Promise<Row | null> {
  if (!UUID_RE.test(id)) return null;
  // Just the columns the schema declares. This also asked for "seq", which
  // order_boi_items and order_lots do not have — so reading the row threw and
  // every save of a bought-out item or a lot failed before it wrote anything.
  const cols = [...new Set(CHILD_FIELDS[table].map((f) => f.column))];
  const r = await query<Row>(
    `SELECT ${cols.map((c) => `"${c}"`).join(", ")} FROM ${table} WHERE id = $1`,
    [id]
  );
  return r.rows[0] ?? null;
}

/** How each list names one of its rows in a sentence. */
const CHILD_NOUN: Record<ChildTable, { noun: string; key: string }> = {
  order_billing_docs: { noun: "PI", key: "pi_no" },
  order_invoices: { noun: "Invoice", key: "invoice_no" },
  order_boi_items: { noun: "Bought-out item", key: "boi_item" },
  order_drawing_revisions: { noun: "Drawing revision", key: "revision_no" },
  order_packing_slips: { noun: "Packing slip", key: "packing_slip_no" },
  order_lots: { noun: "Lot", key: "lot_no" },
  order_ready_lots: { noun: "Readiness lot", key: "status" },
  // "Payment term Advance Against ABG" reads better in an audit line than the
  // percentage would.
  order_payment_terms: { noun: "Payment term", key: "term" },
};

/** "PI 0042", "Bought-out item Motor", or just "PI" while it has no number. */
export function childLabel(table: ChildTable, row: Row | null): string {
  const { noun, key } = CHILD_NOUN[table];
  const value = row?.[key];
  return value != null && String(value).trim() ? `${noun} ${String(value).trim()}` : noun;
}

function display(field: OrderField, value: unknown): string {
  if (value == null || String(value).trim() === "") return "—";
  if (field.type === "date") {
    const d = new Date(String(value));
    if (!Number.isNaN(d.getTime())) {
      return d.toLocaleDateString("en-GB", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        timeZone: "UTC",
      }).replace(/\//g, "-");
    }
  }
  const text = String(value).replace(/\s+/g, " ").trim();
  return text.length > 60 ? `${text.slice(0, 57)}…` : text;
}

/** Compare as the form would show them, so 5 and "5.00" are not a change. */
function same(field: OrderField, a: unknown, b: unknown): boolean {
  if (field.type === "number" || field.type === "int") {
    const x = a == null || a === "" ? null : Number(a);
    const y = b == null || b === "" ? null : Number(b);
    return x === y || (Number.isNaN(x) && Number.isNaN(y));
  }
  return display(field, a) === display(field, b);
}

/** Past this many, the line names the rest by count rather than listing them. */
const MAX_LISTED = 8;

/**
 * "Planning Status: In plan → Assembled; Assembly Date: — → 12-09-2026".
 * Null when nothing changed — a Save that altered no field.
 */
export function describeChanges(
  fields: OrderField[],
  before: Row | null,
  after: Row | null
): string | null {
  const changes: string[] = [];
  for (const f of fields) {
    if (f.computed) continue;
    const a = before?.[f.column];
    const b = after?.[f.column];
    if (same(f, a, b)) continue;
    changes.push(`${f.label}: ${display(f, a)} → ${display(f, b)}`);
  }
  if (changes.length === 0) return null;
  const shown = changes.slice(0, MAX_LISTED).join("; ");
  const more = changes.length - MAX_LISTED;
  return more > 0 ? `${shown}; +${more} more` : shown;
}
