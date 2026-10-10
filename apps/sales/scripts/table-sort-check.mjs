#!/usr/bin/env node
// The one comparator every sortable table in the portal runs through.
//
// Thirty-odd tables share lib/risansi-table-sort.ts, so a mistake in it is not
// one wrong table, it is every wrong table at once, and the wrongness is the
// quiet kind: a column that looks sorted and is not. One bug of exactly that
// shape was already written and caught here — sortRows multiplied the whole
// comparison by -1 to flip direction, which flipped the empty-cell handling
// too and floated every blank row to the TOP of a descending sort, burying the
// largest values a person clicked the column to see.
//
// So the rules are pinned here rather than trusted:
//   text    A to Z, case-insensitive, "Item 2" before "Item 10"
//   number  by magnitude, reading through ₹ and thousands separators
//   date    chronological
//   status  the sequence the status list defines, not the alphabet
//   blanks  always last, in BOTH directions, for every kind
//
// Run by `npm run build`. Costs nothing and runs no queries.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const SRC = path.join(ROOT, 'lib', 'risansi-table-sort.ts');

const js = ts.transpileModule(readFileSync(SRC, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { compareBy, firstDir, nextSort, sortRows } =
  await import('data:text/javascript;base64,' + Buffer.from(js).toString('base64'));

let failed = 0;
const eq = (label, got, want) => {
  if (JSON.stringify(got) === JSON.stringify(want)) return;
  failed++;
  console.error(`  ✗ ${label}\n      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`);
};
const srt = (kind, arr, order) => [...arr].sort(compareBy(kind, order));

const STAGES = ['Quoted', 'Negotiating', 'Won', 'Lost'];

// ── the four kinds ────────────────────────────────────────────
eq('text is A-Z and case-insensitive', srt('text', ['beta', 'Alpha', 'gamma']), ['Alpha', 'beta', 'gamma']);
eq('text counts numerals as numbers', srt('text', ['Item 10', 'Item 2', 'Item 1']), ['Item 1', 'Item 2', 'Item 10']);
eq('number reads through ₹ and commas', srt('number', ['₹1,20,000', '₹45', '₹3,000']), ['₹45', '₹3,000', '₹1,20,000']);
eq('number puts unparseable text last', srt('number', [5, 'n/a', 1]), [1, 5, 'n/a']);
eq('date is chronological', srt('date', ['2026-03-01', '2025-12-31', '2026-01-05']), ['2025-12-31', '2026-01-05', '2026-03-01']);
eq('status follows its own sequence', srt('status', ['Lost', 'Quoted', 'Won', 'Negotiating'], STAGES), ['Quoted', 'Negotiating', 'Won', 'Lost']);
eq('status puts an unlisted value last', srt('status', ['Mystery', 'Won', 'Quoted'], STAGES), ['Quoted', 'Won', 'Mystery']);

// ── blanks sink, whichever way the column points ──────────────
const bothWays = (kind, rows, order) => {
  const cols = [{ key: 'v', kind, order }];
  return {
    desc: sortRows(rows, cols, { key: 'v', dir: 'desc' }).map(r => r.v),
    asc: sortRows(rows, cols, { key: 'v', dir: 'asc' }).map(r => r.v),
  };
};
const num = bothWays('number', [{ v: 5 }, { v: null }, { v: 1 }, { v: '' }]);
eq('number blanks last, descending', num.desc, [5, 1, null, '']);
eq('number blanks last, ascending', num.asc, [1, 5, null, '']);
const txt = bothWays('text', [{ v: 'b' }, { v: null }, { v: 'a' }]);
eq('text blanks last, descending', txt.desc, ['b', 'a', null]);
eq('text blanks last, ascending', txt.asc, ['a', 'b', null]);
const dt = bothWays('date', [{ v: '2026-01-01' }, { v: null }, { v: '2025-01-01' }]);
eq('date blanks last, descending', dt.desc, ['2026-01-01', '2025-01-01', null]);
const st = bothWays('status', [{ v: 'Won' }, { v: null }, { v: 'Quoted' }], STAGES);
eq('status blanks last, descending', st.desc, ['Won', 'Quoted', null]);

// ── which way the first click points ──────────────────────────
eq('a name column opens at A', firstDir('text'), 'asc');
eq('a value column opens at the largest', firstDir('number'), 'desc');
eq('a date column opens at the newest', firstDir('date'), 'desc');
eq('a status column opens at the first stage', firstDir('status'), 'asc');

// ── click, click, clear ───────────────────────────────────────
let s = { key: null, dir: 'asc' };
s = nextSort(s, 'v', 'number'); eq('first click on a value column', s, { key: 'v', dir: 'desc' });
s = nextSort(s, 'v', 'number'); eq('second click reverses it', s, { key: 'v', dir: 'asc' });
s = nextSort(s, 'v', 'number'); eq('third click clears it', s, { key: null, dir: 'asc' });
s = nextSort(s, 'n', 'text'); eq('first click on a name column', s, { key: 'n', dir: 'asc' });

// ── sortRows contract ─────────────────────────────────────────
const rows = [{ n: 'b', v: 5 }, { n: 'a', v: 9 }];
const COLS = [{ key: 'n', kind: 'text' }, { key: 'v', kind: 'number' }];
eq('no sort returns the very same array', sortRows(rows, COLS, { key: null, dir: 'asc' }) === rows, true);
eq('an unknown key changes nothing', sortRows(rows, COLS, { key: 'zzz', dir: 'asc' }) === rows, true);
sortRows(rows, COLS, { key: 'n', dir: 'asc' });
eq('the input array is never reordered', rows.map(r => r.n), ['b', 'a']);
eq('a value accessor is used when given',
  sortRows([{ c: 1, amt: 2 }, { c: 2, amt: 9 }],
    [{ key: 'c', kind: 'number', value: r => r.amt }],
    { key: 'c', dir: 'desc' }).map(r => r.amt), [9, 2]);

if (failed) {
  console.error(`\ntable-sort-check: ${failed} rule${failed === 1 ? '' : 's'} broken in lib/risansi-table-sort.ts`);
  console.error('Every sortable table in the portal runs through this comparator.');
  process.exit(1);
}
console.log('table-sort-check: comparator ok');
