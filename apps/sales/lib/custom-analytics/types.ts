// The shape of a report, and what each visual type can hold.
//
// CLIENT-SAFE. The builder imports this, so nothing here may reach the
// database — not even transitively. The SQL lives in sql.ts and the engine in
// engine.ts, both server-only.

/** Every visual we can draw. Anything else in a saved doc is rejected. */
export const VISUAL_TYPES = [
  'kpi', 'column', 'bar', 'line', 'area', 'donut', 'treemap', 'table', 'matrix',
] as const;
export type VisualType = typeof VISUAL_TYPES[number];

/** How a date field is bucketed. */
export const GRAINS = ['day', 'week', 'month', 'quarter', 'year', 'fy'] as const;
export type Grain = typeof GRAINS[number];

export const GRAIN_LABEL: Record<Grain, string> = {
  day: 'Day', week: 'Week', month: 'Month',
  quarter: 'Quarter', year: 'Year', fy: 'Financial year',
};

/** What a plain numeric column may be rolled up by. */
export const AGGS = ['sum', 'avg', 'min', 'max', 'count', 'countd'] as const;
export type Agg = typeof AGGS[number];

export const AGG_LABEL: Record<Agg, string> = {
  sum: 'Sum', avg: 'Average', min: 'Minimum', max: 'Maximum',
  count: 'Count', countd: 'Count distinct',
};

export interface FieldRef { field: string; grain?: Grain }
/** A number on a visual. `dataset` only when it comes from another table. */
export interface ValueRef { field: string; agg?: Agg; dataset?: string }

export interface PageFilters {
  datePreset?: string;
  dateFrom?: string;
  dateTo?: string;
  states?: string[];
  industries?: string[];
  reps?: number[];
  clientTypes?: string[];
  tiers?: string[];
}

export interface Layout { x: number; y: number; w: number; h: number }

export interface Visual {
  id: string;
  type: VisualType;
  dataset: string | null;
  /** The category or date a chart is grouped by. */
  axis?: FieldRef | null;
  /** A second category: the legend / series. */
  split?: FieldRef | null;
  /** Tables and matrices group by several at once. */
  dims?: FieldRef[];
  values: ValueRef[];
  title?: string;
  topN?: number;
  stacked?: boolean;
  layout: Layout;
}

export interface ReportPage {
  id: string;
  name: string;
  filters: PageFilters;
  visuals: Visual[];
}

export interface ReportDoc {
  version: 1;
  pages: ReportPage[];
}

/**
 * What each visual type accepts.
 *
 * `maxValues` is the hard cap; `splitCollapsesValues` marks the types where a
 * legend and several numbers cannot both be drawn on one y-scale, so adding a
 * split drops you to one value.
 */
export interface VisualMeta {
  label: string;
  /** Which wells the Build panel shows, in order. */
  wells: ('axis' | 'split' | 'dims' | 'values')[];
  maxValues: number;
  maxDims: number;
  splitCollapsesValues: boolean;
  /** Default size on the 12-column grid. */
  size: { w: number; h: number };
  /** Default top-N cap for a category axis, before the rest becomes "Other". */
  topN: number;
}

export const VISUAL_META: Record<VisualType, VisualMeta> = {
  kpi:     { label: 'KPI card',  wells: ['values'],                    maxValues: 1, maxDims: 0, splitCollapsesValues: false, size: { w: 3, h: 3 },  topN: 0 },
  column:  { label: 'Column',    wells: ['axis', 'split', 'values'],   maxValues: 4, maxDims: 0, splitCollapsesValues: true,  size: { w: 6, h: 6 },  topN: 15 },
  bar:     { label: 'Bar',       wells: ['axis', 'split', 'values'],   maxValues: 4, maxDims: 0, splitCollapsesValues: true,  size: { w: 6, h: 6 },  topN: 15 },
  line:    { label: 'Line',      wells: ['axis', 'split', 'values'],   maxValues: 4, maxDims: 0, splitCollapsesValues: true,  size: { w: 6, h: 6 },  topN: 15 },
  area:    { label: 'Area',      wells: ['axis', 'split', 'values'],   maxValues: 4, maxDims: 0, splitCollapsesValues: true,  size: { w: 6, h: 6 },  topN: 15 },
  donut:   { label: 'Donut',     wells: ['axis', 'values'],            maxValues: 1, maxDims: 0, splitCollapsesValues: false, size: { w: 4, h: 6 },  topN: 8 },
  treemap: { label: 'Treemap',   wells: ['axis', 'values'],            maxValues: 1, maxDims: 0, splitCollapsesValues: false, size: { w: 6, h: 6 },  topN: 30 },
  table:   { label: 'Table',     wells: ['dims', 'values'],            maxValues: 6, maxDims: 4, splitCollapsesValues: false, size: { w: 8, h: 7 },  topN: 0 },
  matrix:  { label: 'Matrix',    wells: ['axis', 'split', 'values'],   maxValues: 1, maxDims: 0, splitCollapsesValues: false, size: { w: 8, h: 7 },  topN: 50 },
};

/** Cap on a split (the legend), whatever the visual. Eight colours, then "Other". */
export const SPLIT_CAP = 8;
/** Matrix columns are read across a screen, so fewer than its rows. */
export const MATRIX_COL_CAP = 12;

/** The label used for everything outside the top N. Never clickable. */
export const OTHER = 'Other';

// Saved documents are user input. These are the caps the save path enforces
// and the engine re-checks, so a hand-edited doc cannot ask for 900 visuals.
export const MAX_PAGES = 20;
export const MAX_VISUALS_PER_PAGE = 40;
export const GRID_COLS = 12;
export const ROW_H = 44;
export const TABLE_PAGE_SIZE = 50;

export const isVisualType = (v: unknown): v is VisualType =>
  typeof v === 'string' && (VISUAL_TYPES as readonly string[]).includes(v);
export const isGrain = (v: unknown): v is Grain =>
  typeof v === 'string' && (GRAINS as readonly string[]).includes(v);
export const isAgg = (v: unknown): v is Agg =>
  typeof v === 'string' && (AGGS as readonly string[]).includes(v);
