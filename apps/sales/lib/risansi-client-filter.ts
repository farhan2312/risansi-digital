import { clientVisibilitySql, type CurrentUser } from './risansi-auth';
import { PROSPECTIVE_STATUSES } from './risansi-client-status';
import { clientRepIdsSql, clientRepNamesSql } from '@/lib/risansi-client-rep';

// Shared filter logic for the Client 360 list. The list page and the Excel
// export both build their WHERE from buildClientFilter() so the export always
// matches exactly what the filtered view shows.

// The reps who work the client: primary first, then anyone covering it.
export const OWNERS_SUBQUERY = clientRepNamesSql('c.id');

// Lifetime revenue (INR) per client, joined as rev.lifetime_rev.
export const REV_JOIN = `LEFT JOIN (
  SELECT client_id, SUM(total_value) AS lifetime_rev
  FROM client_revenue_monthly GROUP BY client_id
) rev ON rev.client_id = c.id`;

// Revenue buckets keyed on lifetime revenue (INR). The value doubles as the
// human-readable label; `cond` builds the SQL range for the given column.
export const REV_BUCKETS: { value: string; cond: (x: string) => string }[] = [
  { value: 'No Revenue',     cond: x => `${x} = 0` },
  { value: '< ₹10 L',        cond: x => `${x} > 0 AND ${x} < 1000000` },
  { value: '₹10 L – ₹50 L',  cond: x => `${x} >= 1000000 AND ${x} < 5000000` },
  { value: '₹50 L – ₹1 Cr',  cond: x => `${x} >= 5000000 AND ${x} < 10000000` },
  { value: '₹1 Cr+',         cond: x => `${x} >= 10000000` },
];

// Last-visit buckets keyed on clients.last_visit_date, mutually exclusive so
// Visited + Overdue + Never always sum to the total (unlike the Field page's
// own "Overdue" tab, which folds Never Visited into its overdue count).
export const VISIT_BUCKETS: { value: string; label: string; cond: (x: string) => string }[] = [
  { value: 'visited', label: 'Visited (≤90d)',  cond: x => `${x} >= CURRENT_DATE - INTERVAL '90 days'` },
  { value: 'overdue', label: 'Overdue (90d+)',  cond: x => `${x} IS NOT NULL AND ${x} < CURRENT_DATE - INTERVAL '90 days'` },
  { value: 'never',   label: 'Never Visited',   cond: x => `${x} IS NULL` },
];

type SP = { [key: string]: string | string[] | undefined };

/**
 * Build the parameterised WHERE (no leading `WHERE`) + params for a client-list
 * query from URL search params and the current user's visibility. Callers own
 * the FROM/JOINs (they must include `tour_routes tr` and {@link REV_JOIN} so
 * `tr.zone` and `rev.lifetime_rev` resolve) and append their own limit/offset.
 */
