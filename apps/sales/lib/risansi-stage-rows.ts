import 'server-only';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import risansiPool from '@/lib/db-risansi';
import { getCurrentUser, clientScopeSql, OWN_OPEN } from '@/lib/risansi-auth';
import { parseOppFilters, buildOppFilter, repBookSql } from '@/lib/risansi-opp-filters';
import { creditedRepNameSql, CREDITED_REP_JOIN } from '@/lib/risansi-attribution';
import {
  ageBasisSql, applySelection, parseSelection, todayMonthIdx, fyStartIdx,
  type DashStage, type Selection, type StageRow, type MonthActual,
} from '@/lib/risansi-stage-dashboard';

// The rows behind a stage dashboard — one query, one place.
//
// The page and the table's Excel export must agree to the row, so they share
// this. Scope is exactly the board's: the URL filters, the viewer's ownership,
// the in-flight rule. On top of that sits the bar selection (`sel=dim:value`),
// which is applied here too, so an export taken with three bars clicked holds
// the same rows the table showed under them.

export interface StageDashRow extends StageRow {
  product: string; stage: string;
  quote_ref: string | null; client_code: string; tour_name: string | null;
  revised_on: string | null; so_numbers: string | null; po_number: string | null;
  quotation_link: string | null; doc_count: number;
  eta_text: string | null;
  enquiry_date: string | null;
}

export type SearchParams = Record<string, string | string[] | undefined>;

export interface StageRows {
  /** Every row in the stage under the board filters and the viewer's scope. */
  all: StageDashRow[];
  /** `all` narrowed by the bar selection. */
  rows: StageDashRow[];
  sel: Selection;
  todayIdx: number;
  role: string;
}

export async function loadStageRows(stage: DashStage, sp: SearchParams): Promise<StageRows> {
  const session = await getServerSession(authOptions);
  const role    = session?.user?.role ?? 'rep';
  let currentRepId: number | null = session?.user?.repId ?? null;
  if (role === 'rep' && currentRepId == null && session?.user?.email) {
    const r = await risansiPool.query<{ id: number }>(
      'SELECT id FROM users WHERE lower(email) = lower($1) LIMIT 1', [session.user.email]);
    currentRepId = r.rows[0]?.id ?? null;
  }

  // The board's filters ride in on the URL, minus `stage` — this page IS the
  // stage, so a stage param from the board would fight it.
  const filters = parseOppFilters({ ...sp, stage: undefined });
  const showAll = filters.showAllReps || role !== 'rep';
  const scopedRepId = !showAll && filters.rep.length === 0 ? currentRepId : null;
  const built = buildOppFilter(filters, scopedRepId);

  const visUser = await getCurrentUser();
  const ownerVis = clientScopeSql(visUser, 'o.client_id', OWN_OPEN.opportunity('o'));
  // c.deleted_at IS NULL: an archived client's opportunities leave the stage
  // pages and their export with it (lib/risansi-opportunity-scope).
  const where = [`o.stage = $${built.nextIdx}`, 'c.deleted_at IS NULL', ...built.conds, ...(ownerVis ? [ownerVis] : [])].join(' AND ');
  const vals: (string | number | string[])[] = [...built.vals, stage];

  const all = await risansiPool.query<StageDashRow>(`
      SELECT o.id, o.product, o.product_type, o.stage,
             COALESCE(o.value_cr, 0)::float8       AS value_cr,
             o.final_value_cr::float8              AS final_cr,
             o.quote_ref, o.quote_date::text       AS quote_date, o.market,
             o.client_id, c.legal_name AS client_name, c.code AS client_code,
             c.industry, c.client_type,
             -- Rep is the client's owner, which under the attribution rule of
             -- 1 Oct 2026 is the only rep an opportunity has. There used to be
             -- a second name under it — "raised for Akshay" on 422 rows whose
             -- o.rep_id was somebody other than the owner — and it is gone,
             -- because the figure it was qualifying no longer depends on it.
             -- See lib/risansi-attribution.ts.
             ${creditedRepNameSql()} AS rep_name,
             (SELECT tr.name FROM tour_routes tr WHERE tr.id = c.tour_id) AS tour_name,
             o.offer_value_inr::float8             AS offer_inr,
             o.revised_offer_value_inr::float8     AS revised_inr,
             o.revised_offer_date::text            AS revised_on,
             (SELECT count(*) FROM opportunity_offer_revisions v WHERE v.opportunity_id = o.id)::int AS rev_count,
             (SELECT COALESCE(SUM(s.so_value_cr), 0) FROM opportunity_sales_orders s WHERE s.opportunity_id = o.id)::float8 AS so_sum_cr,
             (SELECT string_agg(s.so_number, ', ' ORDER BY s.so_date, s.id) FROM opportunity_sales_orders s WHERE s.opportunity_id = o.id) AS so_numbers,
             o.po_number, o.lost_to_competitor, o.lost_reason, o.drop_reason,
             o.drop_reason_other, o.quotation_link,
             o.eta_text, o.enquiry_date::text AS enquiry_date,
             (SELECT count(*) FROM opportunity_quotation_files qf WHERE qf.opportunity_id = o.id)::int AS doc_count,
             -- Age from the stage's own reference date. opportunity_stage_log is
             -- empty today (migration 0042 created it after years of swallowed
             -- writes), so 'entered' degrades to created_at rather than to null.
             CASE WHEN ${ageBasisSql(stage)} IS NULL THEN NULL
                  ELSE (CURRENT_DATE - ${ageBasisSql(stage)})::int END AS age_days
        FROM opportunities o
        JOIN clients c ON c.id = o.client_id
        ${CREDITED_REP_JOIN()}
       WHERE ${where}
       ORDER BY o.value_cr DESC NULLS LAST, o.id`,
    vals as (string | number)[],
  ).then(r => r.rows.map(x => ({ ...x, value_cr: Number(x.value_cr ?? 0) }))).catch(() => [] as StageDashRow[]);

  const sel = parseSelection(sp.sel);
  const todayIdx = todayMonthIdx();
  return { all, rows: applySelection(all, sel, todayIdx), sel, todayIdx, role };
}

