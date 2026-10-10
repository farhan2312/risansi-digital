#!/usr/bin/env node
// Give every unassigned action an owner.
//
//   node scripts/backfill-unassigned-actions.mjs           report only
//   node scripts/backfill-unassigned-actions.mjs --commit  write
//
// An action with nobody on it is a to-do nobody has agreed to do. It shows in
// the registry under "Unassigned", where it is somebody else's problem by
// construction, and it is invisible in the one place people actually look —
// their own list. The form allowed it, so it happened.
//
// Who each one goes to, in order:
//   1. the client's primary rep      — the person answerable for the account
//   2. whoever raised it             — no client, or a client nobody owns yet
//   3. left alone, and reported      — neither resolves to a real active user
//
// Rule 1 before rule 2 on purpose. The creator is often a manager or admin
// filing on somebody else's behalf, and handing them the action would move work
// up the hierarchy rather than to the person who does it.
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const COMMIT = process.argv.includes('--commit');
const env = {};
for (const line of fs.readFileSync(path.join(ROOT, '.env.local'), 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/); if (m) env[m[1]] = m[2];
}
const c = new pg.Client({ host: env.DB_HOST, port: Number(env.DB_PORT) || 5432,
  database: env.RISANSI_DB_NAME, user: env.DB_USER, password: env.DB_PASSWORD,
  ssl: { rejectUnauthorized: false } });
await c.connect();

// An action counts as unassigned when it names neither an in-system rep nor an
// external person. An external assignee IS an assignee — somebody outside the
// company agreed to do it — so those are left exactly as they are.
const { rows } = await c.query(`
  SELECT t.id, t.title, t.status, t.client_id, t.created_by,
         cl.code AS client_code, cl.legal_name AS client_name,
         owner.id   AS owner_id,   owner.name   AS owner_name,
         creator.id AS creator_id, creator.name AS creator_name
    FROM tasks t
    LEFT JOIN clients cl ON cl.id = t.client_id
    LEFT JOIN users owner ON owner.id = cl.primary_rep_id AND owner.is_active
    LEFT JOIN users creator ON lower(creator.email) = lower(t.created_by) AND creator.is_active
   WHERE t.assigned_to_rep IS NULL
     AND (t.assigned_to_external IS NULL OR t.assigned_to_external = '')
   ORDER BY t.status, t.id`);

const byOwner   = rows.filter(r => r.owner_id);
const byCreator = rows.filter(r => !r.owner_id && r.creator_id);
const stuck     = rows.filter(r => !r.owner_id && !r.creator_id);

const total = (await c.query('SELECT count(*)::int n FROM tasks')).rows[0].n;
const ext   = (await c.query(
  `SELECT count(*)::int n FROM tasks WHERE assigned_to_rep IS NULL AND assigned_to_external <> ''`)).rows[0].n;

console.log(`${total} actions in total.`);
console.log(`${ext} assigned to someone outside the system — left alone, an external assignee is an assignee.`);
console.log(`${rows.length} with nobody on them:\n`);
console.log(`  -> the client's owner : ${byOwner.length}`);
console.log(`  -> whoever raised it  : ${byCreator.length}`);
console.log(`  -> cannot resolve     : ${stuck.length}`);

const open = rows.filter(r => r.status !== 'completed').length;
console.log(`\n  (${open} of them are still open, ${rows.length - open} already completed)\n`);

const pad = (s, n) => String(s ?? '').slice(0, n).padEnd(n);
for (const r of rows) {
  const to = r.owner_id ? `${r.owner_name} (owns ${r.client_code})` : r.creator_id ? `${r.creator_name} (raised it)` : 'NOBODY';
  console.log(`  #${pad(r.id, 6)} ${pad(r.status, 10)} ${pad(r.title, 40)} -> ${to}`);
}

if (stuck.length) {
  console.log(`\n${stuck.length} cannot be resolved — no active owner on the client and no active user behind created_by:`);
  for (const r of stuck) {
    console.log(`  #${r.id}  ${r.title}  (client ${r.client_code ?? 'none'}, raised by ${r.created_by ?? 'unknown'})`);
  }
  console.log('  Assign these by hand, or reactivate the user.');
}

if (!COMMIT) {
  console.log(`\nDry run. Re-run with --commit to assign ${byOwner.length + byCreator.length} action(s).`);
  await c.end();
  process.exit(0);
}

await c.query('BEGIN');
let n = 0;
for (const r of [...byOwner, ...byCreator]) {
  const to = r.owner_id ?? r.creator_id;
  const res = await c.query(
    'UPDATE tasks SET assigned_to_rep = $2, updated_at = NOW() WHERE id = $1 AND assigned_to_rep IS NULL',
    [r.id, to]);
  n += res.rowCount ?? 0;
}
await c.query('COMMIT');

const left = (await c.query(
  `SELECT count(*)::int n FROM tasks
    WHERE assigned_to_rep IS NULL AND (assigned_to_external IS NULL OR assigned_to_external = '')`)).rows[0].n;
console.log(`\nAssigned ${n} action(s). ${left} still without anybody${left ? ' — the unresolvable ones above.' : '.'}`);

await c.end();
