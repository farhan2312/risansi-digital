#!/usr/bin/env node
// The report model, its SQL, and the four templates must agree.
//
// WHY THIS EXISTS
//
// lib/custom-analytics/model.ts says what a report may ask about and
// sql.ts says how to ask it, keyed by the same ids. The engine refuses an id
// that is in one and not the other — which is the right behaviour at runtime
// and a silent one: the field simply stops appearing, or a card that used to
// work starts saying "this table has no number X". Nothing fails loudly, and
// nothing fails until somebody opens the report that used it.
//
// The templates have the same problem one level up. sanitizeDoc DROPS a
// visual it cannot validate rather than rejecting the save, deliberately, so
// that a model change cannot destroy somebody's saved report. The cost is
// that a template naming a field that no longer exists loses that card
// quietly, and the first anybody knows is an empty space on a page.
//
// So all of it is checked here instead, before the build. Costs nothing and
// runs no queries.
//
// The TS graph is transpiled to a temp directory and imported, rather than
// read as text: a regex over model.ts can tell you the id 'revenue' appears
// in both files, and cannot tell you it is a measure in one and a dimension
// in the other.

import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const ROOT = path.resolve(HERE, '..');
const SRC = path.join(ROOT, 'lib', 'custom-analytics');

// A closed graph: each of these imports only the others, by relative path.
const MODULES = ['types', 'model', 'sql', 'doc', 'templates', 'fmt', 'shape', 'build'];

const dir = mkdtempSync(path.join(tmpdir(), 'risansi-report-model-'));
let failed = 0;
const bad = (msg) => { failed++; console.error(`  ✗ ${msg}`); };

