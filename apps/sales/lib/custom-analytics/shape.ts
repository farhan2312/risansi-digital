// Turning the engine's rows into the shape a chart draws.
//
// CLIENT-SAFE, and deliberately free of React: this is the arithmetic, and
// arithmetic that lives inside a component is arithmetic nobody tests. Both
// functions here are the kind that fail quietly — a legend ordered one way
// and the segments another, or a treemap whose rectangles do not add up to
// the box — so they are pulled out where scripts/report-model-check.mjs can
// assert on them.

import { OTHER, type Grain } from './types';
import type { Format } from './model';
import { bucketLabel } from './fmt';

export type Cell = string | number | null;
export type ShapeRow = Record<string, Cell>;

export interface Part { key: string; label: string; value: number | null; colour: string }
export interface Cat {
  /** The raw bucket key, as the engine returned it. Null for a blank category. */
  raw: string | null;
  label: string;
  parts: Part[];
  total: number;
  /** False for "Other" and for a null category: nothing to filter on. */
  clickable: boolean;
}
export interface Normalised {
  cats: Cat[];
  legend: { label: string; colour: string }[];
  /** One entry per part position. */
  formats: Format[];
  /** True when the parts are split members rather than separate numbers. */
  isSplit: boolean;
}
export interface SeriesDef { key: string; label: string; format: Format }

/** The chart palette. First four are the semantic tokens. */
export const SERIES = [
  'var(--accent)', 'var(--pos)', 'var(--warn)', 'var(--neg)',
  '#7C3AED', '#0891B2', '#DB2777', 'var(--fg-3)',
];
export const col = (i: number) => SERIES[i % SERIES.length];

const toNum = (c: Cell): number | null =>
  typeof c === 'number' ? c : c == null ? null : (Number.isFinite(Number(c)) ? Number(c) : null);

/**
 * The engine's rows as categories and series.
 *
 * With a split the rows are long — one per axis value per split value — and
 * the series are the split's members, ordered by their own totals so the
 * legend reads biggest first and "Other" sits last whatever its size. Without
 * one the series are simply the numbers on the visual, in the order they were
 * added, and the axis order the engine chose is kept exactly.
 *
 * Every category carries every series, even where the query returned no row
 * for that combination, so a stacked bar does not go ragged and a legend
 * entry never points at a colour that is missing from half the chart.
 */
export function normalise(
  rows: ShapeRow[], series: SeriesDef[],
  axis: { grain?: Grain; isDate: boolean } | null,
  hasSplit: boolean,
): Normalised {
  const label = (raw: string | null) =>
    raw === null ? '(none)' : axis?.isDate ? bucketLabel(axis.grain, raw) : raw;

  if (!hasSplit) {
    const cats: Cat[] = rows.map(r => {
      const raw = r.d0 == null ? null : String(r.d0);
      const parts = series.map((s, i) => ({
        key: s.key, label: s.label, value: toNum(r[s.key]), colour: col(i),
      }));
      return {
        raw, label: label(raw), parts,
        total: parts.reduce((a, p) => a + (p.value ?? 0), 0),
        clickable: raw !== null && raw !== OTHER,
      };
    });
    return {
      cats,
      legend: series.length > 1 ? series.map((s, i) => ({ label: s.label, colour: col(i) })) : [],
      formats: series.map(s => s.format),
      isSplit: false,
    };
  }

  // Split: the first number only, pivoted on d1.
  const vKey = series[0]?.key ?? 'm0';
  const fmt = series[0]?.format ?? 'num';
  const NULLK = '\u0000null';
  const memberTotal = new Map<string, number>();
  const axisOrder: (string | null)[] = [];
  const byAxis = new Map<string, Map<string, number | null>>();

  for (const r of rows) {
    const a = r.d0 == null ? null : String(r.d0);
    const m = r.d1 == null ? '(none)' : String(r.d1);
    const k = a ?? NULLK;
    if (!byAxis.has(k)) { byAxis.set(k, new Map()); axisOrder.push(a); }
    const v = toNum(r[vKey]);
    byAxis.get(k)!.set(m, v);
    memberTotal.set(m, (memberTotal.get(m) ?? 0) + (v ?? 0));
  }

  const members = [...memberTotal.entries()]
    .sort((a, b) => (a[0] === OTHER ? 1 : b[0] === OTHER ? -1 : b[1] - a[1]))
    .map(([m]) => m);

  const cats: Cat[] = axisOrder.map(a => {
    const m = byAxis.get(a ?? NULLK)!;
    const parts = members.map((name, i) => ({
      key: name, label: name, value: m.get(name) ?? null, colour: col(i),
    }));
    return {
      raw: a, label: label(a), parts,
      total: parts.reduce((s, p) => s + (p.value ?? 0), 0),
      clickable: a !== null && a !== OTHER,
    };
  });

  return {
    cats,
    legend: members.map((m, i) => ({ label: m, colour: col(i) })),
    formats: members.map(() => fmt),
    isSplit: true,
  };
}

// ── treemap ───────────────────────────────────────────────────

export interface Rect { x: number; y: number; w: number; h: number }

/**
 * Squarified treemap layout.
 *
 * Laid out by area so the biggest category is the biggest rectangle, which is
 * the only reason to use one of these over a bar chart. Slice-and-dice would
 * give long slivers nobody can compare by eye; squarify keeps each rectangle
 * close to square by filling the shorter side of what is left.
 *
 * `fracs` must sum to 1 and be sorted largest first. The rectangles returned
 * tile the box exactly and in the same order.
 */
