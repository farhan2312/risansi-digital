// Clients a visit is not expected for.
//
// One catalogue, read by the Client 360 control that sets a waiver, by every
// coverage query that has to skip one, and by the executive review panel that
// lists them back by reason. Codes live in a CHECK constraint (migration 0127),
// so adding one here means adding it there too.
//
// Two rules the SQL below encodes and nothing else should re-derive:
//
//   A waiver EXPIRES. `until` in the past means the client owes a visit again.
//   Without that, "will plan a visit next quarter" would keep an account out
//   of the numbers for years.
//
//   A waiver does not make a visit stop counting. A waived client visited last
//   month is a VISITED client, not a waived one. Only the ones that would
//   otherwise sit in the gap are reported as waived, so the buckets still add
//   up to the total and the waiver cannot inflate coverage past what happened.

export const VISIT_WAIVER_CODES = [
  'not_required', 'planned', 'unreachable', 'declined', 'sick_unit',
] as const;
export type VisitWaiverCode = typeof VISIT_WAIVER_CODES[number];

export interface VisitWaiverReason {
  code: VisitWaiverCode;
  /** The heading, on the client page and on the review. Kept to two words. */
  label: string;
  /** The sentence under it, which is what the rep is actually agreeing to. */
  hint: string;
  /** Temporary reasons ask for a date; standing ones do not. */
  expects_until: boolean;
  color: string;
}

export const VISIT_WAIVER_REASONS: VisitWaiverReason[] = [
  { code: 'not_required', label: 'No visit needed',
    hint: 'Orders come over call or mail. No field potential to work.',
    expects_until: false, color: 'var(--fg-3)' },
  { code: 'planned', label: 'Visit planned',
    hint: 'Going in a coming month or next quarter. Set the date it is due by.',
    expects_until: true, color: 'var(--brand-blue)' },
  { code: 'unreachable', label: 'Out of reach',
    hint: 'Cannot get hold of anyone at the client.',
    expects_until: false, color: 'var(--warn-strong)' },
  { code: 'declined', label: 'Meeting declined',
    hint: 'Visit was planned, client was unavailable and turned it down.',
    expects_until: true, color: 'var(--warn-strong)' },
  { code: 'sick_unit', label: 'Sick unit',
    hint: 'Plant shut or not operating.',
    expects_until: false, color: 'var(--neg)' },
];

const BY_CODE = new Map(VISIT_WAIVER_REASONS.map(r => [r.code as string, r]));
export const waiverReason = (code: string | null | undefined): VisitWaiverReason | null =>
  (code ? BY_CODE.get(code) ?? null : null);

export const isWaiverCode = (v: unknown): v is VisitWaiverCode =>
  typeof v === 'string' && (VISIT_WAIVER_CODES as readonly string[]).includes(v);

// ── SQL ───────────────────────────────────────────────────────
//
// Every coverage query uses these two rather than writing the expiry rule out
// again. They take the clients alias because the queries disagree about it.

/** The waiver is set AND has not run out. */
export const waivedSql = (a = 'c') =>
  `(${a}.visit_waiver IS NOT NULL`
  + ` AND (${a}.visit_waiver_until IS NULL OR ${a}.visit_waiver_until >= CURRENT_DATE))`;

/** A visit is expected: no waiver, or one that has expired. */
export const visitExpectedSql = (a = 'c') => `NOT ${waivedSql(a)}`;

/**
 * In the gap: no visit in 90 days, or none ever.
 *
 * The coverage buckets are visited / overdue / never / waived, and they are
 * meant to add up. Overdue and never both carry `visitExpectedSql`; this is
 * the other side of that split, so waived counts only the clients a waiver
 * actually took out of the gap.
 */
export const inVisitGapSql = (a = 'c') =>
  `(${a}.last_visit_date IS NULL OR ${a}.last_visit_date < CURRENT_DATE - INTERVAL '90 days')`;

/** Waived AND in the gap: the ones the waiver is doing work for. */
export const waivedGapSql = (a = 'c') => `(${waivedSql(a)} AND ${inVisitGapSql(a)})`;
