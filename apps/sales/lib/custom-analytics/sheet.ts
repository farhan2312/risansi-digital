// A card, as a sheet.
//
// CLIENT-SAFE and pure: this turns a Visual plus the engine's rows into
// columns and cells, and nothing else. The workbook itself is assembled in
// app/api/risansi/reports/export/route.ts, which does the ExcelJS work and
// knows nothing about what a matrix is.
//
// WHY THE EXPORT RE-RUNS THE QUERY INSTEAD OF TAKING WHAT IS ON SCREEN
//
// The Executive Review's export posts the figures the page drew, because that
// page computes its tables in the browser and a second implementation would
// be a second set of numbers. A report is the opposite case: there is exactly
// one implementation of its figures, the engine, so the export calls it — and
// gets something better than the screen. The screen folds a long category
// into "Other" at fifteen rows and pages a table at fifty; `forExport` drops
// both, so the sheet carries every row the question actually has.
//
// WHAT A NUMBER IS
//
// A number. Never a pre-formatted string: a column of "₹1,23,54,288" cannot
// be summed, sorted or pivoted, which is most of the reason for wanting a
// spreadsheet. The rupee shape goes on the cell format and the unit goes in
// the column heading, so the figure stays a figure.

import { fieldOf, DATASET_BY_ID, type Format } from './model';
import { formatOf, labelOf, bucketLabel } from './fmt';
import { shapeMatrix } from './shape';
import type { Visual, PageFilters, Grain } from './types';

export interface SheetCol {
  label: string;
  kind: 'text' | 'number';
  numFmt?: string;
}

export interface SheetData {
  /** The sheet's name. Trimmed to Excel's rules by the route, not here. */
  name: string;
  /** One line saying what the card is, written onto the sheet. */
  note: string;
  cols: SheetCol[];
  rows: (string | number | null)[][];
  /** Set when there is nothing to write, and why. */
  skipped?: string;
}

/** What the engine returns, as much of it as a sheet needs. */
export interface SheetSource {
  ok: boolean;
  rows?: Record<string, string | number | null>[];
  error?: string;
}

/**
 * Excel's own number formats.
 *
 * Rupees get no ₹ in the format: the symbol is in the column heading, and a
 * currency-formatted column is a nuisance to paste into another sheet whose
 * own currency differs. Indian digit grouping is deliberately not asked for —
 * Excel's own locale handling for `#,##0` does the right thing on an Indian
 * machine and the wrong thing nowhere.
 */
export function numFmtOf(format: Format): string {
  switch (format) {
    case 'inr': return '#,##0';
    case 'cr':  return '#,##0.00';
    case 'pct': return '0.0';
    case 'int': return '#,##0';
    default:    return '#,##0.##';
  }
}

const NONE = '(none)';
const TOTAL = 'Total';

const text = (v: unknown, grain?: Grain, isDate?: boolean): string => {
  if (v === null || v === undefined || v === '') return NONE;
  return isDate ? bucketLabel(grain, String(v)) : String(v);
};

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** The heading for a number column: its label, which already carries the unit. */
const valueCols = (v: Visual): SheetCol[] =>
  (v.values ?? []).map(ref => ({
    label: labelOf(v.dataset, ref),
    kind: 'number' as const,
    numFmt: numFmtOf(formatOf(v.dataset, ref)),
  }));

/** One line of provenance for the sheet: what this card is. */
export function cardNote(v: Visual, title: string): string {
  const ds = v.dataset ? DATASET_BY_ID.get(v.dataset)?.label ?? v.dataset : 'no table';
  const dims = [v.axis, v.split, ...(v.dims ?? [])]
    .filter(Boolean)
    .map(d => fieldOf(v.dataset ?? '', d!.field)?.label ?? d!.field);
  return dims.length ? `${title} — ${ds}, by ${dims.join(' and ')}` : `${title} — ${ds}`;
}

