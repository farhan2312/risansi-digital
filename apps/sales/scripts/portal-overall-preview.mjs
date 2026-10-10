#!/usr/bin/env node
// Render the Overall-tab handout to an HTML file, with real data.
//
//   node scripts/portal-overall-preview.mjs [1d|7d|30d|90d|all] [role] [email]
//
// Same purpose as scripts/portal-usage-preview.mjs: a print layout cannot be
// checked by reading it. Writes a file you can open and print, without a dev
// server, a login, or a route that would have to be deleted afterwards.
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import ts from 'typescript';
import { renderToStaticMarkup } from 'react-dom/server';
import React from 'react';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');

const tmp = fs.mkdtempSync(path.join(ROOT, 'node_modules', '.po-'));
const MODULES = [
  ['components/risansi/PortalOverallReport.tsx', 'PortalOverallReport'],
  ['components/risansi/AuditOverall.tsx', 'AuditOverall'],
  ['components/risansi/print-shared.tsx', 'print-shared'],
  ['components/risansi/AutoPrint.tsx', 'AutoPrint'],
  ['lib/risansi-audit-overall.ts', 'risansi-audit-overall'],
];
for (const [rel, name] of MODULES) {
  const src = fs.readFileSync(path.join(ROOT, rel), 'utf8')
    .replace(/from '@\/(?:components\/risansi|lib|app\/actions)\/([^']+)'/g, "from './$1.mjs'")
    // Relative sibling imports need the extension node resolves by.
    .replace(/from '\.\/([A-Za-z0-9_-]+)'/g, "from './$1.mjs'")
    // next/link is a plain anchor for a static render.
    .replace(/^import Link from 'next\/link';$/m, "const Link = ({ href, children, ...p }) => React.createElement('a', { href, ...p }, children);\nimport React from 'react';")
    .replace(/^'use client';?\n/m, '');
  fs.writeFileSync(path.join(tmp, `${name}.mjs`), ts.transpileModule(src, {
    // fileName decides TS vs TSX. Without it a generic arrow in a .ts file
    // (`async <T>(…)`) is parsed as an unclosed JSX tag and emits nonsense.
    fileName: rel,
    compilerOptions: {
      module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX, jsxImportSource: 'react',
    },
  }).outputText);
}
// The drill-down panel is a client component wired to a server action, and the
// print layout never mounts it — DrillTile renders its children plainly with no
// provider above it. A stub keeps this preview from pulling a database pool in
// through a module the handout does not use.
fs.writeFileSync(path.join(tmp, 'AuditDrilldown.mjs'),
  'export const AuditDrilldownProvider = ({ children }) => children; '
  + 'export const DrillTile = ({ children }) => children;');

const imp = (n) => import('file:///' + path.join(tmp, `${n}.mjs`).split(path.sep).join('/'));
const { PortalOverallReport } = await imp('PortalOverallReport');
const { loadOverall, OVERALL_WINDOWS } = await imp('risansi-audit-overall');

const env = {};
for (const line of fs.readFileSync(path.join(ROOT, '.env.local'), 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/); if (m) env[m[1]] = m[2];
}
const pool = new pg.Pool({
  host: env.DB_HOST, port: Number(env.DB_PORT) || 5432, database: env.RISANSI_DB_NAME,
  user: env.DB_USER, password: env.DB_PASSWORD, ssl: { rejectUnauthorized: false },
});

const win = OVERALL_WINDOWS.some(w => w.id === process.argv[2]) ? process.argv[2] : '30d';
const role = process.argv[3] ?? '';
const user = (process.argv[4] ?? '').toLowerCase();
const d = await loadOverall(pool, { win, role, user });
await pool.end();

const filters = [
  OVERALL_WINDOWS.find(w => w.id === win)?.label ?? win,
  role ? `${role}s only` : null,
  user || null,
].filter(Boolean).join(' · ');

const html = renderToStaticMarkup(React.createElement(PortalOverallReport, {
  d, win, role, user, filters,
  generated: new Date().toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' }),
  generatedBy: 'preview',
  autoPrint: false,
}));

fs.rmSync(tmp, { recursive: true, force: true });

const out = path.join(ROOT, 'node_modules', '.cache-portal-overall-preview.html');
fs.writeFileSync(out,
  `<!doctype html><meta charset="utf-8"><title>Portal usage — ${filters}</title>` +
  `<style>body{margin:0;background:#fff}img{max-width:100%}</style>${html}`);

console.log(`${filters}`);
console.log(`  ${d.kpi.activeUsers}/${d.kpi.accounts} users · ${d.kpi.hours}h · ${d.daily.length} days · ${d.people.length} people`);
console.log(`  ${out}`);
