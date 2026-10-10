// The SQL the landing dashboard is built from, in one place.
//
// Same reason lib/risansi-exec-review.ts exists: the page computes a number and
// the drill-down lists the rows behind it, and if the two build their scope,
// their fiscal windows or their stage lists separately they will agree today and
// disagree after the next edit. A drill-down that does not add up to the figure
// above it is worse than none, because it looks authoritative while being wrong.
// So app/risansi/page.tsx and app/actions/risansi-dashboard-drilldown.ts both
// import every predicate below rather than spelling it out twice.

import {
  clientScopeSql, clientVisibilitySql, OWN_OPEN, type CurrentUser,
} from './risansi-auth';
import { AND_LIVE_CLIENT } from './risansi-opportunity-scope';
import { getCurrentFY } from './risansi-utils';

/** 1 Cr in rupees. `value_cr` is crores; `offer_value_inr` and revenue are rupees. */
export const CR = 10_000_000;
/** 1 Lakh in rupees. The hero card carries its totals in lakhs. */
export const INR_TO_L = 100_000;

// ── Fiscal windows ────────────────────────────────────────────

export interface DashWindows {
  /** 'FY 26-27'. */
  fyLabel: string;
  /** Current FY start, inclusive — '2026-04-01'. */
  cyStart: string;
  /** Current FY end, exclusive — '2027-04-01'. */
  cyEnd: string;
  /** Previous FY start, inclusive. Also the current FY's exclusive lower bound. */
  pyStart: string;
  /** Start of the seven-FY window the year-on-year bars are drawn over. */
  histStart: string;
}

/**
 * The dashboard's fiscal windows.
 *
 * Derived from getCurrentFY so the page, the drill-down and every other FY
 * reader roll over on the same date rather than on three slightly different
 * ones.
 */
export function dashWindows(): DashWindows {
  const fy = getCurrentFY();
  const s = Number(fy.startDate.slice(0, 4));
  return {
    fyLabel: fy.label,
    cyStart: fy.startDate,
    cyEnd: `${s + 1}-04-01`,
    pyStart: `${s - 1}-04-01`,
    histStart: `${s - 6}-04-01`,
  };
}

/** The window a 'FY26'-style bar label on the year-on-year chart stands for. */
export function fyCodeWindow(code: string): { start: string; end: string } | null {
  const m = /^FY(\d{2})$/.exec(code.trim());
  if (!m) return null;
  const y = 2000 + Number(m[1]);
  return { start: `${y}-04-01`, end: `${y + 1}-04-01` };
}

// ── Visibility ────────────────────────────────────────────────

export interface DashScope {
  /** ` AND (…)` for a clients query aliased `c`. Empty for an admin. */
  cVisAnd: string;
  /** ` AND (…)` for an opportunities query aliased `o`, plus the archived-client guard. */
  oppOwnerAnd: string;
  /** ` AND (…)` for an opportunities query aliased `o`, counting by ATTRIBUTION
   *  rather than by reach: the clients the viewer owns or covers, with no
   *  in-flight limb. What the figures use. */
  oppCreditAnd: string;
  /** ` AND (…)` for a visits query aliased `v`. */
  visitOwnerAnd: string;
}

/**
 * The viewer's own reach, as the three ` AND …` fragments the dashboard queries
 * append.
 *
 * Re-derived from the session on both sides — the browser sends which figure to
 * itemise, never whose rows to include — so opening a breakdown can never show
 * somebody a row the tile above it did not already count for them.
 */
