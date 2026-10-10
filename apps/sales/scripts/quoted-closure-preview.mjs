#!/usr/bin/env node
// Render the Quoted page's top row of analytics to an HTML file, with real data.
//
//   node scripts/quoted-closure-preview.mjs
//
// Four panels — Quote ageing, Closing by month, Closing by quarter, Target date
// set — in the same two-by-four grid the page uses. The page is auth-gated, so
// this is the only way to look at nine columns of month labels in a quarter of
// the screen without signing in. Also asserts the closure maths adds up.
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import ts from 'typescript';
import { renderToStaticMarkup } from 'react-dom/server';
import React from 'react';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const tmp = fs.mkdtempSync(path.join(ROOT, 'node_modules', '.qc-'));
for (const [rel, name] of [
  ['components/risansi/StageCharts.tsx', 'StageCharts'],
  ['lib/risansi-stage-dashboard.ts', 'risansi-stage-dashboard'],
]) {
  const src = fs.readFileSync(path.join(ROOT, rel), 'utf8')
    .replace(/from '@\/lib\/([^']+)'/g, "from './$1.mjs'");
  fs.writeFileSync(path.join(tmp, `${name}.mjs`), ts.transpileModule(src, {
    fileName: rel,
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, jsxImportSource: 'react' },
  }).outputText);
}
const imp = (n) => import('file:///' + path.join(tmp, `${n}.mjs`).split(path.sep).join('/'));
const { ChartPanel, AgeingBars, ClosureBars, CoverageList, BarList } = await imp('StageCharts');
const { summariseStage, summariseClosure, todayMonthIdx, applySelection, dimValue } = await imp('risansi-stage-dashboard');

const env = {};
for (const l of fs.readFileSync(path.join(ROOT, '.env.local'), 'utf8').split('\n')) {
  const m = l.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/); if (m) env[m[1]] = m[2];
}
const pool = new pg.Pool({
  host: env.DB_HOST, port: Number(env.DB_PORT) || 5432, database: env.RISANSI_DB_NAME,
  user: env.DB_USER, password: env.DB_PASSWORD, ssl: { rejectUnauthorized: false },
});
const { rows } = await pool.query(`
  SELECT o.id::text, o.product_type, COALESCE(o.value_cr,0)::float8 AS value_cr, o.final_value_cr::float8 AS final_cr,
         o.quote_date::text AS quote_date, o.market, o.client_id::text, c.legal_name AS client_name,
         c.industry, c.client_type, COALESCE(u.name,'—') AS rep_name,
         o.offer_value_inr::float8 AS offer_inr, o.revised_offer_value_inr::float8 AS revised_inr, 0 AS rev_count,
         0 AS so_sum_cr, o.lost_to_competitor, o.lost_reason, o.drop_reason,
         CASE WHEN o.quote_date IS NULL THEN NULL ELSE (CURRENT_DATE - o.quote_date)::int END AS age_days,
         o.eta_text
    FROM opportunities o JOIN clients c ON c.id = o.client_id LEFT JOIN users u ON u.id = o.rep_id
   WHERE o.stage = 'Quoted'`);
await pool.end();

const A = summariseStage(rows);
const C = summariseClosure(rows, todayMonthIdx());
const n = rows.length, totalCr = A.totalCr;
const fmtCr = (v) => `₹${v.toFixed(v >= 10 ? 1 : 2)} Cr`;

