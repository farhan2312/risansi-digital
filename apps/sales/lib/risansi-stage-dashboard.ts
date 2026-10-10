// What each pipeline stage's dashboard is for.
//
// A stage answers a different question depending on where it sits. Suspect and
// Prospect are "who owns this and has it gone cold". Quoted is "which of these
// 746 quotes is going stale". Negotiating is "how far has the price moved". Won
// is "what have we won and what still needs an SO raised". Lost and Dropped are
// post-mortems. So the tiles, the charts and even the table columns differ per
// stage rather than being one generic list rendered eight times.

export const DASH_STAGES = [
  'Suspect', 'Prospect', 'Quoted', 'Negotiating', 'On Hold', 'Won', 'Lost', 'Dropped',
] as const;
export type DashStage = typeof DASH_STAGES[number];

/** URL slug ⇄ stage name. 'On Hold' is the only one that isn't just lowercase. */
export const STAGE_SLUG: Record<DashStage, string> = {
  Suspect: 'suspect', Prospect: 'prospect', Quoted: 'quoted', Negotiating: 'negotiating',
  'On Hold': 'on-hold', Won: 'won', Lost: 'lost', Dropped: 'dropped',
};

const SLUG_STAGE: Record<string, DashStage> =
  Object.fromEntries(Object.entries(STAGE_SLUG).map(([s, g]) => [g, s])) as Record<string, DashStage>;

export const stageFromSlug = (slug: string): DashStage | null =>
  SLUG_STAGE[slug.toLowerCase()] ?? null;

export const stageHref = (stage: string, query?: URLSearchParams): string => {
  const slug = STAGE_SLUG[stage as DashStage];
  if (!slug) return '/risansi/pipeline';
  const qs = query?.toString();
  return `/risansi/pipeline/stage/${slug}${qs ? `?${qs}` : ''}`;
};

/** Column hue, matching the kanban board so the pages feel like the same object. */
export const STAGE_COLOR: Record<DashStage, string> = {
  Suspect:     'var(--info)',
  Prospect:    '#5a86c2',
  Quoted:      '#c69347',
  Negotiating: 'var(--accent)',
  'On Hold':   '#7C3AED',
  Won:         'var(--pos)',
  Lost:        'var(--neg)',
  Dropped:     '#64748B',
};

/** One line under the page title saying what this stage means. */
export const STAGE_BLURB: Record<DashStage, string> = {
  Suspect:     'Early leads, roughly 1–2 years out. The question here is who owns them and whether they have gone cold.',
  Prospect:    'Active interest with a value estimate, roughly 6 months out.',
  Quoted:      'A quotation is out and the outcome is undecided. The question is which of these are going stale.',
  Negotiating: 'The quote is on the table and the price is moving. Every re-price is recorded against its date.',
  'On Hold':   'Parked, not lost. Worth a periodic sweep so nothing sits here by accident.',
  Won:         'Order in hand. The open question on most of these is whether a Sales Order has been raised yet.',
  Lost:        'We competed and did not win. Reason and competitor feed win-rate and competitive analysis.',
  Dropped:     'The requirement went away — cancelled, deferred or duplicated. Distinct from Lost.',
};

/**
 * Ageing buckets, in days. Shared by every stage's ageing chart so "61–90d"
 * means the same span everywhere. The clock runs from the stage's own reference
 * date — see AGE_BASIS.
 */
export const AGE_BUCKETS = [
  { label: '0–30d',  min: 0,  max: 30 },
  { label: '31–60d', min: 30, max: 60 },
  { label: '61–90d', min: 60, max: 90 },
  { label: '90d+',   min: 90, max: null as number | null },
];

/**
 * What "age" counts from, per stage.
 *
 * `quote` — days since quote_date. Right for Quoted / Negotiating / On Hold,
 * where the meaningful clock started when the quotation went out.
 * `entered` — days since the opportunity last entered its current stage, from
 * opportunity_stage_log, falling back to created_at. Right for Suspect and
 * Prospect, which have no quote.
 *
 * The fallback matters: opportunity_stage_log was only created in migration
 * 0042 (it had never existed, and every write to it was being swallowed), so it
 * is empty today and fills going forward. Ageing degrades to created_at rather
 * than showing nothing.
 */
