// SERVER ONLY. One visual in, one set of aggregated rows out.
//
// Everything a report can ask is routed through runVisual. It validates the
// request against the model before a word of SQL is assembled, applies the
// reader's own row-level scope, and never puts a user-supplied string into
// SQL text - values are bound parameters, and the handful of things that
// cannot be bound (LIMIT, OFFSET, sort key, grain) are clamped or looked up
// in an allow-list.
//
// SCOPE IS THE ONLY LIMIT ON THIS DATA
//
// No field is withheld for sensitivity, by decision - outstanding balances,
// rep targets and contact details are all selectable. So the row-level rule
// is carrying the whole weight, and it fails CLOSED: a scope that cannot be
// resolved becomes WHERE false, not an absent predicate.
//
// Each dataset is scoped by the rule the rest of the portal already uses for
// that table, rather than a new one invented here:
//
//   revenue, pipeline, orders, visits   clientScopeSql   (records)
//   complaints                          complaintVisibilitySql
//   clients, installed base, competitors clientVisibilitySql (attributes)
//
// That keeps a report honest against the pages: a rep who cannot see an
// opportunity on the pipeline board cannot see it in a report either, and
// the three read-only roles get exactly the reach they already have.

import risansiPool from '@/lib/db-risansi';
import { presetRange } from '@/lib/risansi-date-presets';
import {
  DATASET_BY_ID, fieldOf, mapDim, combinableOn, type ModelField,
} from './model';
import {
  DATASET_SQL, dimLabel, dateBucket, dateMoment, PAGE_FILTER_SQL, type DatasetSql,
} from './sql';
import {
  VISUAL_META, SPLIT_CAP, MATRIX_COL_CAP, OTHER, TABLE_PAGE_SIZE,
  isAgg, isGrain, isVisualType,
  type Agg, type Grain, type PageFilters, type Visual, type FieldRef, type ValueRef,
} from './types';

/**
 * A predicate per dataset: null for no restriction, 'FALSE' for nothing at
 * all, otherwise SQL built from trusted session values. Defined here rather
 * than beside the auth helpers so the engine does not depend on sessions -
 * scope.ts implements this from a CurrentUser, and the sweep supplies it
 * directly.
 */
export type ReportScope = Record<string, string | null>;

/** Every row of every table. Admin-equivalent; used by the read-only sweep. */
export const UNSCOPED: ReportScope = Object.fromEntries(
  Object.keys(DATASET_SQL).map(id => [id, null]),
);

export type Cell = string | number | null;
export type Row = Record<string, Cell>;

export interface CrossFilter {
  dataset: string;
  field: string;
  grain?: Grain;
  value: string;
  /** Set when the clicked field is a shared dimension, so it can travel. */
  common?: string;
  /** Cosmetic; stripped from the cache key. */
  label?: string;
  sourceVisual?: string;
}

export interface RunOpts {
  page?: number;
  sortKey?: string;
  sortDir?: 'asc' | 'desc';
  /** Drops paging and top-N folding. Never cached. */
  forExport?: boolean;
}

export interface RunResult {
  ok: boolean;
  rows?: Row[];
  /** Total matching rows, for a paged table. */
  total?: number;
  /** True when a category was folded into "Other". */
  truncated?: boolean;
  /** Page filters this dataset could not answer. */
  ignoredFilters?: string[];
  error?: string;
}

const MAX_GROUP_ROWS = 20_000;
const MAX_EXPORT_ROWS = 50_000;
const STATEMENT_TIMEOUT_MS = 25_000;

/** Bound parameters, one list per statement. */
class Params {
  readonly list: unknown[] = [];
  add(v: unknown, cast = ''): string {
    this.list.push(v);
    return `$${this.list.length}${cast}`;
  }
}

const fail = (error: string): RunResult => ({ ok: false, error });

// ── validation ────────────────────────────────────────────────

interface Dim { key: string; expr: string; field: ModelField; grain?: Grain; isDate: boolean }
interface Val { key: string; expr: string; field: ModelField; dataset: string }

/** A dimension of `ds`, as SQL. Null when the model does not have it. */
function resolveDim(ds: string, ref: FieldRef, key: string): Dim | null {
  const f = fieldOf(ds, ref.field);
  const s = DATASET_SQL[ds];
  if (!f || !s || f.kind !== 'dim') return null;
  if (f.date) {
    const d = s.dates[ref.field];
    if (!d) return null;
    const grain: Grain = isGrain(ref.grain) ? ref.grain : 'month';
    return { key, expr: dateBucket(d, grain), field: f, grain, isDate: true };
  }
  const expr = s.dims[ref.field];
  if (!expr) return null;
  return { key, expr: dimLabel(expr), field: f, isDate: false };
}

