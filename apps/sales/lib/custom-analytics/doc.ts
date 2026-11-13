// Making a saved report safe to store, and safe to read back.
//
// A report document is user input twice over: once when the builder posts it,
// and again every time it is loaded, because what comes out of the database
// is whatever went in. So it is sanitised on write AND re-validated by the
// engine on every run. Neither pass trusts the other.
//
// Pure functions, no database, no session. Imported by the server actions
// (which may only export async functions) and by the builder.

import {
  VISUAL_META, GRID_COLS, MAX_PAGES, MAX_VISUALS_PER_PAGE,
  isVisualType, isGrain, isAgg,
  type ReportDoc, type ReportPage, type Visual, type PageFilters,
  type FieldRef, type ValueRef, type Layout,
} from './types';
import { DATASET_BY_ID, fieldOf } from './model';

const str = (v: unknown, max: number): string | undefined => {
  if (typeof v !== 'string') return undefined;
  const t = v.trim();
  return t ? t.slice(0, max) : undefined;
};

const int = (v: unknown, lo: number, hi: number, dflt: number): number => {
  const n = Number(v);
  return Number.isInteger(n) ? Math.min(hi, Math.max(lo, n)) : dflt;
};

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const isoDate = (v: unknown): string | undefined =>
  typeof v === 'string' && ISO.test(v) ? v : undefined;

const strList = (v: unknown, maxItems: number, maxLen: number): string[] | undefined => {
  if (!Array.isArray(v)) return undefined;
  const out = v.filter((x): x is string => typeof x === 'string' && x.length <= maxLen).slice(0, maxItems);
  return out.length ? out : undefined;
};

const intList = (v: unknown, maxItems: number): number[] | undefined => {
  if (!Array.isArray(v)) return undefined;
  const out = v.filter((x): x is number => Number.isInteger(x)).slice(0, maxItems);
  return out.length ? out : undefined;
};

function cleanFilters(v: unknown): PageFilters {
  const f = (v ?? {}) as Record<string, unknown>;
  const out: PageFilters = {};
  const preset = str(f.datePreset, 40);
  if (preset) out.datePreset = preset;
  const from = isoDate(f.dateFrom), to = isoDate(f.dateTo);
  if (from) out.dateFrom = from;
  if (to) out.dateTo = to;
  const states = strList(f.states, 60, 120);
  if (states) out.states = states;
  const inds = strList(f.industries, 60, 120);
  if (inds) out.industries = inds;
  const ct = strList(f.clientTypes, 20, 120);
  if (ct) out.clientTypes = ct;
  const tiers = strList(f.tiers, 20, 120);
  if (tiers) out.tiers = tiers;
  const reps = intList(f.reps, 100);
  if (reps) out.reps = reps;
  return out;
}

/** A field reference, dropped entirely if the model does not have it. */
function cleanFieldRef(v: unknown, dataset: string | null): FieldRef | null {
  if (!v || typeof v !== 'object' || !dataset) return null;
  const r = v as Record<string, unknown>;
  const field = str(r.field, 60);
  if (!field) return null;
  const f = fieldOf(dataset, field);
  if (!f || f.kind !== 'dim') return null;
  const out: FieldRef = { field };
  if (f.date && isGrain(r.grain)) out.grain = r.grain;
  return out;
}

function cleanValueRef(v: unknown, homeDataset: string | null): ValueRef | null {
  if (!v || typeof v !== 'object' || !homeDataset) return null;
  const r = v as Record<string, unknown>;
  const field = str(r.field, 60);
  if (!field) return null;
  // A value may live on another table; its dataset must still be a real one.
  const foreign = str(r.dataset, 40);
  const ds = foreign && DATASET_BY_ID.has(foreign) ? foreign : homeDataset;
  const f = fieldOf(ds, field);
  if (!f || f.kind === 'dim') {
    // A dim can still be counted, but only with a counting aggregation.
    if (!f || !isAgg(r.agg) || (r.agg !== 'count' && r.agg !== 'countd')) return null;
  }
  const out: ValueRef = { field };
  if (isAgg(r.agg) && f.kind !== 'measure') out.agg = r.agg;
  if (ds !== homeDataset) out.dataset = ds;
  return out;
}

