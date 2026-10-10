#!/usr/bin/env node
// The adoption report, written to a file.
//
//   node scripts/user-adoption-report.mjs
//
// The report itself lives in lib/risansi-adoption-report.ts, which is what the
// download button on the Audit Log page uses. This script transpiles that module
// and runs it rather than holding a second copy of the queries and the layout:
// two implementations of a management report is two answers to the same
// question, and the one nobody regenerated is the one that gets quoted.
//
// Useful for checking a change to the report without a dev server and a login,
// and for handing somebody the file directly.
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import ts from 'typescript';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');

// ── transpile the two TS modules into a temp dir and import them ──
// The '@/lib/...' alias means nothing to plain node, so it is rewritten to a
// relative path on the way through.
// Inside the project, not the system temp dir: node resolves `exceljs` and
// `jszip` by walking up from the importing file, and from /tmp there is no
// node_modules to find.
const tmp = fs.mkdtempSync(path.join(ROOT, 'node_modules', '.adoption-'));
for (const name of ['xlsx-charts', 'risansi-adoption-report']) {
  const src = fs.readFileSync(path.join(ROOT, 'lib', `${name}.ts`), 'utf8')
    .replace(/from '@\/lib\/([^']+)'/g, "from './$1.mjs'");
  const js = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  fs.writeFileSync(path.join(tmp, `${name}.mjs`), js);
}
const { buildAdoptionReport } = await import(
  path.join(tmp, 'risansi-adoption-report.mjs').replace(/\\/g, '/').replace(/^([A-Za-z]:)/, 'file:///$1')
);

// ── run it ────────────────────────────────────────────────────────
const env = {};
for (const line of fs.readFileSync(path.join(ROOT, '.env.local'), 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/); if (m) env[m[1]] = m[2];
}
const pool = new pg.Pool({
  host: env.DB_HOST, port: Number(env.DB_PORT) || 5432, database: env.RISANSI_DB_NAME,
  user: env.DB_USER, password: env.DB_PASSWORD, ssl: { rejectUnauthorized: false },
});

const { buffer, summary } = await buildAdoptionReport(pool);
await pool.end();
fs.rmSync(tmp, { recursive: true, force: true });

const outDir = path.join(ROOT, 'reports');
fs.mkdirSync(outDir, { recursive: true });
const out = path.join(outDir, `user-adoption-${new Date().toISOString().slice(0, 10)}.xlsx`);
fs.writeFileSync(out, buffer);

console.log(`Portal adoption, ${summary.from} to ${summary.to}\n`);
console.log(`  active accounts        ${summary.accounts}`);
console.log(`  have signed in         ${summary.signedIn}`);
console.log(`  never signed in        ${summary.neverIn.length}${summary.neverIn.length ? '  (' + summary.neverIn.join(', ') + ')' : ''}`);
console.log(`  sessions               ${summary.sessions.toLocaleString('en-IN')}`);
console.log(`  active hours           ${summary.hours.toLocaleString('en-IN')}`);
console.log(`  recorded actions       ${summary.records.toLocaleString('en-IN')}`);
console.log(`\n  ${path.relative(ROOT, out)}  (${(buffer.length / 1024).toFixed(0)} KB)`);
console.log(`  verify with: node scripts/verify-xlsx.mjs ${path.relative(ROOT, out).replace(/\\/g, '/')}`);
