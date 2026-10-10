'use server';

import risansiPool from '@/lib/db-risansi';
import {
  getCurrentUser, getReviewableRepIds, clientVisibilitySql, clientScopeSql, OWN_OPEN,
} from '@/lib/risansi-auth';
import {
  CANON, CAT_OTHER, CAT_OTHER_SQL, execScopeSql, fyWindows, parseFy, TURNOVER_BAND_CASE, TURNOVER_REV_CTE,
  STAGE_TO_OFFER, CONVERSION_STAGES, conversionWhereSql, OPP_WINDOW_DATE, OPEN_STAGES,
  type AccountScope,
} from '@/lib/risansi-exec-review';

// What is behind a number on the Executive Review.
//
// Every figure on that page is a sum or a count over a set of clients, and until
// now the set was the one thing you could not see. "₹1,36,76,782 active on Direct
// Mill" is only actionable once you know which mills, so this returns the rows
// the aggregate was built from — same scope, same windows, same bands, because
// both sides import them from lib/risansi-exec-review.ts.
//
// Read-only, and re-derives the viewer's own scope from the session rather than
// trusting anything the browser sends. The tsm parameter says whose review to
// open, not what may be seen: getReviewableRepIds decides the first, and the
// viewer's clientVisibilitySql still bounds the second.

export interface DrillRow {
  clientId: number;
  code: string;
  name: string;
  value: number | null;   // rupees, or null for a count-only list
  detail?: string | null; // a second line — stage, date, purpose
}

export interface DrillResult {
  title: string;
  subtitle: string;
  /** 'money' prints a rupee total; 'count' just says how many. */
  unit: 'money' | 'count';
  rows: DrillRow[];
  total: number;
}

export type DrillKind =
  | 'order_in_hand' | 'revenue'
  | 'active_clients' | 'active_visited' | 'active_overdue' | 'active_never'
  | 'prospective' | 'prospective_visited' | 'prospective_lead' | 'prospective_client'
  | 'clients_by_type' | 'quotation' | 'turnover' | 'offer_status'
  | 'attendance_visits' | 'attendance_clients' | 'conversion' | 'outside_window';

export interface DrillParams {
  kind: DrillKind;
  tsm: string;
  /**
   * The FY start year the page is showing. Without it the drill-down anchors on
   * the current year and a review of FY 25-26 opens lists from FY 26-27.
   */
  fy?: string;
  scope?: string;      // 'own' | 'all' | 'covered'
  /** Row key: client type, channel, turnover band, offer status, or 'YYYY-MM'. */
  key?: string;
  /** Column key for the quotation and turnover tables. */
  col?: string;
}

const money = (v: unknown) => (v == null ? 0 : Number(v));