export const AGE_BASIS: Record<DashStage, 'quote' | 'entered'> = {
  Suspect: 'entered', Prospect: 'entered', Quoted: 'quote', Negotiating: 'quote',
  'On Hold': 'quote', Won: 'entered', Lost: 'entered', Dropped: 'entered',
};

/** SQL expression for the stage's age reference date. */
export function ageBasisSql(stage: DashStage): string {
  if (AGE_BASIS[stage] === 'quote') return 'o.quote_date';
  return `COALESCE(
    (SELECT max(l.changed_at)::date FROM opportunity_stage_log l
      WHERE l.opportunity_id = o.id AND l.to_stage = o.stage),
    o.created_at::date)`;
}

/** Table columns, per stage. `key` matches a field on the row the page selects. */
export interface StageColumn {
  key: string;
  label: string;
  /** right-aligned monospace money/number */
  num?: boolean;
  width?: number;
}

const COMMON_HEAD: StageColumn[] = [
  { key: 'client_name', label: 'Client' },
  { key: 'product',     label: 'Product' },
  { key: 'product_type', label: 'Type', width: 70 },
];
const COMMON_TAIL: StageColumn[] = [
  { key: 'rep_name', label: 'Rep', width: 130 },
];

export const STAGE_COLUMNS: Record<DashStage, StageColumn[]> = {
  Suspect: [
    // The date a stage with no quote has: when the enquiry came in.
    { key: 'enquiry_date', label: 'Enquiry date', width: 100 },
    ...COMMON_HEAD,
    { key: 'value_cr',  label: 'Value', num: true, width: 90 },
    { key: 'tour_name', label: 'Tour', width: 130 },
    ...COMMON_TAIL,
    { key: 'age_days',  label: 'Days in stage', num: true, width: 100 },
  ],
  Prospect: [
    { key: 'enquiry_date', label: 'Enquiry date', width: 100 },
    ...COMMON_HEAD,
    { key: 'value_cr',    label: 'Value', num: true, width: 90 },
    { key: 'industry',    label: 'Industry', width: 120 },
    { key: 'client_type', label: 'Client Type', width: 110 },
    ...COMMON_TAIL,
    { key: 'age_days',    label: 'Days in stage', num: true, width: 100 },
  ],
  Quoted: [
    { key: 'quote_ref',  label: 'Quote No.', width: 150 },
    { key: 'quote_date', label: 'Quoted', width: 95 },
    { key: 'age_days',   label: 'Age', num: true, width: 70 },
    // Beside the other two dates, so the row reads went out → how long ago →
    // expected back. It is the month the rep set on the card, as typed.
    { key: 'eta_text',   label: 'Expected closure', width: 110 },
    ...COMMON_HEAD,
    { key: 'market',     label: 'Market', width: 90 },
    { key: 'offer_inr',  label: 'Offer', num: true, width: 105 },
    { key: 'revised_inr', label: 'Revised', num: true, width: 115 },
    ...COMMON_TAIL,
  ],
  Negotiating: [
    { key: 'quote_ref',   label: 'Quote No.', width: 150 },
    ...COMMON_HEAD,
    { key: 'offer_inr',   label: 'Original', num: true, width: 105 },
    { key: 'revised_inr', label: 'Current', num: true, width: 115 },
    { key: 'rev_count',   label: 'Revisions', num: true, width: 85 },
    { key: 'revised_on',  label: 'Last revised', width: 100 },
    ...COMMON_TAIL,
  ],
  'On Hold': [
    ...COMMON_HEAD,
    { key: 'value_cr',   label: 'Value', num: true, width: 90 },
    { key: 'quote_ref',  label: 'Quote No.', width: 150 },
    { key: 'age_days',   label: 'Days on hold', num: true, width: 105 },
    ...COMMON_TAIL,
  ],
  Won: [
    ...COMMON_HEAD,
    { key: 'value_cr',   label: 'Won Value', num: true, width: 100 },
    { key: 'final_cr',   label: 'Final', num: true, width: 95 },
    { key: 'po_number',  label: 'PO No.', width: 120 },
    { key: 'so_numbers', label: 'SO No.', width: 130 },
    { key: 'so_sum_cr',  label: 'SO Value', num: true, width: 95 },
    { key: 'so_status',  label: 'Coverage', width: 95 },
    ...COMMON_TAIL,
  ],
  Lost: [
    ...COMMON_HEAD,
    { key: 'value_cr',           label: 'Value', num: true, width: 90 },
    { key: 'lost_to_competitor', label: 'Lost To', width: 150 },
    { key: 'lost_reason',        label: 'Reason', width: 200 },
    { key: 'quote_ref',          label: 'Quote No.', width: 150 },
    ...COMMON_TAIL,
  ],
  Dropped: [
    ...COMMON_HEAD,
    { key: 'value_cr',    label: 'Value', num: true, width: 90 },
    { key: 'drop_reason', label: 'Drop Reason', width: 230 },
    { key: 'quote_ref',   label: 'Quote No.', width: 150 },
    ...COMMON_TAIL,
  ],
};

