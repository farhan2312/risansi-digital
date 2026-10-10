// Import the PCP + MMP installed-base census from design/pumps-data.xlsx into
// competitor_installed_base (feeds the Competition page + Client 360).
//
//   node scripts/import-pumps-data.mjs            → DRY RUN (report only)
//   node scripts/import-pumps-data.mjs --apply    → merge into the table
//
// Merge semantics (per the product decision):
//  • Match each sheet row to a client by CLIENT CODE (case/space-insensitive).
//  • For every sheet row, DELETE any existing cib rows with that code and INSERT
//    a fresh row — i.e. update-by-code. Rows NOT present in the sheet are left
//    untouched (no full wipe).
//  • Skip junk rows (codes that aren't a real client-code pattern, e.g.
//    "END CLIENT", "LEAD") and keep only the FIRST occurrence of a duplicate code.
//  • RIL* columns are us (Risansi); every other *_pcp / *_mmp column is a
//    competitor make. ravalgoan_pcp has no column in the sheet, so it is set to 0.

import { readFileSync } from 'node:fs';
import pg from 'pg';
import XLSX from 'xlsx';

const APPLY = process.argv.includes('--apply');

const env = {};
for (const l of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').replace(/^﻿/, '').split(/\r?\n/)) {
  const m = l.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/); if (m) env[m[1]] = m[2];
}
const client = new pg.Client({ host: env.DB_HOST, port: +env.DB_PORT || 5432, database: env.RISANSI_DB_NAME, user: env.DB_USER, password: env.DB_PASSWORD, ssl: { rejectUnauthorized: false } });

// cib integer column → sheet column index (verified against the row-3 header).
const INT_COLS = {
  ril_supplied_pcp: 6, ril_supplied_mmp: 7, ril_pcp: 8, ril_mmp: 9,
  roto_pcp: 10, rotomac_pcp: 11, gita_pcp: 12, gita_mmp: 13, sintech_mmp: 14,
  psp_pcp: 15, psp_mmp: 16, syno_pcp: 17, syno_mmp: 18, ropman_pcp: 19, ropman_mmp: 20,
  myto_pcp: 21, vikas_pcp: 22, vikas_mmp: 23, newpumps_pcp: 24, indopump_pcp: 25, indopump_mmp: 26,
  tushaco_pcp: 27, yaswant_pcp: 28, yaswant_mmp: 29, shivam_pcp: 30, shivam_mmp: 31, saksham_pcp: 32,
  alpha_pcp: 33, gajanan_pcp: 34, chandra_helicon_pcp: 35, netzsch_pcp: 36, akanshi_pcp: 37,
  elite_mmp: 38, pragati_pcp: 39, others_pcp: 40, others_mmp: 41, ravalgoan_mmp: 42,
  ropar_pcp: 43, rotor_flow_pcp: 44, mather_mmp: 45, naishit_pcp: 46, delta_pcp: 47,
  varun_pcp: 48, varun_mmp: 49, vs_engg_mmp: 50, npi_pcp: 51, hydroprocav_pcp: 52, sre_pcp: 53,
  span_engg_pcp: 54, span_engg_mmp: 55, pandey_pcp: 56, pandey_mmp: 57, mahalaxmi_pcp: 58, mahalaxmi_mmp: 59,
  total_others_pcp: 60, total_others_mmp: 61, total_pumps: 62, total_pcp: 63, total_mmp: 64,
};
const FLOAT_COLS = { ril_pcp_pct: 65, ril_mmp_pct: 66 };
// cib columns with no sheet column → forced to 0 so totals stay consistent.
const ZERO_COLS = ['ravalgoan_pcp'];

const norm = s => String(s ?? '').trim();
const int  = v => { const n = Number(v); return Number.isFinite(n) ? Math.round(n) : 0; };
const flt  = v => { const n = Number(v); return Number.isFinite(n) ? n : null; };
const isRealCode = c => /^[A-Za-z0-9]{6,}$/.test(c) && /\d/.test(c) && /[A-Za-z]/.test(c);

