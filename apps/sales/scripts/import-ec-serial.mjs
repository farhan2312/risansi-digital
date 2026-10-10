// Loads RIL pump detail from the EC/Serial ERP export into client_pumps.
// One row per unique pump serial (PUMP_SL_NO). Wipes existing pump rows first,
// so re-running is idempotent.
//
//   node scripts/import-ec-serial.mjs
//
// Source: design/EC_SERIAL_NUMBER_27_06_26.xlsx
// Columns: CUST, CUST_NAME, EC_NO, SO_NO, PUMP_SL_NO, PUMP_MODEL_AS_NAME_PLATE, LIQUID, CAPACITY, HEAD
// CUST is the ERP customer code; clients.code is its 4-2-4 reversal
// (e.g. A00101HOSH -> HOSH01A001).

import { readFileSync } from 'fs';
import path from 'node:path';
import * as XLSX from 'xlsx';
import pg from 'pg';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const FILE = path.join(ROOT, 'design', 'EC_SERIAL_NUMBER_27_06_26.xlsx');

const env = {};
for (const line of readFileSync(path.join(ROOT, '.env.local'), 'utf8').replace(/^﻿/, '').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
  if (m) env[m[1]] = m[2];
}

const norm = s => { const t = String(s ?? '').trim(); return t === '' ? null : t; };
const up   = s => { const t = norm(s); return t ? t.toUpperCase() : null; };
// Reverse the ERP customer code to the portal client code: [4][2][4] -> [4][2][4] swapped ends.
const reverseCode = s => {
  const c = up(s);
  if (!c) return null;
  const m = c.match(/^(.{4})(\d\d)(.{4})$/);
  return m ? m[3] + m[2] + m[1] : c;
};

const client = new pg.Client({
  host: env.DB_HOST, port: Number(env.DB_PORT) || 5432, database: env.RISANSI_DB_NAME,
  user: env.DB_USER, password: env.DB_PASSWORD, ssl: { rejectUnauthorized: false },
});

async function main() {
  await client.connect();

  const wb   = XLSX.read(readFileSync(FILE), { type: 'buffer' });
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' });
  const hdr  = rows[0].map(h => String(h).trim().toUpperCase());
  const col  = name => hdr.indexOf(name);
  const iCust = col('CUST'), iName = col('CUST_NAME'), iEc = col('EC_NO'), iSo = col('SO_NO'),
        iSl = col('PUMP_SL_NO'), iModel = col('PUMP_MODEL_AS_NAME_PLATE'),
        iLiq = col('LIQUID'), iCap = col('CAPACITY'), iHead = col('HEAD');
  if ([iCust, iSl, iModel].some(x => x < 0)) throw new Error('Unexpected header layout: ' + hdr.join(','));

  // clients.code -> id
  const cmap = new Map(
    (await client.query(`SELECT id, UPPER(code) AS code FROM clients WHERE deleted_at IS NULL`)).rows
      .map(r => [r.code, r.id]),
  );

  // Build + dedup by (client_id, serial); serial-less rows are all kept.
  const seen = new Map();
  let noSerial = 0;
  rows.slice(1).forEach((r, idx) => {
    const cust = up(r[iCust]);
    if (!cust && !norm(r[iName])) return;            // blank line
    const code = reverseCode(cust);
    const clientId = cmap.get(code) ?? null;
    const serial = norm(r[iSl]);
    const rec = {
      client_id: clientId,
      client_code: code,
      customer_code: cust,
      customer_name: norm(r[iName]),
      ec_number: norm(r[iEc]),
      so_number: norm(r[iSo]),
      pump_sl_no: serial,
      pump_model_plate: norm(r[iModel]),
      liquid: norm(r[iLiq]),
      capacity: norm(r[iCap]),
      head: norm(r[iHead]),
    };
    const key = serial ? `${clientId}|${serial}` : `__n${idx}`;
    if (!serial) noSerial++;
    seen.set(key, rec);                              // last wins on duplicate serial
  });
  const recs = [...seen.values()];
  const linked = recs.filter(r => r.client_id != null).length;

  console.log(`Parsed ${recs.length} pumps (${linked} linked to a client, ${recs.length - linked} unmatched, ${noSerial} serial-less).`);

  await client.query('BEGIN');
  await client.query('DELETE FROM client_pumps');

  const CHUNK = 500;
  const cols = ['client_id','client_code','customer_code','customer_name','ec_number','so_number',
                'pump_sl_no','pump_model_plate','liquid','capacity','head'];
  for (let i = 0; i < recs.length; i += CHUNK) {
    const slice = recs.slice(i, i + CHUNK);
    const params = [];
    const values = slice.map((r, j) => {
      const base = j * (cols.length);
      cols.forEach(c => params.push(r[c]));
      return `(${cols.map((_, k) => `$${base + k + 1}`).join(',')}, 1, 'import', NOW())`;
    });
    await client.query(
      `INSERT INTO client_pumps (${cols.join(',')}, quantity, source, created_at) VALUES ${values.join(',')}`,
      params,
    );
  }

  await client.query('COMMIT');
  const total = (await client.query('SELECT COUNT(*)::int n FROM client_pumps')).rows[0].n;
  console.log(`Imported. client_pumps now has ${total} rows.`);
}

main().catch(async e => { await client.query('ROLLBACK').catch(() => {}); console.error(e); process.exitCode = 1; })
  .finally(() => client.end());
