#!/usr/bin/env node
// Lightweight, dependency-free migration runner for the Risansi Postgres DB.
//
//   node scripts/migrate.mjs            → apply all pending migrations
//   node scripts/migrate.mjs --status   → list applied / pending, apply nothing
//
// Migrations live in /migrations and are applied in filename order. Two kinds:
//   *.sql  → executed verbatim (may contain multiple statements)
//   *.mjs  → `export default async (client) => { ... }`, run with the live client
// Each migration runs inside its own transaction and is recorded in
// schema_migrations; a failure rolls that migration back and halts the run.

import { readFileSync, readdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import pg from 'pg';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const MIGRATIONS_DIR = path.join(ROOT, 'migrations');

// ── Load .env.local (standalone script — Next doesn't inject env here) ──
const env = {};
const raw = readFileSync(path.join(ROOT, '.env.local'), 'utf8').replace(/^﻿/, '');
for (const line of raw.split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
  if (m) env[m[1]] = m[2];
}

const statusOnly = process.argv.includes('--status');

const client = new pg.Client({
  host: env.DB_HOST,
  port: Number(env.DB_PORT) || 5432,
  database: env.RISANSI_DB_NAME,
  user: env.DB_USER,
  password: env.DB_PASSWORD,
  ssl: { rejectUnauthorized: false },
});

async function main() {
  await client.connect();

  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`);

  const applied = new Set(
    (await client.query('SELECT version FROM schema_migrations')).rows.map(r => r.version),
  );

  const files = readdirSync(MIGRATIONS_DIR)
    .filter(f => f.endsWith('.sql') || f.endsWith('.mjs'))
    .sort();

  const pending = files.filter(f => !applied.has(f));

  if (statusOnly) {
    console.log('Applied:');
    for (const f of files.filter(f => applied.has(f))) console.log('  ✓', f);
    console.log('Pending:');
    for (const f of pending) console.log('  •', f);
    if (!pending.length) console.log('  (none)');
    return;
  }

  if (!pending.length) {
    console.log('Nothing to apply — database is up to date.');
    return;
  }

  for (const file of pending) {
    const full = path.join(MIGRATIONS_DIR, file);
    process.stdout.write(`Applying ${file} … `);
    try {
      await client.query('BEGIN');
      if (file.endsWith('.sql')) {
        await client.query(readFileSync(full, 'utf8'));
      } else {
        const mod = await import(pathToFileURL(full).href);
        if (typeof mod.default !== 'function') {
          throw new Error(`${file} must export a default async (client) => {} function`);
        }
        await mod.default(client);
      }
      await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [file]);
      await client.query('COMMIT');
      console.log('done');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      console.log('FAILED');
      console.error(`\nMigration ${file} failed and was rolled back:\n`, err.message);
      process.exitCode = 1;
      return;
    }
  }
  console.log(`\n✓ Applied ${pending.length} migration(s).`);
}

main().finally(() => client.end());