try {
  for (const name of MODULES) {
    const out = ts.transpileModule(readFileSync(path.join(SRC, `${name}.ts`), 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
      fileName: `${name}.ts`,
    }).outputText
      // Node's ESM resolver needs the extension these files deliberately omit.
      .replace(/from\s+'\.\/(\w+)'/g, (_, m) => `from './${m}.mjs'`);
    writeFileSync(path.join(dir, `${name}.mjs`), out);
  }

  const model = await import(pathToFileURL(path.join(dir, 'model.mjs')).href);
  const sql = await import(pathToFileURL(path.join(dir, 'sql.mjs')).href);
  const doc = await import(pathToFileURL(path.join(dir, 'doc.mjs')).href);
  const types = await import(pathToFileURL(path.join(dir, 'templates.mjs')).href);
  const T = await import(pathToFileURL(path.join(dir, 'types.mjs')).href);
  const fmt = await import(pathToFileURL(path.join(dir, 'fmt.mjs')).href);
  const shape = await import(pathToFileURL(path.join(dir, 'shape.mjs')).href);
  const build = await import(pathToFileURL(path.join(dir, 'build.mjs')).href);

  const { DATASETS } = model;
  const { DATASET_SQL } = sql;
  const { TEMPLATES } = types;
  const { sanitizeDoc } = doc;
  const { VISUAL_META, GRID_COLS } = T;

  // ── 1. every dataset in the model has SQL, and the reverse ──

  const modelIds = DATASETS.map(d => d.id);
  const sqlIds = Object.keys(DATASET_SQL);
  for (const id of modelIds) if (!sqlIds.includes(id)) bad(`dataset "${id}" is in model.ts with no entry in sql.ts`);
  for (const id of sqlIds) if (!modelIds.includes(id)) bad(`dataset "${id}" is in sql.ts and not in model.ts — nothing can reach it`);

  // ── 2. every field has an expression of the right kind ──────

  for (const d of DATASETS) {
    const s = DATASET_SQL[d.id];
    if (!s) continue;
    const seen = new Set();

    for (const f of d.fields) {
      if (seen.has(f.id)) bad(`${d.id}.${f.id} is declared twice`);
      seen.add(f.id);

      const where =
        f.kind === 'measure' ? (f.id in s.measures ? 'measures' : null)
        : f.kind === 'num' ? (f.id in s.nums ? 'nums' : null)
        : f.date ? (f.id in s.dates ? 'dates' : null)
        : (f.id in s.dims ? 'dims' : null);

      if (!where) {
        const kind = f.kind === 'dim' && f.date ? 'date' : f.kind;
        bad(`${d.id}.${f.id} is a ${kind} in model.ts with no ${kind === 'date' ? 'dates' : f.kind === 'measure' ? 'measures' : f.kind === 'num' ? 'nums' : 'dims'} entry in sql.ts`);
      }
    }

    // And the other way: SQL nobody can select is dead weight at best, and at
    // worst a field somebody meant to expose and forgot to declare.
    for (const bucket of ['dates', 'dims', 'measures', 'nums']) {
      for (const id of Object.keys(s[bucket] ?? {})) {
        if (!d.fields.some(f => f.id === id)) {
          bad(`${d.id}.${id} is in sql.ts ${bucket} and not in model.ts — unreachable`);
        }
      }
    }

    // The page date filter names a field; it has to be one that exists and
    // carries a date, or every card on a filtered page reports it as ignored.
    if (d.dateField) {
      const f = d.fields.find(x => x.id === d.dateField);
      if (!f) bad(`${d.id}.dateField "${d.dateField}" is not one of its fields`);
      else if (!f.date) bad(`${d.id}.dateField "${d.dateField}" is not a date field`);
      if (!d.dateLabel) bad(`${d.id} has a dateField and no dateLabel`);
    } else if (Object.keys(s.dates ?? {}).length) {
      bad(`${d.id} has date columns in sql.ts but no dateField, so its date filter can never apply`);
    }
  }

  // ── 3. shared dimensions really are shared ──────────────────
  //
  // A cross-table visual joins on the text these produce, so a `common` key
  // present on one dataset and spelt differently on another would line up
  // nowhere and silently return a table of nulls.

  const commons = new Map();
  for (const d of DATASETS) {
    for (const f of d.fields.filter(x => x.common)) {
      const prev = commons.get(f.common);
      if (prev && prev.fieldId !== f.id) {
        bad(`shared dimension "${f.common}" is field "${prev.fieldId}" on ${prev.ds} and "${f.id}" on ${d.id} — mapDim would not find it`);
      }
      commons.set(f.common, { ds: d.id, fieldId: f.id });
      const expr = DATASET_SQL[d.id]?.dims?.[f.id];
      if (expr) {
        const first = commons.get(`expr:${f.common}`);
        if (first && first.expr !== expr) {
          bad(`shared dimension "${f.common}" is "${first.expr}" on ${first.ds} and "${expr}" on ${d.id} — the two will not match as text`);
        } else if (!first) {
          commons.set(`expr:${f.common}`, { ds: d.id, expr });
        }
      }
    }
  }

  // ── 4. the templates survive the sanitiser intact ───────────

  for (const t of TEMPLATES) {
    const before = t.doc;
    const after = sanitizeDoc(JSON.parse(JSON.stringify(before)));

    if (after.pages.length !== before.pages.length) {
      bad(`template "${t.key}": ${before.pages.length} pages in, ${after.pages.length} out`);
      continue;
    }

    before.pages.forEach((p, i) => {
      const q = after.pages[i];
      if (q.visuals.length !== p.visuals.length) {
        const lost = p.visuals.filter(v => !q.visuals.some(w => w.id === v.id));
        bad(`template "${t.key}" page "${p.name}": ${lost.length} card(s) dropped by the sanitiser — ${lost.map(v => v.title || v.type).join(', ')}`);
      }

      for (const v of p.visuals) {
        const w = q.visuals.find(x => x.id === v.id);
        if (!w) continue;
        if (w.values.length !== v.values.length) {
          bad(`template "${t.key}" / "${v.title ?? v.type}": ${v.values.length} numbers in, ${w.values.length} out`);
        }
        if (!!v.axis !== !!w.axis) bad(`template "${t.key}" / "${v.title ?? v.type}": its axis was dropped`);
        if (!!v.split !== !!w.split) bad(`template "${t.key}" / "${v.title ?? v.type}": its split was dropped`);
        if ((v.dims?.length ?? 0) !== (w.dims?.length ?? 0)) {
          bad(`template "${t.key}" / "${v.title ?? v.type}": ${v.dims?.length ?? 0} grouping fields in, ${w.dims?.length ?? 0} out`);
        }
        // A well the type does not have is a card built wrong, even though the
        // sanitiser forgives it.
        const wells = VISUAL_META[v.type].wells;
        if (v.split && !wells.includes('split')) bad(`template "${t.key}" / "${v.title ?? v.type}": a ${v.type} has no split well`);
        if (v.dims?.length && !wells.includes('dims')) bad(`template "${t.key}" / "${v.title ?? v.type}": a ${v.type} has no grouping well`);
        if (v.axis && !wells.includes('axis')) bad(`template "${t.key}" / "${v.title ?? v.type}": a ${v.type} has no axis well`);
        if (!v.axis && wells.includes('axis') && v.type !== 'table') {
          bad(`template "${t.key}" / "${v.title ?? v.type}": a ${v.type} with no axis has nothing to plot against`);
        }
      }

      // ── 5. no two cards on top of each other ──────────────────
      const grid = new Map();
      for (const v of p.visuals) {
        const { x, y, w, h } = v.layout;
        if (x < 0 || x + w > GRID_COLS) {
          bad(`template "${t.key}" page "${p.name}": "${v.title ?? v.type}" runs from column ${x} to ${x + w} on a ${GRID_COLS}-column grid`);
        }
        for (let r = y; r < y + h; r++) {
          for (let c = x; c < x + w; c++) {
            const cell = `${r}:${c}`;
            if (grid.has(cell)) {
              bad(`template "${t.key}" page "${p.name}": "${v.title ?? v.type}" overlaps "${grid.get(cell)}" at row ${r}, column ${c}`);
              r = y + h; break;
            }
            grid.set(cell, v.title ?? v.type);
          }
        }
      }
    });
  }

  // ── 6. the arithmetic the charts draw from ──────────────────
  //
  // Pinned rather than trusted. Each of these has a wrong answer that looks
  // perfectly plausible on screen: a legend ordered one way and the segments
  // another, a treemap whose rectangles do not cover the box, a pivot that
  // counts a total line as a category, or ₹1.2449 Cr written as ₹1.24 Cr in a
  // table cell where the exact figure was the point.

  const { normalise, squarify, shapeMatrix } = shape;
  const { compact, exact, bucketLabel } = fmt;
  const eq = (label, got, want) => {
    if (JSON.stringify(got) === JSON.stringify(want)) return;
    bad(`${label}\n      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`);
  };

  // normalise, no split: the engine's order is kept, and nothing is invented.
  {
    const n = normalise(
      [{ d0: 'Maharashtra', m0: 10 }, { d0: 'Gujarat', m0: 4 }, { d0: null, m0: 1 }, { d0: 'Other', m0: 9 }],
      [{ key: 'm0', label: 'Revenue', format: 'inr' }], null, false);
    eq('normalise keeps the engine\'s category order', n.cats.map(c => c.raw),
       ['Maharashtra', 'Gujarat', null, 'Other']);
    eq('normalise labels a blank category', n.cats[2].label, '(none)');
    eq('normalise makes "Other" and blanks unclickable', n.cats.map(c => c.clickable),
       [true, true, false, false]);
    eq('normalise draws no legend for one number', n.legend.length, 0);
  }

  // normalise, two numbers: a legend, and parts in the order they were added.
  {
    const n = normalise([{ d0: 'A', m0: 3, m1: 7 }],
      [{ key: 'm0', label: 'Won', format: 'int' }, { key: 'm1', label: 'Lost', format: 'int' }],
      null, false);
    eq('two numbers give a two-entry legend', n.legend.map(l => l.label), ['Won', 'Lost']);
    eq('two numbers give two parts per category', n.cats[0].parts.map(p => p.value), [3, 7]);
    eq('the category total adds the numbers up', n.cats[0].total, 10);
  }

  // normalise with a split: the legend is biggest-first with "Other" last,
  // every category carries every member, and a combination the query never
  // returned is NULL rather than zero.
  {
    const n = normalise([
      { d0: '2026-04', d1: 'Open', m0: 2 },
      { d0: '2026-04', d1: 'Other', m0: 50 },
      { d0: '2026-05', d1: 'Closed', m0: 9 },
      { d0: '2026-05', d1: 'Open', m0: 1 },
    ], [{ key: 'm0', label: 'Complaints', format: 'int' }], { isDate: true, grain: 'month' }, true);
    eq('a split legend is biggest first with "Other" last',
       n.legend.map(l => l.label), ['Closed', 'Open', 'Other']);
    eq('a date axis keeps chronological order', n.cats.map(c => c.label), ['Apr 26', 'May 26']);
    eq('every category carries every legend member',
       n.cats.map(c => c.parts.length), [3, 3]);
    eq('a combination the query never returned is null, not zero',
       n.cats[0].parts.map(p => p.value), [null, 2, 50]);
    eq('a split category total ignores the nulls', n.cats[1].total, 10);
  }

  // squarify: the rectangles must tile the box and keep their order.
  {
    const fracs = [0.4, 0.25, 0.2, 0.1, 0.05];
    const tiles = squarify(fracs, { x: 0, y: 0, w: 100, h: 100 });
    eq('squarify returns one rectangle per slice', tiles.length, fracs.length);
    const area = tiles.reduce((a, t) => a + t.w * t.h, 0);
    if (Math.abs(area - 10000) > 1) bad(`squarify leaves the box uncovered: ${area.toFixed(1)} of 10000`);
    for (const t of tiles) {
      if (t.w <= 0 || t.h <= 0) bad(`squarify produced an empty rectangle ${JSON.stringify(t)}`);
      if (t.x < -0.01 || t.y < -0.01 || t.x + t.w > 100.01 || t.y + t.h > 100.01) {
        bad(`squarify put a rectangle outside the box: ${JSON.stringify(t)}`);
      }
    }
    for (let i = 0; i < tiles.length; i++) {
      for (let j = i + 1; j < tiles.length; j++) {
        const a = tiles[i], b = tiles[j];
        const over = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x))
                   * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
        if (over > 0.01) bad(`squarify overlapped slices ${i} and ${j} by ${over.toFixed(2)}`);
      }
    }
    // The biggest slice gets the biggest rectangle, which is the whole point.
    const biggest = tiles.reduce((m, t, i) => (t.w * t.h > tiles[m].w * tiles[m].h ? i : m), 0);
    eq('squarify gives the largest slice the largest rectangle', biggest, 0);
    eq('squarify drops zero-sized slices', squarify([1, 0], { x: 0, y: 0, w: 10, h: 10 }).length, 1);
  }

  // shapeMatrix: the GROUPING SETS markers become totals, not categories.
  {
    const m = shapeMatrix([
      { d0: 'QC', d1: 'Low', m0: 5 }, { d0: 'QC', d1: 'High', m0: 1 },
      { d0: 'Packing', d1: 'Low', m0: 9 },
      { d0: null, d1: 'Low', m0: 2 },
      { d0: 'QC', d1: '__total', m0: 6 },
      { d0: 'Packing', d1: '__total', m0: 9 },
      { d0: null, d1: '__total', m0: 2 },
      { d0: '__total', d1: 'Low', m0: 16 },
      { d0: '__total', d1: 'High', m0: 1 },
      { d0: '__total', d1: '__total', m0: 17 },
    ]);
    eq('a total marker never becomes a row', m.rowKeys.includes('__total'), false);
    eq('a total marker never becomes a column', m.colKeys.includes('__total'), false);
    eq('rows are ordered by their own totals', m.rowKeys, ['Packing', 'QC', null]);
    eq('columns are ordered by their own totals', m.colKeys, ['Low', 'High']);
    eq('a genuinely blank category survives as a row', m.rowKeys.includes(null), true);
    eq('a cell reads back', m.cell('QC', 'High'), 1);
    eq('an absent cell is null, not zero', m.cell('Packing', 'High'), null);
    eq('row totals come from the database, not from adding the cells', m.rowTotal('QC'), 6);
    eq('column totals likewise', m.colTotal('Low'), 16);
    eq('the grand total is picked up', m.grand, 17);
  }
  {
    // "Other" sorts last among rows however big it is — it is not a category
    // anybody can click through to, so it belongs at the bottom.
    const m = shapeMatrix([
      { d0: 'Other', d1: 'x', m0: 900 }, { d0: 'Real', d1: 'x', m0: 1 },
      { d0: 'Other', d1: '__total', m0: 900 }, { d0: 'Real', d1: '__total', m0: 1 },
    ]);
    eq('"Other" is the last row whatever its size', m.rowKeys, ['Real', 'Other']);
  }
  {
    // A date dimension keeps the engine's chronological order rather than
    // being re-sorted by size, which would scramble a time axis.
    const m = shapeMatrix([
      { d0: '2026-04', d1: 'x', m0: 1 }, { d0: '2026-05', d1: 'x', m0: 99 },
      { d0: '2026-04', d1: '__total', m0: 1 }, { d0: '2026-05', d1: '__total', m0: 99 },
    ], true, false);
    eq('a date row dimension stays chronological', m.rowKeys, ['2026-04', '2026-05']);
  }

  // Money, at the boundaries where the unit changes.
  {
    eq('a crore is written in crores', compact('inr', 12_43_55_120), '₹12.4 Cr');
    eq('a lakh is written in lakhs', compact('inr', 4_50_000), '₹4.50 L');
    eq('above ten lakh one decimal is enough', compact('inr', 45_50_000), '₹45.5 L');
    eq('under a lakh is written in full', compact('inr', 45_000), '₹45,000');
    eq('a negative keeps its sign', compact('inr', -1_50_00_000), '-₹1.50 Cr');
    eq('the exact figure rounds nothing away', exact('inr', 12_43_55_120), '₹12,43,55,120');
    eq('a count is a count', compact('int', 1234), '1,234');
    eq('a percentage keeps one decimal while it matters', compact('pct', 6.25), '6.3%');
    eq('a blank is a dash, not a zero', exact('inr', null), '—');
    eq('a crore column is already in crores', compact('cr', 1.5), '₹1.50 Cr');
  }

  // Bucket keys are built to sort as text, so they are unreadable until this
  // turns them back. Every grain, because each has its own shape.
  {
    eq('month', bucketLabel('month', '2026-10'), 'Oct 26');
    eq('quarter', bucketLabel('quarter', '2026-Q3'), 'Q3 26');
    eq('week', bucketLabel('week', '2026-10-05'), 'w/c 5 Oct');
    eq('day', bucketLabel('day', '2026-10-05'), '5 Oct 26');
    eq('year', bucketLabel('year', '2026'), '2026');
    eq('financial year is already readable', bucketLabel('fy', 'FY26-27'), 'FY26-27');
    eq('a blank bucket', bucketLabel('month', null), '(none)');
  }

  // ── 7. the builder's own operations ─────────────────────────
  //
  // Every edit the builder makes is a function in build.ts, pinned here for
  // the same reason as the chart arithmetic: these have wrong answers that
  // look like design choices. A card settled on top of another one reads as
  // a deliberate overlap; a type change that quietly drops the number the
  // card was showing reads as an empty card somebody forgot to finish.

  const B = build;
  const lay = (x, y, w, h) => ({ x, y, w, h });
  const card = (id, x, y, w, h, type = 'column') =>
    ({ id, type, dataset: 'revenue', values: [], layout: lay(x, y, w, h) });
  const anyOverlap = (vs) => vs.some((a, ai) =>
    vs.some((b, bi) => bi > ai && B.overlaps(a.layout, b.layout)));

  // settle: the dropped card keeps where it was dropped, the rest move.
  {
    const vs = B.settle([card('a', 0, 0, 6, 6), card('b', 0, 0, 6, 6)], 'b');
    eq('the card being moved keeps its position', vs.find(v => v.id === 'b').layout.y, 0);
    eq('the card it landed on is pushed below it', vs.find(v => v.id === 'a').layout.y, 6);
    eq('settling leaves nothing overlapping', anyOverlap(vs), false);
    eq('settling keeps the document order', vs.map(v => v.id), ['a', 'b']);
  }
  {
    // A cascade: three cards stacked on one spot each clear the one before.
    const vs = B.settle([card('a', 0, 0, 12, 4), card('b', 0, 0, 12, 4), card('c', 0, 0, 12, 4)], 'a');
    eq('a collision cascades rather than stopping at the first card',
       vs.map(v => v.layout.y).sort((x, y) => x - y), [0, 4, 8]);
    eq('a cascade still leaves nothing overlapping', anyOverlap(vs), false);
  }
  {
    // Side by side is not a collision. Two cards on one row must stay there.
    const vs = B.settle([card('a', 0, 0, 6, 6), card('b', 6, 0, 6, 6)], 'b');
    eq('cards beside each other are left alone', vs.map(v => v.layout.y), [0, 0]);
  }

  // tidy: the gaps close, the reading order does not change.
  {
    // Gravity is per column, not per row: a card floats up as far as the
    // cards above IT allow, so a short card beside a tall one rises past it.
    const vs = B.tidy([card('a', 0, 0, 6, 4), card('b', 0, 20, 6, 4), card('c', 6, 20, 6, 4)]);
    eq('tidy pulls a stranded card up behind the one above it', vs.find(v => v.id === 'b').layout.y, 4);
    eq('tidy pulls a card with nothing above it to the top', vs.find(v => v.id === 'c').layout.y, 0);
    eq('tidy leaves nothing overlapping', anyOverlap(vs), false);
  }

  // freeSpot: a new card fills a hole before it goes to the bottom.
  {
    const spot = B.freeSpot([card('a', 0, 0, 6, 6)], 6, 6);
    eq('a new card fills the gap beside an existing one', spot, { x: 6, y: 0 });
    eq('a card too wide for the gap goes underneath',
       B.freeSpot([card('a', 0, 0, 6, 6)], 12, 4), { x: 0, y: 6 });
  }

  // moveTo and resizeTo: never off the right-hand edge, never smaller than 2.
  {
    const vs = B.moveTo([card('a', 0, 0, 6, 6)], 'a', 99, 3);
    eq('a card dragged past the edge stops at it', vs[0].layout.x, 6);
    const r = B.resizeTo([card('a', 8, 0, 4, 6)], 'a', 99, 0);
    eq('a card cannot be widened past the grid', r[0].layout.w, 4);
    eq('a card cannot be resized to nothing', r[0].layout.h, 2);
  }

  // changeType: the contents are re-dealt, and what cannot be kept is dropped.
  {
    const col = {
      id: 'a', type: 'column', dataset: 'revenue',
      axis: { field: 'month', grain: 'month' }, split: { field: 'state' },
      values: [{ field: 'revenue' }], layout: lay(0, 0, 6, 6),
    };
    const asTable = B.changeType(col, 'table');
    eq('column to table puts both categories in the columns',
       asTable.dims.map(d => d.field), ['month', 'state']);
    eq('column to table keeps the number', asTable.values.map(v => v.field), ['revenue']);
    eq('column to table leaves nothing in the axis', asTable.axis, undefined);

    const back = B.changeType(asTable, 'column');
    eq('and back again puts the first column on the axis', back.axis.field, 'month');
    eq('and the second on the legend', back.split.field, 'state');
    eq('the grain survives the round trip', back.axis.grain, 'month');

    const asKpi = B.changeType(col, 'kpi');
    eq('a KPI keeps the number and drops the categories',
       [asKpi.values.length, asKpi.axis, asKpi.split], [1, undefined, undefined]);
  }
  {
    // A card at the right-hand edge grown by a type change must not hang off.
    const k = { id: 'a', type: 'kpi', dataset: 'revenue',
                values: [{ field: 'revenue' }], layout: lay(9, 0, 3, 3) };
    const t = B.changeType(k, 'table');
    eq('a type change cannot push a card off the edge', t.layout.x + t.layout.w <= 12, true);
  }
  {
    // Three numbers on a table, drawn as a column chart with a legend: the
    // legend wins and the extra numbers go, because they cannot share a scale.
    const tbl = {
      id: 'a', type: 'table', dataset: 'revenue',
      dims: [{ field: 'state' }, { field: 'industry' }],
      values: [{ field: 'revenue' }, { field: 'pump_revenue' }, { field: 'spare_revenue' }],
      layout: lay(0, 0, 8, 7),
    };
    const col = B.changeType(tbl, 'column');
    eq('a legend drops the card to one number, and it is the first one',
       col.values.map(v => v.field), ['revenue']);
  }

  // addToWell: where a field lands, and what it arrives with.
  {
    const base = B.newVisual('column', null);
    const a = B.addToWell(base, 'axis', 'revenue', 'month');
    eq('the first field sets the table the card is built on', a.dataset, 'revenue');
    eq('a date arrives bucketed by month', a.axis, { field: 'month', grain: 'month' });

    const b = B.addToWell(a, 'values', 'revenue', 'revenue');
    eq('a measure arrives with no aggregation to pick', b.values, [{ field: 'revenue' }]);

    const c = B.addToWell(b, 'values', 'revenue', 'total_value');
    eq('a plain column arrives with its own default aggregation',
       c.values[1], { field: 'total_value', agg: 'sum' });

    const d = B.addToWell(c, 'values', 'revenue', 'client');
    eq('a category counted in the Numbers well counts distinct things',
       d.values[2], { field: 'client', agg: 'countd' });

    const e = B.addToWell(d, 'values', 'orders', 'order_value');
    eq('a number from another table says which table it came from',
       e.values.filter(v => v.dataset).map(v => v.dataset), ['orders']);

    const f = B.addToWell(e, 'axis', 'orders', 'financial_year');
    eq('a category from another table is refused', f, e);

    const g = B.addToWell(b, 'split', 'revenue', 'state');
    eq('adding a legend drops the card to one number', g.values.length, 1);
  }
  {
    // The same field twice is one field, not two columns of the same thing.
    let t = B.newVisual('table', 'revenue');
    t = B.addToWell(t, 'values', 'revenue', 'revenue');
    t = B.addToWell(t, 'values', 'revenue', 'revenue');
    eq('the same number added twice is added once', t.values.length, 1);

    let d = B.newVisual('table', 'revenue');
    for (const id of ['state', 'industry', 'city', 'client', 'tier']) {
      d = B.addToWell(d, 'dims', 'revenue', id);
    }
    eq('a table holds four columns, oldest out first',
       d.dims.map(x => x.field), ['industry', 'city', 'client', 'tier']);
  }

  // bestWell: where a clicked field goes when nobody said.
  {
    const num = model.fieldOf('revenue', 'revenue');
    const dim = model.fieldOf('revenue', 'state');
    const col = B.newVisual('column', 'revenue');
    eq('a number goes to the Numbers well', B.bestWell(col, num), 'values');
    eq('a category goes to the empty axis', B.bestWell(col, dim), 'axis');
    eq('and then to the legend', B.bestWell({ ...col, axis: { field: 'month' } }, dim), 'split');
    eq('a table groups by it instead', B.bestWell(B.newVisual('table', 'revenue'), dim), 'dims');
    eq('a KPI can only count it', B.bestWell(B.newVisual('kpi', 'revenue'), dim), 'values');
    eq('a date is drawn as a line, a category as a column',
       [B.suggestType(model.fieldOf('revenue', 'month')), B.suggestType(dim), B.suggestType(num)],
       ['line', 'column', 'kpi']);
  }

  // problems: what the card says about itself before it can draw.
  {
    eq('an empty column card asks for a number and a category',
       B.problems(B.newVisual('column', 'revenue')).length, 2);
    const ok = B.addToWell(
      B.addToWell(B.newVisual('column', 'revenue'), 'axis', 'revenue', 'month'),
      'values', 'revenue', 'revenue');
    eq('a finished card has nothing to say', B.problems(ok), []);
    eq('and is runnable', B.isRunnable(ok), true);
    eq('a matrix wants its columns too',
       B.problems({ ...ok, type: 'matrix' }).includes('Add a second category for the columns.'), true);
  }

  // Anything the builder can produce has to survive the save path, or the
  // card comes back changed and nobody knows why.
  {
    let vs = [];
    const kpi = B.addToWell(B.newVisual('kpi', 'revenue'), 'values', 'revenue', 'revenue');
    vs = B.addVisual(vs, kpi);
    let line = B.newVisual('line', 'revenue');
    line = B.addToWell(line, 'axis', 'revenue', 'month');
    line = B.addToWell(line, 'split', 'revenue', 'state');
    line = B.addToWell(line, 'values', 'revenue', 'revenue');
    vs = B.addVisual(vs, line);
    let tab = B.newVisual('table', 'orders');
    tab = B.addToWell(tab, 'dims', 'orders', 'client');
    tab = B.addToWell(tab, 'values', 'orders', 'order_value');
    tab = B.addToWell(tab, 'values', 'revenue', 'revenue');
    vs = B.addVisual(vs, tab);

    const built = { version: 1, pages: [{ id: 'p1', name: 'Page 1', filters: {}, visuals: vs }] };
    const after = sanitizeDoc(built);
    eq('nothing the builder makes is lost on save', after.pages[0].visuals.length, 3);
    // Compared key-insensitively: the sanitiser rebuilds the layout object
    // and so writes its four numbers in its own order, which is not a change
    // to the card.
    const sorted = (x) => JSON.stringify(x, (k, v) =>
      v && typeof v === 'object' && !Array.isArray(v)
        ? Object.fromEntries(Object.keys(v).sort().map(j => [j, v[j]]))
        : v);
    eq('and nothing about it is rewritten', sorted(after.pages[0].visuals), sorted(vs));
    eq('a built page has nothing overlapping', anyOverlap(vs), false);
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}

if (failed) {
  console.error(`\nreport-model-check: ${failed} problem${failed === 1 ? '' : 's'}.`);
  console.error('The model, its SQL and the templates have to name the same things.');
  console.error('See lib/custom-analytics/model.ts and sql.ts.\n');
  process.exit(1);
}
console.log('✓ report-model-check: model, SQL and templates agree');