export async function execDrilldown(p: DrillParams): Promise<DrillResult | null> {
  const me = await getCurrentUser();
  if (!me.email) return null;

  const tsmId = Number(p.tsm);
  if (!Number.isInteger(tsmId) || tsmId <= 0) return null;

  // May this viewer open this person's review at all? Same gate as the page.
  const allowed = await getReviewableRepIds(me);
  if (allowed !== null && !allowed.includes(tsmId)) return null;

  const vis = clientVisibilitySql(me, 'c');
  const visAnd = vis ? ` AND (${vis})` : '';
  // Owned + covered is the default here because it is the default on the page:
  // a drill-down that scoped narrower than the tile it came from would list
  // fewer rows than the number it claims to explain.
  const accountScope: AccountScope =
    p.scope === 'own' ? 'own' : p.scope === 'covered' ? 'covered' : 'all';
  const scope = execScopeSql(tsmId, accountScope, visAnd);
  // parseFy rejects anything the selector would not offer, so a hand-typed year
  // cannot widen the window; the page and this list then share one definition.
  const now = new Date();
  const w = fyWindows(now, parseFy(p.fy, now));

  const who = (await risansiPool.query<{ name: string }>(
    'SELECT name FROM users WHERE id = $1', [tsmId])).rows[0]?.name ?? 'this TSM';
  const sub = `${who} · ${accountScope === 'all' ? 'owned + covered accounts'
    : accountScope === 'covered' ? 'accounts they cover for others' : 'accounts they own'}`;

  const esc = (s: string) => s.replace(/'/g, "''");
  const key = p.key ? esc(p.key) : '';

  // Every branch returns rows already sorted biggest-first, which is what the
  // reader is looking for: the popup answers "who is this made of", and that
  // question is almost always really "who is most of it".
  const run = async (sql: string, params: unknown[] = []) =>
    (await risansiPool.query<{ id: number; code: string; name: string; value: string | null; detail: string | null }>(
      sql, params as never[])).rows.map(r => ({
        clientId: Number(r.id), code: r.code, name: r.name,
        value: r.value == null ? null : Number(r.value), detail: r.detail,
      }));

  const CLIENT_LIST = (cond: string) => `
    SELECT c.id, c.code, c.legal_name AS name, NULL::numeric AS value,
           CASE WHEN c.last_visit_date IS NULL THEN 'never visited'
                ELSE 'last visit ' || to_char(c.last_visit_date, 'DD Mon YYYY') END AS detail
      FROM clients c
     WHERE ${scope} AND c.deleted_at IS NULL AND ${cond}
     ORDER BY c.last_visit_date ASC NULLS FIRST, c.legal_name`;

  try {
    switch (p.kind) {
      // ── the two value KPIs ────────────────────────────────────
      case 'order_in_hand': {
        const rows = await run(`
          SELECT c.id, c.code, c.legal_name AS name,
                 round(sum(GREATEST(
                   COALESCE(o.final_value_cr*10000000, o.value_cr*10000000, 0)
                   - COALESCE((SELECT sum(so.so_value_cr)*10000000 FROM opportunity_sales_orders so
                                WHERE so.opportunity_id = o.id), 0), 0))) AS value,
                 count(*)::text || ' won opportunit' || CASE WHEN count(*) = 1 THEN 'y' ELSE 'ies' END AS detail
            FROM opportunities o JOIN clients c ON c.id = o.client_id
           WHERE ${scope} AND o.stage = 'Won'
             AND ${w.inMonths(OPP_WINDOW_DATE)}
           GROUP BY c.id, c.code, c.legal_name
          HAVING round(sum(GREATEST(
                   COALESCE(o.final_value_cr*10000000, o.value_cr*10000000, 0)
                   - COALESCE((SELECT sum(so.so_value_cr)*10000000 FROM opportunity_sales_orders so
                                WHERE so.opportunity_id = o.id), 0), 0))) > 0
           ORDER BY value DESC`);
        return { title: 'Order in hand', subtitle: sub, unit: 'money', rows, total: rows.reduce((s, r) => s + money(r.value), 0) };
      }

      case 'revenue': {
        const rows = await run(`
          SELECT c.id, c.code, c.legal_name AS name, round(sum(r.total_value)) AS value,
                 count(DISTINCT r.month)::text || ' month(s) invoiced' AS detail
            FROM client_revenue_monthly r JOIN clients c ON c.id = r.client_id
           WHERE ${scope} AND ${w.inMonths('r.month')}
           GROUP BY c.id, c.code, c.legal_name
          HAVING sum(r.total_value) <> 0
           ORDER BY value DESC`);
        return {
          title: `Revenue · FY ${w.fy}${w.toDate ? ' to date' : ''}`,
          subtitle: `${sub} · every status, as invoiced`,
          unit: 'money', rows, total: rows.reduce((s, r) => s + money(r.value), 0),
        };
      }

      // ── the client-count KPIs ─────────────────────────────────
      case 'active_clients':
      case 'active_visited':
      case 'active_overdue':
      case 'active_never':
      case 'prospective':
      case 'prospective_visited':
      case 'prospective_lead':
      case 'prospective_client': {
        const COND: Record<string, [string, string]> = {
          active_clients:      [`c.status='ACTIVE'`, 'Active clients'],
          active_visited:      [`c.status='ACTIVE' AND c.last_visit_date >= CURRENT_DATE - INTERVAL '90 days'`, 'Active · visited in 90 days'],
          active_overdue:      [`c.status='ACTIVE' AND c.last_visit_date IS NOT NULL AND c.last_visit_date < CURRENT_DATE - INTERVAL '90 days'`, 'Active · overdue a visit'],
          active_never:        [`c.status='ACTIVE' AND c.last_visit_date IS NULL`, 'Active · never visited'],
          prospective:         [`c.status IN ('PROSPECTIVE_LEAD','PROSPECTIVE_CLIENT')`, 'Prospective'],
          prospective_visited: [`c.status IN ('PROSPECTIVE_LEAD','PROSPECTIVE_CLIENT') AND c.last_visit_date >= CURRENT_DATE - INTERVAL '90 days'`, 'Prospective · visited in 90 days'],
          prospective_lead:    [`c.status='PROSPECTIVE_LEAD'`, 'Prospective leads'],
          prospective_client:  [`c.status='PROSPECTIVE_CLIENT'`, 'Prospective clients'],
        };
        const [cond, title] = COND[p.kind];
        const rows = await run(CLIENT_LIST(cond));
        return { title, subtitle: sub, unit: 'count', rows, total: rows.length };
      }

      // ── Clients Summary: one client type ──────────────────────
      case 'clients_by_type': {
        const COL: Record<string, [string, string]> = {
          active:             [`c.status='ACTIVE'`, 'active clients'],
          prospective_client: [`c.status='PROSPECTIVE_CLIENT'`, 'prospective clients'],
          prospective_lead:   [`c.status='PROSPECTIVE_LEAD'`, 'prospective leads'],
          // Kept for links saved before the column was split in two.
          prospective:        [`c.status IN ('PROSPECTIVE_LEAD','PROSPECTIVE_CLIENT')`, 'prospective clients'],
          inactive:           [`c.status IN ('INACTIVE','CLOSED')`, 'inactive & closed clients'],
          total:              [`c.status <> 'DUPLICATE'`, 'all clients'],
        };
        const [cond, label] = COL[p.col ?? 'active'] ?? COL.active;
        // The catch-all row is "everything CATS did not claim", so its drill-down
        // has to be the same negation rather than an equality on 'Other' — else
        // a bucket added to CANON later would be in the figure and not the list.
        const bucket = p.key === CAT_OTHER ? CAT_OTHER_SQL : `${CANON} = '${key}'`;
        const rows = await run(CLIENT_LIST(`${cond} AND ${bucket}`));
        return { title: `${p.key} · ${label}`, subtitle: sub, unit: 'count', rows, total: rows.length };
      }

      // ── Quotation Summary: channel x active / order received ──
      case 'quotation': {
        const stageCond = p.col === 'won'
          ? `o.stage = 'Won'`
          : p.col === 'active' ? `o.stage IN ('Quoted','Negotiating')`
          : `o.stage IN ('Quoted','Negotiating','Won')`;
        const label = p.col === 'won' ? 'Order received' : p.col === 'active' ? 'Active' : 'Total';
        const rows = await run(`
          SELECT c.id, c.code, c.legal_name AS name, round(sum(o.offer_value_inr)) AS value,
                 string_agg(DISTINCT o.stage, ', ') AS detail
            FROM opportunities o JOIN clients c ON c.id = o.client_id
           WHERE ${scope} AND ${stageCond}
             AND ${w.inMonths(OPP_WINDOW_DATE)}
             AND ${p.key === CAT_OTHER ? CAT_OTHER_SQL : `${CANON} = '${key}'`}
           GROUP BY c.id, c.code, c.legal_name
          HAVING sum(o.offer_value_inr) IS NOT NULL
           ORDER BY value DESC`);
        return { title: `${p.key} · ${label}`, subtitle: sub, unit: 'money', rows, total: rows.reduce((s, r) => s + money(r.value), 0) };
      }

      // ── Target & Conversion: one stage of the quoted pipeline, or all of it ──
      case 'conversion': {
        const all = p.key === 'total' || !p.key;
        if (!all && !(CONVERSION_STAGES as readonly string[]).includes(p.key!)) return null;
        const stages = all ? CONVERSION_STAGES : [p.key!];
        const rows = await run(`
          SELECT c.id, c.code, c.legal_name AS name, round(sum(COALESCE(o.offer_value_inr,0))) AS value,
                 count(*)::text || ' · ' || string_agg(DISTINCT o.stage, ', ') AS detail
            FROM opportunities o JOIN clients c ON c.id = o.client_id
           WHERE ${scope} AND ${conversionWhereSql(stages)}
             AND ${w.inMonths(OPP_WINDOW_DATE)}
           GROUP BY c.id, c.code, c.legal_name
          HAVING sum(COALESCE(o.offer_value_inr,0)) <> 0
           ORDER BY value DESC`);
        return {
          title: all ? 'Total quoted · the conversion denominator' : `${p.key} · offer value`,
          subtitle: `${sub} · budgetary enquiries excluded`,
          unit: 'money', rows, total: rows.reduce((s, r) => s + money(r.value), 0),
        };
      }

      // ── What the fiscal-year window leaves out ───────────────
      // Every stage, because the window governs every opportunity panel on the
      // page. The detail line carries the stage and the date it is windowed on,
      // which is the thing that surprises people: a quotation dated in one year
      // and entered in the next.
      case 'outside_window': {
        const open = OPEN_STAGES.map(s => `'${s}'`).join(',');
        const rows = await run(`
          SELECT c.id, c.code, c.legal_name AS name, round(sum(COALESCE(o.offer_value_inr,0))) AS value,
                 string_agg(DISTINCT o.stage || ' · ' ||
                   COALESCE(to_char(${OPP_WINDOW_DATE}, 'DD Mon YYYY'), 'no date')
                   || CASE WHEN o.stage IN (${open}) THEN ' · still open' ELSE '' END, '; ') AS detail
            FROM opportunities o JOIN clients c ON c.id = o.client_id
           WHERE ${scope} AND ${w.outsideMonths(OPP_WINDOW_DATE)}
           GROUP BY c.id, c.code, c.legal_name
           ORDER BY value DESC NULLS LAST`);
        return {
          title: `Outside FY ${w.fy} · in no figure on the page`,
          subtitle: `${sub} · windowed on the quote date, else the day the record was made`,
          unit: 'money', rows, total: rows.reduce((s, r) => s + money(r.value), 0),
        };
      }

      // ── Turnover Summary: band x fiscal year ──────────────────
      case 'turnover': {
        const col = ['fyc', 'f1', 'f2', 'f3'].includes(p.col ?? '') ? p.col! : 'clients';
        const valueExpr = col === 'clients' ? 'NULL::numeric' : `round(b.${col})`;
        const rows = await run(`
          WITH rev AS (${TURNOVER_REV_CTE(scope, w)}),
               b AS (SELECT *, ${TURNOVER_BAND_CASE(w.fy, w.d)} bucket FROM rev)
          SELECT b.id, b.code, b.legal_name AS name, ${valueExpr} AS value,
                 'FY ' || ${w.fy} || ' to date: ' || round(b.fyc)::text AS detail
            FROM b WHERE b.bucket = '${key}'
           ORDER BY ${col === 'clients' ? 'b.fyc DESC' : `b.${col} DESC`}, b.legal_name`);
        const label = col === 'clients' ? 'clients' : col === 'fyc' ? `FY ${w.fy} to date` : `FY ${w.fy - Number(col.slice(1))}`;
        return {
          title: `${p.key} · ${label}`, subtitle: sub,
          unit: col === 'clients' ? 'count' : 'money',
          rows, total: col === 'clients' ? rows.length : rows.reduce((s, r) => s + money(r.value), 0),
        };
      }

      // ── Offer Status ──────────────────────────────────────────
      case 'offer_status': {
        const stages = Object.entries(STAGE_TO_OFFER).filter(([, v]) => v === p.key).map(([k]) => k);
        if (!stages.length) return null;
        const rows = await run(`
          SELECT c.id, c.code, c.legal_name AS name, round(sum(o.offer_value_inr)) AS value,
                 count(*)::text || ' opportunit' || CASE WHEN count(*) = 1 THEN 'y' ELSE 'ies' END AS detail
            FROM opportunities o JOIN clients c ON c.id = o.client_id
           WHERE ${scope} AND o.stage IN (${stages.map(s => `'${esc(s)}'`).join(',')})
             AND ${w.inMonths(OPP_WINDOW_DATE)}
           GROUP BY c.id, c.code, c.legal_name
          HAVING sum(o.offer_value_inr) IS NOT NULL
           ORDER BY value DESC`);
        return { title: `${p.key} · offer value`, subtitle: sub, unit: 'money', rows, total: rows.reduce((s, r) => s + money(r.value), 0) };
      }

      // ── Attendance ────────────────────────────────────────────
      // Scoped by the visit, not the client: attendance is the rep's own activity
      // record, and a visit they made to a client that has since moved to a
      // colleague is still a day they worked.
      case 'attendance_visits':
      case 'attendance_clients': {
        const selfReview = me.id != null && Number(me.id) === tsmId;
        const vScope = selfReview ? null : clientScopeSql(me, 'v.client_id', OWN_OPEN.visit('v'));
        const vAnd = vScope ? ` AND (${vScope})` : '';
        if (!/^\d{4}-\d{2}$/.test(p.key ?? '')) return null;

        if (p.kind === 'attendance_visits') {
          const rows = await run(`
            SELECT c.id, c.code, c.legal_name AS name, NULL::numeric AS value,
                   to_char(v.visit_date, 'DD Mon') || ' · ' || COALESCE(NULLIF(v.purpose,''), v.status) AS detail
              FROM visits v JOIN clients c ON c.id = v.client_id
             WHERE v.rep_id = ${tsmId} AND to_char(v.visit_date,'YYYY-MM') = '${key}'${vAnd}
             ORDER BY v.visit_date DESC, c.legal_name`);
          return { title: `Visits · ${p.key}`, subtitle: `${who} · field activity`, unit: 'count', rows, total: rows.length };
        }
        const rows = await run(`
          SELECT c.id, c.code, c.legal_name AS name, NULL::numeric AS value,
                 count(*)::text || ' visit(s)' AS detail
            FROM visits v JOIN clients c ON c.id = v.client_id
           WHERE v.rep_id = ${tsmId} AND to_char(v.visit_date,'YYYY-MM') = '${key}'${vAnd}
           GROUP BY c.id, c.code, c.legal_name
           ORDER BY count(*) DESC, c.legal_name`);
        return { title: `Clients visited · ${p.key}`, subtitle: `${who} · field activity`, unit: 'count', rows, total: rows.length };
      }
    }
  } catch (e) {
    console.error('[execDrilldown]', p, e);
    return null;
  }
  return null;
}
