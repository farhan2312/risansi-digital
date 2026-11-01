'use server';

import risansiPool from '@/lib/db-risansi';
import { getCurrentUser, hasRole } from '@/lib/risansi-auth';
import type { DrillRow } from '@/lib/risansi-drill-row';
import {
  BOOKED_VALUE, CR, INR_TO_L, OPEN_STAGES, PIPELINE_STAGES, PCP_COLUMNS, OTHERS_PCP,
  SO_SUM_JOIN, IN_HAND_CR, BOOKED_CR,
  activeClientWhere, atRiskExposureOn, atRiskWhere, dashScope, dashWindows,
  fyCodeWindow, overdueClientWhere, repPipelineWhere, revBetweenSql, revClientWhere,
  revMonthsSql, stageWhere, visitsThisWeekWhere, wonClientWhere,
} from '@/lib/risansi-dashboard';
import { targetHolders, teamsByManager } from '@/lib/risansi-rep-targets';

// What is behind a number on the landing dashboard.
//
// The sibling of app/actions/risansi-exec-drilldown.ts, for the page the portal
// opens on. Every figure there is a sum or a count over a set of clients, and
// the set was the one thing you could not see: "₹4.21 Cr open pipeline" is only
// actionable once you know which accounts. Each branch below builds its WHERE
// from lib/risansi-dashboard.ts — the same fragment the tile itself used — so a
// breakdown cannot list a different population from the number above it.
//
// Read-only, and the viewer's scope is re-derived from the session on every
// call. The browser says which figure to itemise; it never says whose rows to
// include.


/**
 * How to print the total and each row, picked so the modal's headline reads
 * character-for-character like the figure that was clicked.
 *
 * 'inr' is the auto-scaling formatRev the hero card and the mix bars use, 'lakh'
 * the fmtL of the market split, 'cr' the fmtCr of the opportunity tiles.
 */
export type DashUnit = 'inr' | 'lakh' | 'cr' | 'count' | 'units';

export interface DashDrillResult {
  title: string;
  subtitle: string;
  unit: DashUnit;
  rows: DrillRow[];
  /** In the unit above: rupees for 'inr', lakhs for 'lakh', crores for 'cr'. */
  total: number;
  /** A second count the same list also explains — "148 opportunities", say. */
  secondary?: string;
}

export type DashDrillKind =
  // ── the full (admin) dashboard ──
  | 'rev_fy' | 'rev_delta' | 'rev_fy_bar' | 'rev_market' | 'segment'
  | 'pipeline' | 'stage' | 'order_in_hand' | 'order_booked'
  | 'at_risk' | 'market_supplier'
  // ── the personal (rep / manager) dashboard ──
  | 'my_revenue' | 'my_visits_week' | 'my_overdue' | 'my_clients' | 'my_pipeline'
  // ── the Targets table, on both dashboards ──
  | 'target_revenue' | 'target_new_clients' | 'target_visits';

export interface DashDrillParams {
  kind: DashDrillKind;
  /** Row key: a stage, an industry, a supplier, 'Domestic' / 'Export', 'FY26'. */
  key?: string;
  /**
   * Targets only: whose row was clicked.
   *
   * `rep` is one person's id; `rollup` is the All reps or Your team row. The
   * id is checked against what the viewer may see rather than trusted — the
   * browser says which row, never whose rows to include.
   */
  rep?: number;
  rollup?: 'all' | 'team';
}

/**
 * The figures that only ever appear on the admin dashboard.
 *
 * Three of them — booked revenue, its year-on-year bars and the installed base —
 * read their tables with no client predicate at all, because they are the
 * company's book rather than a filtered view of it. That is correct for the page
 * (reps and managers are sent to the personal view instead) and would be a leak
 * here, so the gate is the same one the page uses to choose which dashboard to
 * render.
 */
const ADMIN_ONLY = new Set<DashDrillKind>([
  'rev_fy', 'rev_delta', 'rev_fy_bar', 'rev_market', 'segment',
  'pipeline', 'stage', 'order_in_hand', 'order_booked', 'at_risk', 'market_supplier',
]);