/** A number of `ds`, as a complete aggregate. */
function resolveVal(ds: string, ref: ValueRef, key: string): Val | null {
  const f = fieldOf(ds, ref.field);
  const s = DATASET_SQL[ds];
  if (!f || !s) return null;
  if (f.kind === 'measure') {
    const expr = s.measures[ref.field];
    return expr ? { key, expr, field: f, dataset: ds } : null;
  }
  const col = f.kind === 'num' ? s.nums[ref.field] : (s.dims[ref.field] ?? s.dates[ref.field]?.expr);
  if (!col) return null;
  const agg: Agg = isAgg(ref.agg) ? ref.agg : (f.defaultAgg ?? (f.kind === 'num' ? 'sum' : 'count'));
  // The aggregation is one of six known words, never the user's text.
  const sqlAgg =
    agg === 'countd' ? `count(DISTINCT ${col})`
    : agg === 'count' ? `count(${col})`
    : `${agg}(${col})`;
  return { key, expr: sqlAgg, field: f, dataset: ds };
}

// ── predicates ────────────────────────────────────────────────

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** The page date filter as [from, to], already validated. */
function dateRange(f: PageFilters): { from: string; to: string } | null {
  if (f.datePreset && f.datePreset !== 'Custom') {
    return presetRange(f.datePreset);
  }
  const from = f.dateFrom && ISO.test(f.dateFrom) ? f.dateFrom : null;
  const to   = f.dateTo   && ISO.test(f.dateTo)   ? f.dateTo   : null;
  if (!from && !to) return null;
  return { from: from ?? '1900-01-01', to: to ?? '2999-12-31' };
}

interface Where { sql: string; ignored: string[] }

function buildWhere(
  scope: ReportScope, ds: string, s: DatasetSql,
  filters: PageFilters, cross: CrossFilter | undefined, p: Params,
): Where {
  const parts: string[] = [];
  const ignored: string[] = [];

  if (s.where) parts.push(s.where);

  // Scope first, and fail closed: a dataset the scope has no entry for is
  // one nobody has been granted, not one everybody may read.
  const rule = Object.prototype.hasOwnProperty.call(scope, ds) ? scope[ds] : 'FALSE';
  if (rule === 'FALSE') parts.push('FALSE');
  else if (rule) parts.push(rule);

  // Date range against the dataset's own main date.
  const range = dateRange(filters);
  if (range) {
    const main = DATASET_BY_ID.get(ds)?.dateField;
    const d = main ? s.dates[main] : null;
    if (d) {
      const m = dateMoment(d);
      parts.push(`${m} >= ${p.add(range.from, '::timestamp')}`);
      parts.push(`${m} < ${p.add(range.to, '::timestamp')} + interval '1 day'`);
    } else {
      ignored.push('date range');
    }
  }

  const textIn = (vals: string[] | undefined, col: string, name: string) => {
    const v = (vals ?? []).filter(x => typeof x === 'string' && x.length <= 120);
    if (!v.length) return;
    if (!col) { ignored.push(name); return; }
    parts.push(`${col} = ANY(${p.add(v, '::text[]')})`);
  };
  textIn(filters.states,      PAGE_FILTER_SQL.states,      'state');
  textIn(filters.industries,  PAGE_FILTER_SQL.industries,  'industry');
  textIn(filters.clientTypes, PAGE_FILTER_SQL.clientTypes, 'client type');
  textIn(filters.tiers,       PAGE_FILTER_SQL.tiers,       'tier');

  const reps = (filters.reps ?? []).filter(n => Number.isInteger(n));
  if (reps.length) parts.push(`${PAGE_FILTER_SQL.reps} = ANY(${p.add(reps, '::int[]')})`);

  // Cross-filter: the same field on the same table, or a shared dimension
  // that the other table also carries.
  if (cross) {
    const target = cross.dataset === ds
      ? cross.field
      : (cross.common ? DATASET_BY_ID.get(ds)?.fields.find(f => f.common === cross.common)?.id ?? null : null);
    if (target) {
      const d = resolveDim(ds, { field: target, grain: cross.grain }, 'x');
      if (d) parts.push(`${d.expr} = ${p.add(String(cross.value), '::text')}`);
    }
  }

  return { sql: parts.length ? `WHERE ${parts.join(' AND ')}` : '', ignored };
}

