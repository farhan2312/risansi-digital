// The Opportunities filter set — parsed once, built once.
//
// The board at /risansi/pipeline and the per-stage dashboards at
// /risansi/pipeline/stage/[stage] answer questions about the same rows through
// the same filters, so they must build the same predicate. Without this a stage
// page would have had to reimplement all of it — the same nine filters, the same
// the same rep attribution, the same value buckets — and any later fix would
// have had to land twice, or silently not.
//
// STATUS: the stage dashboards build from here. The board still carries its own
// inline copy, kept for now because it is the busiest page in the app and the
// swap deserves its own verified change. The two were proven to emit identical
// SQL and parameters across eleven filter combinations before this shipped; if
// you touch either, re-run that check and finish the swap.
//
// Everything here is pure. Visibility scoping (clientScopeSql) stays with the
// caller, because it is appended as raw inlined text and each page has a
// different set of aliases to scope.

import { soCoverageSql, isSoCoverage } from './risansi-pipeline-brackets';

export type SearchParams = Record<string, string | string[] | undefined>;

/** Value buckets on value_cr, in Crores. Boundaries are constants we control. */
export const VALUE_BUCKETS: { label: string; min: number; max: number | null }[] = [
  { label: '< ₹1L',    min: 0,    max: 0.01 },
  { label: '₹1–5L',    min: 0.01, max: 0.05 },
  { label: '₹5–10L',   min: 0.05, max: 0.10 },
  { label: '₹10–50L',  min: 0.10, max: 0.50 },
  { label: '₹50L–1Cr', min: 0.50, max: 1.0 },
  { label: '≥ ₹1Cr',   min: 1.0,  max: null },
];

/** SQL for a set of value buckets, ORed together. Inlines — no parameters. */
export function valueRangeSql(col: string, labels: string[]): string {
  const parts = labels
    .map(l => VALUE_BUCKETS.find(b => b.label === l))
    .filter((b): b is { label: string; min: number; max: number | null } => !!b)
    .map(b => (b.max == null ? `${col} >= ${b.min}` : `(${col} >= ${b.min} AND ${col} < ${b.max})`));
  return parts.length ? `(${parts.join(' OR ')})` : '';
}

export interface OppFilters {
  stage:     string[];
  prodType:  string[];
  rep:       string[];
  industry:  string[];
  ctype:     string[];
  /** clients.status — Prospective-Lead / Prospective-Client / Active / … .
   *  A different column from ctype, and ANDed with it: picking OEM and Active
   *  asks for OEM accounts that are active, not for either. */
  cstat:     string[];
  prob:      string[];
  val:       string[];
  so:        string;
  qname:     string;
  qfrom:     string;
  qto:       string;
  /** Enquiry date range — the date that exists for a Prospect, which has no quote date. */
  efrom:     string;
  eto:       string;
  /** ?rep=all — the reps-only scope toggle, not a rep selection. */
  showAllReps: boolean;
}

const list = (v: unknown): string[] =>
  typeof v === 'string' && v ? v.split(',').filter(Boolean) : [];

/** Read every Opportunities filter out of the query string. */
export function parseOppFilters(sp: SearchParams): OppFilters {
  return {
    stage:    list(sp.stage),
    prodType: list(sp.product_type),
    // NOTE: `rep` doubles as the scope-toggle param (?rep=all). The 'all'
    // sentinel is excluded here so the multi-select doesn't hunt for a rep
    // literally named "all" and return nothing.
    rep:      typeof sp.rep === 'string' && sp.rep !== 'all' ? list(sp.rep) : [],
    industry: list(sp.industry),
    ctype:    list(sp.ctype),
    cstat:    list(sp.cstat),
    prob:     list(sp.prob),
    val:      list(sp.val),
    so:       isSoCoverage(sp.so) ? sp.so : '',
    qname:    typeof sp.qname === 'string' ? sp.qname.trim() : '',
    qfrom:    typeof sp.qfrom === 'string' ? sp.qfrom : '',
    qto:      typeof sp.qto   === 'string' ? sp.qto   : '',
    efrom:    typeof sp.efrom === 'string' ? sp.efrom : '',
    eto:      typeof sp.eto   === 'string' ? sp.eto   : '',
    showAllReps: sp.rep === 'all',
  };
}

export interface BuiltFilter {
  conds: string[];
  vals:  (string | number | string[])[];
  /** Next free $-index, for a caller that wants to append its own parameters. */
  nextIdx: number;
}

/**
 * Build the WHERE fragments. Assumes `o` = opportunities and `c` = clients are
 * both in scope, which every caller joins.
 *
 * `scopedRepId` is the viewer's own rep id when the board is in self-scope, else
 * null. Self-scope follows the client — a rep owns the opportunities of
 * the clients on their tour(s), plus any client granted to them by special
 * access — not a per-opportunity rep_id. An explicit rep selection REPLACES the
 * self-scope rather than ANDing with it: a rep who picks a colleague means "show
 * me theirs", and ANDing the two produced an unexplained empty board.
 */
