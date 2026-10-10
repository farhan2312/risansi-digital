// Import the PCP installed-base from design/competitor.xlsx into
// competitor_installed_base (feeds the Competition tab).
//   node scripts/import-competitor.mjs            → DRY RUN (report only)
//   node scripts/import-competitor.mjs --apply    → replace cib with sheet data
//
// RIL = Risansi (us); every other *_pcp column is a competitor. Rows are matched
// to clients by normalized name; unmatched rows are still imported (client_code
// NULL) so the market totals are complete — they just don't appear in the
// client-joined displacement/industry views.

import { readFileSync } from 'node:fs';
import pg from 'pg';
import XLSX from 'xlsx';

const APPLY = process.argv.includes('--apply');
const env = {};
for (const l of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').replace(/^﻿/, '').split(/\r?\n/)) {
  const m = l.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/); if (m) env[m[1]] = m[2];
}
const client = new pg.Client({ host: env.DB_HOST, port: +env.DB_PORT || 5432, database: env.RISANSI_DB_NAME, user: env.DB_USER, password: env.DB_PASSWORD, ssl: { rejectUnauthorized: false } });

// cib column → Excel column index (from the verified header on row 3)
const MAP = {
  ril_supplied_pcp: 6, ril_supplied_mmp: 7, ril_pcp: 8, ril_mmp: 9,
  roto_pcp: 10, rotomac_pcp: 11, gita_pcp: 12, gita_mmp: 13, sintech_mmp: 14,
  psp_pcp: 15, psp_mmp: 16, syno_pcp: 17, syno_mmp: 18, ropman_pcp: 19, ropman_mmp: 20,
  myto_pcp: 21, vikas_pcp: 22, vikas_mmp: 23, newpumps_pcp: 24, indopump_pcp: 25, indopump_mmp: 26,
  tushaco_pcp: 27, yaswant_pcp: 28, shivam_pcp: 30, saksham_pcp: 32, alpha_pcp: 33,
  gajanan_pcp: 34, chandra_helicon_pcp: 35, netzsch_pcp: 36, akanshi_pcp: 37, pragati_pcp: 39,
  others_pcp: 40, ropar_pcp: 43, rotor_flow_pcp: 44, naishit_pcp: 46, delta_pcp: 47,
  varun_pcp: 48, npi_pcp: 51, hydroprocav_pcp: 52, sre_pcp: 53, span_engg_pcp: 54,
  pandey_pcp: 56, mahalaxmi_pcp: 58, total_pcp: 63,
};
const norm = s => String(s ?? '').toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
const num = v => { const n = Number(v); return Number.isFinite(n) ? Math.round(n) : 0; };

await client.connect();
try {
  // Restrict the map to columns that actually exist on the table.
  const { rows: colRows } = await client.query("SELECT column_name FROM information_schema.columns WHERE table_name='competitor_installed_base'");
  const cibCols = new Set(colRows.map(r => r.column_name));
  const cols = Object.keys(MAP).filter(c => cibCols.has(c));

  const wb = XLSX.readFile(new URL('../design/competitor.xlsx', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
  const rows = XLSX.utils.sheet_to_json(wb.Sheets['Sheet1'], { header: 1, raw: true, defval: '' });
  const data = rows.slice(4).filter(r => norm(r[4]));

  const { rows: clients } = await client.query('SELECT id, code, legal_name, trade_name FROM clients WHERE deleted_at IS NULL');
  const nameMap = new Map();
  for (const c of clients) { for (const nm of [c.legal_name, c.trade_name]) { const k = norm(nm); if (k && !nameMap.has(k)) nameMap.set(k, c); } }

  let matched = 0; const recs = []; const unmatchedSamples = [];
  for (const r of data) {
    const hit = nameMap.get(norm(r[4]));
    if (hit) matched++; else if (unmatchedSamples.length < 8) unmatchedSamples.push(String(r[4]).trim());
    recs.push({
      client_id: hit?.id ?? null,
      client_code: hit?.code ?? null,
      client_name: String(r[4] ?? '').trim() || null,
      location: String(r[5] ?? '').trim() || null,
      vals: cols.map(c => num(r[MAP[c]])),
    });
  }

  const sumRil = recs.reduce((s, r) => s + r.vals[cols.indexOf('ril_pcp')], 0);
  const sumTot = recs.reduce((s, r) => s + r.vals[cols.indexOf('total_pcp')], 0);
  console.log('=== DRY RUN ===');
  console.log('data rows:', data.length, '· matched to a client:', matched, '· unmatched:', data.length - matched);
  console.log('cib columns populated:', cols.length);
  console.log('SUM ril_pcp:', sumRil, '· SUM total_pcp:', sumTot, '· RIL share:', ((sumRil / Math.max(sumTot, 1)) * 100).toFixed(1) + '%');
  console.log('unmatched samples:', JSON.stringify(unmatchedSamples));

  if (!APPLY) {
    console.log('\nDRY RUN only — re-run with --apply to replace competitor_installed_base.');
  } else {
    await client.query('BEGIN');
    const del = await client.query('DELETE FROM competitor_installed_base');
    const allCols = ['client_id', 'client_code', 'client_name', 'location', ...cols];
    const CHUNK = 200;
    let inserted = 0;
    for (let i = 0; i < recs.length; i += CHUNK) {
      const slice = recs.slice(i, i + CHUNK);
      const ph = [], vals = [];
      slice.forEach((r, j) => {
        const base = j * allCols.length;
        ph.push('(' + allCols.map((_, k) => `$${base + k + 1}`).join(',') + ')');
        vals.push(r.client_id, r.client_code, r.client_name, r.location, ...r.vals);
      });
      await client.query(`INSERT INTO competitor_installed_base (${allCols.join(',')}) VALUES ${ph.join(',')}`, vals);
      inserted += slice.length;
    }
    await client.query('COMMIT');
    console.log(`\ndeleted ${del.rowCount} old rows · inserted ${inserted} rows`);
    const [{ n }] = (await client.query('SELECT COUNT(*)::int n FROM competitor_installed_base')).rows;
    console.log('competitor_installed_base rows now:', n);
  }
} catch (e) {
  await client.query('ROLLBACK').catch(() => {});
  console.error('FAILED:', e.message); process.exitCode = 1;
} finally { await client.end(); }
