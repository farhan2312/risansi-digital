#!/usr/bin/env node
// Is clients.primary_rep_id ready to be made NOT NULL?
//
//   node scripts/primary-rep-notnull-ready.mjs
//
// The column was left nullable on purpose: 107 clients were parked without an
// owner during the ownership migration, and a NOT NULL then would either have
// blocked the backfill or forced a wrong answer onto a hundred records. Once the
// Unassigned tab reads zero, the constraint can go on and the "unowned client"
// state stops being possible.
//
// This only reports. The ALTER is a migration, and it is deliberately not
// written yet: scripts/migrate.mjs runs every pending file, so one sitting in
// the folder would fire on the next unrelated migration and fail against these
// rows. Run this, and when it says ready, the migration gets added and applied
// in the same breath.
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

// Live clients are what the constraint would bite on. Archived ones are excluded
// from every query in the application, but NOT from a table constraint — so they
// have to be counted separately, or the ALTER fails on rows nobody can see.
const { rows: [n] } = await c.query(`
  SELECT
    (SELECT count(*)::int FROM clients WHERE deleted_at IS NULL AND primary_rep_id IS NULL) AS live_unowned,
    (SELECT count(*)::int FROM clients WHERE deleted_at IS NOT NULL AND primary_rep_id IS NULL) AS archived_unowned,
    (SELECT count(*)::int FROM clients WHERE deleted_at IS NULL) AS live_total`);

console.log(`clients.primary_rep_id\n`);
console.log(`  live clients                    : ${n.live_total}`);
console.log(`  live clients with no owner      : ${n.live_unowned}`);
console.log(`  ARCHIVED clients with no owner  : ${n.archived_unowned}`);

if (n.live_unowned === 0 && n.archived_unowned === 0) {
  console.log('\n  READY. Add the migration and apply it.');
} else if (n.live_unowned === 0) {
  console.log(`\n  The Unassigned tab is clear, but ${n.archived_unowned} ARCHIVED client(s) still`);
  console.log('  have no owner. A table constraint applies to them too, so they need an owner,');
  console.log('  a hard delete, or the constraint needs a NOT VALID / partial form. Listing them:');
  const { rows } = await c.query(
    `SELECT code, legal_name, deleted_at::date::text AS archived
       FROM clients WHERE deleted_at IS NOT NULL AND primary_rep_id IS NULL ORDER BY code`);
  for (const r of rows) console.log(`      ${r.code.padEnd(14)} ${String(r.legal_name).slice(0, 40).padEnd(42)} archived ${r.archived}`);
} else {
  const { rows } = await c.query(`
    SELECT c.code, c.legal_name, c.status,
           (SELECT count(*)::int FROM opportunities o WHERE o.client_id = c.id) AS opps,
           (SELECT count(*)::int FROM visits v WHERE v.client_id = c.id) AS visits
      FROM clients c
     WHERE c.deleted_at IS NULL AND c.primary_rep_id IS NULL
     ORDER BY 4 DESC, 5 DESC, c.code`);
  const withHistory = rows.filter(r => r.opps || r.visits);
  console.log(`\n  NOT READY. ${n.live_unowned} to go, ${withHistory.length} of them carrying work.`);
  console.log('  Assign them in Reps & Managers → Unassigned, or in bulk with Move clients.\n');
  for (const r of rows.slice(0, 20)) {
    const h = r.opps || r.visits ? `${r.opps} opp · ${r.visits} visit` : '';
    console.log(`      ${r.code.padEnd(14)} ${String(r.legal_name).slice(0, 38).padEnd(40)} ${r.status.padEnd(20)} ${h}`);
  }
  if (rows.length > 20) console.log(`      … and ${rows.length - 20} more`);
}

await c.end();