/**
 * The book a chosen rep answers for, as SQL over a `clients c` join: the
 * clients that rep owns or covers, and nobody else's.
 *
 * A manager's team is deliberately NOT folded in. It was, between 23 Sep and
 * 26 Sep, so that "Rep: Anil Vankudre" from an admin login returned the same
 * total Anil's own board showed. The cost was worse than the problem: Aviral
 * Shukla, who manages two reps, ticked his own name and the board did not move
 * — every figure on it was still his team's, and there was no way to ask what
 * was actually his. A filter has to mean the thing it names.
 *
 * The team is still one click away, because the dropdown lists a manager's
 * reps individually: pick all three and you have the manager's board. And an
 * unfiltered board already shows everything the viewer may see, team included
 * — that, not the rep filter, is where "what does Anil see" is answered.
 *
 * Under tours this had to mean "clients on a route they are on", which caught
 * every other rep's clients on a shared route.
 */
export function repBookSql(namesParam: string): string {
  return `EXISTS (SELECT 1 FROM users u2
            WHERE u2.name = ANY(${namesParam})
              AND (c.primary_rep_id = u2.id
                   OR c.id IN (SELECT client_id FROM client_secondary_reps WHERE rep_id = u2.id)))`;
}

export function buildOppFilter(f: OppFilters, scopedRepId: number | null, startIdx = 1): BuiltFilter {
  const conds: string[] = [];
  const vals: (string | number | string[])[] = [];
  let idx = startIdx;

  if (scopedRepId != null) {
    // "My pipeline": the clients this person works, plus anything granted. The
    // opportunity's own rep_id is deliberately not consulted here — that is the
    // in-flight rule, which clientScopeSql applies at the page level; this filter
    // answers a different question, which is whose territory the deal sits in.
    conds.push(`(c.primary_rep_id = $${idx}
           OR c.id IN (SELECT client_id FROM client_secondary_reps WHERE rep_id = $${idx}))`);
    vals.push(scopedRepId); idx++;
  }
  if (f.stage.length)    { conds.push(`o.stage = ANY($${idx}::text[])`);           vals.push(f.stage);    idx++; }
  if (f.prodType.length) { conds.push(`o.product_type = ANY($${idx}::text[])`);    vals.push(f.prodType); idx++; }
  if (f.rep.length) {
    conds.push(repBookSql(`$${idx}::text[]`));
    vals.push(f.rep); idx++;
  }
  if (f.industry.length) { conds.push(`c.industry = ANY($${idx}::text[])`);        vals.push(f.industry); idx++; }
  if (f.ctype.length)    { conds.push(`c.client_type = ANY($${idx}::text[])`);     vals.push(f.ctype);    idx++; }
  if (f.cstat.length)    { conds.push(`c.status = ANY($${idx}::text[])`);          vals.push(f.cstat);    idx++; }
  if (f.prob.length)     { conds.push(`o.probability_code = ANY($${idx}::text[])`); vals.push(f.prob);    idx++; }
  if (f.val.length)      { const v = valueRangeSql('o.value_cr', f.val); if (v) conds.push(v); }
  // SO coverage and value buckets inline (validated enum / constant thresholds),
  // so they leave every $-index untouched.
  if (soCoverageSql(f.so, 'o')) conds.push(soCoverageSql(f.so, 'o'));
  if (f.qname) {
    conds.push(`(o.quote_ref ILIKE $${idx} OR c.legal_name ILIKE $${idx} OR o.product ILIKE $${idx})`);
    vals.push(`%${f.qname}%`); idx++;
  }
  if (f.qfrom) { conds.push(`o.quote_date >= $${idx}`); vals.push(f.qfrom); idx++; }
  if (f.qto)   { conds.push(`o.quote_date <= $${idx}`); vals.push(f.qto);   idx++; }
  if (f.efrom) { conds.push(`o.enquiry_date >= $${idx}`); vals.push(f.efrom); idx++; }
  if (f.eto)   { conds.push(`o.enquiry_date <= $${idx}`); vals.push(f.eto);   idx++; }

  return { conds, vals, nextIdx: idx };
}

/** Is anything at all selected? Drives whether the active-filter bar shows. */
export function anyOppFilter(f: OppFilters): boolean {
  return f.stage.length > 0 || f.prodType.length > 0 || f.rep.length > 0
    || f.industry.length > 0 || f.ctype.length > 0 || f.cstat.length > 0 || f.prob.length > 0
    || f.val.length > 0 || !!f.so || !!f.qname || !!f.qfrom || !!f.qto || !!f.efrom || !!f.eto;
}

/** The filter params, for carrying onto an export link or a stage page. */
export const OPP_FILTER_PARAMS = [
  'stage', 'product_type', 'rep', 'industry', 'ctype', 'cstat', 'so', 'prob', 'val',
  'qname', 'qfrom', 'qto', 'efrom', 'eto',
] as const;

/** Copy the active filter params out of a query string. */
export function oppFilterQuery(sp: SearchParams, omit: readonly string[] = []): URLSearchParams {
  const qp = new URLSearchParams();
  for (const k of OPP_FILTER_PARAMS) {
    if (omit.includes(k)) continue;
    const v = sp[k];
    if (typeof v === 'string' && v) qp.set(k, v);
  }
  return qp;
}
