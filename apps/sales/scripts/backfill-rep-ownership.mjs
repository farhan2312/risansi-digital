#!/usr/bin/env node
// Phase 3 of the rep-ownership migration: load primary and secondary reps from
// the client export, seed the manager matrix, archive the withdrawn clients.
//
//   node scripts/backfill-rep-ownership.mjs <csv>            dry run, changes nothing
//   node scripts/backfill-rep-ownership.mjs <csv> --commit   apply
//
// Deliberately a script rather than a .sql migration: the source is a spreadsheet
// that lives outside the repository, the email-to-user resolution needs real
// matching rather than a hand-typed id list, and the dry run has to be readable
// before anyone commits 2,700 ownership changes.
//
// Everything runs in ONE transaction. A partial ownership backfill would leave
// the company half-migrated with no way to tell which half.
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const args = process.argv.slice(2);
const COMMIT = args.includes('--commit');
const CSV = args.find(a => !a.startsWith('--'));
if (!CSV) { console.error('usage: backfill-rep-ownership.mjs <csv> [--commit]'); process.exit(1); }

// ── settings agreed with the business ────────────────────────────
// The sheet names Amit by an address he does not log in with. The tours on those
// 168 clients already point at the same person, which is what made this safe.
const EMAIL_ALIAS = { 'amit.srivastava@risansi.com': 'northindia2@risansi.com' };

// Instruction words that appear where a rep should be.
const WITHDRAW = new Set(['remove', 'delete']);          // archived via deleted_at
const PARK     = new Set(['close', 'rakesh', 'prasad@risansi.com']); // left unowned, listed

// The four approved pairings. Everyone else manages themselves.
const MANAGER_TEAMS = [
  ['aviral.shukla@risansi.com',   'himanshu.kushwaha@risansi.com'],
  ['aviral.shukla@risansi.com',   'akshay.awasthi@risansi.com'],
  ['anil.vankudre@risansi.com',   'westindia2@risansi.com'],      // Prashant Dhere
  ['madhav.kulkarni@risansi.com', 'westindia1@risansi.com'],      // Vishal Gaikwad
];

// ── env ──────────────────────────────────────────────────────────
const env = {};
for (const line of fs.readFileSync(path.join(ROOT, '.env.local'), 'utf8').replace(/^﻿/, '').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/); if (m) env[m[1]] = m[2];
}
const client = new pg.Client({
  host: env.DB_HOST, port: Number(env.DB_PORT) || 5432, database: env.RISANSI_DB_NAME,
  user: env.DB_USER, password: env.DB_PASSWORD, ssl: { rejectUnauthorized: false },
});

