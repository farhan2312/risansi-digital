// RIL probability code — the single vocabulary for how likely a quoted
// opportunity is to convert. It is a controlled 1–4 scale, not a free number,
// so it can be filtered and reported on consistently. One definition, shared by
// the entry dropdown (QuotedDetailsModal) and the Opportunities filter, so the
// two can never drift.

export interface ProbabilityCode {
  code: string;         // stored value in opportunities.probability_code
  pct: number;          // the odds it stands for
  /** Short gloss shown next to the code so its meaning is self-evident. */
  gloss: string;
}

export const PROBABILITY_CODES: ProbabilityCode[] = [
  { code: '1', pct: 90, gloss: 'very likely' },
  { code: '2', pct: 40, gloss: 'possible' },
  { code: '3', pct: 20, gloss: 'long shot' },
  { code: '4', pct: 0,  gloss: 'no chance of the order' },
];

/** Dropdown/filter label, e.g. "1 — 90% (very likely)" / "4 — No chance of the order". */
export function probabilityCodeLabel(c: ProbabilityCode): string {
  return c.pct > 0
    ? `${c.code} — ${c.pct}% (${c.gloss})`
    : `${c.code} — No chance of the order`;
}

/** Filter options in the shape MultiSelectFilter expects. */
export const PROBABILITY_CODE_OPTIONS = PROBABILITY_CODES.map(c => ({
  value: c.code,
  label: probabilityCodeLabel(c),
}));

/**
 * The odds to weight a forecast by. A missing code is not a coin toss: nobody
 * has said what the chances are, so it counts as nothing until somebody does.
 * That is deliberately unflattering — an un-rated quote drags the weighted
 * figure down until a rep rates it, which is the point.
 */
export function probabilityWeight(code: string | null | undefined): number {
  return pctForProbabilityCode(code) ?? 0;
}

/**
 * How a stored code reads on screen: "1 (90% — very likely)", never a bare "1".
 * The code on its own is meaningless to anyone who has not memorised the scale.
 */
export function probabilityCodeDisplay(code: string | null | undefined): string {
  const c = PROBABILITY_CODES.find(x => x.code === code);
  if (c) return c.pct > 0 ? `${c.code} (${c.pct}% — ${c.gloss})` : `${c.code} (no chance of the order)`;
  const raw = (code ?? '').trim();
  return raw ? `${raw} (code no longer in use)` : 'Not set';
}

/**
 * The odds as SQL, read from the code rather than the numeric column. Reports
 * weight with this so they agree with the screens even on rows whose stored
 * percentage was written by an old stage default and never by a rep.
 * Null when no code is set — a caller decides whether that is 0 or excluded.
 */
export function probabilityPctSql(alias = 'o'): string {
  const whens = PROBABILITY_CODES.map(c => `WHEN '${c.code}' THEN ${c.pct}`).join(' ');
  return `(CASE btrim(COALESCE(${alias}.probability_code, '')) ${whens} ELSE NULL END)`;
}

/** Whether a row carries a probability anybody actually entered. */
export function hasProbabilitySql(alias = 'o'): string {
  return `${probabilityPctSql(alias)} IS NOT NULL`;
}

/** The same fact in the width a kanban card has: "90% (code 1)", or ''. */
export function probabilityCardLabel(code: string | null | undefined): string {
  const c = PROBABILITY_CODES.find(x => x.code === code);
  return c ? `${c.pct}% (code ${c.code})` : '';
}

/**
 * Numeric % odds a stored code stands for, or null for an unknown/blank code.
 * The opportunity forms now capture the code; the numeric `probability` column
 * (weighted forecast + % displays) is derived from this so both stay in sync.
 */
export function pctForProbabilityCode(code: string | null | undefined): number | null {
  const c = PROBABILITY_CODES.find(x => x.code === code);
  return c ? c.pct : null;
}
