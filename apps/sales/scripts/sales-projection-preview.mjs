#!/usr/bin/env node
// Render the Sales Projection section to an HTML file, with real data.
//
//   node scripts/sales-projection-preview.mjs [quarterly|monthly] [fyStartYear]
//
// Same reason as the print previews: a wide table with sticky columns and a
// coverage band is not something you can check by reading the source.
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import ts from 'typescript';
import { renderToStaticMarkup } from 'react-dom/server';
import React from 'react';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const tmp = fs.mkdtempSync(path.join(ROOT, 'node_modules', '.sp-'));
for (const [rel, name] of [
  ['components/risansi/SalesProjection.tsx', 'SalesProjection'],
  ['lib/risansi-sales-projection.ts', 'risansi-sales-projection'],
]) {
  const src = fs.readFileSync(path.join(ROOT, rel), 'utf8')
    .replace(/from '@\/lib\/([^']+)'/g, "from './$1.mjs'")
    .replace(/^import Link from 'next\/link';$/m,
      "const Link = ({ href, children, ...p }) => React.createElement('a', { href, ...p }, children);\nimport React from 'react';");
  fs.writeFileSync(path.join(tmp, `${name}.mjs`), ts.transpileModule(src, {
    fileName: rel,
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, jsxImportSource: 'react' },
  }).outputText);
}
const imp = (n) => import('file:///' + path.join(tmp, `${n}.mjs`).split(path.sep).join('/'));
const { SalesProjection } = await imp('SalesProjection');
const { loadProjection } = await imp('risansi-sales-projection');

const env = {};
for (const l of fs.readFileSync(path.join(ROOT, '.env.local'), 'utf8').split('\n')) {
  const m = l.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/); if (m) env[m[1]] = m[2];
}
const pool = new pg.Pool({
  host: env.DB_HOST, port: Number(env.DB_PORT) || 5432, database: env.RISANSI_DB_NAME,
  user: env.DB_USER, password: env.DB_PASSWORD, ssl: { rejectUnauthorized: false },
});

const mode = process.argv[2] === 'monthly' ? 'monthly' : 'quarterly';
const fy = Number(process.argv[3]) || 2026;
const d = await loadProjection(pool, fy, null);

// The visibility scope has to actually narrow: an admin sees every rep, a rep
// must see one. Checked here rather than trusted, because it is access control.
const one = d.reps[0];
const scoped = await loadProjection(pool, fy, one ? [one.repId] : []);
const none = await loadProjection(pool, fy, []);
await pool.end();

console.log(`all reps: ${d.reps.length}`);
console.log(`scoped to ${one?.name}: ${scoped.reps.length} rep(s) — ${scoped.reps.map(r => r.name).join(', ')}`);
console.log(`scoped to []: ${none.reps.length} rep(s), open Rs ${(none.coverage.openGross / 1e7).toFixed(2)} Cr`);
let bad = 0;
if (scoped.reps.length !== 1) { console.log('FAIL: a one-rep scope did not return exactly one rep'); bad++; }
if (none.reps.length !== 0 || none.coverage.openGross !== 0) { console.log('FAIL: an empty scope leaked data'); bad++; }
if (scoped.coverage.openGross >= d.coverage.openGross) { console.log('FAIL: scoped coverage is not narrower'); bad++; }

const html = renderToStaticMarkup(React.createElement(SalesProjection, {
  d, mode, hrefFor: (m) => `?proj=${m}`,
}));
fs.rmSync(tmp, { recursive: true, force: true });
const out = path.join(ROOT, 'node_modules', '.cache-sales-projection.html');
fs.writeFileSync(out,
  `<!doctype html><meta charset="utf-8"><title>Sales Projection</title>` +
  `<style>:root{--fg:#0D1B2E;--fg-2:#2D3E55;--fg-3:#6B7F96;--fg-4:#A8BAC8;--bg:#F4F6FB;--bg-paper:#fff;--bg-elev:#EDF1F7;--bg-sunk:#E2E8F3;--line:rgba(10,22,40,.08);--line-2:rgba(10,22,40,.05);--line-strong:rgba(10,22,40,.16);--accent:#1A5CB8;--pos:#059669;--neg:#DC2626;--warn:#D97706;--warn-soft:#FEF3C7;--warn-strong:#92400E;--radius:6px;--font-mono:ui-monospace,monospace}` +
  `body{margin:0;padding:22px;background:var(--bg);font:14px system-ui,sans-serif;color:var(--fg)}</style>${html}`);
console.log(`\n  ${out}`);
process.exit(bad ? 1 : 0);