const num = (v: unknown) => (v == null ? 0 : Number(v));
const sum = (rows: DrillRow[]) => rows.reduce((t, r) => t + num(r.value), 0);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * Why a failure here is recorded rather than only logged.
 *
 * Every tile on the landing dashboard was coming back 500 and the panel could
 * only say "could not be loaded". The switch below has always caught its own
 * errors, so whatever was throwing was throwing somewhere this function could
 * not see — and the one place the message existed was a Vercel function log
 * nobody reading the dashboard can open. So it goes in audit_log, where the
 * person who hit it can be told what it was.
 *
 * Never throws on its own account: a drill-down that cannot explain its failure
 * must still fail quietly rather than turning one broken figure into two.
 */
async function recordDrillFailure(p: DashDrillParams, email: string | null, e: unknown) {
  const err = e instanceof Error ? e : new Error(String(e));
  console.error('[dashDrilldown]', p, err);
  try {
    await risansiPool.query(
      `INSERT INTO audit_log (actor_email, action, entity_type, entity_id, entity_label, summary, metadata)
       VALUES ($1, 'dashboard.drilldown.error', 'dashboard', $2, $3, $4, $5::jsonb)`,
      [email, p.kind, p.key ?? null, `${err.name}: ${err.message}`.slice(0, 500),
        JSON.stringify({
          params: p, name: err.name, message: err.message,
          stack: (err.stack ?? '').split('\n').slice(0, 12).join('\n'),
          cause: err.cause instanceof Error ? `${err.cause.name}: ${err.cause.message}` : null,
        })],
    );
  } catch (logErr) {
    console.error('[dashDrilldown] could not record the failure either', logErr);
  }
}

/**
 * Whose rows a Targets drill-down may list, and what to call them.
 *
 * The browser sends which ROW was clicked. It does not get to send whose
 * records to include: a rep id arriving from the page is only honoured when
 * it is the viewer's own, somebody on their team, or the viewer is an admin.
 * Null means "not yours to itemise", and the panel says so.
 */
async function targetAudience(
  p: DashDrillParams,
  me: { id: number | null; role: string },
): Promise<{ ids: number[]; label: string } | null> {
  const mine = me.id == null ? null : Number(me.id);

  if (p.rollup === 'all') {
    if (!hasRole(me.role, 'admin')) return null;
    const ids = (await targetHolders()).map(h => Number(h.id)).filter(Number.isInteger);
    return ids.length ? { ids, label: 'All reps' } : null;
  }

  if (p.rollup === 'team') {
    if (mine == null) return null;
    const team = ((await teamsByManager()).get(mine) ?? []).map(Number).filter(Number.isInteger);
    return team.length ? { ids: team, label: 'Your team' } : null;
  }

  const id = Number(p.rep);
  if (!Number.isInteger(id) || id <= 0) return null;
  let allowed = hasRole(me.role, 'admin') || id === mine;
  if (!allowed && mine != null) {
    allowed = ((await teamsByManager()).get(mine) ?? []).some(r => Number(r) === id);
  }
  if (!allowed) return null;
  const holder = (await targetHolders()).find(h => Number(h.id) === id);
  return { ids: [id], label: holder?.name ?? 'This rep' };
}