/** Chart palette — enough distinct hues for a product/industry breakdown. */
export const CHART_COLORS = [
  '#0A3D8F', '#c69347', '#2E9E6B', '#7C3AED', '#D9534F',
  '#0EA5E9', '#F59E0B', '#64748B', '#DB2777', '#14B8A6',
];

// ── Stage summary ──────────────────────────────────────────────
// Every tile and chart on a stage page is derived here, from the rows the page
// already fetched. Pure and exported so it can be driven directly in a test —
// the page is auth-gated, so this is the only way to exercise the maths against
// real rows without standing up a session.

export interface StageRow {
  id: string; product_type: string | null; value_cr: number; final_cr: number | null;
  quote_date: string | null; market: string | null; client_id: string; client_name: string;
  industry: string | null; client_type: string | null; rep_name: string | null;
  offer_inr: number | null; revised_inr: number | null; rev_count: number;
  so_sum_cr: number; lost_to_competitor: string | null; lost_reason: string | null;
  drop_reason: string | null;
  /** What was typed when the reason was 'Other'. Shown beside it; the charts
   *  still group on drop_reason itself, so Other stays one bar. */
  drop_reason_other: string | null;
  age_days: number | null;
  eta_text?: string | null;
}

export interface Slice { label: string; count: number; value: number }

// ── Target closure ─────────────────────────────────────────────
// Quote ageing looks back: how long has this been out. These look forward: when
// does the rep say it lands. Same rows, same value, the other direction.
//
// opportunities.eta_text is free text of the shape "Oct 2026". It is parsed the
// way risansi-sales-projection parses it in SQL — month by its first three
// letters, year as the digits — so a card the Executive Review counts in October
// is counted in October here too, and one that neither can read is "No date"
// in both rather than silently dropped.

export interface ClosureRow { value_cr: number; eta_text: string | null; rep_name: string | null }

/**
 * Month tone, so a bar can say what kind of month it is without a legend.
 * 'actual' is a closed month of this FY, valued by invoiced revenue rather than
 * quotes; 'missing' is a closed month whose revenue has not been uploaded yet.
 */
export type ClosureTone = 'overdue' | 'actual' | 'missing' | 'now' | 'ahead' | 'later' | 'none';
export interface ClosureSlice extends Slice { tone: ClosureTone }
/** Invoiced revenue for one closed month: crores, and how many clients invoiced. */
export interface MonthActual { valueCr: number; count: number }

