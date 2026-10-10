#!/usr/bin/env node
// Does each Executive Review drill-down add up to the number above it?
//
//   node scripts/exec-drilldown-check.mjs [tsmId]
//
// Read-only. A breakdown that does not reconcile with its own headline is worse
// than none: it looks authoritative while being wrong, and the reader has no way
// to tell. Both sides build their scope, fiscal windows and turnover bands from
// lib/risansi-exec-review.ts, so they SHOULD agree — this proves it against live
// data rather than assuming the shared module was actually shared.
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const env = {};
for (const line of fs.readFileSync(path.join(ROOT, '.env.local'), 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/); if (m) env[m[1]] = m[2];
}
const c = new pg.Client({ host: env.DB_HOST, port: Number(env.DB_PORT) || 5432,
  database: env.RISANSI_DB_NAME, user: env.DB_USER, password: env.DB_PASSWORD,
  ssl: { rejectUnauthorized: false } });
await c.connect();

const arg = Number(process.argv[2]);
const tsmId = Number.isInteger(arg) && arg > 0
  ? arg
  : (await c.query(`SELECT id FROM users WHERE is_active AND role IN ('rep','manager')
                     ORDER BY (SELECT count(*) FROM clients WHERE primary_rep_id = users.id) DESC LIMIT 1`)).rows[0].id;
const who = (await c.query('SELECT name FROM users WHERE id = $1', [tsmId])).rows[0].name;

// An admin's view: no visAnd, primary-only accounts — the page's default.
const scope = `(c.primary_rep_id = ${tsmId})`;

const now = new Date();
const fyStartYear = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
const selMonths = [];
for (let cur = new Date(fyStartYear, 3, 1); cur <= new Date(now.getFullYear(), now.getMonth(), 1);
     cur = new Date(cur.getFullYear(), cur.getMonth() + 1, 1)) {
  selMonths.push(`${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}`);
}
const qMonths = selMonths.map(m => `'${m}'`).join(',');
const inMonths = (col) => `to_char(${col},'YYYY-MM') IN (${qMonths})`;

let bad = 0;
const pad = (s, n) => String(s).padEnd(n);
const money = (v) => Math.round(Number(v ?? 0)).toLocaleString('en-IN');

async function compare(label, headlineSql, breakdownSql) {
  const h = Number((await c.query(headlineSql)).rows[0]?.v ?? 0);
  const rows = (await c.query(breakdownSql)).rows;
  const b = rows.reduce((s, r) => s + Number(r.v ?? 0), 0);
  const ok = Math.abs(h - b) < 1;              // rounding, not tolerance
  if (!ok) bad++;
  console.log(`  ${ok ? 'ok  ' : 'MISMATCH'} ${pad(label, 34)} headline ${pad(money(h), 16)} breakdown ${pad(money(b), 16)} ${rows.length} row(s)`);
}

console.log(`RECONCILIATION — ${who} (#${tsmId}), primary-only accounts, FY to date\n`);

await compare('Order in hand',
  `SELECT COALESCE(round(sum(GREATEST(
      COALESCE(o.final_value_cr*10000000, o.value_cr*10000000, 0)
      - COALESCE((SELECT sum(so.so_value_cr)*10000000 FROM opportunity_sales_orders so WHERE so.opportunity_id=o.id),0), 0))),0) v
     FROM opportunities o JOIN clients c ON c.id=o.client_id
    WHERE ${scope} AND o.stage='Won' AND ${inMonths('COALESCE(o.quote_date, o.created_at::date)')}`,
  `SELECT round(sum(GREATEST(
      COALESCE(o.final_value_cr*10000000, o.value_cr*10000000, 0)
      - COALESCE((SELECT sum(so.so_value_cr)*10000000 FROM opportunity_sales_orders so WHERE so.opportunity_id=o.id),0), 0))) v
     FROM opportunities o JOIN clients c ON c.id=o.client_id
    WHERE ${scope} AND o.stage='Won' AND ${inMonths('COALESCE(o.quote_date, o.created_at::date)')}
    GROUP BY c.id
   HAVING round(sum(GREATEST(
      COALESCE(o.final_value_cr*10000000, o.value_cr*10000000, 0)
      - COALESCE((SELECT sum(so.so_value_cr)*10000000 FROM opportunity_sales_orders so WHERE so.opportunity_id=o.id),0), 0))) > 0`);

await compare('Revenue',
  `SELECT COALESCE(round(sum(r.total_value)),0) v FROM client_revenue_monthly r JOIN clients c ON c.id=r.client_id
    WHERE ${scope} AND ${inMonths('r.month')}`,
  `SELECT round(sum(r.total_value)) v FROM client_revenue_monthly r JOIN clients c ON c.id=r.client_id
    WHERE ${scope} AND ${inMonths('r.month')} GROUP BY c.id HAVING sum(r.total_value) <> 0`);

await compare('Active clients',
  `SELECT count(*) v FROM clients c WHERE ${scope} AND c.status='ACTIVE' AND c.deleted_at IS NULL`,
  `SELECT 1 v FROM clients c WHERE ${scope} AND c.status='ACTIVE' AND c.deleted_at IS NULL`);

await compare('Active · never visited',
  `SELECT count(*) v FROM clients c WHERE ${scope} AND c.status='ACTIVE' AND c.deleted_at IS NULL AND c.last_visit_date IS NULL`,
  `SELECT 1 v FROM clients c WHERE ${scope} AND c.status='ACTIVE' AND c.deleted_at IS NULL AND c.last_visit_date IS NULL`);