export async function dashDrilldown(p: DashDrillParams): Promise<DashDrillResult | null> {
  // The preamble is inside the guard too.
  //
  // It used to sit outside it, which is how every tile on this dashboard came
  // to answer 500 rather than null: the switch below catches its own errors,
  // but a throw in getCurrentUser, dashScope or dashWindows went straight past
  // and out of the action, and an uncaught server action is a 500 whatever the
  // caller does with it.
  let me: Awaited<ReturnType<typeof getCurrentUser>>;
  let s: ReturnType<typeof dashScope>;
  let w: ReturnType<typeof dashWindows>;
  try {
    me = await getCurrentUser();
    if (!me.email) return null;
    if (ADMIN_ONLY.has(p.kind) && !hasRole(me.role, 'admin')) return null;
    s = dashScope(me);
    w = dashWindows();
  } catch (e) {
    await recordDrillFailure(p, null, e);
    return null;
  }
  const key = (p.key ?? '').trim();

  // Every branch returns rows biggest-first, which is what the reader is looking
  // for: the popup answers "who is this made of", and that question is almost
  // always really "who is most of it".
  const run = async (sql: string): Promise<DrillRow[]> =>
    (await risansiPool.query<{ id: number | null; code: string | null; name: string | null; value: string | null; detail: string | null }>(sql))
      .rows.map(r => ({
        clientId: Number(r.id ?? 0),
        code: r.code ?? '—',
        name: r.name ?? 'Unattributed',
        value: r.value == null ? null : Number(r.value),
        detail: r.detail,
      }));

  /**
   * A per-client revenue list over one month window.
   *
   * The join side matters and is not cosmetic. The hero card totals
   * client_revenue_monthly without touching `clients` at all, so a row whose
   * client_id points nowhere still counts towards that number; a LEFT JOIN keeps
   * it in the list as Unattributed rather than leaving the breakdown short of
   * the figure it explains. The panels that name a client — the mix, the market
   * split, the rep's own revenue — inner-join for exactly the same reason in
   * reverse: their figure already excluded those rows.
   */
  const revList = (where: string, join: 'left' | 'inner' = 'left', measure = 'crm.total_value') => `
    SELECT c.id, c.code, c.legal_name AS name, round(sum(${measure})) AS value,
           count(DISTINCT crm.month)::text || ' month(s) invoiced' AS detail
      FROM client_revenue_monthly crm
      ${join === 'left' ? 'LEFT JOIN' : 'JOIN'} clients c ON c.id = crm.client_id
     WHERE ${where}
     GROUP BY c.id, c.code, c.legal_name
    HAVING sum(${measure}) <> 0
     ORDER BY value DESC NULLS LAST`;

  try {
    switch (p.kind) {
      // ── Hero card: booked revenue ─────────────────────────────
      case 'rev_fy': {
        const rows = await run(revList(revMonthsSql(w, 'cy'), 'left', BOOKED_VALUE()));
        return {
          title: `Booked revenue · ${w.fyLabel}`,
          subtitle: 'Every invoice line in the fiscal year to date, by account',
          unit: 'inr', rows, total: sum(rows),
        };
      }

      // The delta is a difference, so each row is one too: this year minus last,
      // per account. It adds up to the "vs PY" figure, and it answers the
      // question that figure provokes — who grew, and who went quiet.
      case 'rev_delta': {
        // Each leg takes the measure its own half of the tile took: Total
        // Booked is pump + spare, the previous-FY figure beside it is
        // total_value, and the delta is the one minus the other.
        const cy = `sum(CASE WHEN ${revMonthsSql(w, 'cy')} THEN ${BOOKED_VALUE()} ELSE 0 END)`;
        const py = `sum(CASE WHEN ${revMonthsSql(w, 'py')} THEN crm.total_value ELSE 0 END)`;
        const rows = await run(`
          SELECT c.id, c.code, c.legal_name AS name,
                 round(${cy} - ${py}) AS value,
                 'this FY ' || round(${cy})::text || ' · last FY ' || round(${py})::text AS detail
            FROM client_revenue_monthly crm
            LEFT JOIN clients c ON c.id = crm.client_id
           WHERE ${revMonthsSql(w, 'cy')} OR ${revMonthsSql(w, 'py')}
           GROUP BY c.id, c.code, c.legal_name
          HAVING ${cy} - ${py} <> 0
           ORDER BY value DESC`);
        const gained = rows.filter(r => num(r.value) > 0).length;
        return {
          title: `Movement vs last FY`,
          subtitle: `${w.fyLabel} booked minus the same measure a year earlier, by account`,
          unit: 'inr', rows, total: sum(rows),
          secondary: `${gained} up · ${rows.length - gained} down`,
        };
      }

      // One bar on the year-on-year chart.
      case 'rev_fy_bar': {
        const win = fyCodeWindow(key);
        if (!win) return null;
        const rows = await run(revList(revBetweenSql(win.start, win.end)));
        return {
          title: `Booked revenue · ${key}`,
          subtitle: `April ${win.start.slice(0, 4)} to March ${win.end.slice(0, 4)}, by account`,
          unit: 'inr', rows, total: sum(rows),
        };
      }

      // ── Domestic / Export split ───────────────────────────────
      case 'rev_market': {
        if (key !== 'Domestic' && key !== 'Export') return null;
        const rows = await run(revList(
          `${revClientWhere(w, s)} AND c.market_type = '${key}'`, 'inner'));
        return {
          title: `${key} revenue · ${w.fyLabel}`,
          subtitle: 'Booked in the fiscal year to date, by account',
          unit: 'lakh', rows: rows.map(r => ({ ...r, value: num(r.value) / INR_TO_L })),
          total: sum(rows) / INR_TO_L,
        };
      }

      // ── Revenue mix: one industry segment ─────────────────────
      case 'segment': {
        // 'Other' on the chart is the COALESCE bucket, so it has to match the
        // NULLs as well as the literal string.
        const match = key === 'Other'
          ? `COALESCE(c.industry, 'Other') = 'Other'`
          : `c.industry = '${key.replace(/'/g, "''")}'`;
        const rows = await run(revList(`${revClientWhere(w, s)} AND ${match}`, 'inner'));
        return {
          title: `${key} · ${w.fyLabel} revenue`,
          subtitle: 'Booked in the fiscal year to date, by account',
          unit: 'inr', rows, total: sum(rows),
        };
      }

      // ── Opportunities ─────────────────────────────────────────
      case 'pipeline':
      case 'stage': {
        const stages = p.kind === 'pipeline'
          ? [...PIPELINE_STAGES]
          : ([...OPEN_STAGES, 'Won'] as string[]).includes(key) ? [key] : null;
        if (!stages) return null;
        const rows = await run(`
          SELECT c.id, c.code, c.legal_name AS name, sum(o.value_cr) AS value,
                 count(*)::text || ' opportunit' || CASE WHEN count(*) = 1 THEN 'y' ELSE 'ies' END
                   || ' · ' || string_agg(DISTINCT o.stage, ', ') AS detail
            FROM opportunities o JOIN clients c ON c.id = o.client_id
           WHERE ${stageWhere(s, stages)}
           GROUP BY c.id, c.code, c.legal_name
           ORDER BY value DESC NULLS LAST`);
        const opps = (await risansiPool.query<{ n: string }>(
          `SELECT count(*)::text AS n FROM opportunities o WHERE ${stageWhere(s, stages)}`)).rows[0]?.n ?? '0';
        return {
          title: p.kind === 'pipeline' ? 'Open pipeline · Quoted + Negotiating' : `${key} opportunities`,
          subtitle: 'Opportunity value at 100%, by account',
          unit: 'cr', rows, total: sum(rows),
          secondary: plural(Number(opps), 'opportunity', 'opportunities'),
        };
      }

      case 'order_in_hand':
      case 'order_booked': {
        const expr = p.kind === 'order_in_hand' ? IN_HAND_CR : BOOKED_CR;
        const rows = await run(`
          SELECT c.id, c.code, c.legal_name AS name, sum(${expr}) AS value,
                 count(*) FILTER (WHERE ${expr} > 0)::text || ' won opportunit'
                   || CASE WHEN count(*) FILTER (WHERE ${expr} > 0) = 1 THEN 'y' ELSE 'ies' END AS detail
            FROM opportunities o
            JOIN clients c ON c.id = o.client_id
            ${SO_SUM_JOIN}
           WHERE ${wonClientWhere(s)}
           GROUP BY c.id, c.code, c.legal_name
          HAVING sum(${expr}) > 0
           ORDER BY value DESC`);
        return {
          title: p.kind === 'order_in_hand' ? 'Order in hand' : 'Order booked',
          subtitle: p.kind === 'order_in_hand'
            ? 'Won, not yet written into a Sales Order'
            : 'Won value already in Sales Orders',
          unit: 'cr', rows, total: sum(rows),
        };
      }

      // ── At-risk accounts ──────────────────────────────────────
      // One row per account, so the list length is the count on the tile and the
      // sum of the values is the exposure printed beside it.
      case 'at_risk': {
        const rows = await run(`
          SELECT c.id, c.code, c.legal_name AS name,
                 round(COALESCE(sum(crm.total_value), 0)) AS value,
                 CASE WHEN c.last_visit_date IS NULL THEN 'never visited'
                      ELSE 'last visit ' || to_char(c.last_visit_date, 'DD Mon YYYY') END AS detail
            FROM clients c
            LEFT JOIN client_revenue_monthly crm
              ON crm.client_id = c.id AND ${atRiskExposureOn(w)}
           WHERE ${atRiskWhere(s)}
           GROUP BY c.id, c.code, c.legal_name, c.last_visit_date
           ORDER BY value DESC, c.legal_name`);
        return {
          title: 'At-risk accounts',
          subtitle: 'Bought from us at some point · no visit in 18 months',
          unit: 'inr', rows, total: sum(rows),
          secondary: plural(rows.length, 'account'),
        };
      }

      // ── PCP installed base ────────────────────────────────────
      case 'market_supplier': {
        const col = key === 'Others' ? OTHERS_PCP
          : key === 'Total' ? 'COALESCE(total_pcp,0)'
          : PCP_COLUMNS[key] ? `COALESCE(${PCP_COLUMNS[key]},0)` : null;
        if (!col) return null;
        // The assessment sheet carries its own client code and name, and some
        // rows were never matched to an account. Those are real units and stay
        // in the list under the name the field gave them.
        const rows = await run(`
          SELECT c.id, COALESCE(c.code, cib.client_code) AS code,
                 COALESCE(c.legal_name, cib.client_name) AS name,
                 sum(${col}) AS value,
                 'of ' || sum(COALESCE(cib.total_pcp,0))::text || ' PCP on site' AS detail
            FROM competitor_installed_base cib
            LEFT JOIN clients c ON c.id = cib.client_id
           GROUP BY c.id, COALESCE(c.code, cib.client_code), COALESCE(c.legal_name, cib.client_name)
          HAVING sum(${col}) > 0
           ORDER BY value DESC`);
        return {
          title: key === 'Total' ? 'PCP installed base · all suppliers' : `${key} · PCP installed base`,
          subtitle: 'Pumps counted by the field during equipment assessments',
          unit: 'units', rows, total: sum(rows),
          secondary: plural(rows.length, 'site'),
        };
      }

      // ── The personal dashboard ────────────────────────────────
      case 'my_revenue': {
        const rows = await run(revList(revClientWhere(w, s), 'inner'));
        return {
          title: `Revenue · ${w.fyLabel}`,
          subtitle: 'Booked against the clients you own or cover',
          unit: 'cr', rows: rows.map(r => ({ ...r, value: num(r.value) / CR })),
          total: sum(rows) / CR,
        };
      }

      // Scoped by the visit rather than by the client: this tile is the rep's own
      // activity record, and a call they made is a day they worked whoever now
      // owns the account.
      case 'my_visits_week': {
        const rows = await run(`
          SELECT c.id, c.code, c.legal_name AS name, count(*) AS value,
                 string_agg(to_char(v.visit_date, 'DD Mon'), ', ' ORDER BY v.visit_date DESC) AS detail
            FROM visits v JOIN clients c ON c.id = v.client_id
           WHERE ${visitsThisWeekWhere(s)}
           GROUP BY c.id, c.code, c.legal_name
           ORDER BY value DESC, c.legal_name`);
        return {
          title: 'Visits · last 7 days',
          subtitle: 'Completed and checked-in calls',
          unit: 'count', rows, total: sum(rows),
          secondary: plural(rows.length, 'client'),
        };
      }

      case 'my_overdue':
      case 'my_clients': {
        const where = p.kind === 'my_overdue' ? overdueClientWhere(s) : activeClientWhere(s);
        const rows = await run(`
          SELECT c.id, c.code, c.legal_name AS name, NULL::numeric AS value,
                 CASE WHEN c.last_visit_date IS NULL THEN 'never visited'
                      ELSE 'last visit ' || to_char(c.last_visit_date, 'DD Mon YYYY')
                           || ' · ' || (CURRENT_DATE - c.last_visit_date)::text || ' days ago' END AS detail
            FROM clients c
           WHERE ${where}
           ORDER BY c.last_visit_date ASC NULLS FIRST, c.legal_name`);
        return {
          title: p.kind === 'my_overdue' ? 'Overdue clients' : 'Active clients',
          subtitle: p.kind === 'my_overdue'
            ? 'Active accounts with no visit in 90 days'
            : 'Active accounts you own or cover',
          unit: 'count', rows, total: rows.length,
        };
      }

      // ── The Targets table ────────────────────────────────────
      //
      // The three figures on a Targets row — revenue, new clients, visits —
      // now open the same way every other number on these dashboards does.
      // Each one repeats the predicate loadAchieved counted with, so the list
      // cannot describe a different population from the figure above it; if
      // one of those rules changes, both have to change together.
      case 'target_revenue':
      case 'target_new_clients':
      case 'target_visits': {
        const who = await targetAudience(p, me);
        if (!who) return null;
        const inReps = `(${who.ids.join(',')})`;

        if (p.kind === 'target_revenue') {
          const rows = await run(`
            SELECT c.id, c.code, c.legal_name AS name,
                   (SUM(crm.total_value) / 10000000.0) AS value,
                   count(DISTINCT crm.month)::text || ' month(s) invoiced' AS detail
              FROM client_revenue_monthly crm
              JOIN clients c ON c.id = crm.client_id
             WHERE c.primary_rep_id IN ${inReps}
               AND crm.month >= '${w.cyStart}'::date AND crm.month < '${w.cyEnd}'::date
             GROUP BY c.id, c.code, c.legal_name
            HAVING SUM(crm.total_value) <> 0
             ORDER BY value DESC NULLS LAST`);
          return {
            title: `${who.label} · revenue this year`,
            subtitle: 'Invoiced revenue on the accounts they are primary rep for',
            unit: 'cr', rows, total: sum(rows),
            secondary: plural(rows.length, 'account'),
          };
        }

        if (p.kind === 'target_new_clients') {
          // The same two exclusions the count makes, for the same reason: a
          // bulk loader tags itself instead of signing with an email, and a
          // merged duplicate is housekeeping rather than a new account.
          const rows = await run(`
            SELECT c.id, c.code, c.legal_name AS name, NULL::numeric AS value,
                   'added ' || to_char(c.created_at, 'DD Mon YYYY')
                     || ' · ' || COALESCE(NULLIF(c.created_by, ''), 'unknown') AS detail
              FROM clients c
             WHERE c.primary_rep_id IN ${inReps}
               AND c.deleted_at IS NULL AND c.status <> 'DUPLICATE'
               AND c.created_by LIKE '%@%'
               AND c.created_at >= '${w.cyStart}'::date AND c.created_at < '${w.cyEnd}'::date
             ORDER BY c.created_at DESC`);
          return {
            title: `${who.label} · new clients this year`,
            subtitle: 'Accounts a person added — bulk imports are not counted',
            unit: 'count', rows, total: rows.length,
          };
        }

        // Visits, counted when the report was submitted. LEFT JOIN so a visit
        // with no client on it still counts towards the total the tile shows,
        // listed as Unattributed rather than quietly dropped.
        const rows = await run(`
          SELECT c.id, c.code, c.legal_name AS name, count(*) AS value,
                 count(*)::text || ' visit(s) · last '
                   || to_char(max(v.submitted_at), 'DD Mon YYYY') AS detail
            FROM visits v LEFT JOIN clients c ON c.id = v.client_id
           WHERE v.rep_id IN ${inReps} AND v.submitted_at IS NOT NULL
             AND v.submitted_at >= '${w.cyStart}'::date AND v.submitted_at < '${w.cyEnd}'::date
           GROUP BY c.id, c.code, c.legal_name
           ORDER BY value DESC, c.legal_name`);
        return {
          title: `${who.label} · visits this year`,
          subtitle: 'Visit reports submitted, by account',
          unit: 'count', rows, total: sum(rows),
          secondary: plural(rows.length, 'account'),
        };
      }

      case 'my_pipeline': {
        const rows = await run(`
          SELECT c.id, c.code, c.legal_name AS name, sum(o.value_cr) AS value,
                 count(*)::text || ' open · ' || string_agg(DISTINCT o.stage, ', ') AS detail
            FROM opportunities o JOIN clients c ON c.id = o.client_id
           WHERE ${repPipelineWhere(s)}
           GROUP BY c.id, c.code, c.legal_name
           ORDER BY value DESC NULLS LAST`);
        return {
          title: 'Open pipeline',
          subtitle: 'Every opportunity still in play, by account',
          unit: 'cr', rows, total: sum(rows),
        };
      }
    }
  } catch (e) {
    // Server actions hand back a null rather than throwing: a thrown error is
    // redacted in production, so the modal would have nothing to say.
    await recordDrillFailure(p, me.email, e);
    return null;
  }
  return null;
}