export function buildClientFilter(
  sp: SP,
  user: CurrentUser,
): { whereClause: string; params: (string | number | boolean | string[])[] } {
  const str  = (k: string) => (typeof sp[k] === 'string' ? (sp[k] as string).trim() : '');
  const list = (k: string) => (typeof sp[k] === 'string' && sp[k] ? (sp[k] as string).split(',').filter(Boolean) : []);

  const q_str     = str('q');
  const sugarFilt = str('sugar');
  const indFilts  = list('industry');
  const zoneFilts = list('zone');
  const countryFilts = list('country');
  // Hand-picked clients. `sel` is an explicit list; `selall` means everything the
  // other filters match, with `selx` naming anything unticked since.
  //
  // These INTERSECT with the filters rather than replacing them, which is a
  // deliberate choice: the count on the export button is computed under the same
  // filters, so what you are told you are exporting is what you get. A selection
  // that overrode the filters would quietly re-add clients the filter had
  // removed, and the number would stop matching the file.
  const selFilts = list('sel');
  const selAll   = str('selall') === '1';
  const selEx    = list('selx');
  const tierFilts  = list('tier');
  const ctypeFilts = list('ctype');
  const statFilts  = list('status').map(s => s.toUpperCase());
  const tab        = str('tab');
  const repFilts  = list('rep');
  const fyFilts   = list('fy');
  const revFilts  = list('rev');
  const visitFilts = list('visit');

  const whereConditions: string[] = ['c.deleted_at IS NULL'];
  const params: (string | number | boolean | string[])[] = [];

  if (q_str) {
    const pIdx = params.push(`%${q_str}%`);
    whereConditions.push(
      `(c.legal_name ILIKE $${pIdx} OR c.trade_name ILIKE $${pIdx} OR c.code ILIKE $${pIdx} OR c.city ILIKE $${pIdx} OR c.state ILIKE $${pIdx})`,
    );
  }
  if (indFilts.length)  whereConditions.push(`c.industry = ANY($${params.push(indFilts)}::text[])`);
  if (zoneFilts.length) whereConditions.push(`tr.zone = ANY($${params.push(zoneFilts)}::text[])`);
  // Country sits on the client, unlike zone which comes from its route. Trimmed
  // on the way in because the column is free text and a stray space would make
  // a value that matches nothing the dropdown could ever offer.
  if (countryFilts.length) whereConditions.push(`btrim(c.country) = ANY($${params.push(countryFilts)}::text[])`);
  if (selFilts.length && !selAll) whereConditions.push(`c.code = ANY($${params.push(selFilts)}::text[])`);
  if (selAll && selEx.length)     whereConditions.push(`c.code <> ALL($${params.push(selEx)}::text[])`);
  if (tierFilts.length) whereConditions.push(`c.tier = ANY($${params.push(tierFilts)}::text[])`);
  if (ctypeFilts.length) whereConditions.push(`c.client_type = ANY($${params.push(ctypeFilts)}::text[])`);
  // The Prospectives tab constrains the list to the two prospective statuses.
  // Any Status pick INTERSECTS with that (so you can narrow to just leads or
  // just enquiry-stage clients); a pick that falls outside — e.g. a stale
  // ?status=ACTIVE left in the URL — is ignored rather than yielding zero rows.
  const effStatus = tab === 'prospective'
    ? (statFilts.filter(s => (PROSPECTIVE_STATUSES as readonly string[]).includes(s)).length
        ? statFilts.filter(s => (PROSPECTIVE_STATUSES as readonly string[]).includes(s))
        : [...PROSPECTIVE_STATUSES])
    : statFilts;
  if (effStatus.length) whereConditions.push(`UPPER(c.status) = ANY($${params.push(effStatus)}::text[])`);
  if (repFilts.length) {
    const rIdx = params.push(repFilts);
    whereConditions.push(
      `EXISTS (SELECT 1 FROM (${clientRepIdsSql('c.id')}) r
                JOIN users u ON u.id = r.user_id WHERE u.name = ANY($${rIdx}::text[]))`,
    );
  }
  if (fyFilts.length)   whereConditions.push(`c.since_year = ANY($${params.push(fyFilts)}::text[])`);
  if (sugarFilt === 'true')  whereConditions.push('c.is_sugar = TRUE');
  if (sugarFilt === 'false') whereConditions.push('(c.is_sugar = FALSE OR c.is_sugar IS NULL)');
  if (revFilts.length) {
    const rExpr = 'COALESCE(rev.lifetime_rev, 0)';
    const conds = REV_BUCKETS.filter(b => revFilts.includes(b.value)).map(b => `(${b.cond(rExpr)})`);
    if (conds.length) whereConditions.push(`(${conds.join(' OR ')})`);
  }
  if (visitFilts.length) {
    const conds = VISIT_BUCKETS.filter(b => visitFilts.includes(b.value)).map(b => `(${b.cond('c.last_visit_date')})`);
    if (conds.length) whereConditions.push(`(${conds.join(' OR ')})`);
  }

  // Per-user visibility — predicate inlines trusted integer ids, no params.
  const visPred = clientVisibilitySql(user, 'c');
  if (visPred) whereConditions.push(`(${visPred})`);

  return { whereClause: whereConditions.join(' AND '), params };
}