export interface RepCoverage { label: string; dated: number; total: number; datedCr: number; totalCr: number }

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const MONTH_LABEL = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Oct 2026" → months since year 0 (2026*12 + 9), or null when unreadable. */
export function parseEtaMonth(eta: string | null | undefined): number | null {
  if (!eta) return null;
  const t = eta.trim().toLowerCase();
  const m = MONTHS.indexOf(t.slice(0, 3));
  const y = Number((t.match(/\d{4}/) ?? [])[0]);
  if (m < 0 || !Number.isInteger(y) || y < 2000) return null;
  return y * 12 + m;
}

export const monthLabel = (idx: number) => `${MONTH_LABEL[idx % 12]} ${String(Math.floor(idx / 12)).slice(2)}`;

/** April of the financial year a month index belongs to: Sep 26 → Apr 26, Feb 27 → Apr 26. */
export function fyStartIdx(idx: number): number {
  const y = Math.floor(idx / 12), m = idx % 12;
  return (m >= 3 ? y : y - 1) * 12 + 3;
}
/** Months from `todayIdx` to the end of its financial year, inclusive: Sep → 7 (Sep..Mar). */
export const fyMonthsAhead = (todayIdx: number) => fyStartIdx(todayIdx) + 12 - todayIdx;

/**
 * Which column of the month view a target month falls in. The view runs to
 * the end of the financial year, so "Later" is April onward; anything before
 * this month is Overdue whatever month it named.
 */
export function closureMonthBucket(idx: number | null, todayIdx: number, monthsAhead = fyMonthsAhead(todayIdx)): string {
  if (idx == null) return 'No date';
  if (idx < todayIdx) return 'Overdue';
  if (idx >= todayIdx + monthsAhead) return 'Later';
  return monthLabel(idx);
}

/** Which column of the quarter view a target month falls in. Overdue is the same line as the month view. */
export function closureQuarterBucket(idx: number | null, todayIdx: number, quartersAhead = 4): string {
  if (idx == null) return 'No date';
  if (idx < todayIdx) return 'Overdue';
  const thisQ = fyQuarter(todayIdx).key, q = fyQuarter(idx);
  if (q.key >= thisQ + quartersAhead) return 'Later';
  return q.label;
}

/** Indian financial year, April to March: 2026-10 is Q3 FY27. */
export function fyQuarter(idx: number): { key: number; label: string } {
  const y = Math.floor(idx / 12), m = idx % 12;          // m: 0 = Jan
  const fyEnd = m >= 3 ? y + 1 : y;                       // Apr..Dec → next year's FY
  const q = m >= 3 ? Math.floor((m - 3) / 3) + 1 : 4;     // Apr–Jun Q1 … Jan–Mar Q4
  return { key: fyEnd * 4 + q, label: `Q${q} FY${String(fyEnd).slice(2)}` };
}

/**
 * Buckets a stage's rows by target closure month and by FY quarter, and says
 * who is setting the date at all.
 *
 * `todayIdx` is the current month as a month index; passed in rather than read
 * from the clock so the maths can be checked against fixed rows. Overdue is any
 * target month strictly before it — the same line in both the month and the
 * quarter view, so the current quarter shows only what is still ahead in it and
 * the two panels never disagree about what is late.
 */