// ── csv ──────────────────────────────────────────────────────────
function parseCsv(s) {
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (q) { if (ch === '"') { if (s[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch; }
    else if (ch === '"') q = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\r') { /* ignore */ }
    else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += ch;
  }
  if (cell.length || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

const raw = parseCsv(fs.readFileSync(CSV, 'utf8').replace(/^﻿/, ''));
// The export carries blank spacer rows above the header.
const hIdx = raw.findIndex(r => r.filter(c => c.trim()).length > 3);
if (hIdx < 0) { console.error('could not find a header row'); process.exit(1); }
const H = raw[hIdx].map(h => h.trim());
const iCode = H.findIndex(h => /^client code$/i.test(h));
const iPri  = H.findIndex(h => /^primary$/i.test(h));
const iSec  = H.findIndex(h => /^secondary$/i.test(h));
if (iCode < 0 || iPri < 0) { console.error('sheet needs Client Code and Primary columns'); process.exit(1); }

const sheet = raw.slice(hIdx + 1)
  .map(r => ({
    code: (r[iCode] ?? '').trim().toUpperCase(),
    primary: (r[iPri] ?? '').trim(),
    secondary: (iSec >= 0 ? (r[iSec] ?? '') : '').trim(),
  }))
  .filter(r => r.code);

const main = async () => {
  await client.connect();
  await client.query('BEGIN');
  const q = async (s, a) => (await client.query(s, a)).rows;

  const users = await q(`SELECT id, name, lower(email) AS email, role, is_active FROM users`);
  const byEmail = new Map(users.map(u => [u.email, u]));
  const resolve = (v) => {
    const k = (v ?? '').trim().toLowerCase();
    if (!k) return null;
    return byEmail.get(EMAIL_ALIAS[k] ?? k) ?? null;
  };

  const clients = await q(`SELECT id, upper(code) AS code FROM clients WHERE code IS NOT NULL`);
  const byCode = new Map(clients.map(c => [c.code, c.id]));

  const report = {
    primary: 0, secondary: 0, withdrawn: 0, parked: 0,
    noSuchClient: [], unresolved: new Map(), perRep: new Map(),
  };
  const bump = (u, k) => {
    if (!report.perRep.has(u.name)) report.perRep.set(u.name, { role: u.role, primary: 0, secondary: 0 });
    report.perRep.get(u.name)[k]++;
  };

  const withdrawIds = [], parkIds = [];
  const primarySets = [], secondaryPairs = [];

  for (const row of sheet) {
    const clientId = byCode.get(row.code);
    if (!clientId) { report.noSuchClient.push(row.code); continue; }

    const pKey = row.primary.trim().toLowerCase();
    if (WITHDRAW.has(pKey)) { withdrawIds.push(clientId); continue; }
    if (PARK.has(pKey))     { parkIds.push(clientId); continue; }

    const pu = resolve(row.primary);
    if (row.primary && !pu) {
      report.unresolved.set(row.primary, (report.unresolved.get(row.primary) ?? 0) + 1);
    } else if (pu) {
      primarySets.push([clientId, pu.id]); bump(pu, 'primary');
    }

    const su = resolve(row.secondary);
    if (row.secondary && !su) {
      report.unresolved.set(row.secondary, (report.unresolved.get(row.secondary) ?? 0) + 1);
    } else if (su && (!pu || su.id !== pu.id)) {
      secondaryPairs.push([clientId, su.id]); bump(su, 'secondary');
    }
  }

  // ── apply, set-based ───────────────────────────────────────────
  if (primarySets.length) {
    const r = await client.query(
      `UPDATE clients c SET primary_rep_id = v.rep
         FROM (SELECT * FROM unnest($1::int[], $2::int[]) AS t(cid, rep)) v
        WHERE c.id = v.cid`,
      [primarySets.map(x => x[0]), primarySets.map(x => x[1])]);
    report.primary = r.rowCount;
  }
  if (secondaryPairs.length) {
    const r = await client.query(
      `INSERT INTO client_secondary_reps (client_id, rep_id)
       SELECT * FROM unnest($1::int[], $2::int[]) ON CONFLICT DO NOTHING`,
      [secondaryPairs.map(x => x[0]), secondaryPairs.map(x => x[1])]);
    report.secondary = r.rowCount;
  }
  if (withdrawIds.length) {
    // Archived, not erased: 19 of these carry opportunities, and every query in
    // the app already filters deleted_at, so they leave the interface entirely
    // while staying recoverable from the admin page.
    const r = await client.query(
      `UPDATE clients SET deleted_at = NOW() WHERE id = ANY($1) AND deleted_at IS NULL`,
      [withdrawIds]);
    report.withdrawn = r.rowCount;
  }
  report.parked = parkIds.length;

  // ── the manager matrix ─────────────────────────────────────────
  const teams = [];
  for (const [mEmail, rEmail] of MANAGER_TEAMS) {
    const m = byEmail.get(mEmail), r = byEmail.get(rEmail);
    if (!m || !r) { console.error(`  !! could not resolve team pair ${mEmail} -> ${rEmail}`); continue; }
    teams.push([m.id, r.id, `${m.name} -> ${r.name}`]);
  }
  if (teams.length) {
    await client.query(
      `INSERT INTO manager_reps (manager_id, rep_id)
       SELECT * FROM unnest($1::int[], $2::int[]) ON CONFLICT DO NOTHING`,
      [teams.map(t => t[0]), teams.map(t => t[1])]);
  }

  // ── what the result looks like ─────────────────────────────────
  const owned    = (await q(`SELECT count(*)::int n FROM clients WHERE primary_rep_id IS NOT NULL AND deleted_at IS NULL`))[0].n;
  const unowned  = (await q(`SELECT count(*)::int n FROM clients WHERE primary_rep_id IS NULL AND deleted_at IS NULL`))[0].n;
  const archived = (await q(`SELECT count(*)::int n FROM clients WHERE deleted_at IS NOT NULL`))[0].n;

  console.log(`\n${COMMIT ? 'APPLIED' : 'DRY RUN'} — ${path.basename(CSV)}\n`);
  console.log(`  sheet rows              ${sheet.length}`);
  console.log(`  primary rep set         ${report.primary}`);
  console.log(`  secondary reps added    ${report.secondary}`);
  console.log(`  archived (remove/delete)${String(report.withdrawn).padStart(5)}`);
  console.log(`  parked unowned          ${report.parked}`);
  console.log(`  codes not in database   ${report.noSuchClient.length}${report.noSuchClient.length ? '  ' + report.noSuchClient.join(', ') : ''}`);
  if (report.unresolved.size) {
    console.log('\n  values resolving to nobody:');
    for (const [k, n] of [...report.unresolved].sort((a, b) => b[1] - a[1])) console.log(`    ${JSON.stringify(k).padEnd(34)} ${n}`);
  }

  console.log('\n  manager teams seeded:');
  for (const t of teams) console.log(`    ${t[2]}`);

  console.log('\n  book per person:');
  console.log('    person                       role      primary  secondary');
  for (const [name, v] of [...report.perRep].sort((a, b) => b[1].primary - a[1].primary))
    console.log(`    ${name.padEnd(28)} ${v.role.padEnd(9)} ${String(v.primary).padStart(7)} ${String(v.secondary).padStart(10)}`);

  console.log('\n  resulting state:');
  console.log(`    clients with an owner   ${owned}`);
  console.log(`    clients without one     ${unowned}   <- the Unassigned tab`);
  console.log(`    archived                ${archived}`);

  if (COMMIT) { await client.query('COMMIT'); console.log('\nCOMMITTED'); }
  else        { await client.query('ROLLBACK'); console.log('\nrolled back — pass --commit to apply'); }
  await client.end();
};

main().catch(async (e) => {
  console.error('\nFAILED:', e.message);
  try { await client.query('ROLLBACK'); } catch { /* connection may be gone */ }
  try { await client.end(); } catch { /* already closed */ }
  process.exit(1);
});
