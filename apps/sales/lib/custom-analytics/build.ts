// Editing a report document.
//
// CLIENT-SAFE, pure, and React-free on purpose: every operation the builder
// performs is a function from one document to the next, so the build guard
// can assert on them without a browser. A card that lands on top of another
// card, or a type change that silently loses the number it was showing, is a
// defect you cannot see in a screenshot — it looks like a layout choice.
//
// THE RULES THESE FUNCTIONS KEEP
//
//   1. No two cards overlap. Ever. CSS grid stacks them silently, so a move
//      that would collide pushes the cards it hits downwards instead.
//   2. A card never ends up partly off the right-hand edge: x + w <= 12.
//   3. Changing a card's type keeps as much of its contents as the new type
//      can hold, and drops the rest explicitly rather than leaving a field
//      in a well the type does not draw.
//   4. Nothing here validates against the database. sanitizeDoc on save and
//      the engine on every run both re-check, and neither trusts this file.

import {
  VISUAL_META, GRID_COLS, MAX_VISUALS_PER_PAGE,
  type Visual, type VisualType, type FieldRef, type ValueRef, type Layout,
  type Agg, type Grain,
} from './types';
import {
  fieldOf, mapDim, combinableOn, DATASETS, DATASET_BY_ID, type ModelField,
} from './model';

/** The four places a field can sit on a card. */
export type Well = 'axis' | 'split' | 'dims' | 'values';

export const WELL_LABEL: Record<Well, string> = {
  axis: 'Axis', split: 'Legend', dims: 'Group by', values: 'Numbers',
};

/** What each well is for, in the words of somebody who has not used Power BI. */
export const WELL_HINT: Record<Well, string> = {
  axis: 'What runs along the bottom: a date, or a category.',
  split: 'Splits each bar into coloured parts, one per value.',
  dims: 'One row per combination of these.',
  values: 'What is being measured.',
};

export const newId = (prefix: string) =>
  `${prefix}-${Math.random().toString(36).slice(2, 9)}`;

// ── what fits where ───────────────────────────────────────────

/**
 * The cap on numbers for THIS card, which is not always the type's cap.
 *
 * A legend and several numbers cannot share one y-scale — "revenue and order
 * count, split by state" has no honest drawing — so on the types where a
 * split stacks the marks, having one drops the card to a single number.
 */
export function maxValuesFor(v: Visual): number {
  const meta = VISUAL_META[v.type];
  return meta.splitCollapsesValues && v.split ? 1 : meta.maxValues;
}

export function wellsFor(type: VisualType): Well[] {
  return [...VISUAL_META[type].wells];
}

/** Whether a field could go in that well at all, type aside. */
export function accepts(type: VisualType, well: Well, f: ModelField): boolean {
  if (!VISUAL_META[type].wells.includes(well)) return false;
  // A dimension can be counted, so it is welcome in Numbers too.
  if (well === 'values') return true;
  return f.kind === 'dim';
}

/**
 * Where a clicked field goes when nobody said which well.
 *
 * Measures go to Numbers. A dimension goes to whichever grouping well is
 * still empty, because a half-built chart that already draws teaches more
 * than one that waits for a second click.
 */
export function bestWell(v: Visual, f: ModelField): Well | null {
  const wells = wellsFor(v.type);
  if (f.kind !== 'dim') return wells.includes('values') ? 'values' : null;
  if (wells.includes('dims')) return 'dims';
  if (wells.includes('axis') && !v.axis) return 'axis';
  if (wells.includes('split') && !v.split) return 'split';
  if (wells.includes('axis')) return 'axis';
  return wells.includes('values') ? 'values' : null;
}

/** The aggregation a field arrives with. */
export function defaultAgg(f: ModelField): Agg | undefined {
  if (f.kind === 'measure') return undefined;
  if (f.kind === 'num') return f.defaultAgg ?? 'sum';
  // Counting a dimension almost always means counting the distinct things,
  // not the rows: "clients" rather than "rows mentioning a client".
  return 'countd';
}

/** The chart a lone field is most likely to have been reaching for. */
export function suggestType(f: ModelField): VisualType {
  if (f.kind === 'dim') return f.date ? 'line' : 'column';
  return 'kpi';
}