export function summariseClosure(
  rows: ClosureRow[], todayIdx: number,
  monthsAhead = fyMonthsAhead(todayIdx), quartersAhead = 4,
  /** Invoiced revenue by month index for the closed months of this FY; when given, the month view opens at April. */
  actuals?: Map<number, MonthActual> | null,
) {
  const parsed = rows.map(r => ({ r, idx: parseEtaMonth(r.eta_text) }));
  const dated = parsed.filter(p => p.idx != null) as { r: ClosureRow; idx: number }[];
  const undated = parsed.filter(p => p.idx == null).map(p => p.r);
  const sum = (xs: ClosureRow[]) => xs.reduce((s, r) => s + r.value_cr, 0);
  const slice = (label: string, xs: ClosureRow[], tone: ClosureTone): ClosureSlice =>
    ({ label, count: xs.length, value: sum(xs), tone });

  const overdue = dated.filter(p => p.idx < todayIdx).map(p => p.r);
  const inMonth   = (label: string) => parsed.filter(p => closureMonthBucket(p.idx, todayIdx, monthsAhead) === label).map(p => p.r);
  const inQuarter = (label: string) => parsed.filter(p => closureQuarterBucket(p.idx, todayIdx, quartersAhead) === label).map(p => p.r);

  // Closed months of the FY, from April to last month: what was invoiced, not
  // what was quoted. Quotes that named those months and are still open are on
  // the Overdue line; the month itself shows the business that landed.
  const past: ClosureSlice[] = actuals
    ? Array.from({ length: Math.max(0, todayIdx - fyStartIdx(todayIdx)) }, (_, i) => {
        const idx = fyStartIdx(todayIdx) + i, a = actuals.get(idx);
        return { label: monthLabel(idx), count: a?.count ?? 0, value: a?.valueCr ?? 0, tone: a ? 'actual' as const : 'missing' as const };
      })
    : [];
  const months: ClosureSlice[] = [
    slice('Overdue', overdue, 'overdue'),
    ...past,
    ...Array.from({ length: monthsAhead }, (_, i) => {
      const label = monthLabel(todayIdx + i);
      return slice(label, inMonth(label), i === 0 ? 'now' : 'ahead');
    }),
    slice('Later', inMonth('Later'), 'later'),
    slice('No date', undated, 'none'),
  ];

  const thisQ = fyQuarter(todayIdx).key;
  const quarters: ClosureSlice[] = [
    slice('Overdue', overdue, 'overdue'),
    ...Array.from({ length: quartersAhead }, (_, i) => {
      const key = thisQ + i;
      // Label from any month in that quarter: walk forward from today to find one.
      let probe = todayIdx; while (fyQuarter(probe).key < key) probe++;
      const label = fyQuarter(probe).label;
      return slice(label, inQuarter(label), i === 0 ? 'now' : 'ahead');
    }),
    slice('Later', inQuarter('Later'), 'later'),
    slice('No date', undated, 'none'),
  ];

  // Who sets the date. Sorted by book size, because the rep with 70 undated
  // quotes matters more than the one with 3, whatever their percentages say.
  const byRep = (() => {
    const m = new Map<string, RepCoverage>();
    for (const p of parsed) {
      const k = (p.r.rep_name ?? '').trim() || '—';
      const cur = m.get(k) ?? { label: k, dated: 0, total: 0, datedCr: 0, totalCr: 0 };
      cur.total++; cur.totalCr += p.r.value_cr;
      if (p.idx != null) { cur.dated++; cur.datedCr += p.r.value_cr; }
      m.set(k, cur);
    }
    return [...m.values()].sort((a, b) => b.total - a.total || a.label.localeCompare(b.label));
  })();

  return {
    dated: dated.length, datedCr: sum(dated.map(p => p.r)),
    undated: undated.length, undatedCr: sum(undated),
    overdue: overdue.length, overdueCr: sum(overdue),
    months, quarters, byRep,
  };
}

// ── Cross-filter selections ────────────────────────────────────
// Click a bar and the rest of the page narrows to it, the way a Power BI visual
// does. The selection lives in the URL as `sel=dim:value`, one entry per
// dimension, so it survives a reload, rides into the Excel export, and can be
// sent to somebody as a link. The visual a selection came from keeps all its
// bars with the chosen one lit; every other visual, the tiles and the table
// see only the matching rows. Selections on different dimensions combine.
//
// A dimension's value is the bar's LABEL — the same string the chart prints —
// produced by one function for both the chart and the filter, so a click can
// never select a bucket the chart did not draw.

export type SelDim =
  | 'age' | 'etam' | 'etaq' | 'ptype' | 'market' | 'rep' | 'client'
  | 'so' | 'qmonth' | 'lost_reason' | 'lost_to' | 'drop_reason';
