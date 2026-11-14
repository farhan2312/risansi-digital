import 'server-only';
import risansiPool from '@/lib/db-risansi';
import { ecPool } from '@/lib/db-ec';

/**
 * Order in Hand, and what the SO portal has invoiced.
 *
 * Both come from `ec_to_dispatch`, the SO-to-dispatch portal, which is the only
 * system that knows what has actually shipped. The sales portal's own `orders`
 * table is the monthly Excel import and stops on 30 June 2026.
 *
 * HOW A FIGURE CROSSES THE TWO DATABASES
 *
 * They cannot be joined (see lib/db-ec.ts), so the question is asked in two
 * halves: which client codes may this reader count, answered here against
 * `clients`; and what do those codes add up to, answered there. The reader's
 * scope and the page's filters are therefore applied in `risansi` — the
 * dispatch portal is never asked anything about who may see what, and could
 * not answer if it were.
 *
 * ONE CONSEQUENCE WORTH KNOWING
 *
 * An SO whose client code is not in `clients` is counted by nobody. There is
 * exactly one such code today (BANG01V125, one order). That is the right
 * behaviour — these figures are "orders against accounts I can see" — but it
 * means the company-wide total here can sit a little under the dispatch
 * portal's own.
 */

/**
 * The value of an SO in rupees, whatever currency it was taken in.
 *
 * `order_value_inr` is populated on 20 rows out of 709 — only the orders taken
 * in USD. For the 675 INR orders the figure is in `order_value`. So
 * `sum(order_value_inr)` reads ₹1.46 Cr and looks like a rounding error, and
 * `sum(order_value)` adds rupees to dollars. This is the only correct form,
 * and it is written once.
 */
const SO_INR = `CASE WHEN o.order_currency = 'INR' OR o.order_currency IS NULL
                     THEN o.order_value ELSE o.order_value_inr END`;

/**
 * Two SOs exist for testing (SO26/1/TEST and SO26/1/TEST-SPARE, both against
 * "CAMEROON COTTON COMPANY"). They carry no value, so they move no rupees, but
 * one of them holds a line of 234,324 pumps against a real book of 797. The
 * dispatch portal's own dashboards exclude them and so does this.
 */
const NOT_A_TEST = `COALESCE(o.so_no, '') NOT ILIKE '%TEST%'`;

/**
 * An order that has not been dispatched.
 *
 * Cancelled and Diverted are not ours to deliver. Hold is: it is an order we
 * owe, whatever is blocking it — 87 SOs and ₹1.73 Cr of the total. Eleven SOs
 * carry no `dispatch_status` at all and are counted as in hand, because an SO
 * nobody has marked dispatched has not been dispatched.
 */
const NOT_DISPATCHED =
  `COALESCE(o.dispatch_status, '') NOT IN ('Fully dispatch', 'Cancelled by client', 'Diverted')`;

export interface DispatchFigures {
  /** SO value raised and not yet dispatched, in crores. */
  orderInHandCr: number;
  openOrders: number;
  /** Invoices raised in the SO portal inside the window, in crores. */
  invoicedCr: number;
  invoices: number;
  /** How many client codes the figures were computed over, for the tooltip. */
  codes: number;
}

/**
 * Both figures, for the accounts this reader may see after the page's filters.
 *
 * `clientClause` and `clientVals` are the page's own `revFilterClause` /
 * `revVals` — the client-level filter the Revenue block already uses, so the
 * three blocks on that row cannot drift apart. The opportunity-level filters
 * (stage, quote date, enquiry date) are deliberately not applied: an SO has no
 * stage and was never quoted on this board.
 *
 * Throws rather than returning zero if either database refuses. "The dispatch
 * portal did not answer" and "there are no open orders" are different facts,
 * and the caller renders them differently.
 */
export async function dispatchFigures(
  clientClause: string,
  clientVals: readonly unknown[],
  fyStart: string,
  fyEnd: string,
): Promise<DispatchFigures> {
  // Half one: who may be counted. UPPER/TRIM on both sides because the two
  // systems were populated by different people at different times.
  const { rows: codeRows } = await risansiPool.query<{ code: string }>(
    `SELECT DISTINCT UPPER(TRIM(c.code)) AS code
       FROM clients c
      WHERE c.deleted_at IS NULL
        AND c.code IS NOT NULL AND c.code <> ''${clientClause}`,
    clientVals as unknown[],
  );
  const codes = codeRows.map(r => r.code);

  // A reader who can see no coded account at all is a real answer of zero, and
  // is worth not crossing the network for.
  if (!codes.length) {
    return { orderInHandCr: 0, openOrders: 0, invoicedCr: 0, invoices: 0, codes: 0 };
  }

  // Half two: what they add up to. Two questions, one wave.
  const ec = ecPool();
  const [oih, inv] = await Promise.all([
    ec.query<{ inr: string; orders: number }>(
      `SELECT COALESCE(SUM(${SO_INR}), 0)::text AS inr, COUNT(*)::int AS orders
         FROM orders o
        WHERE ${NOT_DISPATCHED}
          AND ${NOT_A_TEST}
          AND UPPER(TRIM(o.client_code)) = ANY($1::text[])`,
      [codes],
    ),
    // Invoices against an order later cancelled or diverted still count: the
    // money was billed, whatever happened to the order afterwards. The 74
    // invoice rows carrying no date are dropped by the window, which is right.
    ec.query<{ inr: string; invoices: number }>(
      `SELECT COALESCE(SUM(i.invoice_value), 0)::text AS inr, COUNT(*)::int AS invoices
         FROM order_invoices i
         JOIN orders o ON o.id = i.order_id
        WHERE i.invoice_date >= $2 AND i.invoice_date < $3
          AND ${NOT_A_TEST}
          AND UPPER(TRIM(o.client_code)) = ANY($1::text[])`,
      [codes, fyStart, fyEnd],
    ),
  ]);

  const cr = (s: string | undefined) => Number(s ?? 0) / 10_000_000;
  return {
    orderInHandCr: cr(oih.rows[0]?.inr),
    openOrders:    oih.rows[0]?.orders ?? 0,
    invoicedCr:    cr(inv.rows[0]?.inr),
    invoices:      inv.rows[0]?.invoices ?? 0,
    codes:         codes.length,
  };
}

/**
 * The month the SO portal's invoices really begin.
 *
 * Shown under the Invoiced block. Before September 2026 that system was
 * carrying a handful of invoices while the monthly upload carried everything,
 * so a reader comparing the two needs to be told rather than left to work it
 * out from a gap of ₹13 Cr. Read live rather than hard-coded, so it stops
 * being mentioned once the history is filled in.
 */
export async function firstBusyInvoiceMonth(): Promise<string | null> {
  const { rows } = await ecPool().query<{ month: string }>(
    `SELECT to_char(date_trunc('month', invoice_date), 'Mon YYYY') AS month
       FROM order_invoices
      WHERE invoice_date IS NOT NULL
      GROUP BY 1, date_trunc('month', invoice_date)
     HAVING COUNT(*) >= 20
      ORDER BY date_trunc('month', invoice_date)
      LIMIT 1`,
  );
  return rows[0]?.month ?? null;
}
