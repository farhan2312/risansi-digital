#!/usr/bin/env node
// The dispatch portal still means what Order in Hand assumes it means.
//
// WHY THIS IS A SCRIPT AND NOT A BUILD GUARD
//
// It asks a database. `next build` has to run on a laptop and in CI without
// credentials, so nothing in the build chain may need them. Run this by hand
// after any change to the SO portal's schema, and whenever a figure on the
// Opportunities page looks wrong:
//
//   node scripts/ec-order-check.mjs
//
// WHAT IT IS PROTECTING
//
// lib/risansi-order-in-hand.ts reads four things out of another team's
// database: the currency rule that decides which value column to trust, the
// seven dispatch statuses, the test SOs, and the invoice date. None of them is
// ours to change and none of them is under our tests. If one moves, the
// figures do not break — they quietly become wrong, which is why this prints
// them too.
//
// READ ONLY. The connection refuses writes at the server.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import pg from 'pg';

const ROOT = path.resolve(
  path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');

const env = {};
for (const line of readFileSync(path.join(ROOT, '.env.local'), 'utf8')
       .replace(/^﻿/, '').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}

if (!env.EC_DB_NAME) {
  console.error('✗ EC_DB_NAME is not set in .env.local — nothing to check.');
  process.exit(1);
}

const client = new pg.Client({
  host: env.DB_HOST, port: Number(env.DB_PORT) || 5432, database: env.EC_DB_NAME,
  user: env.DB_USER, password: env.DB_PASSWORD,
  ssl: { rejectUnauthorized: env.DB_SSL_INSECURE !== '1' },
  options: '-c default_transaction_read_only=on',
});

let failed = 0;
const bad = (m) => { failed++; console.error(`  ✗ ${m}`); };
const ok  = (m) => console.log(`  ✓ ${m}`);

await client.connect();
const q = async (sql, vals = []) => (await client.query(sql, vals)).rows;

// 1. The columns are still there, and still the types we read them as.
const cols = Object.fromEntries((await q(
  `SELECT table_name || '.' || column_name AS k, data_type AS t
     FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name IN ('orders', 'order_invoices')`
)).map(r => [r.k, r.t]));

for (const [col, want] of Object.entries({
  'orders.order_value': 'numeric', 'orders.order_value_inr': 'numeric',
  'orders.order_currency': 'text', 'orders.dispatch_status': 'text',
  'orders.client_code': 'text', 'orders.so_no': 'text',
  'order_invoices.invoice_value': 'numeric', 'order_invoices.invoice_date': 'date',
  'order_invoices.order_id': 'uuid',
})) {
  if (!cols[col]) bad(`${col} no longer exists`);
  else if (cols[col] !== want) bad(`${col} is ${cols[col]}, was ${want}`);
}
if (!failed) ok('every column Order in Hand reads is still there, with the same type');

// 2. The currency rule. order_value_inr is populated ONLY for non-INR orders;
//    the moment that stops being true, summing it is no longer safe and the
//    CASE in risansi-order-in-hand.ts is reading the wrong column.
const [cur] = await q(`
  SELECT count(*) FILTER (WHERE (order_currency = 'INR' OR order_currency IS NULL)
                            AND order_value_inr IS NOT NULL)::int AS inr_rows_with_inr_column,
         count(*) FILTER (WHERE order_currency <> 'INR' AND order_value_inr IS NULL)::int AS fx_rows_without_it
    FROM orders`);
if (cur.inr_rows_with_inr_column > 0) {
  bad(`${cur.inr_rows_with_inr_column} rupee orders now carry order_value_inr — the currency rule has changed`);
} else if (cur.fx_rows_without_it > 0) {
  bad(`${cur.fx_rows_without_it} foreign-currency orders have no order_value_inr — their value cannot be read`);
} else {
  ok('the currency rule holds: order_value for rupees, order_value_inr for the rest');
}

// 3. The statuses. A new one appears as neither dispatched nor excluded, so it
//    silently joins Order in Hand — which may be right, but somebody should
//    decide rather than find out.
const KNOWN = ['Fully dispatch', 'Pending', 'Hold', 'Cancelled by client', 'Diverted', 'LOT dispatch'];
const seen = (await q(`SELECT DISTINCT dispatch_status AS s FROM orders WHERE dispatch_status IS NOT NULL`))
  .map(r => r.s);
const novel = seen.filter(s => !KNOWN.includes(s));
if (novel.length) bad(`dispatch_status has values nobody has ruled on: ${novel.join(', ')}`);
else ok(`dispatch_status still holds only the six known values`);

// 4. The figures themselves, company-wide, so a wrong number on the page can be
//    compared against its source in one command.
const SO_INR = `CASE WHEN o.order_currency = 'INR' OR o.order_currency IS NULL
                     THEN o.order_value ELSE o.order_value_inr END`;
const NOT_A_TEST = `COALESCE(o.so_no, '') NOT ILIKE '%TEST%'`;
const [oih] = await q(`
  SELECT COUNT(*)::int AS orders, round(COALESCE(SUM(${SO_INR}), 0) / 1e7, 2) AS cr
    FROM orders o
   WHERE COALESCE(o.dispatch_status, '') NOT IN ('Fully dispatch', 'Cancelled by client', 'Diverted')
     AND ${NOT_A_TEST}`);
const fyStart = (() => { const d = new Date(); const y = d.getFullYear() - (d.getMonth() < 3 ? 1 : 0); return `${y}-04-01`; })();
const [inv] = await q(`
  SELECT COUNT(*)::int AS invoices, round(COALESCE(SUM(i.invoice_value), 0) / 1e7, 2) AS cr
    FROM order_invoices i JOIN orders o ON o.id = i.order_id
   WHERE i.invoice_date >= $1 AND ${NOT_A_TEST}`, [fyStart]);

console.log(`\n  Order in Hand        ₹${oih.cr} Cr over ${oih.orders} SOs`);
console.log(`  Invoiced since ${fyStart}  ₹${inv.cr} Cr over ${inv.invoices} invoices`);
console.log('  (company-wide — the page shows only the accounts its reader may see)');

await client.end();

if (failed) {
  console.error(`\nec-order-check: ${failed} problem${failed === 1 ? '' : 's'}.`);
  console.error('Order in Hand on the Opportunities page is reading another system\'s');
  console.error('database. See lib/risansi-order-in-hand.ts.\n');
  process.exit(1);
}
console.log('\n✓ ec-order-check: the dispatch portal still means what Order in Hand assumes');
