#!/usr/bin/env node
// Render the Action Registry dashboard to an HTML file, with real data, and
// check that its numbers add up.
//
//   node scripts/action-stats-preview.mjs
//
// The registry is auth-gated, so this is how the tiles and the four charts get
// looked at without signing in. The checks are the ones that matter for a
// dashboard: every owner's open + done equals their total, overdue never
// exceeds open, every open action lands in exactly one age bucket, and the
// tiles agree with the list's own open/overdue count query.
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import ts from 'typescript';
import { renderToStaticMarkup } from 'react-dom/server';
import React from 'react';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const tmp = fs.mkdtempSync(path.join(ROOT, 'node_modules', '.as-'));
for (const [rel, name] of [
  ['components/risansi/StageCharts.tsx', 'StageCharts'],
  ['components/risansi/ActionStats.tsx', 'ActionStats'],
  ['lib/risansi-stage-dashboard.ts', 'risansi-stage-dashboard'],
  ['lib/risansi-action-stats.ts', 'risansi-action-stats'],
  ['lib/risansi-action-queue.ts', 'risansi-action-queue'],
]) {
  const src = fs.readFileSync(path.join(ROOT, rel), 'utf8')
    .replace(/from '@\/lib\/([^']+)'/g, "from './$1.mjs'")
    .replace(/from '@\/components\/risansi\/([^']+)'/g, "from './$1.mjs'");
  fs.writeFileSync(path.join(tmp, `${name}.mjs`), ts.transpileModule(src, {
    fileName: rel,
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, jsxImportSource: 'react' },
  }).outputText);
}
const imp = (n) => import('file:///' + path.join(tmp, `${n}.mjs`).split(path.sep).join('/'));
const { ActionStats } = await imp('ActionStats');
const { summariseActions } = await imp('risansi-action-stats');
const { buildTasksStatsQuery, buildTasksCountQuery } = await imp('risansi-action-queue');

const env = {};
for (const l of fs.readFileSync(path.join(ROOT, '.env.local'), 'utf8').split('\n')) {
  const m = l.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/); if (m) env[m[1]] = m[2];
}
const pool = new pg.Pool({
  host: env.DB_HOST, port: Number(env.DB_PORT) || 5432, database: env.RISANSI_DB_NAME,
  user: env.DB_USER, password: env.DB_PASSWORD, ssl: { rejectUnauthorized: false },
});

// As an admin on the All actions tab, no filters.
const opts = { isAdmin: true, repId: null, email: 'preview@risansi.com', filters: {}, mine: false };
const sq = buildTasksStatsQuery(opts);
const { rows } = await pool.query(sq.sql, sq.params);
const cq = buildTasksCountQuery(opts);
const { rows: [counts] } = await pool.query(cq.sql, cq.params);
const { rows: [{ today }] } = await pool.query(`SELECT (NOW() AT TIME ZONE 'Asia/Kolkata')::date::text AS today`);
await pool.end();

const s = summariseActions(rows, today);
let bad = 0;
const check = (label, ok) => { if (!ok) bad++; console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}`); };
check(`${s.total} actions · open ${s.open} · overdue ${s.overdue} · done ${s.done}`, s.open + s.done === s.total);
check('tiles agree with the list header count query', s.open === Number(counts.open_count) && s.overdue === Number(counts.overdue_count));
check('overdue never exceeds open', s.overdue <= s.open && s.byOwner.every(o => o.overdue <= o.open));
check('every owner: open + done = total', s.byOwner.every(o => o.open + o.done === o.total));
check('owners sum to the whole', s.byOwner.reduce((a, o) => a + o.total, 0) === s.total);
check('priorities sum to the whole', s.byPriority.reduce((a, o) => a + o.total, 0) === s.total);
check('every open action sits in one age bucket', s.openByAge.reduce((a, b) => a + b.count, 0) === s.open);
check('on-time rate is a fraction of dated closures', s.onTimeRate == null || (s.onTimeRate >= 0 && s.onTimeRate <= 1));
console.log(`\n  avg age of open ${s.avgOpenAge?.toFixed(1)}d · avg time to close ${s.avgTimeToClose?.toFixed(1)}d · on time ${s.onTimeRate == null ? '—' : Math.round(s.onTimeRate * 100) + '%'}`
  + ` · date moves ${s.avgExtensions.toFixed(2)}/action · first response median ${s.medianFirstResponseH ?? '—'}h (${s.respondedCount})`);
console.log('  by owner: ' + s.byOwner.slice(0, 6).map(o => `${o.label} ${o.open}/${o.overdue}/${o.done}`).join(' · '));
console.log('  months: ' + s.months.map(m => `${m.label} ${m.raised}↑${m.closed}↓`).join(' · '));

const html = renderToStaticMarkup(React.createElement(ActionStats, {
  s, hrefOwner: (n) => `?resp=${encodeURIComponent(n)}`, hrefPriority: (p) => `?priority=${p}`,
  selectedOwners: [], selectedPriorities: [],
}));
fs.rmSync(tmp, { recursive: true, force: true });
const out = path.join(ROOT, 'node_modules', '.cache-action-stats.html');
fs.writeFileSync(out,
  `<!doctype html><meta charset="utf-8"><title>Action Registry · dashboard</title>` +
  `<style>:root{--fg:#0D1B2E;--fg-2:#2D3E55;--fg-3:#6B7F96;--fg-4:#A8BAC8;--bg:#F4F6FB;--bg-paper:#fff;--bg-elev:#EDF1F7;--bg-sunk:#E2E8F3;--line:rgba(10,22,40,.08);--line-2:rgba(10,22,40,.05);--line-strong:rgba(10,22,40,.16);--accent:#1A5CB8;--pos:#059669;--neg:#DC2626;--warn:#D97706;--warn-soft:#FEF3C7;--warn-strong:#92400E;--radius:6px;--font-mono:ui-monospace,monospace}` +
  `body{margin:0;padding:22px;background:var(--bg);font:14px system-ui,sans-serif;color:var(--fg)}` +
  `.stage-grid-4{display:grid;grid-template-columns:repeat(auto-fill,470px);gap:12px}</style>${html}`);
console.log(`\n  ${out}`);
process.exit(bad ? 1 : 0);
