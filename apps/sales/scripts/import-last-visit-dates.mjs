#!/usr/bin/env node
//
// "Last Visit date update in sales portal_29092026.xlsx" → visits.
//
// One row per client: the day they were last visited, and sometimes a written
// summary. 672 rows, header on row 2.
//
// ── The dates ──────────────────────────────────────────────────────────────
// The column is half text and half real dates, and the real ones are wrong.
// Excel converted 206 cells and left 464 as text, and 204 of the 206 have a
// day of 12 or less. That is not chance: it is what happens when dd-mm-yyyy is
// read as mm-dd-yyyy, because the cells it could NOT read that way — day 13 and
// above — are exactly the ones that stayed text. So a converted cell has the
// original day sitting in its month and the original month in its day, and the
// two are put back the right way round.
//
// Two converted cells have a day above 12, so they were never misread and are
// taken as they are. And three would land in the future once swapped while
// reading them as-is lands in the past — a visit cannot be in the future, so
// that settles those three the other way.
//
// The text dates are dd-mm-yyyy, which is settled twice over: 434 of them have
// a first part above 12, and where the filename in column B also carries the
// date the two agree 48 times against 2.
//
// ── The clients ────────────────────────────────────────────────────────────
// A code that matches wins. Failing that, a name that matches exactly one
// client. Failing that, six hand-checked near-misses (NEAR_MATCHES below) —
// spelling and suffix differences on the same company, not different plants of
// the same group, which are left alone deliberately. Anything still unmatched
// becomes a new client under the code the file gives it: these are ERP codes,
// so a code the portal does not have is an account the portal is missing.
//
// A client the portal soft-deleted is skipped. Somebody removed it on purpose
// and an import should not quietly bring it back.
//
// Every visit is owned by its client's primary rep, carries the summary when
// there is one, and is tagged so the whole load can be undone:
//
//   DELETE FROM visits WHERE import_source = 'visit-history-2026-10';
//   DELETE FROM clients WHERE import_source = 'visit-history-2026-10';
//
// Usage: node scripts/import-last-visit-dates.mjs [--apply]   (dry run without --apply)

import ExcelJS from 'exceljs';
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';

const TAG = 'visit-history-2026-10';
const FILE = process.env.VISIT_XLSX
  ?? 'C:/Users/Cosmos/Downloads/Last Visit date update in sales portal_29092026.xlsx';
const APPLY = process.argv.includes('--apply');

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const env = {};
for (const line of fs.readFileSync(path.join(ROOT, '.env.local'), 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
  if (m) env[m[1]] = m[2];
}
const db = new pg.Client({
  host: env.DB_HOST, port: Number(env.DB_PORT) || 5432, database: env.RISANSI_DB_NAME,
  user: env.DB_USER, password: env.DB_PASSWORD, ssl: { rejectUnauthorized: false },
});

/**
 * Near-misses checked by hand and accepted: the same company under a different
 * spelling. Everything else the fuzzy pass offered was a different plant of the
 * same group (DCM Hariawan against Ajbapur, Renuka F against K, Indian Potash
 * against its Muzaffarnagar unit) or simply a shared word (NEPA Paper Mill
 * against Tulsi Paper Mill), and those become new clients instead.
 */
const NEAR_MATCHES = {
  NAGP01S503: 'NAGP01S623',  // SUPERB HYGIENIC DISPOSALS — same name, same city
  BATH01H062: 'DLHI01H045',  // HI TECH / HI-TECH SWEET WATER TECH
  BHAR01I105: 'NODA01I015',  // ISGEC HEAVY ENGINEERING LIMITED / LTD.
  CHEN01B107: 'KANP01B161',  // BGR ENERGY "SYESTEM" / SYSTEMS LTD
  CHEN01S370: 'CHEN01S307',  // S R / SR ENGINEERING SOLUTIONS, same city
  'END CLIENT': 'HAVE01G152', // "GM SUGARS UNIT 2" → GM SUGAR & ENERGY LTD UNIT -II
};

const IST = 5.5 * 60 * 60 * 1000;
const pad = (n) => String(n).padStart(2, '0');
const todayIST = new Date(Date.now() + IST).toISOString().slice(0, 10);

const cellText = (c) => {
  const v = c?.value;
  if (v == null) return '';
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'object') return String(v.text ?? v.result ?? (v.richText ? v.richText.map(r => r.text).join('') : ''));
  return String(v);
};