export function squarify(fracs: number[], box: Rect): Rect[] {
  const out: Rect[] = [];
  let rest = fracs.filter(f => f > 0);
  let area: Rect = { ...box };
  let remaining = rest.reduce((a, b) => a + b, 0);

  while (rest.length) {
    const horiz = area.w >= area.h;
    const side = horiz ? area.h : area.w;
    const other = horiz ? area.w : area.h;

    // Take items into the strip while the worst aspect ratio keeps improving.
    let take = 1, best = Infinity;
    for (let k = 1; k <= rest.length; k++) {
      const sum = rest.slice(0, k).reduce((a, b) => a + b, 0);
      const thick = remaining > 0 ? (sum / remaining) * other : other;
      const worst = Math.max(...rest.slice(0, k).map(f => {
        const len = sum > 0 ? (f / sum) * side : side;
        return Math.max(thick / (len || 1e-9), (len || 1e-9) / (thick || 1e-9));
      }));
      if (worst <= best) { best = worst; take = k; } else break;
    }

    const strip = rest.slice(0, take);
    const sum = strip.reduce((a, b) => a + b, 0);
    // The last strip takes the whole remainder, so rounding cannot leave a
    // sliver of the box uncovered.
    const thick = rest.length === take ? other : (remaining > 0 ? (sum / remaining) * other : other);
    let along = 0;
    strip.forEach((f, i) => {
      const len = i === strip.length - 1 ? side - along : (sum > 0 ? (f / sum) * side : side / strip.length);
      out.push(horiz
        ? { x: area.x, y: area.y + along, w: thick, h: len }
        : { x: area.x + along, y: area.y, w: len, h: thick });
      along += len;
    });

    rest = rest.slice(take);
    remaining -= sum;
    area = horiz
      ? { x: area.x + thick, y: area.y, w: area.w - thick, h: area.h }
      : { x: area.x, y: area.y + thick, w: area.w, h: area.h - thick };
  }
  return out;
}

// ── matrix ────────────────────────────────────────────────────

export const TOTAL_KEY = '__total';

export interface MatrixShape {
  rowKeys: (string | null)[];
  colKeys: (string | null)[];
  cell: (r: string | null, c: string | null) => number | null;
  rowTotal: (r: string | null) => number | null;
  colTotal: (c: string | null) => number | null;
  grand: number | null;
  /** Biggest absolute cell, for the shading. */
  max: number;
}

/**
 * A pivot from the engine's GROUPING SETS output.
 *
 * The engine marks a grouped-away dimension '__total' rather than null, so a
 * genuinely blank category and a total line are told apart here instead of
 * being guessed at. Rows and columns are ordered by their own totals unless
 * the dimension is a date, in which case the engine's chronological order is
 * what the reader wants and is kept.
 */
export function shapeMatrix(rows: ShapeRow[], rowDate = false, colDate = false): MatrixShape {
  const k = (v: string | null) => v ?? '\u0000null';
  const cells = new Map<string, number | null>();
  const rowTotals = new Map<string, number | null>();
  const colTotals = new Map<string, number | null>();
  let grand: number | null = null;
  const rowKeys: (string | null)[] = [];
  const colKeys: (string | null)[] = [];
  const seenR = new Set<string>(), seenC = new Set<string>();

  const noteRow = (v: string | null) => { if (!seenR.has(k(v))) { seenR.add(k(v)); rowKeys.push(v); } };
  const noteCol = (v: string | null) => { if (!seenC.has(k(v))) { seenC.add(k(v)); colKeys.push(v); } };

  for (const r of rows) {
    const rk = r.d0 === TOTAL_KEY ? TOTAL_KEY : (r.d0 == null ? null : String(r.d0));
    const ck = r.d1 === TOTAL_KEY ? TOTAL_KEY : (r.d1 == null ? null : String(r.d1));
    const v = toNum(r.m0);
    if (rk === TOTAL_KEY && ck === TOTAL_KEY) { grand = v; continue; }
    if (rk === TOTAL_KEY) { colTotals.set(k(ck), v); noteCol(ck); continue; }
    if (ck === TOTAL_KEY) { rowTotals.set(k(rk), v); noteRow(rk); continue; }
    cells.set(`${k(rk)}\u0001${k(ck)}`, v);
    noteRow(rk); noteCol(ck);
  }

  const byTotal = (m: Map<string, number | null>) => (a: string | null, b: string | null) =>
    a === OTHER ? 1 : b === OTHER ? -1 : (m.get(k(b)) ?? 0) - (m.get(k(a)) ?? 0);

  return {
    rowKeys: rowDate ? rowKeys : [...rowKeys].sort(byTotal(rowTotals)),
    colKeys: colDate ? colKeys : [...colKeys].sort(byTotal(colTotals)),
    cell: (r, c) => cells.get(`${k(r)}\u0001${k(c)}`) ?? null,
    rowTotal: r => rowTotals.get(k(r)) ?? null,
    colTotal: c => colTotals.get(k(c)) ?? null,
    grand,
    max: Math.max(...[...cells.values()].map(v => Math.abs(v ?? 0)), 1),
  };
}