// ── running ───────────────────────────────────────────────────

const num = (v: unknown): Cell => {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return v;
  const n = Number(v);
  return Number.isFinite(n) ? n : String(v);
};

async function query(sql: string, params: unknown[]): Promise<Row[]> {
  const client = await risansiPool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SET LOCAL statement_timeout = ${STATEMENT_TIMEOUT_MS}`);
    const { rows } = await client.query(sql, params);
    await client.query('COMMIT');
    return rows as Row[];
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch { /* the connection is going back anyway */ }
    throw e;
  } finally {
    client.release();
  }
}

const TIMEOUT_CODES = new Set(['57014']);
function friendly(e: unknown): string {
  const code = (e as { code?: string } | null)?.code;
  if (code && TIMEOUT_CODES.has(code)) {
    return 'This visual took too long — add a filter or pick fewer categories.';
  }
  return 'Could not load this visual.';
}

/**
 * The top N categories by the first value, so the rest can become "Other".
 *
 * A separate statement with its own parameter list. Reusing the main query's
 * list would hand Postgres parameters this statement never mentions, and it
 * rejects that outright rather than ignoring them.
 */
async function topKeys(
  scope: ReportScope, ds: string, s: DatasetSql, dim: Dim, val: Val,
  filters: PageFilters, cross: CrossFilter | undefined, cap: number,
): Promise<string[] | null> {
  const p = new Params();
  const w = buildWhere(scope, ds, s, filters, cross, p);
  // cap is clamped by the caller and interpolated as an integer only.
  const sql = `SELECT ${dim.expr} AS d, ${val.expr} AS m
                 FROM ${s.from} ${w.sql}
                GROUP BY 1 ORDER BY m DESC NULLS LAST LIMIT ${cap + 1}`;
  const rows = await query(sql, p.list);
  if (rows.length <= cap) return null;
  return rows.slice(0, cap).map(r => String(r.d));
}

/** The cap for a dim on this visual, or 0 for no folding. */
function capFor(v: Visual, which: 'axis' | 'split'): number {
  const meta = VISUAL_META[v.type];
  if (which === 'split') return SPLIT_CAP;
  if (v.type === 'matrix') return meta.topN;
  const asked = Number(v.topN);
  const base = meta.topN;
  if (!base) return 0;
  // Clamped: topN arrives from the browser and ends up in a LIMIT.
  return Number.isInteger(asked) && asked > 0 ? Math.min(asked, 200) : base;
}

/**
 * Run one visual.
 *
 * `scope` is the READER's, never the report owner's: a shared report is
 * evaluated for whoever has it open, so sharing can never widen access.
 */
export async function runVisual(
  scope: ReportScope,
  visual: Visual,
  filters: PageFilters = {},
  cross?: CrossFilter,
  opts: RunOpts = {},
): Promise<RunResult> {
  try {
    if (!isVisualType(visual?.type)) return fail('Unknown visual type.');
    const ds = visual.dataset;
    if (!ds || !DATASET_BY_ID.has(ds) || !DATASET_SQL[ds]) return fail('Pick a table for this visual.');
    const s = DATASET_SQL[ds];
    const meta = VISUAL_META[visual.type];

    // Values, each possibly from another table.
    const valueRefs = (visual.values ?? []).slice(0, meta.maxValues);
    if (!valueRefs.length) return fail('Add a number to this visual.');

    // Dimensions, in the order they become d0, d1, …
    const dimRefs: FieldRef[] =
      visual.type === 'table' ? (visual.dims ?? []).slice(0, meta.maxDims)
      : [visual.axis, visual.split].filter(Boolean).slice(0, 2) as FieldRef[];

    const dims: Dim[] = [];
    for (const [i, ref] of dimRefs.entries()) {
      const d = resolveDim(ds, ref, `d${i}`);
      if (!d) return fail(`This table has no field "${ref.field}".`);
      dims.push(d);
    }

    const foreign = valueRefs.some(v => v.dataset && v.dataset !== ds);
    if (foreign) return runCombined(scope, visual, ds, dims, valueRefs, filters, cross, opts);

    const vals: Val[] = [];
    for (const [i, ref] of valueRefs.entries()) {
      const v = resolveVal(ds, ref, `m${i}`);
      if (!v) return fail(`This table has no number "${ref.field}".`);
      vals.push(v);
    }

    if (visual.type === 'matrix') return runMatrix(scope, ds, s, dims, vals, filters, cross);
    if (!dims.length) return runScalar(scope, ds, s, vals, filters, cross);
    return runGrouped(scope, visual, ds, s, dims, vals, filters, cross, opts);
  } catch (e) {
    return fail(friendly(e));
  }
}

/** A KPI: no grouping, one row. */
async function runScalar(
  scope: ReportScope, ds: string, s: DatasetSql, vals: Val[],
  filters: PageFilters, cross: CrossFilter | undefined,
): Promise<RunResult> {
  const p = new Params();
  const w = buildWhere(scope, ds, s, filters, cross, p);
  const sel = vals.map(v => `${v.expr} AS ${v.key}`).join(', ');
  const rows = await query(`SELECT ${sel} FROM ${s.from} ${w.sql}`, p.list);
  const r: Row = {};
  for (const v of vals) r[v.key] = num(rows[0]?.[v.key]);
  return { ok: true, rows: [r], ignoredFilters: w.ignored.length ? w.ignored : undefined };
}

const SORT_KEY = /^[dm]\d$/;

async function runGrouped(
  scope: ReportScope, visual: Visual, ds: string, s: DatasetSql,
  dims: Dim[], vals: Val[], filters: PageFilters, cross: CrossFilter | undefined,
  opts: RunOpts,
): Promise<RunResult> {
  // Fold each capped category into "Other", dates excepted - a month is not
  // "top" or "other", it is just a month.
  const keysByDim = new Map<string, string[]>();
  if (!opts.forExport) {
    for (const [i, d] of dims.entries()) {
      if (d.isDate) continue;
      const cap = capFor(visual, i === 0 ? 'axis' : 'split');
      if (!cap) continue;
      const keys = await topKeys(scope, ds, s, d, vals[0], filters, cross, cap);
      if (keys) keysByDim.set(d.key, keys);
    }
  }

  const p = new Params();
  const w = buildWhere(scope, ds, s, filters, cross, p);
  // Built with a loop rather than a map so each fold's parameter is added to
  // `p` in the order it appears in the statement.
  const dimSel: string[] = [];
  for (const d of dims) {
    const keys = keysByDim.get(d.key);
    dimSel.push(`${keys ? `CASE WHEN ${d.expr} = ANY(${p.add(keys, '::text[]')}) THEN ${d.expr} ELSE '${OTHER}' END` : d.expr} AS ${d.key}`);
  }
  const valSel = vals.map(v => `${v.expr} AS ${v.key}`);
  const groupBy = dims.map((_, i) => i + 1).join(', ');

  const isTable = visual.type === 'table';
  const totalSel = isTable ? ', count(*) OVER ()::int AS __total' : '';

  // Postgres cannot see an output alias inside an ORDER BY expression, so the
  // ordering that needs one goes outside a wrapping select.
  const sortKey = opts.sortKey && SORT_KEY.test(opts.sortKey) &&
                  (dims.some(d => d.key === opts.sortKey) || vals.some(v => v.key === opts.sortKey))
    ? opts.sortKey : null;
  const dir = opts.sortDir === 'asc' ? 'ASC' : 'DESC';
  const order = sortKey
    ? `ORDER BY ${sortKey} ${dir} NULLS LAST`
    : dims[0].isDate
      ? `ORDER BY d0 ASC`
      // "Other" last whatever its size, then biggest first.
      : `ORDER BY (d0 = '${OTHER}'), ${vals[0].key} DESC NULLS LAST`;

  const limit = opts.forExport ? MAX_EXPORT_ROWS
    : isTable ? TABLE_PAGE_SIZE
    : MAX_GROUP_ROWS;
  const page = Number.isInteger(opts.page) && opts.page! > 0 ? Math.min(opts.page!, 10_000) : 0;
  const offset = isTable && !opts.forExport ? page * TABLE_PAGE_SIZE : 0;

  const sql = `SELECT * FROM (
                 SELECT ${dimSel.join(', ')}, ${valSel.join(', ')}${totalSel}
                   FROM ${s.from} ${w.sql}
                  GROUP BY ${groupBy}
               ) t ${order} LIMIT ${limit} OFFSET ${offset}`;

  const raw = await query(sql, p.list);
  const total = isTable ? Number(raw[0]?.__total ?? 0) : undefined;
  const rows = raw.map(r => {
    const o: Row = {};
    for (const d of dims) o[d.key] = r[d.key] == null ? null : String(r[d.key]);
    for (const v of vals) o[v.key] = num(r[v.key]);
    return o;
  });

  return {
    ok: true, rows, total,
    truncated: keysByDim.size > 0 || undefined,
    ignoredFilters: w.ignored.length ? w.ignored : undefined,
  };
}

/**
 * A pivot, with its totals computed by the database.
 *
 * GROUPING SETS rather than summing the cells in JavaScript: an average or a
 * distinct count of a row is not the average or the count of its parts, so
 * adding up the cells gives a total that is simply wrong.
 */
async function runMatrix(
  scope: ReportScope, ds: string, s: DatasetSql, dims: Dim[], vals: Val[],
  filters: PageFilters, cross: CrossFilter | undefined,
): Promise<RunResult> {
  if (dims.length < 2) return fail('A matrix needs a row field and a column field.');
  const [rowD, colD] = dims;
  const val = vals[0];

  const rowKeys = rowD.isDate ? null : await topKeys(scope, ds, s, rowD, val, filters, cross, VISUAL_META.matrix.topN);
  const colKeys = colD.isDate ? null : await topKeys(scope, ds, s, colD, val, filters, cross, MATRIX_COL_CAP);

  const p = new Params();
  const w = buildWhere(scope, ds, s, filters, cross, p);
  const rExpr = rowKeys ? `CASE WHEN ${rowD.expr} = ANY(${p.add(rowKeys, '::text[]')}) THEN ${rowD.expr} ELSE '${OTHER}' END` : rowD.expr;
  const cExpr = colKeys ? `CASE WHEN ${colD.expr} = ANY(${p.add(colKeys, '::text[]')}) THEN ${colD.expr} ELSE '${OTHER}' END` : colD.expr;

  const sql = `SELECT ${rExpr} AS d0, ${cExpr} AS d1, ${val.expr} AS m0,
                      GROUPING(${rExpr}) AS __gr, GROUPING(${cExpr}) AS __gc
                 FROM ${s.from} ${w.sql}
                GROUP BY GROUPING SETS ((1, 2), (1), (2), ())
                LIMIT ${MAX_GROUP_ROWS}`;

  const raw = await query(sql, p.list);
  const rows = raw.map(r => ({
    // A grouped-away dimension is a total line, marked rather than null so the
    // renderer can tell it from a genuinely blank category.
    d0: Number(r.__gr) === 1 ? '__total' : (r.d0 == null ? null : String(r.d0)),
    d1: Number(r.__gc) === 1 ? '__total' : (r.d1 == null ? null : String(r.d1)),
    m0: num(r.m0),
  }));

  return {
    ok: true, rows,
    truncated: !!(rowKeys || colKeys) || undefined,
    ignoredFilters: w.ignored.length ? w.ignored : undefined,
  };
}

/**
 * One visual, numbers from more than one table.
 *
 * Each table is grouped on its own and the results are joined in memory on
 * the dimension tuple. That works because every dimension here is either a
 * shared one - written identically in every dataset, so the text matches - or
 * each table's own main date at the same grain.
 */
async function runCombined(
  scope: ReportScope, visual: Visual, homeDs: string, dims: Dim[], valueRefs: ValueRef[],
  filters: PageFilters, cross: CrossFilter | undefined, opts: RunOpts,
): Promise<RunResult> {
  const byDs = new Map<string, { ref: ValueRef; key: string }[]>();
  valueRefs.forEach((ref, i) => {
    const d = ref.dataset || homeDs;
    const list = byDs.get(d) ?? [];
    list.push({ ref, key: `m${i}` });
    byDs.set(d, list);
  });

  // Top-N is decided once, on the first value's table, and the same keys are
  // applied everywhere - otherwise each table folds a different set into
  // "Other" and the rows stop lining up.
  const firstDs = valueRefs[0].dataset || homeDs;
  const keysByDimKey = new Map<string, string[]>();
  if (!opts.forExport) {
    const fs = DATASET_SQL[firstDs];
    const firstVal = resolveVal(firstDs, valueRefs[0], 'm0');
    for (const [i, d] of dims.entries()) {
      if (d.isDate || !firstVal) continue;
      const mapped = mapDim(homeDs, d.field.id, firstDs);
      const probeDim = mapped ? resolveDim(firstDs, { field: mapped, grain: d.grain }, d.key) : null;
      if (!probeDim) continue;
      const cap = capFor(visual, i === 0 ? 'axis' : 'split');
      if (!cap) continue;
      const keys = await topKeys(scope, firstDs, fs, probeDim, firstVal, filters, cross, cap);
      if (keys) keysByDimKey.set(d.key, keys);
    }
  }

  const merged = new Map<string, Row>();
  const order: string[] = [];
  const ignored = new Set<string>();

  for (const [ds, entries] of byDs) {
    const s = DATASET_SQL[ds];
    if (!s) return fail('Unknown table on this visual.');

    const localDims: Dim[] = [];
    for (const d of dims) {
      const mapped = mapDim(homeDs, d.field.id, ds);
      const ld = mapped ? resolveDim(ds, { field: mapped, grain: d.grain }, d.key) : null;
      if (!ld) {
        const label = DATASET_BY_ID.get(ds)?.label ?? ds;
        return fail(`${label} can’t be split by “${d.field.label}” — tables only line up on ${combinableOn(ds)}.`);
      }
      localDims.push(ld);
    }

    const vals: Val[] = [];
    for (const e of entries) {
      const v = resolveVal(ds, e.ref, e.key);
      if (!v) return fail(`That table has no number “${e.ref.field}”.`);
      vals.push(v);
    }

    const p = new Params();
    const w = buildWhere(scope, ds, s, filters, cross, p);
    w.ignored.forEach(x => ignored.add(x));
    const dimSel = localDims.map(d => {
      const keys = keysByDimKey.get(d.key);
      return `${keys ? `CASE WHEN ${d.expr} = ANY(${p.add(keys, '::text[]')}) THEN ${d.expr} ELSE '${OTHER}' END` : d.expr} AS ${d.key}`;
    });
    const sql = localDims.length
      ? `SELECT ${dimSel.join(', ')}, ${vals.map(v => `${v.expr} AS ${v.key}`).join(', ')}
           FROM ${s.from} ${w.sql} GROUP BY ${localDims.map((_, i) => i + 1).join(', ')}
          LIMIT ${MAX_GROUP_ROWS}`
      : `SELECT ${vals.map(v => `${v.expr} AS ${v.key}`).join(', ')} FROM ${s.from} ${w.sql}`;

    for (const r of await query(sql, p.list)) {
      const key = localDims.map(d => String(r[d.key] ?? '')).join('\u0000');
      let row = merged.get(key);
      if (!row) {
        row = {};
        for (const d of localDims) row[d.key] = r[d.key] == null ? null : String(r[d.key]);
        merged.set(key, row);
        order.push(key);
      }
      for (const v of vals) row[v.key] = num(r[v.key]);
    }
  }

  // Every row carries every column, so a table does not go ragged where one
  // table has a category the other has never seen.
  const allKeys = valueRefs.map((_, i) => `m${i}`);
  let rows = order.map(k => {
    const r = merged.get(k)!;
    for (const mk of allKeys) if (!(mk in r)) r[mk] = null;
    return r;
  });

  // Sorting and paging happen here because the rows came from several queries.
  const sortKey = opts.sortKey && SORT_KEY.test(opts.sortKey) ? opts.sortKey : null;
  const primary = sortKey ?? (dims[0]?.isDate ? 'd0' : 'm0');
  const asc = sortKey ? opts.sortDir === 'asc' : !!dims[0]?.isDate;
  rows.sort((a, b) => {
    const av = a[primary], bv = b[primary];
    if (a.d0 === OTHER && b.d0 !== OTHER) return 1;
    if (b.d0 === OTHER && a.d0 !== OTHER) return -1;
    if (av == null) return 1;
    if (bv == null) return -1;
    const c = typeof av === 'number' && typeof bv === 'number' ? av - bv : String(av).localeCompare(String(bv));
    return asc ? c : -c;
  });

  const total = rows.length;
  if (visual.type === 'table' && !opts.forExport) {
    const page = Number.isInteger(opts.page) && opts.page! > 0 ? Math.min(opts.page!, 10_000) : 0;
    rows = rows.slice(page * TABLE_PAGE_SIZE, page * TABLE_PAGE_SIZE + TABLE_PAGE_SIZE);
  }

  return {
    ok: true, rows,
    total: visual.type === 'table' ? total : undefined,
    truncated: keysByDimKey.size > 0 || undefined,
    ignoredFilters: ignored.size ? [...ignored] : undefined,
  };
}