export type Selection = Partial<Record<SelDim, string>>;

export const SEL_DIMS: readonly SelDim[] = [
  'age', 'etam', 'etaq', 'ptype', 'market', 'rep', 'client', 'so', 'qmonth', 'lost_reason', 'lost_to', 'drop_reason',
];
export const DIM_LABEL: Record<SelDim, string> = {
  age: 'Age', etam: 'Closing month', etaq: 'Closing quarter', ptype: 'Type', market: 'Market',
  rep: 'Rep', client: 'Client', so: 'SO coverage', qmonth: 'Won month',
  lost_reason: 'Reason', lost_to: 'Lost to', drop_reason: 'Drop reason',
};

const groupLabel = (v: string | null | undefined) => (v ?? '').trim() || 'Unrecorded';

/** The age column a row sits in — the same rule summariseStage uses to build the chart. */
export function ageBucketLabel(ageDays: number | null): string {
  if (ageDays == null) return 'No date';
  const b = AGE_BUCKETS.find(b => ageDays >= b.min && (b.max == null || ageDays < b.max));
  return b?.label ?? 'No date';
}

/** The bar this row belongs to, on the given dimension. */
export function dimValue(dim: SelDim, r: StageRow, todayIdx: number): string {
  switch (dim) {
    case 'age':         return ageBucketLabel(r.age_days);
    case 'etam':        return closureMonthBucket(parseEtaMonth(r.eta_text), todayIdx);
    case 'etaq':        return closureQuarterBucket(parseEtaMonth(r.eta_text), todayIdx);
    case 'ptype':       return groupLabel(r.product_type);
    case 'market':      return r.market === 'DOMESTIC' ? 'Domestic' : r.market === 'EXPORT' ? 'Export' : 'Unrecorded';
    case 'rep':         return groupLabel(r.rep_name);
    case 'client':      return groupLabel(r.client_name);
    case 'so':          return r.so_sum_cr > 0 ? 'SO created' : 'Awaiting SO';
    case 'qmonth':      return r.quote_date ? r.quote_date.slice(0, 7) : 'none';
    case 'lost_reason': return groupLabel(r.lost_reason);
    case 'lost_to':     return groupLabel(r.lost_to_competitor);
    case 'drop_reason': return groupLabel(r.drop_reason);
  }
}

/** `sel=dim:value` entries from the query string, unknown dimensions ignored. */
export function parseSelection(raw: string | string[] | undefined): Selection {
  const out: Selection = {};
  for (const e of Array.isArray(raw) ? raw : raw ? [raw] : []) {
    const i = e.indexOf(':');
    if (i < 1) continue;
    const dim = e.slice(0, i) as SelDim, value = e.slice(i + 1);
    if ((SEL_DIMS as readonly string[]).includes(dim) && value) out[dim] = value;
  }
  return out;
}

export const selectionEntries = (sel: Selection): string[] =>
  (Object.entries(sel) as [SelDim, string][]).map(([d, v]) => `${d}:${v}`);

/**
 * The rows that match every selected dimension — except `except`, which is the
 * dimension of the visual being drawn: that visual keeps its own bars and only
 * narrows by the others, so the chosen bar stays visible to be un-chosen.
 */
export function applySelection<T extends StageRow>(rows: T[], sel: Selection, todayIdx: number, except?: SelDim): T[] {
  const active = (Object.entries(sel) as [SelDim, string][]).filter(([d]) => d !== except);
  if (!active.length) return rows;
  return rows.filter(r => active.every(([d, v]) => dimValue(d, r, todayIdx) === v));
}

/** The current month as a month index, on the Indian clock — Vercel runs on UTC and 05:00 IST on the 1st is still last month there. */
export function todayMonthIdx(now = Date.now()): number {
  const d = new Date(now + 5.5 * 3600e3);
  return d.getUTCFullYear() * 12 + d.getUTCMonth();
}