/** The day this row means, and how that was decided. Null when it cannot be read. */
function readDate(raw) {
  if (raw instanceof Date) {
    const d = new Date(raw.getTime() + IST);
    const y = d.getUTCFullYear(), m = d.getUTCMonth() + 1, day = d.getUTCDate();
    const asIs = `${y}-${pad(m)}-${pad(day)}`;
    if (day > 12) return { iso: asIs, how: 'date cell, never misread' };
    const swapped = `${y}-${pad(day)}-${pad(m)}`;
    // A visit cannot be in the future. Where swapping would put it there and
    // leaving it alone would not, the swap is the wrong call for this row.
    if (swapped > todayIST && asIs <= todayIST) return { iso: asIs, how: 'date cell, left as-is (swapping lands in the future)' };
    return { iso: swapped, how: 'date cell, day and month put back' };
  }
  const s = String(raw ?? '').trim();
  const m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/);   // trailing notes like "(Haryana)" are ignored
  if (!m) return null;
  let y = Number(m[3]); if (y < 100) y += 2000;
  const day = Number(m[1]), mon = Number(m[2]);
  if (day < 1 || day > 31 || mon < 1 || mon > 12) return null;
  return { iso: `${y}-${pad(mon)}-${pad(day)}`, how: 'text, dd-mm-yyyy' };
}

const normName = (s) => s.toUpperCase()
  .replace(/\.[A-Z0-9]{2,5}$/i, '').replace(/\(\d+\)/g, '')
  .replace(/\d{1,2}[.\-_/]\d{1,2}[.\-_/]\d{2,4}/g, '')
  .replace(/[^A-Z0-9]+/g, ' ')
  .replace(/\b(PVT|PRIVATE|LTD|LIMITED|LLP|CO|COMPANY|THE|INDIA|I)\b/g, ' ')
  .replace(/\s+/g, ' ').trim();

/** The company name, with any report filename stripped off it. */
const cleanName = (s) => s
  .replace(/\.(pdf|docx?|xlsx?)$/i, '')
  .replace(/\s*\(\d+\)\s*$/, '')
  .replace(/[\s\-_]*\d{1,2}[.\-_/]\d{1,2}[.\-_/]\d{2,4}\s*$/, '')
  .trim().toUpperCase();

