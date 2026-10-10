#!/usr/bin/env node
// Phase 8: is the live rule sound enough to delete the rollback lever?
//
//   node scripts/rep-ownership-live-check.mjs
//
// Read-only. rep-ownership-diff.mjs answered a different question — old rule
// against new rule, in the abstract — and its "open work that would leave
// someone's view" section predates the in-flight limb that phase 5 added. That
// limb is why those records are still visible, so the diff overstates the loss.
//
// This asks the only question that matters now: running the predicate that is
// actually in production, is there an open record its owner cannot see?
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

// clientRuleSql's ownership branch verbatim, with the viewer left as a hole so
// each record can be tested against its own owner in one pass.
const clientRule = (clientCol, viewer) => `(
  ${clientCol} IN (SELECT c2.id FROM clients c2
              WHERE c2.primary_rep_id = ${viewer}
                 OR c2.primary_rep_id IN (SELECT rep_id FROM manager_reps WHERE manager_id = ${viewer}))
  OR ${clientCol} IN (SELECT s.client_id FROM client_secondary_reps s
                 WHERE s.rep_id = ${viewer}
                    OR s.rep_id IN (SELECT rep_id FROM manager_reps WHERE manager_id = ${viewer})))`;

const pad = (s, n) => String(s ?? '').padEnd(n).slice(0, n);
let blind = 0;

async function check(label, table, ownerCol, openCond, ownOpenCond) {
  const viewer = `r.${ownerCol}`;
  const { rows } = await c.query(`
    SELECT r.id, u.name, u.role, cl.code
      FROM ${table} r
      JOIN users u ON u.id = r.${ownerCol} AND u.is_active AND u.role NOT IN ('admin','sysadmin')
      JOIN clients cl ON cl.id = r.client_id AND cl.deleted_at IS NULL
     WHERE ${openCond}
       AND NOT (${clientRule('r.client_id', viewer)} OR (${ownOpenCond}))
     ORDER BY u.name, r.id`);
  blind += rows.length;
  console.log(`\n  ${label}: ${rows.length === 0 ? 'all visible to their owner' : `${rows.length} INVISIBLE`}`);
  for (const x of rows.slice(0, 15)) {
    console.log(`      #${pad(x.id, 7)} ${pad(x.name, 22)} ${pad(x.role, 9)} ${x.code}`);
  }
  if (rows.length > 15) console.log(`      … and ${rows.length - 15} more`);
}

await c.connect();
console.log('LIVE RULE CHECK — the predicate that is actually in production\n');

await check('open opportunities', 'opportunities', 'rep_id',
  `r.stage NOT IN ('Won','Lost','Dropped')`,
  `TRUE AND r.stage NOT IN ('Won','Lost','Dropped')`);

await check('open visits', 'visits', 'rep_id',
  `r.status <> 'completed'`,
  `TRUE AND r.status <> 'completed'`);

await check('open action items', 'tasks', 'assigned_to_rep',
  `r.status <> 'completed'`,
  `TRUE AND r.status <> 'completed'`);

// The other half: closed work whose filer can no longer reach it. Intended — a
// finished record stops being yours — but worth stating out loud rather than
// discovering later.
const { rows: closed } = await c.query(`
  SELECT count(*)::int AS n
    FROM opportunities o
    JOIN users u ON u.id = o.rep_id AND u.is_active AND u.role NOT IN ('admin','sysadmin')
    JOIN clients cl ON cl.id = o.client_id AND cl.deleted_at IS NULL
   WHERE o.stage IN ('Won','Lost','Dropped')
     AND NOT ${clientRule('o.client_id', 'o.rep_id')}`);

console.log(`\n  closed opportunities now reachable only through the client: ${closed[0].n}`);
console.log('      (intended — a Won/Lost/Dropped record stops being yours)');

console.log(`\n  VERDICT: ${blind === 0
  ? 'no open record is hidden from its owner. The in-flight limb is holding.'
  : `${blind} open record(s) hidden from their owner — fix before removing the flag.`}\n`);

await c.end();
