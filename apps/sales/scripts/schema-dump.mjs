// Dump the live Risansi schema to JSON: tables, columns, keys, foreign keys,
// unique constraints, indexes, CHECK value lists and row counts.
//
// Structure only — no row data ever leaves the database here.
//   node scripts/schema-dump.mjs > schema.json
import { readFileSync } from 'node:fs';
import path from 'node:path';
import pg from 'pg';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const env = {};
for (const line of readFileSync(path.join(ROOT, '.env.local'), 'utf8').replace(/^﻿/, '').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}

const client = new pg.Client({
  host: env.DB_HOST, port: Number(env.DB_PORT) || 5432, database: env.RISANSI_DB_NAME,
  user: env.DB_USER, password: env.DB_PASSWORD, ssl: { rejectUnauthorized: false },
});
await client.connect();
const q = async (sql, vals = []) => (await client.query(sql, vals)).rows;

const tables = await q(`
  SELECT c.relname AS table_name,
         obj_description(c.oid) AS table_comment,
         pg_size_pretty(pg_total_relation_size(c.oid)) AS total_size
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relkind = 'r'
   ORDER BY c.relname`);

const columns = await q(`
  SELECT c.table_name, c.column_name, c.ordinal_position, c.data_type,
         c.udt_name, c.character_maximum_length, c.numeric_precision, c.numeric_scale,
         c.is_nullable, c.column_default,
         col_description(format('public.%I', c.table_name)::regclass, c.ordinal_position) AS column_comment
    FROM information_schema.columns c
   WHERE c.table_schema = 'public'
   ORDER BY c.table_name, c.ordinal_position`);

const constraints = await q(`
  SELECT con.conname, con.contype, cl.relname AS table_name,
         pg_get_constraintdef(con.oid) AS definition,
         -- ::text[] because pg's client does not parse the name[] type and would
         -- hand back the raw literal '{col}' as a string.
         ARRAY(SELECT attname::text FROM pg_attribute
                WHERE attrelid = cl.oid AND attnum = ANY(con.conkey) ORDER BY attnum)::text[] AS columns,
         fcl.relname AS ref_table,
         ARRAY(SELECT attname::text FROM pg_attribute
                WHERE attrelid = fcl.oid AND attnum = ANY(con.confkey) ORDER BY attnum)::text[] AS ref_columns,
         con.confdeltype, con.confupdtype
    FROM pg_constraint con
    JOIN pg_class cl ON cl.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = cl.relnamespace
    LEFT JOIN pg_class fcl ON fcl.oid = con.confrelid
   WHERE n.nspname = 'public'
   ORDER BY cl.relname, con.contype, con.conname`);

const indexes = await q(`
  SELECT tablename AS table_name, indexname, indexdef
    FROM pg_indexes WHERE schemaname = 'public'
   ORDER BY tablename, indexname`);

// Row counts, and per-column fill rate so the guide can say which columns are
// actually populated — an empty column is a trap for anyone building a visual.
const stats = {};
for (const t of tables) {
  const [{ n }] = await q(`SELECT count(*)::int AS n FROM "${t.table_name}"`);
  stats[t.table_name] = { rows: n, fill: {} };
  if (n === 0) continue;
  const cols = columns.filter(c => c.table_name === t.table_name);
  for (const c of cols) {
    // bytea columns are never imported to Power BI; counting them is wasted IO.
    if (c.udt_name === 'bytea') { stats[t.table_name].fill[c.column_name] = null; continue; }
    const [{ f }] = await q(
      `SELECT count("${c.column_name}")::int AS f FROM "${t.table_name}"`);
    stats[t.table_name].fill[c.column_name] = f;
  }
}

// Distinct value lists for the ENUM-LIKE columns — the vocabulary a slicer will
// show. This is deliberately conservative: the guide documents structure, not
// data, and a column is only low-cardinality-by-vocabulary if it is genuinely a
// controlled list. A free-text column in a table with six rows is also
// "low cardinality", and publishing it would put real customer text in a file
// meant to contain none.
const FREE_TEXT = new RegExp([
  'phone', 'mobile', 'whatsapp', 'email', 'person', 'contact', 'name',
  'title', 'body', 'comment', 'reason', 'text', 'note', 'remark', 'summary',
  'detail', 'description', 'discussion', 'requirement', 'next_action',
  'feedback', 'spec', 'caption', 'vendor', 'organizer', 'venue', 'website',
  'url', 'link', 'actor', 'address', 'intervention', 'desc', '_by$', '_raw$',
  '^value$', 'agent',
].join('|'), 'i');

const checkCols = new Set(
  constraints.filter(c => c.contype === 'c').flatMap(c => c.columns.map(col => `${c.table_name}.${col}`)),
);

const vocab = {};
for (const t of tables) {
  const rows = stats[t.table_name].rows;
  if (!rows) continue;
  for (const c of columns.filter(x => x.table_name === t.table_name)) {
    if (!['text', 'character varying'].includes(c.data_type)) continue;
    const key = `${t.table_name}.${c.column_name}`;
    const enforced = checkCols.has(key);
    // A CHECK constraint proves the list is controlled, so those are always in.
    // Everything else must clear all three guards.
    if (!enforced) {
      if (FREE_TEXT.test(c.column_name)) continue;
      if (rows < 20) continue;                    // too few rows to mean anything
    }
    const [{ d, maxlen }] = await q(
      `SELECT count(DISTINCT "${c.column_name}")::int AS d,
              COALESCE(max(length("${c.column_name}")), 0)::int AS maxlen
         FROM "${t.table_name}"`);
    if (d === 0 || d > 25) continue;
    if (!enforced && maxlen > 40) continue;       // long strings are prose, not a vocabulary
    const vals = await q(
      `SELECT DISTINCT "${c.column_name}"::text AS v FROM "${t.table_name}"
        WHERE "${c.column_name}" IS NOT NULL ORDER BY 1 LIMIT 25`);
    vocab[key] = vals.map(r => r.v);
  }
}

console.log(JSON.stringify({
  generated_at: new Date().toISOString().slice(0, 10),
  database: env.RISANSI_DB_NAME,
  tables, columns, constraints, indexes, stats, vocab,
}, null, 1));

await client.end();
