// The flow strip on the Opportunities page is five brackets — Quoted →
// In Negotiation → Won (awaiting SO) → Won (SO created) → Revenue (Invoiced).
// Four of them ARE a set of opportunities, so clicking one should put that set
// in the table and on the board. This builds those links.
//
// They are plain URLs, not client-side state: every other filter on the page
// lives in the query string, so a bracket that worked differently would leave
// the Excel export link, the active-filter bar and the back button disagreeing
// with what is on screen.
//
// Revenue (Invoiced) gets no link — it reads from client_revenue_monthly, which
// carries no opportunity reference, so there is no set of cards to filter to.
// Best-case, Probability-weighted and Annual Target are arithmetic over the
// whole board rather than a subset, so they stay inert too.

/** SO coverage on a Won opportunity. The two overlap: a partly-covered Won is in both. */
export type SoCoverage = 'awaiting' | 'created';

export const isSoCoverage = (v: unknown): v is SoCoverage =>
  v === 'awaiting' || v === 'created';

export const SO_COVERAGE_LABELS: Record<SoCoverage, string> = {
  awaiting: 'Awaiting SO',
  created:  'SO created',
};

export type BracketKey = 'quoted' | 'negotiating' | 'awaitingSo' | 'createdSo';

/** What each clickable bracket selects. */
export const BRACKET_SELECTION: Record<BracketKey, { stage: string; so: SoCoverage | null }> = {
  quoted:      { stage: 'Quoted',      so: null },
  negotiating: { stage: 'Negotiating', so: null },
  awaitingSo:  { stage: 'Won',         so: 'awaiting' },
  createdSo:   { stage: 'Won',         so: 'created'  },
};

export interface BracketLink { href: string; active: boolean }

type SearchParams = Record<string, string | string[] | undefined>;

/**
 * Is the board already showing exactly this bracket? "Exactly" matters: with
 * Stage set to Quoted AND Negotiating, neither bracket is the current view, so
 * lighting one up (and letting a click clear both) would misrepresent the state.
 */
function isActive(key: BracketKey, stageFilts: string[], soFilt: string): boolean {
  const sel = BRACKET_SELECTION[key];
  if (stageFilts.length !== 1 || stageFilts[0] !== sel.stage) return false;
  return (sel.so ?? '') === soFilt;
}

/**
 * Link for one bracket. Clicking an inactive bracket selects it; clicking the
 * lit one clears it — the same second-click-to-undo the filter chips have.
 *
 * Every other search param rides along untouched, so a bracket click narrows
 * whatever the user had already set up rather than resetting their board. Two
 * exceptions: `page` (a new result set starts at page 1) and, obviously, the
 * `stage`/`so` pair being replaced.
 */
export function bracketLink(
  key: BracketKey,
  sp: SearchParams,
  stageFilts: string[],
  soFilt: string,
  pathname = '/risansi/pipeline',
): BracketLink {
  const active = isActive(key, stageFilts, soFilt);
  const qp = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    if (typeof v !== 'string' || !v) continue;
    if (k === 'stage' || k === 'so' || k === 'page') continue;
    qp.set(k, v);
  }
  if (!active) {
    const sel = BRACKET_SELECTION[key];
    qp.set('stage', sel.stage);
    if (sel.so) qp.set('so', sel.so);
  }
  const qs = qp.toString();
  // #opps drops the viewer at the table/board instead of leaving them looking at
  // the same strip, unsure whether the click did anything.
  return { href: `${pathname}${qs ? `?${qs}` : ''}#opps`, active };
}

/**
 * SQL predicate for an SO-coverage pick, for a given opportunity alias.
 *
 * Both branches pin stage = 'Won' because SO coverage is only meaningful on a
 * won deal. Without that, every unwon opportunity (no SO, so ΣSO = 0 < value)
 * would satisfy "awaiting" and the entire open pipeline would pour into a
 * bracket that means "won, not yet fulfilled".
 *
 * Returns '' when nothing is selected. The value is a validated enum and the
 * comparison operands are columns, so this inlines with no parameters — callers
 * can append it without disturbing their $-indices.
 */
export function soCoverageSql(soFilt: string, alias: string): string {
  const soSum = `COALESCE((SELECT SUM(so.so_value_cr) FROM opportunity_sales_orders so WHERE so.opportunity_id = ${alias}.id), 0)`;
  if (soFilt === 'awaiting') {
    return `(${alias}.stage = 'Won' AND COALESCE(${alias}.final_value_cr, ${alias}.value_cr, 0) - ${soSum} > 0)`;
  }
  if (soFilt === 'created') {
    return `(${alias}.stage = 'Won' AND ${soSum} > 0)`;
  }
  return '';
}
