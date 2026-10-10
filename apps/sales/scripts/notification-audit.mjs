#!/usr/bin/env node
// Who actually receives each notification, now that ownership decides it?
//
//   node scripts/notification-audit.mjs
//
// Read-only. Every client-scoped notification funnels through clientManagers()
// in lib/risansi-notify.ts, and the ownership migration rewrote that function.
// The old version asked "managers assigned to this client's route", which had
// three failure modes nobody could see from the code: it reached NOBODY for a
// client owned by a manager with no one above them, it mailed managers who
// merely shared a route with the client, and it missed every client on no route
// at all.
//
// This runs both versions of the question against live data and counts the
// difference, so "the notifications changed" is a number rather than a claim.
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

// clientManagers(), exactly as it now stands: the owner, everyone covering the
// account, and every manager above any of them.
const RECIPIENTS = `
  SELECT DISTINCT u.id, u.name, u.email
    FROM users u
   WHERE u.is_active = TRUE AND u.email IS NOT NULL AND u.email <> ''
     AND (
       u.id = (SELECT primary_rep_id FROM clients WHERE id = c.id)
       OR u.id IN (SELECT rep_id FROM client_secondary_reps WHERE client_id = c.id)
       OR u.id IN (
         SELECT mr.manager_id FROM manager_reps mr
          WHERE mr.rep_id = (SELECT primary_rep_id FROM clients WHERE id = c.id)
             OR mr.rep_id IN (SELECT rep_id FROM client_secondary_reps WHERE client_id = c.id))
     )`;

const { rows: cover } = await c.query(`
  SELECT count(*)::int AS clients,
         count(*) FILTER (WHERE (SELECT count(*) FROM (${RECIPIENTS}) r) = 0)::int AS silent,
         round(avg((SELECT count(*) FROM (${RECIPIENTS}) r)), 2)::text AS avg_recipients,
         max((SELECT count(*) FROM (${RECIPIENTS}) r))::int AS max_recipients
    FROM clients c WHERE c.deleted_at IS NULL`);

console.log('CLIENT-SCOPED NOTIFICATIONS — check-in, visit submitted, complaint');
console.log('closed/updated, opportunity won/lost, quotation issued, sales order,');
console.log('new lead, and the visit-planned mail to a rep\'s managers.\n');
console.log(`  clients                              : ${cover[0].clients}`);
console.log(`  reaching NOBODY                      : ${cover[0].silent}`);
console.log(`  average recipients per client        : ${cover[0].avg_recipients}`);
console.log(`  most recipients on one client        : ${cover[0].max_recipients}`);

// The silent ones are exactly the unowned clients — nothing else can be silent,
// because an owner is always a recipient of their own client's mail.
const { rows: why } = await c.query(`
  SELECT count(*)::int AS n,
         count(*) FILTER (WHERE c.primary_rep_id IS NULL)::int AS unowned
    FROM clients c
   WHERE c.deleted_at IS NULL AND (SELECT count(*) FROM (${RECIPIENTS}) r) = 0`);
console.log(`\n  of the silent ones, ${why[0].unowned}/${why[0].n} have no owner — assign one and they are covered.`);

// ── who gets the weekly digest, and what is in it ─────────────────
const { rows: digest } = await c.query(`
  SELECT u.name,
         (SELECT count(*)::int FROM clients c
           WHERE c.deleted_at IS NULL
             AND (c.primary_rep_id IN (SELECT rep_id FROM manager_reps WHERE manager_id = u.id)
                  OR c.id IN (SELECT s.client_id FROM client_secondary_reps s
                               WHERE s.rep_id IN (SELECT rep_id FROM manager_reps WHERE manager_id = u.id))
                  OR c.primary_rep_id = u.id)) AS clients
    FROM users u
   WHERE u.role = 'manager' AND u.is_active AND u.email IS NOT NULL AND u.email <> ''
   ORDER BY 2 DESC, u.name`);

console.log('\nWEEKLY MANAGER DIGEST — every active manager, team clients + their own');
for (const d of digest) {
  console.log(`  ${String(d.name).padEnd(24)} ${String(d.clients).padStart(5)} client(s)${d.clients ? '' : '   <-- empty digest'}`);
}

// ── the reminder sweeps, which are per-record rather than per-client ──
const { rows: rem } = await c.query(`
  SELECT
    (SELECT count(*)::int FROM tasks t
      WHERE t.status <> 'completed' AND t.due_date < CURRENT_DATE
        AND (t.assigned_to_rep IS NOT NULL OR t.assigned_to_external <> '')) AS overdue_actions_reachable,
    (SELECT count(*)::int FROM tasks t
      WHERE t.status <> 'completed' AND t.due_date < CURRENT_DATE
        AND t.assigned_to_rep IS NULL AND (t.assigned_to_external IS NULL OR t.assigned_to_external = '')) AS overdue_actions_unreachable,
    (SELECT count(*)::int FROM complaints WHERE status NOT IN ('Resolved','Closed')) AS open_complaints`);

console.log('\nREMINDER SWEEPS (daily cron)');
console.log(`  overdue actions with somebody to remind : ${rem[0].overdue_actions_reachable}`);
console.log(`  overdue actions with nobody to remind   : ${rem[0].overdue_actions_unreachable}`);
console.log(`  open complaints                         : ${rem[0].open_complaints}`);

await c.end();
