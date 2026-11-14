import 'server-only';
import risansiPool from '@/lib/db-risansi';
import { ecPool } from '@/lib/db-ec';

/**
 * Copying the SO portal's order book into `so_orders`, so Reports can read it.
 *
 * WHY THIS EXISTS AT ALL
 *
 * The report engine builds one SQL statement per card, against one database.
 * The order book lives in another. See migrations/0132_so_orders_mirror.sql
 * for the reasoning; this is the other half of it.
 *
 * HOW IT BEHAVES
 *
 *   Whole-book refresh.  709 rows. Working out what changed would cost more
 *                        than copying everything, and a diff that is subtly
 *                        wrong leaves a stale row nobody will ever notice.
 *   One transaction.     A report read halfway through a sync sees the book
 *                        as it was before it, never half of each.
 *   Deletes are real.    An SO that has gone from that system goes from here.
 *                        Rows are matched by SO number, so this is the only
 *                        way a withdrawn order ever leaves.
 *   Never partial.       If the dispatch portal fails mid-read, nothing is
 *                        written. A half-synced book reads as a collapse in
 *                        orders rather than as an error.
 */

export interface SyncResult {
  read: number;
  written: number;
  removed: number;
  /** SO rows whose client code matches no client here; counted, not dropped. */
  unmatched: number;
  ms: number;
}

/** Two SOs exist for testing; one holds a line of 234,324 pumps. */
const NOT_A_TEST = `COALESCE(o.so_no, '') NOT ILIKE '%TEST%'`;

const SO_INR = `CASE WHEN o.order_currency = 'INR' OR o.order_currency IS NULL
                     THEN o.order_value ELSE o.order_value_inr END`;

interface Row {
  so_no: string; client_code: string | null; so_date: string | null; po_date: string | null;
  inr: string | null; currency: string | null; status: string | null; is_open: boolean;
  invoiced: string | null; last_invoice: string | null;
  pump_qty: number | null; spare_qty: number | null; item_lines: number | null;
  product_mix: string | null; rep_name: string | null; market_type: string | null;
  client_type: string | null; zone: string | null; order_type: string | null;
}