// ── Invoiced revenue for the closed months of this financial year ──────────
//
// The Quoted page's month view opens at April: closed months show what was
// actually invoiced (client_revenue_monthly), the current month onward shows
// what the quotes say will land. Only the client-level filters carry over —
// the client's owner (Rep), industry, client type, and the viewer's scope —
// because a revenue row has no product type, probability or quote date.
export async function loadFyActuals(sp: SearchParams): Promise<Map<number, MonthActual>> {
  const session = await getServerSession(authOptions);
  const role    = session?.user?.role ?? 'rep';
  let currentRepId: number | null = session?.user?.repId ?? null;
  if (role === 'rep' && currentRepId == null && session?.user?.email) {
    const { rows } = await risansiPool.query<{ id: number }>(
      'SELECT id FROM users WHERE lower(email) = lower($1) LIMIT 1', [session.user.email]);
    currentRepId = rows[0]?.id ?? null;
  }
  const f = parseOppFilters({ ...sp, stage: undefined });
  const showAll = f.showAllReps || role !== 'rep';
  const scopedRepId = !showAll && f.rep.length === 0 ? currentRepId : null;

  const conds: string[] = ['c.deleted_at IS NULL'];
  const vals: (string | number | string[])[] = [];
  if (scopedRepId != null) {
    vals.push(scopedRepId);
    conds.push(`(c.primary_rep_id = $${vals.length} OR c.id IN (SELECT client_id FROM client_secondary_reps WHERE rep_id = $${vals.length}))`);
  }
  if (f.rep.length) {
    vals.push(f.rep);
    conds.push(repBookSql(`$${vals.length}::text[]`));
  }
  if (f.industry.length) { vals.push(f.industry); conds.push(`c.industry = ANY($${vals.length}::text[])`); }
  if (f.ctype.length)    { vals.push(f.ctype);    conds.push(`c.client_type = ANY($${vals.length}::text[])`); }
  const vis = clientScopeSql(await getCurrentUser(), 'c.id');
  if (vis) conds.push(vis);

  const todayIdx = todayMonthIdx();
  const start = fyStartIdx(todayIdx);
  const from = `${Math.floor(start / 12)}-${String(start % 12 + 1).padStart(2, '0')}-01`;
  const to   = `${Math.floor(todayIdx / 12)}-${String(todayIdx % 12 + 1).padStart(2, '0')}-01`;
  vals.push(from, to);
  const { rows } = await risansiPool.query<{ ym: string; cr: string; n: string }>(
    `SELECT to_char(date_trunc('month', r.month), 'YYYY-MM') AS ym,
            (COALESCE(sum(r.total_value), 0) / 10000000)::text AS cr,
            count(DISTINCT r.client_id)::text AS n
       FROM client_revenue_monthly r JOIN clients c ON c.id = r.client_id
      WHERE ${conds.join(' AND ')} AND r.month >= $${vals.length - 1}::date AND r.month < $${vals.length}::date
      GROUP BY 1`, vals as (string | number)[],
  ).catch(() => ({ rows: [] as { ym: string; cr: string; n: string }[] }));
  const out = new Map<number, MonthActual>();
  for (const r of rows) {
    const [y, m] = r.ym.split('-').map(Number);
    out.set(y * 12 + (m - 1), { valueCr: Number(r.cr), count: Number(r.n) });
  }
  return out;
}