function cleanLayout(v: unknown, i: number): Layout {
  const l = (v ?? {}) as Record<string, unknown>;
  const w = int(l.w, 2, GRID_COLS, 6);
  return {
    w,
    h: int(l.h, 2, 40, 6),
    // Clamped so a card cannot be parked off the right-hand edge of the grid.
    x: int(l.x, 0, GRID_COLS - w, 0),
    y: int(l.y, 0, 400, i * 6),
  };
}

function cleanVisual(v: unknown, i: number): Visual | null {
  if (!v || typeof v !== 'object') return null;
  const r = v as Record<string, unknown>;
  if (!isVisualType(r.type)) return null;
  const meta = VISUAL_META[r.type];

  const dsRaw = str(r.dataset, 40);
  const dataset = dsRaw && DATASET_BY_ID.has(dsRaw) ? dsRaw : null;

  const values = (Array.isArray(r.values) ? r.values : [])
    .map(x => cleanValueRef(x, dataset))
    .filter((x): x is ValueRef => !!x)
    .slice(0, meta.maxValues);

  const dims = (Array.isArray(r.dims) ? r.dims : [])
    .map(x => cleanFieldRef(x, dataset))
    .filter((x): x is FieldRef => !!x)
    .slice(0, meta.maxDims);

  const out: Visual = {
    id: str(r.id, 40) ?? `v${i}-${Math.random().toString(36).slice(2, 8)}`,
    type: r.type,
    dataset,
    values,
    layout: cleanLayout(r.layout, i),
  };
  const axis = cleanFieldRef(r.axis, dataset);
  if (axis) out.axis = axis;
  const split = cleanFieldRef(r.split, dataset);
  if (split && meta.wells.includes('split')) out.split = split;
  if (dims.length) out.dims = dims;
  const title = str(r.title, 120);
  if (title) out.title = title;
  if (Number.isInteger(r.topN)) out.topN = int(r.topN, 1, 200, meta.topN);
  if (r.stacked === true) out.stacked = true;
  return out;
}

function cleanPage(v: unknown, i: number): ReportPage {
  const r = (v ?? {}) as Record<string, unknown>;
  return {
    id: str(r.id, 40) ?? `p${i}-${Math.random().toString(36).slice(2, 8)}`,
    name: str(r.name, 60) ?? `Page ${i + 1}`,
    filters: cleanFilters(r.filters),
    visuals: (Array.isArray(r.visuals) ? r.visuals : [])
      .map(cleanVisual)
      .filter((x): x is Visual => !!x)
      .slice(0, MAX_VISUALS_PER_PAGE),
  };
}

/**
 * A stored document from whatever the client sent.
 *
 * Never throws and never rejects the whole save: an unrecognised visual is
 * dropped and the rest is kept. Losing one card is recoverable; losing the
 * report because one field went stale after a model change is not.
 */
export function sanitizeDoc(raw: unknown): ReportDoc {
  const d = (raw ?? {}) as Record<string, unknown>;
  const pages = (Array.isArray(d.pages) ? d.pages : []).map(cleanPage).slice(0, MAX_PAGES);
  return { version: 1, pages: pages.length ? pages : [emptyPage(0)] };
}

export function emptyPage(i = 0): ReportPage {
  return { id: `p${i}-${Math.random().toString(36).slice(2, 8)}`, name: `Page ${i + 1}`, filters: {}, visuals: [] };
}

export const emptyDoc = (): ReportDoc => ({ version: 1, pages: [emptyPage(0)] });

/** A report's own copy, for "Make a copy": new ids throughout. */
export function cloneDoc(doc: ReportDoc): ReportDoc {
  return sanitizeDoc({
    version: 1,
    pages: doc.pages.map((p, i) => ({
      ...p,
      id: `p${i}-${Math.random().toString(36).slice(2, 8)}`,
      visuals: p.visuals.map((v, j) => ({ ...v, id: `v${j}-${Math.random().toString(36).slice(2, 8)}` })),
    })),
  });
}