// ── adding and removing ───────────────────────────────────────

const ref = (f: ModelField): FieldRef =>
  f.date ? { field: f.id, grain: 'month' } : { field: f.id };

/**
 * A field into a well.
 *
 * `dataset` is where the FIELD came from, which is not always the card's own
 * table: a number from another table is how one card answers "revenue and
 * orders, by month". A grouping field has to be the card's own, because the
 * row the card groups by is a row of that table.
 */
export function addToWell(v: Visual, well: Well, dataset: string, fieldId: string): Visual {
  const f = fieldOf(dataset, fieldId);
  if (!f || !accepts(v.type, well, f)) return v;

  // The first field decides the card's table.
  const home = v.dataset ?? dataset;
  if (well !== 'values' && dataset !== home) return v;

  const out: Visual = { ...v, dataset: home };

  if (well === 'axis' || well === 'split') {
    out[well] = ref(f);
    // A split arriving on a stacking type pushes the card down to one number.
    if (well === 'split') out.values = out.values.slice(0, maxValuesFor(out));
    return out;
  }

  if (well === 'dims') {
    const meta = VISUAL_META[v.type];
    const dims = [...(v.dims ?? [])].filter(d => d.field !== f.id);
    dims.push(ref(f));
    out.dims = dims.slice(-meta.maxDims);
    return out;
  }

  const value: ValueRef = { field: f.id };
  const agg = defaultAgg(f);
  if (agg) value.agg = agg;
  if (dataset !== home) value.dataset = dataset;

  const same = (a: ValueRef) =>
    a.field === value.field && (a.dataset ?? home) === (value.dataset ?? home);
  const values = [...out.values].filter(a => !same(a));
  values.push(value);
  out.values = values.slice(-maxValuesFor(out));
  return out;
}

export function removeAt(v: Visual, well: Well, i = 0): Visual {
  if (well === 'axis' || well === 'split') {
    const out = { ...v };
    delete out[well];
    if (well === 'split') delete out.stacked;
    return out;
  }
  if (well === 'dims') return { ...v, dims: (v.dims ?? []).filter((_, j) => j !== i) };
  return { ...v, values: v.values.filter((_, j) => j !== i) };
}

export function setGrain(v: Visual, well: Well, i: number, grain: Grain): Visual {
  if (well === 'axis' || well === 'split') {
    const cur = v[well];
    return cur ? { ...v, [well]: { ...cur, grain } } : v;
  }
  if (well !== 'dims') return v;
  return { ...v, dims: (v.dims ?? []).map((d, j) => (j === i ? { ...d, grain } : d)) };
}

export function setAgg(v: Visual, i: number, agg: Agg): Visual {
  return { ...v, values: v.values.map((x, j) => (j === i ? { ...x, agg } : x)) };
}

/** Reorder within a well, for the one case it changes the answer: table columns. */
export function moveWithin(v: Visual, well: 'dims' | 'values', i: number, delta: number): Visual {
  const list = well === 'dims' ? [...(v.dims ?? [])] : [...v.values];
  const j = i + delta;
  if (i < 0 || j < 0 || i >= list.length || j >= list.length) return v;
  [list[i], list[j]] = [list[j], list[i]];
  return well === 'dims'
    ? { ...v, dims: list as FieldRef[] }
    : { ...v, values: list as ValueRef[] };
}

// ── changing a card's type ────────────────────────────────────

/**
 * The same contents, drawn a different way.
 *
 * Grouping fields are pooled and re-dealt, so table → column puts the first
 * column on the axis and the second on the legend, and column → table puts
 * them both back as columns. What the new type cannot hold is dropped here
 * rather than left in a well nothing reads, which is what makes a round trip
 * lossy in exactly one visible place instead of several invisible ones.
 */