/** Won value with no Sales Order against it uses final_value_cr when set, else value_cr. */
export const wonBase = (r: Pick<StageRow, 'final_cr' | 'value_cr'>) =>
  (r.final_cr != null ? Number(r.final_cr) : r.value_cr);

export function summariseStage(rows: StageRow[]) {
  const n       = rows.length;
  const totalCr = rows.reduce((s, r) => s + r.value_cr, 0);
  const withAge = rows.filter(r => r.age_days != null);

  const group = (key: (r: StageRow) => string | null, limit?: number): Slice[] => {
    const m = new Map<string, Slice>();
    for (const r of rows) {
      // An unrecorded value becomes its own bar rather than being dropped: an
      // empty "why we lost" chart reads as "no reason", not "nobody filled it in".
      const k = (key(r) ?? '').trim() || 'Unrecorded';
      const cur = m.get(k) ?? { label: k, count: 0, value: 0 };
      cur.count++; cur.value += r.value_cr; m.set(k, cur);
    }
    const out = [...m.values()].sort((a, b) => b.value - a.value || b.count - a.count);
    return limit ? out.slice(0, limit) : out;
  };

  const ageBuckets: Slice[] = [
    ...AGE_BUCKETS.map(b => {
      const hit = withAge.filter(r => (r.age_days ?? 0) >= b.min && (b.max == null || (r.age_days ?? 0) < b.max));
      return { label: b.label, count: hit.length, value: hit.reduce((s, r) => s + r.value_cr, 0) };
    }),
    ...(n - withAge.length > 0
      ? [{ label: 'No date', count: n - withAge.length, value: rows.filter(r => r.age_days == null).reduce((s, r) => s + r.value_cr, 0) }]
      : []),
  ];

  const stale = withAge.filter(r => (r.age_days ?? 0) > 60);
  const moved = rows.filter(r => r.rev_count > 0 && r.offer_inr && r.revised_inr);

  // Monthly trend by quote date, oldest first, last 12 months present.
  const trend = (() => {
    const m = new Map<string, { key: string; label: string; count: number; value: number }>();
    for (const r of rows) {
      if (!r.quote_date) continue;
      const key = r.quote_date.slice(0, 7);
      const cur = m.get(key) ?? {
        key,
        label: new Date(`${key}-01T00:00:00Z`).toLocaleString('en-GB', { month: 'short', year: '2-digit', timeZone: 'UTC' }),
        count: 0, value: 0,
      };
      cur.count++; cur.value += wonBase(r); m.set(key, cur);
    }
    return [...m.values()].sort((a, b) => a.key.localeCompare(b.key)).slice(-12);
  })();

  return {
    n, totalCr,
    avgCr:   n ? totalCr / n : 0,
    clients: new Set(rows.map(r => r.client_id)).size,
    avgAge:  withAge.length ? Math.round(withAge.reduce((s, r) => s + (r.age_days ?? 0), 0) / withAge.length) : null,
    oldest:  withAge.length ? Math.max(...withAge.map(r => r.age_days ?? 0)) : null,
    ageBuckets,
    stale, staleCr: stale.reduce((s, r) => s + r.value_cr, 0),
    // Un-SO'd won value: Σ max(final − ΣSO, 0), the same definition the flow
    // bracket on the board uses, so the two can never disagree.
    inHandCr: rows.reduce((s, r) => s + Math.max(0, wonBase(r) - r.so_sum_cr), 0),
    soCr:     rows.reduce((s, r) => s + r.so_sum_cr, 0),
    withSo:   rows.filter(r => r.so_sum_cr > 0).length,
    moved,
    avgMove: moved.length
      ? moved.reduce((s, r) => s + (((r.revised_inr as number) - (r.offer_inr as number)) / (r.offer_inr as number)) * 100, 0) / moved.length
      : null,
    totalRevs: rows.reduce((s, r) => s + r.rev_count, 0),
    trend,
    group,
    unrecorded: (key: (r: StageRow) => string | null) => rows.filter(r => !((key(r) ?? '').trim())).length,
  };
}