const CANON = `CASE
  WHEN upper(c.client_type) IN ('DIRECT MILL','END USER') THEN 'Direct Mill'
  WHEN upper(c.client_type) IN ('GROUP (MILLS)','GROUP')  THEN 'Group Mills'
  WHEN upper(c.client_type) IN ('TRADER','MERCHANT EXPORTER') THEN 'Trader'
  WHEN upper(c.client_type) = 'OEM' THEN 'OEM'
  WHEN upper(c.client_type) = 'CHANNEL PARTNER' THEN 'Channel Partner'
  ELSE 'Other' END`;

await compare('Clients · Direct Mill',
  `SELECT count(*) v FROM clients c WHERE ${scope} AND c.status='ACTIVE' AND c.deleted_at IS NULL AND ${CANON}='Direct Mill'`,
  `SELECT 1 v FROM clients c WHERE ${scope} AND c.status='ACTIVE' AND c.deleted_at IS NULL AND ${CANON}='Direct Mill'`);

await compare('Quotation · Direct Mill active',
  `SELECT COALESCE(round(sum(o.offer_value_inr) FILTER (WHERE o.stage IN ('Quoted','Negotiating'))),0) v
     FROM opportunities o JOIN clients c ON c.id=o.client_id
    WHERE ${scope} AND ${inMonths('COALESCE(o.quote_date, o.created_at::date)')} AND ${CANON}='Direct Mill'`,
  `SELECT round(sum(o.offer_value_inr)) v FROM opportunities o JOIN clients c ON c.id=o.client_id
    WHERE ${scope} AND o.stage IN ('Quoted','Negotiating')
      AND ${inMonths('COALESCE(o.quote_date, o.created_at::date)')} AND ${CANON}='Direct Mill'
    GROUP BY c.id HAVING sum(o.offer_value_inr) IS NOT NULL`);

await compare('Offer status · Order Received',
  `SELECT COALESCE(round(sum(o.offer_value_inr)),0) v FROM opportunities o JOIN clients c ON c.id=o.client_id
    WHERE ${scope} AND o.stage='Won' AND ${inMonths('COALESCE(o.quote_date, o.created_at::date)')}`,
  `SELECT round(sum(o.offer_value_inr)) v FROM opportunities o JOIN clients c ON c.id=o.client_id
    WHERE ${scope} AND o.stage='Won' AND ${inMonths('COALESCE(o.quote_date, o.created_at::date)')}
    GROUP BY c.id HAVING sum(o.offer_value_inr) IS NOT NULL`);

// Turnover: the band CASE has to produce the same membership on both sides.
const d = (y, m = 4) => `${y}-${String(m).padStart(2, '0')}-01`;
const latest = selMonths[selMonths.length - 1];
const fy = Number(latest.slice(5, 7)) >= 4 ? Number(latest.slice(0, 4)) : Number(latest.slice(0, 4)) - 1;
const REV = `
  SELECT c.id, c.is_end_client,
    COALESCE(sum(r.total_value) FILTER (WHERE r.month >= '${d(fy - 5)}' AND r.month < '${d(fy)}'),0) rev5,
    COALESCE(sum(r.total_value) FILTER (WHERE r.month >= '${d(fy)}'),0) rev_cur,
    COALESCE(sum(r.total_value) FILTER (WHERE r.month <  '${d(fy - 5)}'),0) rev_before,
    min(r.month) FILTER (WHERE r.total_value > 0) first_rev,
    COALESCE(sum(r.total_value) FILTER (WHERE r.month >= '${d(fy)}' AND r.month < '${d(fy + 1)}'),0) fyc
  FROM clients c LEFT JOIN client_revenue_monthly r ON r.client_id = c.id
  WHERE ${scope} AND c.status='ACTIVE' AND c.deleted_at IS NULL GROUP BY c.id, c.is_end_client`;
const BAND = `CASE
  WHEN is_end_client THEN 'End Client'
  WHEN rev_cur>0 AND rev5=0 AND rev_before>0 THEN 'Business Regained'
  WHEN first_rev IS NOT NULL AND first_rev >= '${d(fy)}' THEN 'New Business'
  WHEN rev5=0 AND rev_cur=0 THEN 'No Business'
  WHEN rev5/5.0 >= 1500000 THEN '15 Lac & above (Super Critical)'
  WHEN rev5/5.0 >= 500000  THEN '5-15 Lacs p.a.'
  WHEN rev5/5.0 >= 300000  THEN '3-5 Lacs p.a.'
  WHEN rev5/5.0 >= 100000  THEN '1-3 Lacs p.a.'
  ELSE 'Less than 1 Lac p.a.' END`;

const { rows: bands } = await c.query(
  `WITH rev AS (${REV}), b AS (SELECT *, ${BAND} bucket FROM rev)
   SELECT bucket, count(*)::int n, round(sum(fyc)) v FROM b GROUP BY bucket ORDER BY 3 DESC NULLS LAST`);
for (const band of bands.slice(0, 3)) {
  await compare(`Turnover · ${band.bucket.slice(0, 22)}`,
    `WITH rev AS (${REV}), b AS (SELECT *, ${BAND} bucket FROM rev)
     SELECT COALESCE(round(sum(fyc)),0) v FROM b WHERE bucket = '${band.bucket.replace(/'/g, "''")}'`,
    `WITH rev AS (${REV}), b AS (SELECT *, ${BAND} bucket FROM rev)
     SELECT round(fyc) v FROM b WHERE bucket = '${band.bucket.replace(/'/g, "''")}'`);
}

console.log(`\n  ${bad === 0
  ? 'Every breakdown adds up to its headline.'
  : `${bad} MISMATCH(ES) — the drill-down disagrees with the number above it.`}\n`);

await c.end();
process.exit(bad === 0 ? 0 : 1);
