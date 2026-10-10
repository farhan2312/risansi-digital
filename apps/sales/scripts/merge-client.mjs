#!/usr/bin/env node
// Merge one client record into another.
//
//   node scripts/merge-client.mjs <from-id> <into-id>            dry run
//   node scripts/merge-client.mjs <from-id> <into-id> --apply    do it
//   node scripts/merge-client.mjs --candidates                   archived clients with a live twin
//
// Why this exists: a lead gets created for a company that already has a client
// record, work gets logged against the lead, somebody notices the duplicate and
// archives it — and the visit report, the contacts and the actions vanish with
// it, because every screen reads `deleted_at IS NULL`. That is what happened to
// BLENDTECH ENERGIES LLP (LEAD_BC → BELG01B175) on 30 Aug 2026, and to at least
// one more. The rename was never the problem; renaming follows the id
// everywhere. Archiving the record that held the history was.
//
// The merge moves every child row from `from` to `into` — visits, contacts,
// opportunities, actions, complaints, pumps, comments, sightings, equipment,
// exhibition meetings, secondary reps — leaves `from` archived, and writes an
// audit row on both saying what moved and where. Revenue and orders are refused
// rather than moved: they carry monthly uniqueness and money, and a merge that
// touches them wants a person reading it first.
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const env = {};
for (const l of fs.readFileSync(path.join(ROOT, '.env.local'), 'utf8').split('\n')) {
  const m = l.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/); if (m) env[m[1]] = m[2];
}
const pool = new pg.Pool({
  host: env.DB_HOST, port: Number(env.DB_PORT) || 5432, database: env.RISANSI_DB_NAME,
  user: env.DB_USER, password: env.DB_PASSWORD, ssl: { rejectUnauthorized: false },
});

const args = process.argv.slice(2);
const apply = args.includes('--apply');

if (args.includes('--candidates')) {
  const { rows } = await pool.query(`
    SELECT c.id AS from_id, c.code AS from_code, c.legal_name, c.deleted_at::date AS archived,
           t.id AS into_id, t.code AS into_code,
           (SELECT count(*) FROM visits v WHERE v.client_id = c.id)::int AS visits,
           (SELECT count(*) FROM visits v WHERE v.client_id = c.id AND v.submitted_at IS NOT NULL)::int AS reports,
           (SELECT count(*) FROM opportunities o WHERE o.client_id = c.id)::int AS opps,
           (SELECT count(*) FROM contacts k WHERE k.client_id = c.id)::int AS contacts,
           (SELECT count(*) FROM tasks k WHERE k.client_id = c.id)::int AS actions
      FROM clients c
      JOIN clients t ON t.id <> c.id AND t.deleted_at IS NULL AND upper(btrim(t.legal_name)) = upper(btrim(c.legal_name))
     WHERE c.deleted_at IS NOT NULL
     ORDER BY reports DESC, opps DESC, c.legal_name`);
  console.table(rows);
  console.log(`${rows.length} archived client(s) have a live record with the same name.`);
  await pool.end();
  process.exit(0);
}

const from = Number(args[0]), into = Number(args[1]);
if (!Number.isInteger(from) || !Number.isInteger(into) || from === into) {
  console.error('usage: node scripts/merge-client.mjs <from-id> <into-id> [--apply]   |   --candidates');
  process.exit(2);
}

// Every table that points at clients(id), from the catalogue, so a new table
// cannot be forgotten here. Two are refused, the rest are moved.
const REFUSE = new Set(['client_revenue_monthly', 'orders']);
const { rows: fks } = await pool.query(`
  SELECT tc.table_name, kcu.column_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu ON kcu.constraint_name = tc.constraint_name
    JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name
   WHERE tc.constraint_type = 'FOREIGN KEY' AND ccu.table_name = 'clients' AND ccu.column_name = 'id'
   ORDER BY 1`);

const { rows: [f] } = await pool.query('SELECT id, code, legal_name, deleted_at FROM clients WHERE id = $1', [from]);
const { rows: [t] } = await pool.query('SELECT id, code, legal_name, deleted_at FROM clients WHERE id = $1', [into]);
if (!f || !t) { console.error('no such client'); process.exit(2); }
if (t.deleted_at) { console.error(`${t.code} is archived; merge into a live record.`); process.exit(2); }