await client.connect();
try {
  // Keep only the cib columns that actually exist (defensive).
  const { rows: colRows } = await client.query(
    "SELECT column_name FROM information_schema.columns WHERE table_name='competitor_installed_base'");
  const cibCols = new Set(colRows.map(r => r.column_name));
  const intCols   = Object.keys(INT_COLS).filter(c => cibCols.has(c));
  const floatCols = Object.keys(FLOAT_COLS).filter(c => cibCols.has(c));
  const zeroCols  = ZERO_COLS.filter(c => cibCols.has(c));

  const wb = XLSX.readFile(new URL('../design/pumps-data.xlsx', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
  const sheet = XLSX.utils.sheet_to_json(wb.Sheets['Sheet1'], { header: 1, raw: true, defval: '' });
  const body = sheet.slice(1); // row 0 is the header

  // Client code → id (match case/space-insensitively).
  const { rows: clients } = await client.query('SELECT id, code FROM clients WHERE deleted_at IS NULL');
  const idByCode = new Map(clients.map(c => [norm(c.code).toUpperCase(), c.id]));

  let junk = 0, dupe = 0, matched = 0, unmatched = 0;
  const seen = new Set();
  const recs = [];
  const unmatchedSamples = [];
  for (const r of body) {
    const code = norm(r[0]);
    if (!isRealCode(code)) { junk++; continue; }
    const key = code.toUpperCase();
    if (seen.has(key)) { dupe++; continue; }
    seen.add(key);

    const clientId = idByCode.get(key) ?? null;
    if (clientId) matched++; else { unmatched++; if (unmatchedSamples.length < 10) unmatchedSamples.push(code); }

    recs.push({
      code, client_id: clientId,
      client_name: norm(r[4]) || null,
      location: norm(r[5]) || null,
      client_type_raw: norm(r[3]) || null,
      assessed_by_rep: norm(r[2]) || null,
      ints:   intCols.map(c => int(r[INT_COLS[c]])),
      floats: floatCols.map(c => flt(r[FLOAT_COLS[c]])),
    });
  }

  const sumInt = col => { const i = intCols.indexOf(col); return i < 0 ? 0 : recs.reduce((s, x) => s + x.ints[i], 0); };
  console.log('=== ' + (APPLY ? 'APPLY' : 'DRY RUN') + ' · pumps-data.xlsx ===');
  console.log('sheet rows:', body.length, '· junk skipped:', junk, '· duplicate codes skipped:', dupe);
  console.log('importing rows:', recs.length, '· matched to a client:', matched, '· unmatched (market-only):', unmatched);
  console.log('unmatched samples:', JSON.stringify(unmatchedSamples));
  console.log('SUMS · ril_pcp:', sumInt('ril_pcp'), '· ril_mmp:', sumInt('ril_mmp'),
    '· total_pcp:', sumInt('total_pcp'), '· total_mmp:', sumInt('total_mmp'), '· total_pumps:', sumInt('total_pumps'));

  if (!APPLY) {
    console.log('\nDRY RUN only — re-run with --apply to merge into competitor_installed_base.');
  } else {
    const allCols = ['client_id', 'client_code', 'client_name', 'location', 'client_type_raw',
      'assessed_by_rep', 'source', ...zeroCols, ...intCols, ...floatCols, 'created_at', 'updated_at'];
    let updated = 0, inserted = 0;
    await client.query('BEGIN');
    for (const rec of recs) {
      const del = await client.query('DELETE FROM competitor_installed_base WHERE upper(trim(client_code)) = $1', [rec.code.toUpperCase()]);
      if (del.rowCount > 0) updated++; else inserted++;
      const vals = [
        rec.client_id, rec.code, rec.client_name, rec.location, rec.client_type_raw,
        rec.assessed_by_rep, 'pumps-data.xlsx',
        ...zeroCols.map(() => 0), ...rec.ints, ...rec.floats,
      ];
      // Placeholders: NOW() for the two timestamps, $n for everything else.
      const valuePh = [];
      let p = 0;
      for (const c of allCols) {
        if (c === 'created_at' || c === 'updated_at') valuePh.push('NOW()');
        else { p++; valuePh.push(`$${p}`); }
      }
      await client.query(
        `INSERT INTO competitor_installed_base (${allCols.join(',')}) VALUES (${valuePh.join(',')})`, vals);
    }
    await client.query('COMMIT');
    console.log(`\nmerged: updated ${updated} existing code(s), inserted ${inserted} new row(s).`);
    const after = await client.query(
      'SELECT COUNT(*)::int n, COALESCE(SUM(ril_pcp),0)::int rp, COALESCE(SUM(ril_mmp),0)::int rm, COALESCE(SUM(total_pcp),0)::int tp, COALESCE(SUM(total_mmp),0)::int tm FROM competitor_installed_base');
    console.log('competitor_installed_base now:', JSON.stringify(after.rows[0]));
  }
} catch (e) {
  await client.query('ROLLBACK').catch(() => {});
  console.error('FAILED:', e.message); process.exitCode = 1;
} finally { await client.end(); }