async function main() {
  await db.connect();

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(FILE);
  const ws = wb.worksheets[0];

  const rows = [];
  for (let r = 3; r <= ws.rowCount; r++) {
    const code = cellText(ws.getRow(r).getCell(1)).trim();
    const name = cellText(ws.getRow(r).getCell(2)).trim();
    const raw = ws.getRow(r).getCell(3).value;
    const summary = cellText(ws.getRow(r).getCell(4)).trim();
    if (!code && !name && !raw && !summary) continue;
    rows.push({ r, code, name, raw, summary, ...(readDate(raw) ?? { iso: null, how: 'unreadable' }) });
  }

  const { rows: clients } = await db.query(
    `SELECT id, UPPER(code) AS code, legal_name, primary_rep_id, deleted_at IS NOT NULL AS deleted FROM clients`);
  const byCode = new Map(clients.map(c => [c.code, c]));
  const byName = new Map();
  for (const c of clients) {
    if (c.deleted) continue;
    const k = normName(c.legal_name);
    if (k) (byName.get(k) ?? byName.set(k, []).get(k)).push(c);
  }

  const plan = { visit: [], newClient: new Map(), skip: [] };
  for (const row of rows) {
    if (!row.iso) { plan.skip.push({ ...row, why: 'the date cannot be read' }); continue; }
    const code = row.code.toUpperCase();

    let client = byCode.get(code);
    let how = 'code';
    if (!client && NEAR_MATCHES[row.code]) { client = byCode.get(NEAR_MATCHES[row.code]); how = 'hand-checked name'; }
    if (!client) {
      const m = byName.get(normName(row.name));
      if (m?.length === 1) { client = m[0]; how = 'name'; }
    }
    if (client?.deleted) { plan.skip.push({ ...row, why: `client ${client.code} was deleted on purpose` }); continue; }

    if (client) { plan.visit.push({ ...row, clientId: client.id, clientCode: client.code, repId: client.primary_rep_id, how }); continue; }

    // No client anywhere: the file's code is an ERP code the portal is missing.
    if (!/^[A-Z0-9_]{3,20}$/.test(code)) { plan.skip.push({ ...row, why: `"${row.code}" is not a usable client code` }); continue; }
    const legal = cleanName(row.name) || code;
    if (!plan.newClient.has(code)) plan.newClient.set(code, { code, legal, rows: [] });
    plan.newClient.get(code).rows.push(row);
  }

  const byHow = new Map();
  for (const v of plan.visit) byHow.set(v.how, (byHow.get(v.how) ?? 0) + 1);
  const dateHow = new Map();
  for (const v of rows) dateHow.set(v.how, (dateHow.get(v.how) ?? 0) + 1);

  console.log(`\n${rows.length} rows read from ${path.basename(FILE)}\n`);
  console.log('how each date was decided:');
  console.table([...dateHow].map(([how, n]) => ({ how, n })).sort((a, b) => b.n - a.n));
  console.log('how each row found its client:');
  console.table([...byHow].map(([how, n]) => ({ how, n })));
  console.log(`\n  ${plan.visit.length} visits onto existing clients`);
  console.log(`  ${plan.newClient.size} new clients to create, carrying ${[...plan.newClient.values()].reduce((s, c) => s + c.rows.length, 0)} visits`);
  console.log(`  ${plan.skip.length} rows skipped`);
  if (plan.skip.length) console.table(plan.skip.map(s => ({ row: s.r, code: s.code, name: s.name.slice(0, 30), why: s.why })));

  const noRep = plan.visit.filter(v => v.repId == null).length;
  console.log(`\n  ${plan.visit.length - noRep} visits get their client's primary rep · ${noRep} have no rep on the client`);
  console.log(`  ${rows.filter(r => r.summary).length} rows carry a summary`);
  const isos = plan.visit.map(v => v.iso).sort();
  console.log(`  dates ${isos[0]} → ${isos[isos.length - 1]}, none after ${todayIST}: ${plan.visit.every(v => v.iso <= todayIST)}`);

  // Already there? Same client, same day.
  const { rows: dupRows } = await db.query(
    `SELECT client_id, visit_date::text AS d FROM visits WHERE client_id = ANY($1::int[])`,
    [[...new Set(plan.visit.map(v => v.clientId))]]);
  const existing = new Set(dupRows.map(d => `${d.client_id}|${d.d}`));
  const fresh = plan.visit.filter(v => !existing.has(`${v.clientId}|${v.iso}`));
  console.log(`  ${plan.visit.length - fresh.length} already exist on that client and day, and are left alone`);
  console.log(`\n  → ${fresh.length + [...plan.newClient.values()].reduce((s, c) => s + c.rows.length, 0)} visits would be written`);

  if (!APPLY) {
    console.log('\nDry run. Nothing written. Re-run with --apply.');
    console.log('\na sample of what would be written:');
    console.table(fresh.slice(0, 10).map(v => ({ client: v.clientCode, date: v.iso, via: v.how, rep: v.repId ?? '—', summary: v.summary ? `${v.summary.length} chars` : '' })));
    console.log('\nnew clients:');
    console.table([...plan.newClient.values()].slice(0, 12).map(c => ({ code: c.code, name: c.legal.slice(0, 44), visits: c.rows.length })));
    await db.end();
    return;
  }

  await db.query('BEGIN');
  try {
    let madeClients = 0, madeVisits = 0;
    for (const c of plan.newClient.values()) {
      const { rows: [ins] } = await db.query(
        `INSERT INTO clients (code, legal_name, client_type, is_end_client, status, import_source, created_at, updated_at)
         VALUES ($1, $2, 'Unclassified', FALSE, 'PROSPECTIVE_CLIENT', $3, NOW(), NOW())
         ON CONFLICT (code) DO NOTHING
         RETURNING id, primary_rep_id`,
        [c.code, c.legal, TAG]);
      const row = ins ?? (await db.query('SELECT id, primary_rep_id FROM clients WHERE UPPER(code) = $1', [c.code])).rows[0];
      if (ins) madeClients++;
      for (const r of c.rows) plan.visit.push({ ...r, clientId: row.id, clientCode: c.code, repId: row.primary_rep_id, how: 'new client' });
    }
    for (const v of plan.visit) {
      if (existing.has(`${v.clientId}|${v.iso}`)) continue;
      await db.query(
        `INSERT INTO visits (client_id, rep_id, visit_date, purpose, status, summary, import_source, created_at, updated_at)
         VALUES ($1, $2, $3::date, 'Routine', 'completed', $4, $5, NOW(), NOW())`,
        [v.clientId, v.repId, v.iso, v.summary || null, TAG]);
      existing.add(`${v.clientId}|${v.iso}`);
      madeVisits++;
    }
    await db.query('COMMIT');
    console.log(`\napplied: ${madeClients} clients, ${madeVisits} visits, tagged ${TAG}`);
  } catch (e) {
    await db.query('ROLLBACK');
    console.error('\nrolled back:', e.message);
    process.exitCode = 1;
  }
  await db.end();
}

main();