console.log(`\n${f.code} · ${f.legal_name}${f.deleted_at ? ' (archived)' : ''}  →  ${t.code} · ${t.legal_name}\n`);
const plan = [];
let refused = 0;
for (const { table_name: tbl, column_name: col } of fks) {
  const { rows: [{ n }] } = await pool.query(`SELECT count(*)::int AS n FROM ${tbl} WHERE ${col} = $1`, [from]);
  if (!n) continue;
  if (REFUSE.has(tbl)) { refused += n; console.log(`  REFUSE ${tbl}: ${n} row(s) — money; merge these by hand`); continue; }
  plan.push({ tbl, col, n });
  console.log(`  move   ${tbl}: ${n}`);
}
if (!plan.length && !refused) console.log('  nothing to move');
if (refused) { console.log('\nstopping: rows refused above'); await pool.end(); process.exit(1); }

if (!apply) { console.log('\ndry run — add --apply to do it'); await pool.end(); process.exit(0); }

const c = await pool.connect();
try {
  await c.query('BEGIN');
  const moved = [];
  for (const { tbl, col, n } of plan) {
    // Tables keyed on (client_id, x) cannot hold the same x twice; the twin's
    // row wins and the duplicate's is dropped, which for a covering-rep or a
    // comment thread is the right answer.
    if (tbl === 'client_secondary_reps') {
      await c.query(`INSERT INTO client_secondary_reps (client_id, rep_id, added_by, added_at)
                       SELECT $2, rep_id, added_by, added_at FROM client_secondary_reps WHERE client_id = $1
                       ON CONFLICT DO NOTHING`, [from, into]);
      await c.query(`DELETE FROM client_secondary_reps WHERE client_id = $1`, [from]);
    } else if (tbl === 'contacts') {
      // One primary contact per client (contacts_one_primary_per_client). The
      // surviving record keeps its primary; an arriving primary becomes an
      // ordinary contact rather than failing the whole merge.
      await c.query(
        `UPDATE contacts SET is_primary = FALSE
          WHERE client_id = $1 AND is_primary
            AND EXISTS (SELECT 1 FROM contacts p WHERE p.client_id = $2 AND p.is_primary)`, [from, into]);
      await c.query(`UPDATE contacts SET client_id = $2 WHERE client_id = $1`, [from, into]);
    } else {
      await c.query(`UPDATE ${tbl} SET ${col} = $2 WHERE ${col} = $1`, [from, into]);
    }
    moved.push(`${tbl} ${n}`);
  }
  // Opportunities that arrive with no rep take the surviving client's owner —
  // the same rule setPrimaryRep applies when an owner is set (migration 0073).
  const { rows: rehomed } = await c.query(
    `UPDATE opportunities o SET rep_id = t.primary_rep_id, updated_at = NOW()
       FROM clients t WHERE t.id = $1 AND o.client_id = t.id AND o.rep_id IS NULL AND t.primary_rep_id IS NOT NULL
     RETURNING o.id`, [into]);
  if (rehomed.length) moved.push(`${rehomed.length} rep-less opportunit${rehomed.length === 1 ? 'y' : 'ies'} given to the owner`);
  // The duplicate stays archived; if it was live, it is archived now.
  await c.query(`UPDATE clients SET deleted_at = COALESCE(deleted_at, NOW()), updated_at = NOW() WHERE id = $1`, [from]);
  const summary = moved.join(', ') || 'nothing';
  await c.query(
    `INSERT INTO audit_log (actor_email, actor_role, action, entity_type, entity_id, entity_label, summary, metadata)
     VALUES ('script:merge-client', 'system', 'merge', 'client', $1, $2, $3, $4::jsonb),
            ('script:merge-client', 'system', 'merge', 'client', $5, $6, $7, $4::jsonb)`,
    [
      String(from), `${f.code} · ${f.legal_name}`, `Merged into ${t.code} · ${t.legal_name}: moved ${summary}. This record stays archived.`,
      JSON.stringify({ from, into, moved: plan }),
      String(into), `${t.code} · ${t.legal_name}`, `Absorbed ${f.code} · ${f.legal_name} (a duplicate): received ${summary}.`,
    ],
  );
  await c.query('COMMIT');
  console.log(`\nmerged: ${summary}`);
} catch (e) { await c.query('ROLLBACK'); throw e; }
finally { c.release(); await pool.end(); }
