-- A local mirror of the SO portal's order book, so Reports can read it.
--
-- WHY A TABLE AND NOT A LIVE READ
--
-- `ec_to_dispatch` is a different database on the same server. The Opportunities
-- row and Client 360 reach it with a second connection pool and combine the two
-- answers in JavaScript, which is fine for one figure and one client. The report
-- engine cannot: it builds ONE SQL statement per card — scope, page filters,
-- cross-filter, top-N and the grouping all compiled together — against one
-- database. There is no join to another one in that sentence.
--
-- The alternatives were postgres_fdw, which means an extension and a foreign
-- server on production so every report query reaches across the network under
-- the reader's page load; or this: copy the order book in, on a schedule, and
-- let reports read it like any other table. 709 rows today, a few thousand a
-- year. The copy wins on every count except freshness, and freshness here is
-- measured in hours, not seconds — nobody builds a monthly report off an order
-- raised four minutes ago.
--
-- WHAT IS AND IS NOT COPIED
--
-- One row per sales order, with the figures a report would ask for: value,
-- dispatch status, what has been invoiced against it, how many pumps and
-- spares. NOT the item lines, the drawings, the packing slips or the invoices
-- themselves — those belong to that system, are read live where they are
-- actually needed (Client 360, the Won drawer), and mirroring them would make
-- this a second copy of somebody else's database rather than a reporting table.
--
-- `client_id` is resolved at sync time by matching `client_code` against
-- clients.code. It is what makes the reader's scope work: without it every
-- report on this table would be a company-wide total.

CREATE TABLE IF NOT EXISTS so_orders (
  -- The SO number is the key in both systems, has no duplicates in either, and
  -- is what a person reads off a document. No surrogate id.
  so_no            text PRIMARY KEY,

  client_code      text        NOT NULL,
  -- ON DELETE SET NULL, not CASCADE: deleting a client must not quietly delete
  -- the record that they have four orders open.
  client_id        integer     REFERENCES clients(id) ON DELETE SET NULL,

  so_date          date,
  po_date          date,

  -- Already in rupees whatever currency the order was taken in. The dispatch
  -- portal keeps the rupee figure in a different column from the foreign one,
  -- and getting that wrong is the single easiest way to misreport this book,
  -- so the conversion happens once, at sync, and never again.
  order_value_inr  numeric(16,2),
  order_currency   text,

  dispatch_status  text,
  -- Raised and not yet dispatched: not cancelled, not diverted, not fully
  -- dispatched. Stored rather than derived so a report cannot disagree with
  -- the Opportunities row about what "open" means.
  is_open          boolean     NOT NULL DEFAULT false,

  invoiced_inr     numeric(16,2) NOT NULL DEFAULT 0,
  last_invoice     date,

  pump_qty         integer,
  spare_qty        integer,
  item_lines       integer,
  -- 'Pump', 'Spare' or 'Mixed'. Every SO in the data today is one or the
  -- other; 'Mixed' exists so that stops being an assumption.
  product_mix      text,

  rep_name         text,
  market_type      text,
  client_type      text,
  zone             text,
  order_type       text,

  synced_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS so_orders_client_idx ON so_orders (client_id);
CREATE INDEX IF NOT EXISTS so_orders_date_idx   ON so_orders (so_date);
-- Partial: "what is open" is the question this table is most often asked, and
-- the open rows are a third of it.
CREATE INDEX IF NOT EXISTS so_orders_open_idx   ON so_orders (is_open) WHERE is_open;

COMMENT ON TABLE so_orders IS
  'Mirror of ec_to_dispatch.orders, refreshed by /api/cron/so-sync. Read-only to the app: every write comes from the sync.';