export function dashScope(user: CurrentUser): DashScope {
  const cVis = clientVisibilitySql(user, 'c');
  const oppVis = clientScopeSql(user, 'o.client_id', OWN_OPEN.opportunity('o'));
  const visitVis = clientScopeSql(user, 'v.client_id', OWN_OPEN.visit('v'));
  const cVisAnd = cVis ? ` AND (${cVis})` : '';
  // An archived client's opportunities leave every tile and list with it. Every
  // opportunity predicate below is built on this binding, which is how
  // scripts/opportunity-scope-check.mjs can see that the guard is there.
  const oppOwnerAnd = (oppVis ? ` AND (${oppVis})` : '') + AND_LIVE_CLIENT('o');
  // The same rule WITHOUT the in-flight limb, for anything that totals money.
  //
  // clientScopeSql's second limb is "an open record of my own, whoever owns the
  // client", and it is right for a list: a rep has to be able to finish what
  // they started on an account that has moved. It is wrong for a figure. Under
  // the attribution rule of 1 Oct 2026 that opportunity counts for the client's
  // owner, so leaving the limb in put the same money on two reps' dashboards at
  // once — up to 0.54 Cr on one of them, 0.88 Cr across all of them. The record
  // stays visible on the Opportunities board, which still scopes by reach; it
  // simply stops being added to a total that is not the viewer's.
  const oppCredit = clientScopeSql(user, 'o.client_id');
  const oppCreditAnd = (oppCredit ? ` AND (${oppCredit})` : '') + AND_LIVE_CLIENT('o');
  const visitOwnerAnd = visitVis ? ` AND (${visitVis})` : '';
  return { cVisAnd, oppOwnerAnd, oppCreditAnd, visitOwnerAnd };
}

// ── Revenue ───────────────────────────────────────────────────

/**
 * Revenue months inside one fiscal window.
 *
 * The hero card's Total Booked and Previous FY both read client_revenue_monthly
 * with no client join at all — they are the company's book, not a filtered view
 * of it — so the drill-down behind them must not quietly add one either, or the
 * list would come up short of the number it claims to explain.
 */
export const revMonthsSql = (w: DashWindows, period: 'cy' | 'py', a = 'crm') =>
  period === 'cy'
    ? `${a}.month >= '${w.cyStart}' AND ${a}.month < '${w.cyEnd}'`
    : `${a}.month >= '${w.pyStart}' AND ${a}.month < '${w.cyStart}'`;

/**
 * What the hero card means by "booked".
 *
 * Total Booked adds the pump and spare columns rather than reading total_value,
 * because the one query also draws the pump : spare ratio beside it. The three
 * columns agree row for row in the data today; the drill-down sums this
 * expression rather than total_value so that the tile and its breakdown go on
 * agreeing on the day one row does not.
 */
export const BOOKED_VALUE = (a = 'crm') =>
  `(COALESCE(${a}.pump_value,0) + COALESCE(${a}.spare_value,0))`;

/** Revenue months in an arbitrary window — the year-on-year bars. */
export const revBetweenSql = (start: string, end: string, a = 'crm') =>
  `${a}.month >= '${start}' AND ${a}.month < '${end}'`;

/**
 * Revenue joined to a live, visible client — the mix, the market split and the
 * top-accounts table. Narrower than revMonthsSql on purpose: these panels name
 * the client, so a client who has been archived has nothing to name.
 */
export const revClientWhere = (w: DashWindows, s: DashScope, period: 'cy' | 'py' = 'cy') =>
  `${revMonthsSql(w, period)} AND c.deleted_at IS NULL${s.cVisAnd}`;

// ── Opportunities ─────────────────────────────────────────────

/** Open pipeline stages, in flow order. Won is the landed outcome, tracked apart. */
export const OPEN_STAGES = ['Suspect', 'Prospect', 'Quoted', 'Negotiating', 'On Hold'] as const;

/**
 * Open Pipeline is the quoted pipe: Quoted and Negotiating only. A Suspect or
 * Prospect carries no offer and On Hold is parked, so none of them is money in
 * play; the funnel below the tile still shows every stage.
 */
export const PIPELINE_STAGES = ['Quoted', 'Negotiating'] as const;

const quoted = (vs: readonly string[]) => vs.map(v => `'${v.replace(/'/g, "''")}'`).join(',');

/** One or more opportunity stages, scoped to what the viewer may see. */
export const stageWhere = (s: DashScope, stages: readonly string[]) =>
  `o.stage IN (${quoted(stages)})${s.oppCreditAnd}`;

