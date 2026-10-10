#!/usr/bin/env node
// Before dropping tour_assignments: what is in it, what depends on it, and a
// copy of every row on disk.
//
//   node scripts/tour-assignments-archive.mjs
//
// Read-only against the database. Writes archive/tour_assignments-<rows>.json
// and a matching .sql of INSERT statements, so the table can be reconstructed
// from this repo if the drop ever has to be undone. A DROP TABLE is the one
// migration that cannot be rolled back by running another migration, and the
// rows are small enough that keeping them costs nothing.
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

// ── what depends on it ────────────────────────────────────────────
const deps = await c.query(`
  SELECT con.conname, con.contype,
         src.relname AS from_table, tgt.relname AS to_table
    FROM pg_constraint con
    JOIN pg_class src ON src.oid = con.conrelid
    LEFT JOIN pg_class tgt ON tgt.oid = con.confrelid
   WHERE src.relname = 'tour_assignments' OR tgt.relname = 'tour_assignments'
   ORDER BY con.contype, con.conname`);

const views = await c.query(`
  SELECT DISTINCT dependent.relname AS view_name
    FROM pg_depend d
    JOIN pg_rewrite r ON r.oid = d.objid
    JOIN pg_class dependent ON dependent.oid = r.ev_class
    JOIN pg_class source ON source.oid = d.refobjid
   WHERE source.relname = 'tour_assignments' AND dependent.relkind IN ('v','m')`);

console.log('CONSTRAINTS touching tour_assignments');
for (const r of deps.rows) {
  const dir = r.from_table === 'tour_assignments' ? `-> ${r.to_table ?? '(self)'}` : `<- ${r.from_table}`;
  console.log(`  ${r.contype}  ${r.conname.padEnd(42)} ${dir}`);
}
console.log(`\nVIEWS depending on it: ${views.rows.length ? views.rows.map(v => v.view_name).join(', ') : 'none'}`);

// Anything pointing AT the table would break on a drop. Nothing should.
const inbound = deps.rows.filter(r => r.to_table === 'tour_assignments' && r.from_table !== 'tour_assignments');
console.log(`INBOUND foreign keys (these would block the drop): ${inbound.length ? inbound.map(r => r.from_table).join(', ') : 'none'}`);

// ── the rows ──────────────────────────────────────────────────────
const { rows } = await c.query(`
  SELECT ta.id, ta.tour_id, ta.rep_id, ta.role, ta.assigned_by, ta.assigned_at,
         tr.name AS tour_name, u.name AS rep_name, u.email AS rep_email
    FROM tour_assignments ta
    LEFT JOIN tour_routes tr ON tr.id = ta.tour_id
    LEFT JOIN users u ON u.id = ta.rep_id
   ORDER BY ta.tour_id, ta.rep_id`);

const dir = path.join(ROOT, 'archive');
fs.mkdirSync(dir, { recursive: true });
const jsonPath = path.join(dir, `tour_assignments-${rows.length}.json`);
fs.writeFileSync(jsonPath, JSON.stringify(rows, null, 2), 'utf8');

const q = (v) => v === null || v === undefined ? 'NULL' : `'${String(v).split("'").join("''")}'`;
// The DDL below is the live table's, read from information_schema rather than
// written from memory — a restore script that reconstructs a slightly different
// table is worse than none, because it looks like it worked.
const sql = [
  '-- Reconstructs tour_assignments as it stood immediately before migration 0066.',
  '-- The tour_id / rep_id columns are meaningless without the tour_routes and',
  '-- users rows they pointed at, so restore those first if they have moved on.',
  'CREATE TABLE IF NOT EXISTS tour_assignments (',
  '  id          serial PRIMARY KEY,',
  '  tour_id     integer NOT NULL REFERENCES tour_routes(id) ON DELETE CASCADE,',
  '  rep_id      integer NOT NULL REFERENCES users(id),',
  "  role        varchar NOT NULL DEFAULT 'rep' CHECK (role IN ('rep','manager')),",
  '  assigned_by varchar,',
  '  assigned_at timestamptz DEFAULT NOW(),',
  '  UNIQUE (tour_id, rep_id)',
  ');',
  'CREATE INDEX IF NOT EXISTS idx_tour_assignments_tour ON tour_assignments(tour_id);',
  'CREATE INDEX IF NOT EXISTS idx_tour_assignments_rep  ON tour_assignments(rep_id);',
  '',
  ...rows.map(r =>
    `INSERT INTO tour_assignments (id, tour_id, rep_id, role, assigned_by, assigned_at) VALUES `
    + `(${r.id}, ${r.tour_id}, ${r.rep_id}, ${q(r.role)}, ${q(r.assigned_by)}, ${q(r.assigned_at?.toISOString?.() ?? r.assigned_at)});`),
  '',
  "SELECT setval('tour_assignments_id_seq', COALESCE((SELECT MAX(id) FROM tour_assignments), 1));",
].join('\n');
const sqlPath = path.join(dir, `tour_assignments-${rows.length}.sql`);
fs.writeFileSync(sqlPath, sql + '\n', 'utf8');

const byRole = rows.reduce((m, r) => ((m[r.role] = (m[r.role] ?? 0) + 1), m), {});
console.log(`\nROWS: ${rows.length}  (${Object.entries(byRole).map(([k, v]) => `${v} ${k}`).join(', ')})`);
console.log(`  people: ${new Set(rows.map(r => r.rep_id)).size}   routes: ${new Set(rows.map(r => r.tour_id)).size}`);
console.log(`\nwrote ${path.relative(ROOT, jsonPath)}`);
console.log(`wrote ${path.relative(ROOT, sqlPath)}`);

await c.end();