export function sheetFor(visual: Visual, result: SheetSource, title: string): SheetData {
  const base = { name: title, note: cardNote(visual, title) };
  if (!result.ok) {
    return { ...base, cols: [], rows: [], skipped: result.error || 'This card could not be run.' };
  }
  const rows = result.rows ?? [];
  const vals = valueCols(visual);

  if (visual.type === 'kpi') {
    const r = rows[0] ?? {};
    return { ...base, cols: vals, rows: [vals.map((_, i) => num(r[`m${i}`]))] };
  }

  if (visual.type === 'matrix') {
    return matrixSheet(visual, rows, base, vals[0]);
  }

  // Everything else comes back long: one row per combination, the dimensions
  // first and then the numbers. Long is the right shape for a spreadsheet —
  // it pivots, and a pre-pivoted grid does not un-pivot.
  const dimRefs = visual.type === 'table'
    ? (visual.dims ?? [])
    : [visual.axis, visual.split].filter(Boolean);

  const dimCols: SheetCol[] = dimRefs.map(d => {
    const f = fieldOf(visual.dataset ?? '', d!.field);
    return { label: f?.label ?? d!.field, kind: 'text' as const };
  });

  const out = rows.map(r => [
    ...dimRefs.map((d, i) => {
      const f = fieldOf(visual.dataset ?? '', d!.field);
      return text(r[`d${i}`], d!.grain, !!f?.date);
    }),
    ...vals.map((_, i) => num(r[`m${i}`])),
  ]);

  return { ...base, cols: [...dimCols, ...vals], rows: out };
}

/**
 * A matrix, as the cross-tab it looks like on screen.
 *
 * The engine returns a matrix as long rows with '__total' markers from its
 * GROUPING SETS, which would export as a column of the word "__total" next to
 * figures that are already in the table. shapeMatrix reads those markers back
 * into real totals, and they are written as the last row and last column —
 * computed by the database over every row, not by adding up the cells, so
 * they are right even where a category was folded away.
 */
function matrixSheet(
  visual: Visual,
  rows: Record<string, string | number | null>[],
  base: { name: string; note: string },
  val: SheetCol | undefined,
): SheetData {
  const axis = visual.axis ? fieldOf(visual.dataset ?? '', visual.axis.field) : null;
  const split = visual.split ? fieldOf(visual.dataset ?? '', visual.split.field) : null;
  const m = shapeMatrix(rows, !!axis?.date, !!split?.date);
  const fmt = val?.numFmt ?? '#,##0';

  const cols: SheetCol[] = [
    { label: axis?.label ?? 'Rows', kind: 'text' },
    ...m.colKeys.map(c => ({
      label: text(c, visual.split?.grain, !!split?.date),
      kind: 'number' as const, numFmt: fmt,
    })),
    { label: TOTAL, kind: 'number', numFmt: fmt },
  ];

  const out: (string | number | null)[][] = m.rowKeys.map(r => [
    text(r, visual.axis?.grain, !!axis?.date),
    ...m.colKeys.map(c => m.cell(r, c)),
    m.rowTotal(r),
  ]);
  out.push([TOTAL, ...m.colKeys.map(c => m.colTotal(c)), m.grand]);

  return { ...base, cols, rows: out };
}

// ── provenance ────────────────────────────────────────────────

/**
 * The filters, in words, for the top of the sheet.
 *
 * A spreadsheet that has been emailed on has lost the page it came from, and
 * "₹6.18 Cr" with no idea whose book or which months is a figure nobody can
 * use. Rep ids are passed in resolved because this file cannot query.
 */
export function filterWords(
  f: PageFilters,
  repNames: Map<number, string>,
  cross?: { label?: string } | null,
): string {
  const parts: string[] = [];
  if (f.datePreset && f.datePreset !== 'Custom') parts.push(f.datePreset);
  else if (f.dateFrom || f.dateTo) parts.push(`${f.dateFrom ?? 'the start'} to ${f.dateTo ?? 'today'}`);
  else parts.push('All time');

  const list = (label: string, vs?: string[]) => {
    if (vs?.length) parts.push(`${label}: ${vs.join(', ')}`);
  };
  list('State', f.states);
  list('Industry', f.industries);
  list('Direct / OEM', f.clientTypes);
  list('Tier', f.tiers);
  if (f.reps?.length) {
    parts.push(`Sales rep: ${f.reps.map(id => repNames.get(id) ?? `#${id}`).join(', ')}`);
  }
  if (cross?.label) parts.push(`filtered to ${cross.label}`);
  return parts.join(' · ');
}
