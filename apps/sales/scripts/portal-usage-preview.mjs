#!/usr/bin/env node
// Render the individual portal-usage report to an HTML file, with real data.
//
//   node scripts/portal-usage-preview.mjs [email] [30d|90d|180d|all]
//
// A print layout is the one thing you cannot check by reading it: page breaks,
// column widths and whether a table runs off the edge only show up rendered.
// This feeds the real component real rows and writes a file you can open and
// print, without a dev server, a login or a route that would have to be
// deleted afterwards.
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import ts from 'typescript';
import { renderToStaticMarkup } from 'react-dom/server';
import React from 'react';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');

// Transpile the TSX the app uses, rather than a copy of it. '@/…' means nothing
// to plain node, so the alias is rewritten on the way through; the temp dir sits
// inside the project because node resolves `react` by walking up from the file.
const tmp = fs.mkdtempSync(path.join(ROOT, 'node_modules', '.pu-'));
const MODULES = [
  ['components/risansi/PortalUsageReport.tsx', 'PortalUsageReport'],
  ['components/risansi/print-shared.tsx', 'print-shared'],
  ['components/risansi/AutoPrint.tsx', 'AutoPrint'],
  ['lib/risansi-person-metrics.ts', 'risansi-person-metrics'],
];
for (const [rel, name] of MODULES) {
  const src = fs.readFileSync(path.join(ROOT, rel), 'utf8')
    .replace(/from '@\/(?:components\/risansi|lib)\/([^']+)'/g, "from './$1.mjs'")
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
const imp = (n) => import('file:///' + path.join(tmp, `${n}.mjs`).split(path.sep).join('/'));
const { PortalUsageReport, moduleOf } = await imp('PortalUsageReport');
const { loadPersonMetrics, comparePerson, cohortFor, PERSON_WINDOWS } = await imp('risansi-person-metrics');

const env = {};
for (const line of fs.readFileSync(path.join(ROOT, '.env.local'), 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/); if (m) env[m[1]] = m[2];
}
const pool = new pg.Pool({
  host: env.DB_HOST, port: Number(env.DB_PORT) || 5432, database: env.RISANSI_DB_NAME,
  user: env.DB_USER, password: env.DB_PASSWORD, ssl: { rejectUnauthorized: false },
});

const winId = process.argv[3] ?? '90d';
const win = PERSON_WINDOWS.find(w => w.id === winId) ?? PERSON_WINDOWS[0];
const all = await loadPersonMetrics(pool, win.days);

// Default to the busiest rep: the report is meant for sales staff, and an empty
// one tells you nothing about whether the layout holds.
const wanted = (process.argv[2] ?? '').toLowerCase();
const subject = wanted
  ? all.find(r => r.email.toLowerCase() === wanted)
  : [...all].filter(r => r.role === 'rep').sort((a, b) => b.hours - a.hours)[0] ?? all[0];
if (!subject) { console.error('no such user'); process.exit(1); }

const { rows: cohort, label: cohortLabel } = cohortFor(subject, all);
const cmp = comparePerson(subject, cohort);

const winClause = win.interval ? ` AND p.occurred_at >= NOW() - INTERVAL '${win.interval}'` : '';
const { rows: modules } = await pool.query(`
  SELECT p.path,
         COALESCE(round(sum(p.active_seconds) FILTER (WHERE p.user_id = ${subject.id})/3600.0, 2), 0)::text AS mine,
         COALESCE(round(sum(p.active_seconds)/3600.0, 2), 0)::text AS cohort_hours
    FROM page_activity p
   WHERE p.user_id IN (${cohort.map(r => r.id).join(',') || '0'})${winClause}
   GROUP BY p.path`);
const mine = new Map(), grp = new Map();
for (const r of modules) {
  const m = moduleOf(r.path);
  mine.set(m, (mine.get(m) ?? 0) + Number(r.mine));
  grp.set(m, (grp.get(m) ?? 0) + Number(r.cohort_hours));
}
const modRows = [...mine.entries()]
  .map(([m, h]) => ({ m, mine: h, avg: (grp.get(m) ?? 0) / Math.max(cohort.length, 1) }))
  .filter(r => r.mine > 0.01).sort((a, b) => b.mine - a.mine).slice(0, 10);

const { rows: trendRows } = await pool.query(`
  SELECT to_char(p.occurred_at AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM') AS ym,
         round(sum(p.active_seconds)/3600.0, 1)::text AS hours,
         count(DISTINCT (p.occurred_at AT TIME ZONE 'Asia/Kolkata')::date)::text AS days,
         count(DISTINCT p.session_id)::text AS sessions
    FROM page_activity p WHERE p.user_id = ${subject.id}${winClause}
   GROUP BY 1 ORDER BY 1`);

await pool.end();

const html = renderToStaticMarkup(React.createElement(PortalUsageReport, {
  subject, cmp, cohortLabel, cohortSize: cohort.length, winLabel: win.label, modRows,
  trend: trendRows.map(t => ({ ym: t.ym, hours: +t.hours, days: +t.days, sessions: +t.sessions })),
  generated: new Date().toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' }),
  generatedBy: 'preview',
  autoPrint: false,
}));

fs.rmSync(tmp, { recursive: true, force: true });

const out = path.join(ROOT, 'node_modules', '.cache-portal-usage-preview.html');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out,
  `<!doctype html><meta charset="utf-8"><title>${subject.name} — portal usage</title>` +
  `<style>body{margin:0;background:#F1F5F9}img{max-width:100%}</style>${html}`);

console.log(`${subject.name} (${subject.role}) vs ${cohortLabel}, ${win.label}`);
console.log(`  ${modRows.length} modules, ${trendRows.length} months, ${cmp.length} metrics`);
console.log(`  ${out}`);
