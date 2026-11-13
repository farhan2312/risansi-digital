// Turning what the engine returns back into something a person reads.
//
// CLIENT-SAFE. The viewer and the builder both render through this, so the
// same number is written the same way on a KPI card, a bar label, a table
// cell and an exported sheet.
//
// Two jobs, and they are deliberately separate:
//
//   compact()  for a mark on a chart, where "₹1.24 Cr" fits and
//              "₹12,43,55,120" does not
//   exact()    for a table cell, a tooltip and a spreadsheet, where the
//              rounded figure is the wrong answer to a question about money
//
// A chart that only ever shows the compact form hides the difference between
// ₹1.24 Cr and ₹1.2449 Cr, which is eight lakh rupees. So every compact mark
// carries the exact figure in its title attribute.

import { fieldOf, type Format } from './model';
import type { Grain, ValueRef } from './types';

const IN = 'en-IN';

/** The format of a value on a visual, resolved through the model. */
export function formatOf(homeDataset: string | null, ref: ValueRef): Format {
  const ds = ref.dataset || homeDataset;
  if (!ds) return 'num';
  const f = fieldOf(ds, ref.field);
  if (!f) return 'num';
  // A count of anything is a count, whatever the underlying column held.
  if (ref.agg === 'count' || ref.agg === 'countd') return 'int';
  return f.format;
}

/** The label for a value on a visual: "Revenue ₹", or "Clients (count)". */
export function labelOf(homeDataset: string | null, ref: ValueRef): string {
  const ds = ref.dataset || homeDataset;
  const f = ds ? fieldOf(ds, ref.field) : null;
  const base = f?.label ?? ref.field;
  if (!ref.agg || f?.kind === 'measure') return base;
  const word: Record<string, string> = {
    sum: '', avg: 'Average ', min: 'Lowest ', max: 'Highest ',
    count: '', countd: '',
  };
  if (ref.agg === 'count') return `${base} (count)`;
  if (ref.agg === 'countd') return `${base} (distinct)`;
  return `${word[ref.agg] ?? ''}${base}`.trim();
}

// ── money ─────────────────────────────────────────────────────

/**
 * Rupees, in the unit an Indian reader expects at that size.
 *
 * Crore above a crore, lakh above a lakh, the plain figure below that. Two
 * decimals until the number is big enough that the second one is noise.
 */
export function compactInr(n: number): string {
  const a = Math.abs(n);
  const s = n < 0 ? '-' : '';
  if (a >= 1e7) return `${s}₹${(a / 1e7).toFixed(a >= 1e9 ? 0 : a >= 1e8 ? 1 : 2)} Cr`;
  if (a >= 1e5) return `${s}₹${(a / 1e5).toFixed(a >= 1e6 ? 1 : 2)} L`;
  if (a >= 1000) return `${s}₹${Math.round(a).toLocaleString(IN)}`;
  return `${s}₹${a % 1 === 0 ? a : a.toFixed(2)}`;
}

export const exactInr = (n: number) => `₹${Math.round(n).toLocaleString(IN)}`;

/** A column already denominated in crores. */
const compactCr = (n: number) => `₹${n.toFixed(Math.abs(n) >= 100 ? 0 : 2)} Cr`;

// ── counts and the rest ───────────────────────────────────────

function compactCount(n: number): string {
  const a = Math.abs(n);
  if (a >= 1e7) return `${(n / 1e7).toFixed(1)} Cr`;
  if (a >= 1e5) return `${(n / 1e5).toFixed(1)} L`;
  return Math.round(n).toLocaleString(IN);
}

// ── the one entry point ───────────────────────────────────────

/** For a mark on a chart. Short enough to sit on a bar. */
export function compact(format: Format, v: unknown): string {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'string') return v;
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v);
  switch (format) {
    case 'inr': return compactInr(n);
    case 'cr':  return compactCr(n);
    case 'pct': return `${n.toFixed(Math.abs(n) >= 10 ? 0 : 1)}%`;
    case 'int': return compactCount(n);
    case 'num': return n % 1 === 0 ? compactCount(n) : n.toFixed(2);
    case 'date': return String(v);
    default:    return String(v);
  }
}

/** For a table cell, a tooltip or a spreadsheet. Nothing rounded away. */
export function exact(format: Format, v: unknown): string {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'string') return v;
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v);
  switch (format) {
    case 'inr': return exactInr(n);
    case 'cr':  return `₹${n.toFixed(4).replace(/\.?0+$/, '')} Cr`;
    case 'pct': return `${n.toFixed(1)}%`;
    case 'int': return Math.round(n).toLocaleString(IN);
    case 'num': return n % 1 === 0 ? n.toLocaleString(IN) : n.toLocaleString(IN, { maximumFractionDigits: 2 });
    default:    return String(v);
  }
}

// ── date buckets ──────────────────────────────────────────────

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * A bucket key from the engine, as a reader sees it.
 *
 * The keys are built by dateBucket() in sql.ts and sort correctly as text,
 * which is why they look the way they do. That makes them unreadable, so
 * nothing but this function should ever put one on screen.
 *
 *   month    2026-10     → Oct 26
 *   quarter  2026-Q3     → Q3 26
 *   week     2026-10-05  → w/c 5 Oct
 *   day      2026-10-05  → 5 Oct 26
 *   fy       FY26-27     → FY26-27  (already readable)
 */
export function bucketLabel(grain: Grain | undefined, key: string | null): string {
  if (key === null || key === '') return '(none)';
  switch (grain) {
    case 'month': {
      const [y, m] = key.split('-');
      const i = Number(m) - 1;
      return MONTHS[i] ? `${MONTHS[i]} ${y.slice(2)}` : key;
    }
    case 'quarter': {
      const [y, q] = key.split('-');
      return q ? `${q} ${y.slice(2)}` : key;
    }
    case 'week': {
      const d = dateOf(key);
      return d ? `w/c ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}` : key;
    }
    case 'day': {
      const d = dateOf(key);
      return d ? `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${String(d.getUTCFullYear()).slice(2)}` : key;
    }
    default: return key;
  }
}

function dateOf(iso: string): Date | null {
  const d = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Shortened for an axis tick, where there is room for about eight letters. */
export function tick(label: string, max = 12): string {
  return label.length <= max ? label : `${label.slice(0, max - 1)}…`;
}
