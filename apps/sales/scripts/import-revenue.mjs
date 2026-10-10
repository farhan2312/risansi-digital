// Import real 5-year revenue from the Excel into client_revenue_monthly.
//   node scripts/import-revenue.mjs            → DRY RUN (reports only, no changes)
//   node scripts/import-revenue.mjs --apply    → delete temp data + import for real
//
// Excel (Sheet1, header row ~3): CUSTOMER CODE | Financial Year | INV NO |
// INV DATE | MONTH | ITEM | BASE VALUE  (invoice-line level).
// DB target: client_revenue_monthly(client_id, month, pump_value, spare_value,
// total_value) aggregated per client per calendar month. UNIQUE(client_id,month).

import { readFileSync } from 'node:fs';
import pg from 'pg';
import XLSX from 'xlsx';

const APPLY = process.argv.includes('--apply');
const XLSX_PATH = 'C:/Users/Cosmos/Downloads/Revenue of last 5 years.xlsx';

const env = {};
for (const l of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').replace(/^﻿/, '').split(/\r?\n/)) {
  const m = l.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
  if (m) env[m[1]] = m[2];
}
const client = new pg.Client({
  host: env.DB_HOST, port: Number(env.DB_PORT) || 5432, database: env.RISANSI_DB_NAME,
  user: env.DB_USER, password: env.DB_PASSWORD, ssl: { rejectUnauthorized: false },
});

const monthKey = d => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`;

async function main() {
  await client.connect();

  // ── Read Excel ──
  const wb = XLSX.readFile(XLSX_PATH, { cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const all = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true });
  const h = all.findIndex(r => (r[0] + '').toUpperCase().includes('CUSTOMER'));
  const data = all.slice(h + 1).filter(r => r[0]);

  // ── Code → client_id map ──
  const { rows: cl } = await client.query('SELECT id, code FROM clients');
  const codeMap = new Map(cl.map(r => [(r.code || '').trim().toUpperCase(), r.id]));

  // ── Aggregate ──
  const agg = new Map();           // client_id|month -> {pump,spare,total}
  const items = {}, fys = {};
  let skipCode = 0, skipDate = 0, used = 0, sumAll = 0;
  const unmatched = new Set();
  for (const r of data) {
    const code = (r[0] + '').trim().toUpperCase();
    const item = (r[5] + '').trim();
    const val = Number(r[6]) || 0;
    const d = r[3];
    items[item || '(blank)'] = (items[item || '(blank)'] || 0) + 1;
    fys[r[1]] = (fys[r[1]] || 0) + 1;
    const cid = codeMap.get(code);
    if (!cid) { skipCode++; unmatched.add(code); continue; }
    if (!(d instanceof Date) || isNaN(d)) { skipDate++; continue; }
    const key = `${cid}|${monthKey(d)}`;
    const cur = agg.get(key) || { pump: 0, spare: 0, total: 0 };
    if (/pump/i.test(item)) cur.pump += val;
    if (/spare/i.test(item)) cur.spare += val;
    cur.total += val;                       // total = every line, incl. non-pump/spare
    agg.set(key, cur);
    used++; sumAll += val;
  }

  // ── Report ──
  const months = [...new Set([...agg.keys()].map(k => k.split('|')[1]))].sort();
  console.log('=== DRY RUN REPORT ===');
  console.log('excel data rows      :', data.length);
  console.log('distinct ITEM        :', JSON.stringify(items));
  console.log('distinct Financial Yr:', JSON.stringify(fys));
  console.log('rows used            :', used, '| skipped (no client code):', skipCode, '| skipped (bad date):', skipDate);
  console.log('unmatched codes      :', unmatched.size, '→', JSON.stringify([...unmatched].slice(0, 12)));
  console.log('aggregated rows      :', agg.size, '(client × month)');
  console.log('month span           :', months[0], '→', months[months.length - 1], `(${months.length} months)`);
  console.log('total value imported :', Math.round(sumAll), `= ₹${(sumAll / 1e7).toFixed(2)} Cr`);
  // scale sanity vs existing data
  const { rows: smp } = await client.query('SELECT pump_value, spare_value, total_value FROM client_revenue_monthly ORDER BY total_value DESC LIMIT 1');
  console.log('existing top crm row :', JSON.stringify(smp[0] || {}), '(confirms INR scale)');

  if (!APPLY) {
    console.log('\nDRY RUN only — no changes. Re-run with --apply to delete temp data and import.');
    return;
  }

  // ── Apply: wipe temp data + insert aggregates, in one transaction ──
  await client.query('BEGIN');
  try {
    const del = await client.query('DELETE FROM client_revenue_monthly');
    console.log(`\ndeleted ${del.rowCount} temp rows`);
    let n = 0;
    const entries = [...agg.entries()];
    const CHUNK = 500;
    for (let i = 0; i < entries.length; i += CHUNK) {
      const slice = entries.slice(i, i + CHUNK);
      const vals = [], ph = [];
      slice.forEach(([key, v], j) => {
        const [cid, month] = key.split('|');
        const b = j * 6;
        ph.push(`($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},NOW())`);
        vals.push(Number(cid), month, v.pump, v.spare, v.total, 'import:revenue-5yr');
      });
      await client.query(
        `INSERT INTO client_revenue_monthly (client_id, month, pump_value, spare_value, total_value, entered_by, entered_at)
         VALUES ${ph.join(',')}`, vals);
      n += slice.length;
    }
    await client.query('COMMIT');
    console.log(`inserted ${n} aggregated rows`);
    const { rows: chk } = await client.query(`SELECT to_char(month,'YYYY-MM') ym, COUNT(*)::int c, ROUND(SUM(total_value)/1e7,2) cr FROM client_revenue_monthly GROUP BY 1 ORDER BY 1`);
    console.log('post-import by month:'); chk.forEach(r => console.log('  ', r.ym, '|', r.c, 'rows |', r.cr, 'Cr'));
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('FAILED, rolled back:', e.message);
    process.exitCode = 1;
  }
}
main().finally(() => client.end());