let bad = 0;
const check = (label, ok) => { if (!ok) bad++; console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}`); };
check(`month buckets sum to ${n}`, C.months.reduce((s, b) => s + b.count, 0) === n);
check(`quarter buckets sum to ${n}`, C.quarters.reduce((s, b) => s + b.count, 0) === n);
check('month values sum to the total', Math.abs(C.months.reduce((s, b) => s + b.value, 0) - totalCr) < 1e-6);
check('quarter values sum to the total', Math.abs(C.quarters.reduce((s, b) => s + b.value, 0) - totalCr) < 1e-6);
check('overdue is the same line in both views', C.months[0].count === C.quarters[0].count);
check('rep coverage totals sum to n', C.byRep.reduce((s, r) => s + r.total, 0) === n);
// Click-to-filter: every bar a chart draws must select exactly the rows it
// counts, on every dimension the Quoted page offers. If these disagree, a click
// narrows the table to a different set than the bar the person pressed.
const today = todayMonthIdx();
const bars = {
  age:    A.ageBuckets.map(b => [b.label, b.count]),
  etam:   C.months.map(b => [b.label, b.count]),
  etaq:   C.quarters.map(b => [b.label, b.count]),
  ptype:  A.group(r => r.product_type).map(b => [b.label, b.count]),
  rep:    A.group(r => r.rep_name).map(b => [b.label, b.count]),
  client: A.group(r => r.client_name, 8).map(b => [b.label, b.count]),
  market: [['Domestic', rows.filter(r => r.market === 'DOMESTIC').length], ['Export', rows.filter(r => r.market === 'EXPORT').length],
           ['Unrecorded', rows.filter(r => r.market !== 'DOMESTIC' && r.market !== 'EXPORT').length]],
};
let barsChecked = 0;
for (const [dim, list] of Object.entries(bars)) {
  for (const [label, count] of list) {
    const got = applySelection(rows, { [dim]: label }, today).length;
    barsChecked++;
    if (got !== count) { bad++; console.log(`  FAIL ${dim} "${label}": bar says ${count}, selection returns ${got}`); }
  }
}
check(`every bar selects exactly its own rows (${barsChecked} bars over ${Object.keys(bars).length} dimensions)`, true);
// Two dimensions combine: rows matching both, and a chart of one dim under the other's selection.
const two = applySelection(rows, { etam: C.months[2].label, ptype: 'PCP' }, today);
const exceptEtam = applySelection(rows, { etam: C.months[2].label, ptype: 'PCP' }, today, 'etam');
check(`combined selection is the intersection (${two.length} rows) and the source chart keeps the other dims (${exceptEtam.length} rows)`,
  two.every(r => dimValue('etam', r, today) === C.months[2].label && dimValue('ptype', r, today) === 'PCP')
  && exceptEtam.every(r => dimValue('ptype', r, today) === 'PCP') && exceptEtam.length >= two.length);

console.log(`\n  ${C.dated} of ${n} dated (${fmtCr(C.datedCr)} of ${fmtCr(totalCr)}) · ${C.overdue} overdue`);
console.log('  ' + C.months.map(b => `${b.label} ${b.count}`).join(' · '));
console.log('  ' + C.quarters.map(b => `${b.label} ${b.count}`).join(' · '));

const h = React.createElement;
const html = renderToStaticMarkup(h('div', { className: 'stage-grid-4' },
  h(ChartPanel, { title: 'Quote ageing', sub: A.stale.length ? `${A.stale.length} over 60 days` : 'all fresh',
    note: 'Days since the quotation went out. Anything past 60 days needs a call.' },
    h(AgeingBars, { buckets: A.ageBuckets })),
  h(ChartPanel, { title: 'Closing by month', sub: `${C.dated} of ${n} dated · ${fmtCr(C.datedCr)}`,
    note: [
      'Target closure month as set on the card; bars by value.',
      C.undated ? `${C.undated} quotes (${fmtCr(C.undatedCr)}) carry none and sit in No date.` : 'Every quote carries one.',
      C.overdue ? `${C.overdue} past ${C.overdue === 1 ? 'its' : 'their'} month and still open: re-date or decide.` : '',
    ].filter(Boolean).join(' ') },
    h(ClosureBars, { buckets: C.months, hrefFor: (l) => `?sel=etam:${encodeURIComponent(l)}`, selected: C.months[2].label })),
  h(ChartPanel, { title: 'Closing by quarter', sub: `this quarter ${fmtCr(C.quarters[1]?.value ?? 0)} · next ${fmtCr(C.quarters[2]?.value ?? 0)}`,
    note: 'Financial year April to March. Overdue is any target month already past, the same line as the month view, so the current quarter shows only what is still ahead in it.' },
    h(ClosureBars, { buckets: C.quarters })),
  h(ChartPanel, { title: 'Target date set', sub: `${Math.round((C.dated / n) * 100)}% of quotes · ${Math.round((C.datedCr / totalCr) * 100)}% of value`,
    note: 'Share of each rep\'s open quotes with a target month. A quote without one is invisible to the two charts on the left and to the sales projection on the Executive Review.' },
    h(CoverageList, { rows: C.byRep, hrefFor: (l) => `?sel=rep:${encodeURIComponent(l)}` })),
  h(ChartPanel, { title: 'Product mix (selected: PCP)' },
    h(BarList, { rows: A.group(r => r.product_type), hrefFor: (l) => `?sel=ptype:${l}`, selected: 'PCP' })),
));
fs.rmSync(tmp, { recursive: true, force: true });
const out = path.join(ROOT, 'node_modules', '.cache-quoted-closure.html');
fs.writeFileSync(out,
  `<!doctype html><meta charset="utf-8"><title>Quoted · closing</title>` +
  `<style>:root{--fg:#0D1B2E;--fg-2:#2D3E55;--fg-3:#6B7F96;--fg-4:#A8BAC8;--bg:#F4F6FB;--bg-paper:#fff;--bg-elev:#EDF1F7;--bg-sunk:#E2E8F3;--line:rgba(10,22,40,.08);--line-2:rgba(10,22,40,.05);--line-strong:rgba(10,22,40,.16);--accent:#1A5CB8;--pos:#059669;--neg:#DC2626;--warn:#D97706;--warn-soft:#FEF3C7;--warn-strong:#92400E;--radius:6px;--font-mono:ui-monospace,monospace}` +
  `body{margin:0;padding:22px;background:var(--bg);font:14px system-ui,sans-serif;color:var(--fg)}` +
  `.stage-grid-4{display:grid;grid-template-columns:repeat(auto-fill,470px);gap:12px}` +  // 470px ≈ a quarter of a 2000px screen, so the pane shows true panel width
  `</style>${html}`);
console.log(`\n  ${out}`);
process.exit(bad ? 1 : 0);