export function changeType(v: Visual, type: VisualType): Visual {
  const meta = VISUAL_META[type];
  const pool: FieldRef[] = [v.axis, v.split, ...(v.dims ?? [])]
    .filter((x): x is FieldRef => !!x);

  const w = Math.min(Math.max(v.layout.w, meta.size.w), GRID_COLS);
  const out: Visual = {
    id: v.id,
    type,
    dataset: v.dataset,
    values: [...v.values],
    layout: {
      w,
      h: Math.max(v.layout.h, meta.size.h),
      x: Math.min(v.layout.x, GRID_COLS - w),
      y: v.layout.y,
    },
  };
  if (v.title) out.title = v.title;
  if (v.topN) out.topN = v.topN;

  if (meta.wells.includes('dims')) {
    out.dims = pool.slice(0, meta.maxDims);
  } else {
    if (meta.wells.includes('axis') && pool[0]) out.axis = pool[0];
    if (meta.wells.includes('split') && pool[1]) out.split = pool[1];
  }
  out.values = out.values.slice(0, maxValuesFor(out));
  if (v.stacked && out.split) out.stacked = true;
  return out;
}

// ── the grid ──────────────────────────────────────────────────

export function overlaps(a: Layout, b: Layout): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

const MAX_Y = 400;

/**
 * Push whatever a move landed on out of the way.
 *
 * The moved card keeps the position it was dropped at; everything else is
 * re-laid in reading order and slides down past anything already placed.
 * The returned array keeps the document's original card order, so React does
 * not re-mount a card just because another one moved.
 */
export function settle(visuals: Visual[], fixedId?: string): Visual[] {
  const fixed = visuals.filter(v => v.id === fixedId);
  const rest = visuals
    .filter(v => v.id !== fixedId)
    .sort((a, b) => a.layout.y - b.layout.y || a.layout.x - b.layout.x);

  const placed: Visual[] = [];
  for (const v of [...fixed, ...rest]) {
    let y = v.layout.y;
    while (y < MAX_Y && placed.some(p => overlaps({ ...v.layout, y }, p.layout))) y++;
    placed.push(y === v.layout.y ? v : { ...v, layout: { ...v.layout, y } });
  }
  const byId = new Map(placed.map(v => [v.id, v]));
  return visuals.map(v => byId.get(v.id) ?? v);
}

/** Close the vertical gaps, keeping the left-to-right reading order. */
export function tidy(visuals: Visual[]): Visual[] {
  const order = [...visuals].sort((a, b) => a.layout.y - b.layout.y || a.layout.x - b.layout.x);
  const placed: Visual[] = [];
  for (const v of order) {
    let y = 0;
    while (y < MAX_Y && placed.some(p => overlaps({ ...v.layout, y }, p.layout))) y++;
    placed.push({ ...v, layout: { ...v.layout, y } });
  }
  const byId = new Map(placed.map(v => [v.id, v]));
  return visuals.map(v => byId.get(v.id) ?? v);
}

/** The first gap a card of this size fits in, scanning top to bottom. */
export function freeSpot(visuals: Visual[], w: number, h: number): { x: number; y: number } {
  const width = Math.min(Math.max(w, 1), GRID_COLS);
  const bottom = visuals.reduce((m, v) => Math.max(m, v.layout.y + v.layout.h), 0);
  for (let y = 0; y <= bottom; y++) {
    for (let x = 0; x + width <= GRID_COLS; x++) {
      if (!visuals.some(v => overlaps({ x, y, w: width, h }, v.layout))) return { x, y };
    }
  }
  return { x: 0, y: bottom };
}

export function newVisual(type: VisualType, dataset: string | null, at?: Layout): Visual {
  const meta = VISUAL_META[type];
  return {
    id: newId('v'),
    type,
    dataset,
    values: [],
    layout: at ?? { x: 0, y: 0, w: meta.size.w, h: meta.size.h },
  };
}

/** A new card, in the first place it fits. */
export function addVisual(visuals: Visual[], v: Visual): Visual[] {
  if (visuals.length >= MAX_VISUALS_PER_PAGE) return visuals;
  const spot = freeSpot(visuals, v.layout.w, v.layout.h);
  return settle([...visuals, { ...v, layout: { ...v.layout, ...spot } }], v.id);
}