export async function syncSalesOrders(): Promise<SyncResult> {
  const started = Date.now();

  // ── read, out there ──
  //
  // One statement. The invoice total and the item counts are lateral
  // aggregates rather than joins so a four-line SO cannot multiply its own
  // invoice value by four, which is the classic way a mirror like this ends up
  // reporting a book several times its real size.
  const { rows } = await ecPool().query<Row>(`
    SELECT COALESCE(NULLIF(BTRIM(o.so_no), ''), '(no SO number) ' || o.id::text) AS so_no,
           NULLIF(BTRIM(o.client_code), '')            AS client_code,
           o.so_date::text                             AS so_date,
           o.customer_po_date::text                    AS po_date,
           ${SO_INR}::text                             AS inr,
           o.order_currency                            AS currency,
           o.dispatch_status                           AS status,
           (COALESCE(o.dispatch_status, '')
              NOT IN ('Fully dispatch', 'Cancelled by client', 'Diverted')) AS is_open,
           COALESCE(inv.billed, 0)::text               AS invoiced,
           inv.last_invoice::text                      AS last_invoice,
           items.pump_qty, items.spare_qty, items.item_lines,
           CASE WHEN COALESCE(items.pump_lines, 0) > 0 AND COALESCE(items.spare_lines, 0) > 0 THEN 'Mixed'
                WHEN COALESCE(items.pump_lines, 0) > 0 THEN 'Pump'
                WHEN COALESCE(items.spare_lines, 0) > 0 THEN 'Spare'
                ELSE NULL END                          AS product_mix,
           NULLIF(BTRIM(o.reps), '')                   AS rep_name,
           o.market_type, o.client_type, o.zone, o.order_type
      FROM orders o
      LEFT JOIN LATERAL (
        SELECT SUM(i.invoice_value) AS billed, MAX(i.invoice_date) AS last_invoice
          FROM order_invoices i WHERE i.order_id = o.id
      ) inv ON TRUE
      LEFT JOIN LATERAL (
        SELECT COUNT(*)::int                                            AS item_lines,
               SUM(it.quantity) FILTER (WHERE it.item_type = 'Pump')    AS pump_qty,
               SUM(it.quantity) FILTER (WHERE it.item_type = 'Spare')   AS spare_qty,
               COUNT(*) FILTER (WHERE it.item_type = 'Pump')            AS pump_lines,
               COUNT(*) FILTER (WHERE it.item_type = 'Spare')           AS spare_lines
          FROM order_items it WHERE it.order_id = o.id
      ) items ON TRUE
     WHERE ${NOT_A_TEST}`);
  // Eleven orders carry no SO number at all. They are real orders — ten of
  // them are open — so they are keyed on the dispatch portal's own id under a
  // label that says what is missing, rather than dropped. Dropped, the report
  // table read 243 open against the Opportunities row's 253 and there was
  // nothing on either screen to explain the ten.

  // ── write, in here ──
  const client = await risansiPool.connect();
  let written = 0, removed = 0, unmatched = 0;
  try {
    await client.query('BEGIN');

    // client_code → client_id, resolved once. A code that matches nothing is
    // kept with a null client_id: the row still belongs in the book, it simply
    // cannot be scoped, and a report scoped by client will not show it. That
    // is the correct outcome and the count below is how anybody finds out.
    const { rows: codes } = await client.query<{ code: string; id: number }>(
      `SELECT UPPER(TRIM(code)) AS code, id FROM clients
        WHERE deleted_at IS NULL AND code IS NOT NULL AND code <> ''`);
    const byCode = new Map(codes.map(r => [r.code, r.id]));

    const keep: string[] = [];
    for (const r of rows) {
      const soNo = r.so_no.trim();
      const code = (r.client_code ?? '').toUpperCase();
      const clientId = byCode.get(code) ?? null;
      if (!clientId) unmatched++;
      keep.push(soNo);

      await client.query(
        `INSERT INTO so_orders (so_no, client_code, client_id, so_date, po_date,
            order_value_inr, order_currency, dispatch_status, is_open,
            invoiced_inr, last_invoice, pump_qty, spare_qty, item_lines, product_mix,
            rep_name, market_type, client_type, zone, order_type, synced_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20, now())
         ON CONFLICT (so_no) DO UPDATE SET
            client_code = EXCLUDED.client_code, client_id = EXCLUDED.client_id,
            so_date = EXCLUDED.so_date, po_date = EXCLUDED.po_date,
            order_value_inr = EXCLUDED.order_value_inr, order_currency = EXCLUDED.order_currency,
            dispatch_status = EXCLUDED.dispatch_status, is_open = EXCLUDED.is_open,
            invoiced_inr = EXCLUDED.invoiced_inr, last_invoice = EXCLUDED.last_invoice,
            pump_qty = EXCLUDED.pump_qty, spare_qty = EXCLUDED.spare_qty,
            item_lines = EXCLUDED.item_lines, product_mix = EXCLUDED.product_mix,
            rep_name = EXCLUDED.rep_name, market_type = EXCLUDED.market_type,
            client_type = EXCLUDED.client_type, zone = EXCLUDED.zone,
            order_type = EXCLUDED.order_type, synced_at = now()`,
        [soNo, r.client_code ?? '', clientId, r.so_date, r.po_date,
         r.inr, r.currency, r.status, r.is_open,
         r.invoiced ?? '0', r.last_invoice, r.pump_qty, r.spare_qty, r.item_lines, r.product_mix,
         r.rep_name, r.market_type, r.client_type, r.zone, r.order_type],
      );
      written++;
    }

    // Gone from there, gone from here. Skipped when the read came back empty:
    // that is far more likely to be a broken query than a company with no
    // orders, and emptying the table on it would be a silent catastrophe.
    if (keep.length) {
      const { rowCount } = await client.query(
        `DELETE FROM so_orders WHERE so_no <> ALL($1::text[])`, [keep]);
      removed = rowCount ?? 0;
    }

    await client.query('COMMIT');
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch { /* the connection goes back anyway */ }
    throw e;
  } finally {
    client.release();
  }

  return { read: rows.length, written, removed, unmatched, ms: Date.now() - started };
}

/** When the mirror was last refreshed, for anybody wondering how stale it is. */
export async function lastSoSync(): Promise<{ at: string; rows: number } | null> {
  const { rows } = await risansiPool.query<{ at: string; n: string }>(
    `SELECT MAX(synced_at)::text AS at, COUNT(*)::text AS n FROM so_orders`);
  if (!rows[0]?.at) return null;
  return { at: rows[0].at, rows: Number(rows[0].n) };
}