/** Open opportunities on the rep dashboard — everything still in play. */
export const repPipelineWhere = (s: DashScope) =>
  // The quoted pipe, the same PIPELINE_STAGES the admin dashboard's Open
  // Pipeline uses. This was `NOT IN ('Won','Lost')`, which counted Suspect and
  // Prospect — neither of which carries an offer — and, because Dropped is
  // neither Won nor Lost, counted dead deals as pipeline too. On one rep's
  // board that read ₹13.74 Cr against a real quoted pipe of ₹4.72 Cr, ₹0.88 Cr
  // of it dropped.
  `o.stage IN (${PIPELINE_STAGES.map(x => `'${x}'`).join(', ')})${s.oppCreditAnd}`;

/**
 * Order in Hand and Order Booked, as the two halves of a Won opportunity.
 *
 * In hand is what has been won but not yet written into a Sales Order; booked is
 * what has. Both are crores, and both are scoped by the CLIENT (cVisAnd) rather
 * than by the opportunity owner, because a landed order belongs to the account.
 */
export const SO_SUM_JOIN =
  `LEFT JOIN LATERAL (SELECT SUM(so_value_cr) AS sosum FROM opportunity_sales_orders WHERE opportunity_id = o.id) so ON TRUE`;
export const IN_HAND_CR = `GREATEST(COALESCE(o.final_value_cr, o.value_cr, 0) - COALESCE(so.sosum, 0), 0)`;
export const BOOKED_CR = `COALESCE(so.sosum, 0)`;
export const wonClientWhere = (s: DashScope) =>
  `o.stage = 'Won' AND c.deleted_at IS NULL${s.cVisAnd}`;

// ── Clients ───────────────────────────────────────────────────

/** Active, live and visible — the denominator of both dashboards' client counts. */
export const activeClientWhere = (s: DashScope) =>
  `c.status = 'ACTIVE' AND c.deleted_at IS NULL${s.cVisAnd}`;

/** Active clients with no visit in 90 days, or none ever. */
export const overdueClientWhere = (s: DashScope) =>
  `${activeClientWhere(s)} AND (c.last_visit_date IS NULL OR c.last_visit_date < CURRENT_DATE - INTERVAL '90 days')`;

/**
 * At risk: an account that has bought from us at some point and has not been
 * seen in eighteen months. The exposure beside the count is the revenue booked
 * across the previous and current FY, which is what walks out of the door if the
 * silence turns into a switch.
 */
export const atRiskWhere = (s: DashScope) =>
  `c.status = 'ACTIVE' AND c.deleted_at IS NULL`
  + ` AND (c.last_visit_date IS NULL OR c.last_visit_date < CURRENT_DATE - INTERVAL '18 months')`
  + ` AND EXISTS (SELECT 1 FROM client_revenue_monthly r2 WHERE r2.client_id = c.id)${s.cVisAnd}`;
export const atRiskExposureOn = (w: DashWindows, a = 'crm') =>
  `${a}.month >= '${w.pyStart}' AND ${a}.month < '${w.cyEnd}'`;

// ── Visits ────────────────────────────────────────────────────

/** Visits that actually happened in the last seven days. */
export const visitsThisWeekWhere = (s: DashScope) =>
  `v.visit_date >= CURRENT_DATE - INTERVAL '7 days'`
  + ` AND v.status IN ('completed','checked-in')${s.visitOwnerAnd}`;

// ── Installed base ────────────────────────────────────────────

/**
 * The PCP column each supplier on the market-share donut is counted from.
 *
 * competitor_installed_base is a wide table with one column per competitor, so
 * the donut, the share percentage and the drill-down behind them all have to
 * agree on which column is whose. The keys are the names the donut prints.
 */
export const PCP_COLUMNS: Record<string, string> = {
  RIL: 'ril_pcp',
  Roto: 'roto_pcp',
  Rotomac: 'rotomac_pcp',
  Netzsch: 'netzsch_pcp',
  Gita: 'gita_pcp',
  PSP: 'psp_pcp',
  Tushaco: 'tushaco_pcp',
};

/**
 * Everything the named columns do not account for.
 *
 * The donut's Others slice is a remainder, not a column: total_pcp minus the
 * seven named suppliers, floored at zero so a row whose parts overshoot its own
 * total cannot subtract units from the slice next to it.
 */
export const OTHERS_PCP = `GREATEST(COALESCE(total_pcp,0) - (${
  Object.values(PCP_COLUMNS).map(c => `COALESCE(${c},0)`).join(' + ')
}), 0)`;