export function moveTo(visuals: Visual[], id: string, x: number, y: number): Visual[] {
  const next = visuals.map(v => {
    if (v.id !== id) return v;
    const nx = Math.min(Math.max(0, Math.round(x)), GRID_COLS - v.layout.w);
    return { ...v, layout: { ...v.layout, x: nx, y: Math.max(0, Math.round(y)) } };
  });
  return settle(next, id);
}

export function resizeTo(visuals: Visual[], id: string, w: number, h: number): Visual[] {
  const next = visuals.map(v => {
    if (v.id !== id) return v;
    const nw = Math.min(Math.max(2, Math.round(w)), GRID_COLS - v.layout.x);
    return { ...v, layout: { ...v.layout, w: nw, h: Math.min(Math.max(2, Math.round(h)), 40) } };
  });
  return settle(next, id);
}

export function duplicate(visuals: Visual[], id: string): { visuals: Visual[]; id: string | null } {
  const src = visuals.find(v => v.id === id);
  if (!src) return { visuals, id: null };
  const copy: Visual = { ...src, id: newId('v'), layout: { ...src.layout } };
  return { visuals: addVisual(visuals, copy), id: copy.id };
}

// ── two tables on one card ────────────────────────────────────
//
// A card is built on one table and may carry numbers from others. The engine
// matches them on whatever the tables share — a client, a month — and refuses
// when they share nothing. Both of those are worth knowing BEFORE the card is
// built rather than after: the refusal arrives as a red card, and a card that
// works does not say what it was matched on, which leaves the reader to guess
// whether "revenue and orders by client" lined the clients up or just put two
// columns beside each other.

/** Every dimension on a card, in the order the engine will see them. */
export function dimsOf(v: Visual): FieldRef[] {
  return v.type === 'table'
    ? [...(v.dims ?? [])]
    : ([v.axis, v.split].filter(Boolean) as FieldRef[]);
}

/** The tables a card's numbers come from, other than its own. */
export function foreignDatasets(v: Visual): string[] {
  const home = v.dataset;
  return [...new Set(v.values.map(x => x.dataset).filter((d): d is string => !!d && d !== home))];
}

export interface CombinedInfo {
  /** The shared dimensions the tables are matched on, in words. */
  on: string[];
  /** A table that cannot be matched on one of this card's dimensions. */
  refused: { dataset: string; dim: string; only: string }[];
}

/**
 * How this card's tables line up, or why they do not.
 *
 * Null for the ordinary single-table card, which is most of them.
 */
export function combinedInfo(v: Visual): CombinedInfo | null {
  const home = v.dataset;
  const others = foreignDatasets(v);
  if (!home || !others.length) return null;

  const on: string[] = [];
  const refused: CombinedInfo['refused'] = [];

  for (const d of dimsOf(v)) {
    const label = fieldOf(home, d.field)?.label ?? d.field;
    const bad = others.find(ds => !mapDim(home, d.field, ds));
    if (bad) {
      refused.push({
        dataset: DATASET_BY_ID.get(bad)?.label ?? bad,
        dim: label,
        only: combinableOn(bad),
      });
    } else {
      on.push(label);
    }
  }
  return { on, refused };
}

/**
 * The other tables whose numbers could go on this card as it stands.
 *
 * A table is offered only when every dimension already on the card maps into
 * it, so the Numbers well cannot be used to build a card the engine is going
 * to refuse. A card with no dimensions at all — a KPI — can take a number
 * from anywhere, because there is nothing to line up.
 */
export function combinableDatasets(v: Visual): string[] {
  const home = v.dataset;
  if (!home) return [];
  const dims = dimsOf(v);
  return DATASETS
    .filter(d => d.id !== home)
    .filter(d => dims.every(x => !!mapDim(home, x.field, d.id)))
    .map(d => d.id);
}

/**
 * The same card, built on a different table.
 *
 * Without this, picking the wrong table means deleting the card and starting
 * again — which is also how you lose the size and the position you had just
 * settled on. Shared dimensions travel: "by state" on Revenue becomes "by
 * state" on Complaints, through the same mapping the engine uses to combine
 * two tables. Everything the new table does not have is dropped AND named,
 * because a field that quietly disappears is a card that quietly changes
 * what it means.
 */
