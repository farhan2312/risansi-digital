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
const MODULES = ['types', 'model', 'sql', 'doc', 'templates', 'fmt', 'shape', 'build', 'sheet'];

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
  const sheetMod = await import(pathToFileURL(path.join(dir, 'sheet.mjs')).href);

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

  // ── 8. a card, as a sheet ───────────────────────────────────
  //
  // The export is the copy of a figure that outlives the screen: it gets
  // emailed on, pasted into a deck, and read six months later by somebody
  // who never saw the report. So the things that would make it quietly wrong
  // are pinned — a date bucket written as the engine's sort key, a matrix
  // exporting a column of the word "__total", a rupee figure written as text
  // so the column cannot be summed, a blank cell exported as a zero.

  const { sheetFor, filterWords, numFmtOf, cardNote } = sheetMod;

  eq('rupees are grouped, with the unit left in the heading', numFmtOf('inr'), '#,##0');
  eq('crores keep two decimals', numFmtOf('cr'), '#,##0.00');
  eq('a percentage keeps one', numFmtOf('pct'), '0.0');

  // A KPI: one number, named, and written as a number.
  {
    const v = { id: 'a', type: 'kpi', dataset: 'revenue',
                values: [{ field: 'revenue' }], layout: { x: 0, y: 0, w: 3, h: 3 } };
    const s = sheetFor(v, { ok: true, rows: [{ m0: '123456' }] }, 'Revenue');
    eq('a KPI is one column and one row', [s.cols.length, s.rows.length], [1, 1]);
    eq('its heading carries the unit', s.cols[0].label, 'Revenue ₹');
    eq('and the figure is a number, not a formatted string', s.rows[0][0], 123456);
  }

  // A chart with a legend exports long, and the date is readable.
  {
    const v = {
      id: 'a', type: 'column', dataset: 'revenue',
      axis: { field: 'month', grain: 'month' }, split: { field: 'state' },
      values: [{ field: 'revenue' }], layout: { x: 0, y: 0, w: 6, h: 6 },
    };
    const s = sheetFor(v, { ok: true, rows: [
      { d0: '2026-10', d1: 'Maharashtra', m0: 10 },
      { d0: '2026-11', d1: null, m0: null },
    ] }, 'Revenue by month');
    eq('the columns are the axis, the legend and the number',
       s.cols.map(c => c.label), ['Revenue month', 'State', 'Revenue ₹']);
    eq('the kinds are right, so the route knows what to format',
       s.cols.map(c => c.kind), ['text', 'text', 'number']);
    eq('a date bucket is written readably, not as the sort key',
       s.rows[0][0], 'Oct 26');
    eq('a blank category says so', s.rows[1][1], '(none)');
    eq('and a blank figure stays blank rather than becoming a zero', s.rows[1][2], null);
    eq('the sheet says what the card was', cardNote(v, 'Revenue by month'),
       'Revenue by month — Revenue, by Revenue month and State');
  }

  // A table exports its columns in the order they are on the card.
  {
    const v = {
      id: 'a', type: 'table', dataset: 'orders',
      dims: [{ field: 'client' }, { field: 'product_category' }],
      values: [{ field: 'orders' }, { field: 'order_value' }],
      layout: { x: 0, y: 0, w: 8, h: 7 },
    };
    const s = sheetFor(v, { ok: true, rows: [{ d0: 'ACME', d1: 'Pump', m0: 3, m1: 90 }] }, 'Orders');
    eq('dimensions first, then the numbers',
       s.cols.map(c => c.label), ['Client', 'Product category', 'Orders', 'Order value ₹']);
    eq('and the row matches that order', s.rows[0], ['ACME', 'Pump', 3, 90]);
  }

  // A matrix exports as the cross-tab it looks like, totals and all.
  {
    const v = {
      id: 'a', type: 'matrix', dataset: 'complaints',
      axis: { field: 'category' }, split: { field: 'severity' },
      values: [{ field: 'complaints' }], layout: { x: 0, y: 0, w: 8, h: 7 },
    };
    const s = sheetFor(v, { ok: true, rows: [
      { d0: 'Leak', d1: 'High', m0: 2 },
      { d0: 'Leak', d1: 'Low', m0: 7 },
      { d0: 'Noise', d1: 'Low', m0: 4 },
      { d0: 'Leak', d1: '__total', m0: 9 },
      { d0: 'Noise', d1: '__total', m0: 4 },
      { d0: '__total', d1: 'High', m0: 2 },
      { d0: '__total', d1: 'Low', m0: 11 },
      { d0: '__total', d1: '__total', m0: 13 },
    ] }, 'Complaints by category');
    eq('the word "__total" never reaches a cell',
       JSON.stringify(s).includes('__total'), false);
    eq('the heading is the row dimension, the columns, then Total',
       s.cols.map(c => c.label), ['Category', 'Low', 'High', 'Total']);
    eq('each row carries its own total from the database',
       s.rows[0], ['Leak', 7, 2, 9]);
    eq('a combination the query never returned is blank, not nought',
       s.rows[1], ['Noise', 4, null, 4]);
    eq('and the last row is the column totals and the grand total',
       s.rows[2], ['Total', 11, 2, 13]);
  }

  // A card that could not run says why, on its own sheet, rather than
  // vanishing from the workbook and leaving a gap nobody can account for.
  {
    const v = { id: 'a', type: 'kpi', dataset: 'revenue', values: [],
                layout: { x: 0, y: 0, w: 3, h: 3 } };
    const s = sheetFor(v, { ok: false, error: 'Add a number to this visual.' }, 'Empty');
    eq('a card that failed is skipped with its reason', s.skipped, 'Add a number to this visual.');
    eq('and writes no table', [s.cols.length, s.rows.length], [0, 0]);
  }

  // The provenance line. A sheet two forwards from home has to say what it
  // was filtered to or the figures on it mean nothing.
  {
    const names = new Map([[7, 'Anil Kumar']]);
    eq('no filters at all is still stated', filterWords({}, names), 'All time');
    eq('a preset reads as itself',
       filterWords({ datePreset: 'This FY' }, names), 'This FY');
    eq('a custom range reads as a range',
       filterWords({ datePreset: 'Custom', dateFrom: '2026-04-01' }, names),
       '2026-04-01 to today');
    eq('every filter on the bar is named, and reps by name not id',
       filterWords({ datePreset: 'Last FY', states: ['Maharashtra', 'Gujarat'],
                     industries: ['Sugar'], tiers: ['A'], clientTypes: ['Direct'], reps: [7, 9] }, names),
       'Last FY · State: Maharashtra, Gujarat · Industry: Sugar · Direct / OEM: Direct · '
       + 'Tier: A · Sales rep: Anil Kumar, #9');
    eq('a cross-filter is part of the provenance',
       filterWords({ datePreset: 'This FY' }, names, { label: 'State: Gujarat' }),
       'This FY · filtered to State: Gujarat');
  }

  // defaultTitle is shared between the card and the sheet on purpose: a
  // sheet called something else from the card it came from is a sheet
  // somebody has to work out.
  {
    const v = { id: 'a', type: 'column', dataset: 'revenue',
                axis: { field: 'state' }, values: [{ field: 'revenue' }],
                layout: { x: 0, y: 0, w: 6, h: 6 } };
    eq('a card names itself after what it shows', fmt.defaultTitle(v), 'Revenue ₹ by State');
    eq('a KPI is just the number', fmt.defaultTitle(
       { id: 'b', type: 'kpi', dataset: 'revenue', values: [{ field: 'revenue' }], layout: v.layout }),
       'Revenue ₹');
  }

  // ── 9. two tables on one card, and changing the one it is on ──
  //
  // mapDim is what makes both of these work, and what makes them quietly
  // wrong when they do not: a card whose table was switched keeps a field
  // the new table happens to have under the same name but not the same
  // meaning, or drops one it could have kept and says nothing. The engine
  // refuses the impossible cases — after a round trip, as a red card. These
  // are the answers the panel gives before that.

  {
    // A card on Revenue, by client, borrowing Orders' own number. Both tables
    // reach `clients`, so they line up.
    const v = {
      id: 'a', type: 'table', dataset: 'revenue',
      dims: [{ field: 'client' }],
      values: [{ field: 'revenue' }, { field: 'order_value', dataset: 'orders' }],
      layout: { x: 0, y: 0, w: 8, h: 7 },
    };
    eq('the borrowed table is named', B.foreignDatasets(v), ['orders']);
    const info = B.combinedInfo(v);
    eq('and the card says what they were matched on', info.on, ['Client']);
    eq('with nothing refused', info.refused, []);
    eq('a single-table card has nothing to say about it',
       B.combinedInfo({ ...v, values: [{ field: 'revenue' }] }), null);
  }
  {
    // By drop reason — which is a Pipeline column and nothing else's. Orders
    // cannot be split by it, and the panel has to say so rather than letting
    // the engine say it later.
    const v = {
      id: 'a', type: 'table', dataset: 'pipeline',
      dims: [{ field: 'drop_reason' }],
      values: [{ field: 'opportunities' }, { field: 'order_value', dataset: 'orders' }],
      layout: { x: 0, y: 0, w: 8, h: 7 },
    };
    const info = B.combinedInfo(v);
    eq('a category only one table has is refused, by name',
       [info.on.length, info.refused.length, info.refused[0].dim, info.refused[0].dataset],
       [0, 1, 'Drop reason', 'Order in hand']);
    eq('and the refusal says what they could be matched on instead',
       info.refused[0].only.includes('Client'), true);
  }
  {
    // Which tables may be offered depends on what is already on the card.
    const byClient = {
      id: 'a', type: 'table', dataset: 'revenue', dims: [{ field: 'client' }],
      values: [{ field: 'revenue' }], layout: { x: 0, y: 0, w: 8, h: 7 },
    };
    const offered = B.combinableDatasets(byClient);
    eq('every table reaches clients, so all seven others are offered', offered.length, 7);
    eq('the card\'s own table is never offered to itself', offered.includes('revenue'), false);

    const byDropReason = { ...byClient, dataset: 'pipeline', dims: [{ field: 'drop_reason' }],
                           values: [{ field: 'opportunities' }] };
    eq('a card grouped by something only one table has can borrow from none',
       B.combinableDatasets(byDropReason), []);

    const kpi = { id: 'b', type: 'kpi', dataset: 'revenue',
                  values: [{ field: 'revenue' }], layout: { x: 0, y: 0, w: 3, h: 3 } };
    eq('a KPI has nothing to line up, so it can borrow from anywhere',
       B.combinableDatasets(kpi).length, 7);

    // The dateless tables cannot be matched on a month, and must not be offered.
    const byMonth = { ...byClient, dims: [{ field: 'month', grain: 'month' }] };
    const onMonth = B.combinableDatasets(byMonth);
    eq('a card by month is not offered the two tables with no date',
       [onMonth.includes('pumps'), onMonth.includes('competitors'), onMonth.includes('orders')],
       [false, false, true]);
  }

  // changeDataset: shared categories travel, the rest is dropped and named.
  {
    const v = {
      id: 'a', type: 'column', dataset: 'revenue',
      axis: { field: 'state' }, split: { field: 'industry' },
      values: [{ field: 'revenue' }], layout: { x: 0, y: 0, w: 6, h: 6 },
    };
    const r = B.changeDataset(v, 'complaints');
    eq('a shared category keeps its place', [r.visual.axis.field, r.visual.split.field],
       ['state', 'industry']);
    eq('the card is on the new table', r.visual.dataset, 'complaints');
    eq('a measure the new table does not have is dropped and named',
       [r.visual.values.length, r.dropped], [0, ['Revenue ₹']]);
    eq('the size and position are untouched', r.visual.layout, v.layout);
  }
  {
    // A date travels to the other table's OWN date, with its grain, because
    // "by month" means each table's own month and not a join nobody asked for.
    const v = {
      id: 'a', type: 'line', dataset: 'revenue',
      axis: { field: 'month', grain: 'quarter' },
      values: [{ field: 'revenue' }], layout: { x: 0, y: 0, w: 6, h: 6 },
    };
    const r = B.changeDataset(v, 'complaints');
    eq('the axis becomes the new table\'s own date', r.visual.axis.field, 'complaint_date');
    eq('and keeps the grain that was chosen', r.visual.axis.grain, 'quarter');
  }
  {
    // A card by drop reason moved to Orders loses the category too, and both
    // losses are reported rather than one.
    const v = {
      id: 'a', type: 'bar', dataset: 'pipeline',
      axis: { field: 'drop_reason' },
      values: [{ field: 'opportunities' }], layout: { x: 0, y: 0, w: 6, h: 6 },
    };
    const r = B.changeDataset(v, 'orders');
    eq('a category the new table has no counterpart for goes',
       [r.visual.axis, r.dropped], [undefined, ['Drop reason', 'Opportunities']]);
  }
  {
    // Moving ONTO the table a number was borrowed from makes it an ordinary
    // number of the card's own, not a borrowing from itself.
    const v = {
      id: 'a', type: 'table', dataset: 'revenue', dims: [{ field: 'client' }],
      values: [{ field: 'order_value', dataset: 'orders' }], layout: { x: 0, y: 0, w: 8, h: 7 },
    };
    const r = B.changeDataset(v, 'orders');
    eq('a borrowed number comes home', r.visual.values, [{ field: 'order_value' }]);
    eq('with nothing reported lost', r.dropped, []);
    eq('and the card is no longer a two-table card', B.combinedInfo(r.visual), null);
  }
  {
    // Nothing happens where nothing should.
    const v = { id: 'a', type: 'kpi', dataset: 'revenue',
                values: [{ field: 'revenue' }], layout: { x: 0, y: 0, w: 3, h: 3 } };
    eq('switching to the table it is already on changes nothing',
       B.changeDataset(v, 'revenue').visual, v);
    eq('and a table that does not exist is refused',
       B.changeDataset(v, 'nonsense').visual, v);
  }

  // moveChip: a field dragged from one well to another.
  {
    let v = B.newVisual('column', 'revenue');
    v = B.addToWell(v, 'axis', 'revenue', 'state');
    v = B.addToWell(v, 'values', 'revenue', 'revenue');

    const toSplit = B.moveChip(v, 'axis', 0, 'split', 'revenue', 'state');
    eq('a category moved from the axis to the legend leaves the axis empty',
       [toSplit.axis, toSplit.split.field], [undefined, 'state']);

    // A move the target cannot take must leave the card exactly as it was,
    // rather than removing the chip and failing to re-add it.
    const kpi = B.changeType(v, 'kpi');
    eq('a refused move loses nothing', B.moveChip(v, 'axis', 0, 'dims', 'revenue', 'state'), v);
    eq('and a well the type does not have is a refusal, not a crash',
       B.moveChip(kpi, 'values', 0, 'axis', 'revenue', 'revenue'), kpi);
    eq('moving a chip to the well it is already in is a no-op',
       B.moveChip(v, 'axis', 0, 'axis', 'revenue', 'state'), v);
  }
  {
    // A borrowed number cannot become a category: the card groups rows of its
    // own table, and there is no honest answer to give.
    let v = B.newVisual('table', 'revenue');
    v = B.addToWell(v, 'dims', 'revenue', 'client');
    v = B.addToWell(v, 'values', 'orders', 'order_value');
    eq('a number from another table cannot be dragged into Group by',
       B.moveChip(v, 'values', 0, 'dims', 'orders', 'order_value'), v);
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