export function changeDataset(v: Visual, ds: string): { visual: Visual; dropped: string[] } {
  const home = v.dataset;
  if (!home || home === ds || !DATASET_BY_ID.has(ds)) return { visual: v, dropped: [] };
  const dropped: string[] = [];

  const move = (ref: FieldRef): FieldRef | null => {
    const mapped = mapDim(home, ref.field, ds);
    const f = mapped ? fieldOf(ds, mapped) : null;
    if (!mapped || !f) {
      dropped.push(fieldOf(home, ref.field)?.label ?? ref.field);
      return null;
    }
    return f.date && ref.grain ? { field: mapped, grain: ref.grain } : { field: mapped };
  };

  const out: Visual = { ...v, dataset: ds };
  if (v.axis) {
    const a = move(v.axis);
    if (a) out.axis = a; else delete out.axis;
  }
  if (v.split) {
    const sp = move(v.split);
    if (sp) out.split = sp; else delete out.split;
  }
  if (v.dims?.length) out.dims = v.dims.map(move).filter((x): x is FieldRef => !!x);

  // A number is a measure, not a dimension, so it does not map: "win rate"
  // has no counterpart on Revenue. A number survives only if the new table
  // has a field of the same id — and a number already borrowed from a third
  // table survives as long as that table still lines up with the new one.
  const stillCombinable = new Set(combinableDatasets({ ...out, values: [] }));
  const kept: ValueRef[] = [];
  for (const x of v.values) {
    const label = fieldOf(x.dataset ?? home, x.field)?.label ?? x.field;
    if (x.dataset && x.dataset !== ds) {
      if (stillCombinable.has(x.dataset)) kept.push(x);
      else dropped.push(`${DATASET_BY_ID.get(x.dataset)?.label ?? x.dataset} · ${label}`);
      continue;
    }
    // Either the card's own number, or one borrowed from the table we are
    // moving to — which is now simply a number on the card's own table.
    const f = fieldOf(ds, x.field);
    const countable = x.agg === 'count' || x.agg === 'countd';
    if (f && (f.kind !== 'dim' || countable)) {
      kept.push({ field: x.field, ...(f.kind !== 'measure' && x.agg ? { agg: x.agg } : {}) });
    } else {
      dropped.push(label);
    }
  }
  out.values = kept.slice(0, maxValuesFor(out));

  return { visual: out, dropped: [...new Set(dropped)] };
}

/**
 * A chip dragged from one well to another.
 *
 * Refused moves leave the card alone rather than removing the chip and
 * failing to re-add it, which is how a gesture that looks like nothing
 * happened turns out to have deleted something.
 */
export function moveChip(
  v: Visual, from: Well, index: number, to: Well, dataset: string, field: string,
): Visual {
  if (from === to) return v;
  const f = fieldOf(dataset, field);
  if (!f || !accepts(v.type, to, f)) return v;
  // A grouping field has to belong to the card's own table.
  if (to !== 'values' && v.dataset && dataset !== v.dataset) return v;
  return addToWell(removeAt(v, from, index), to, dataset, field);
}

// ── what is still missing ─────────────────────────────────────

/**
 * Why this card is not drawing yet, in the order a person would fix it.
 *
 * The engine returns the same refusals, but only after a round trip and only
 * one at a time. Saying it on the card as it is built is the difference
 * between a tool that teaches and one that just says no.
 */
export function problems(v: Visual): string[] {
  const out: string[] = [];
  if (!v.dataset) out.push('Pick a table on the left.');
  if (!v.values.length) {
    out.push(v.type === 'kpi' ? 'Add the number this card should show.' : 'Add a number.');
  }
  const wells = wellsFor(v.type);
  if (wells.includes('axis') && !v.axis) {
    out.push(v.type === 'donut' || v.type === 'treemap'
      ? 'Add the category to break the total down by.'
      : 'Add a date or a category to the axis.');
  }
  if (v.type === 'matrix' && !v.split) out.push('Add a second category for the columns.');
  return out;
}

/** True when the card can be run as it stands. */
export const isRunnable = (v: Visual): boolean => problems(v).length === 0;
