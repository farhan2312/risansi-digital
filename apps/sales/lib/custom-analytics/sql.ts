// SERVER ONLY. The SQL behind every id in model.ts.
//
// Nothing in here is ever built from user input. Each entry is a constant
// fragment, looked up by an id the engine has already checked against the
// model. Values the user supplies - dates, clicked categories, top-N keys -
// arrive as bound parameters, never as text.
//
// THE ONE RULE THAT MAKES CROSS-TABLE WORK
//
// Every dataset joins `clients c`, and the shared dimensions are written
// against `c` (and `rp`, the account's rep) in exactly the same words in all
// of them. So "Maharashtra" out of Revenue and "Maharashtra" out of
// Complaints are the same string, and a click on one filters the other. Alias
// the client table anything else in a new dataset and that quietly stops
// being true.
//
// `client_id` is on 100% of the rows of every fact table here except
// client_pumps (5,457 of 6,016), which is also why client ownership can be
// the single scope rule.

import type { Grain } from './types';

/** A date column, and whether it carries a time zone. */
interface DateExpr { expr: string; tz: boolean }

export interface DatasetSql {
  /** FROM and its joins. Always ends with the client join. */
  from: string;
  /** Always-on predicate: deleted rows, test data. */
  where: string | null;
  /** The column row-level scope is applied to. */
  scopeCol: string;
  /** Date fields by model id. */
  dates: Record<string, DateExpr>;
  /** Category expressions by model id, before null-labelling. */
  dims: Record<string, string>;
  /** Complete aggregates by model id. */
  measures: Record<string, string>;
  /** Plain columns the user picks an aggregation for. */
  nums: Record<string, string>;
}

// The account's own people and places. One spelling, eight datasets.
const CLIENT_JOIN = `
  JOIN clients c ON c.id = %FK%
  LEFT JOIN users rp ON rp.id = c.primary_rep_id`;

const CLIENT_DIMS: Record<string, string> = {
  client:      `coalesce(nullif(btrim(c.trade_name),''), nullif(btrim(c.legal_name),''), c.code)`,
  rep:         `rp.name`,
  industry:    `c.industry`,
  state:       `c.state`,
  city:        `c.city`,
  client_type: `c.client_type`,
  tier:        `c.tier`,
  market_type: `c.market_type`,
};

/** A dimension as a readable label. Everything blank becomes one "(none)". */
export function dimLabel(expr: string): string {
  return `coalesce(nullif(btrim(${expr}::text),''), '(none)')`;
}

/**
 * A date, bucketed in IST and rendered as sortable text.
 *
 * Text rather than a date so every dimension column has the same type and the
 * cross-table join lines up on plain equality. The formats are chosen to sort
 * correctly as strings, which is why quarters read 2026-Q3 and not Q3 2026.
 *
 * The financial year runs April to March, matching fyOf() in
 * risansi-date-presets.ts: three months back names the start, nine months
 * forward names the end, so March 2027 and April 2026 both land in FY26-27.
 */
export function dateBucket(d: DateExpr, grain: Grain): string {
  const t = d.tz ? `((${d.expr}) AT TIME ZONE 'Asia/Kolkata')` : `((${d.expr})::timestamp)`;
  switch (grain) {
    case 'day':     return `to_char(${t}, 'YYYY-MM-DD')`;
    case 'week':    return `to_char(date_trunc('week', ${t}), 'YYYY-MM-DD')`;
    case 'quarter': return `to_char(${t}, 'YYYY') || '-Q' || to_char(${t}, 'Q')`;
    case 'year':    return `to_char(${t}, 'YYYY')`;
    case 'fy':      return `'FY' || to_char(${t} - interval '3 months', 'YY') || '-' || to_char(${t} + interval '9 months', 'YY')`;
    case 'month':
    default:        return `to_char(${t}, 'YYYY-MM')`;
  }
}

/** The same date as a bare IST timestamp, for the page date-range filter. */
export function dateMoment(d: DateExpr): string {
  return d.tz ? `((${d.expr}) AT TIME ZONE 'Asia/Kolkata')` : `((${d.expr})::timestamp)`;
}

const OPEN_OPP = `o.stage NOT IN ('Won','Lost','Dropped')`;
// Opportunity money is kept in two columns with different units. Rupees where
// they exist, crores converted where they do not: offer_value_inr covers 2,315
// of 2,381 rows and value_cr covers 2,310, so either alone loses real money.
const OPP_VALUE = `coalesce(o.offer_value_inr, o.value_cr * 10000000)`;
const OPP_WON_VALUE = `coalesce(o.final_value_cr * 10000000, o.offer_value_inr, o.value_cr * 10000000)`;
const COMPLAINT_OPEN = `cm.status NOT IN ('Resolved','Closed')`;

export const DATASET_SQL: Record<string, DatasetSql> = {
  revenue: {
    from: `client_revenue_uploaded r ${CLIENT_JOIN.replace('%FK%', 'r.client_id')}`,
    where: `c.deleted_at IS NULL`,
    scopeCol: 'r.client_id',
    dates: { month: { expr: 'r.month', tz: false } },
    dims: { ...CLIENT_DIMS },
    measures: {
      revenue:        `sum(r.total_value)`,
      pump_revenue:   `sum(r.pump_value)`,
      spare_revenue:  `sum(r.spare_value)`,
      clients_billed: `count(DISTINCT r.client_id)`,
      months_billed:  `count(DISTINCT r.month)`,
    },
    nums: { total_value: 'r.total_value', pump_value: 'r.pump_value', spare_value: 'r.spare_value' },
  },

  pipeline: {
    from: `opportunities o ${CLIENT_JOIN.replace('%FK%', 'o.client_id')}`,
    where: `c.deleted_at IS NULL`,
    scopeCol: 'o.client_id',
    dates: {
      created:      { expr: 'o.created_at',   tz: true },
      enquiry_date: { expr: 'o.enquiry_date', tz: false },
      quote_date:   { expr: 'o.quote_date',   tz: false },
      po_date:      { expr: 'o.po_date',      tz: false },
    },
    dims: {
      stage: 'o.stage', product_type: 'o.product_type', market: 'o.market',
      opp_type: 'o.opportunity_type', opp_source: 'o.opportunity_source',
      lost_to: 'o.lost_to_competitor', drop_reason: 'o.drop_reason',
      ...CLIENT_DIMS,
    },
    measures: {
      opportunities: `count(*)`,
      offer_value:   `sum(${OPP_VALUE})`,
      won_value:     `sum(${OPP_WON_VALUE}) FILTER (WHERE o.stage = 'Won')`,
      open_value:    `sum(${OPP_VALUE}) FILTER (WHERE ${OPEN_OPP})`,
      won:           `count(*) FILTER (WHERE o.stage = 'Won')`,
      lost:          `count(*) FILTER (WHERE o.stage = 'Lost')`,
      // Open opportunities are in neither half: a win rate that counts work
      // still in progress as a loss falls every time somebody adds an enquiry.
      win_rate:      `100.0 * count(*) FILTER (WHERE o.stage = 'Won')
                      / nullif(count(*) FILTER (WHERE o.stage IN ('Won','Lost')), 0)`,
      pumps_quoted:  `sum(o.pump_qty)`,
    },
    nums: { value_cr: 'o.value_cr', offer_value_inr: 'o.offer_value_inr', pump_qty: 'o.pump_qty' },
  },

  orders: {
    from: `orders od ${CLIENT_JOIN.replace('%FK%', 'od.client_id')}`,
    where: `c.deleted_at IS NULL`,
    scopeCol: 'od.client_id',
    dates: {
      order_date:   { expr: 'od.order_date',   tz: false },
      invoice_date: { expr: 'od.invoice_date', tz: false },
    },
    dims: { financial_year: 'od.financial_year', product_category: 'od.product_category', ...CLIENT_DIMS },
    measures: {
      orders:      `count(*)`,
      order_value: `sum(od.order_value_inr)`,
      avg_order:   `avg(od.order_value_inr)`,
    },
    nums: { order_value_inr: 'od.order_value_inr' },
  },

  visits: {
    from: `visits v ${CLIENT_JOIN.replace('%FK%', 'v.client_id')}
           LEFT JOIN users vr ON vr.id = v.rep_id`,
    where: `c.deleted_at IS NULL`,
    scopeCol: 'v.client_id',
    dates: { visit_date: { expr: 'v.visit_date', tz: false } },
    dims: {
      visit_rep: 'vr.name', purpose: 'v.purpose', outcome: 'v.outcome',
      visit_status: 'v.status',
      planned: `CASE WHEN v.is_planned THEN 'Planned' ELSE 'Unplanned' END`,
      ...CLIENT_DIMS,
    },
    measures: {
      visits:          `count(*)`,
      clients_visited: `count(DISTINCT v.client_id)`,
      completed:       `count(*) FILTER (WHERE v.status = 'completed')`,
      planned_pct:     `100.0 * count(*) FILTER (WHERE v.is_planned) / nullif(count(*), 0)`,
      followups_open:  `count(*) FILTER (WHERE v.follow_up_required)`,
    },
    nums: {},
  },

  complaints: {
    from: `complaints cm ${CLIENT_JOIN.replace('%FK%', 'cm.client_id')}`,
    where: `c.deleted_at IS NULL`,
    scopeCol: 'cm.client_id',
    dates: {
      complaint_date: { expr: 'cm.complaint_date', tz: false },
      closed_date:    { expr: 'cm.closed_at',      tz: true },
    },
    dims: {
      status: 'cm.status', category: 'cm.complaint_category',
      subcategory: 'cm.complaint_subcategory', severity: 'cm.severity',
      root_cause: 'cm.root_cause_category', responsible: 'cm.responsible_department',
      pump_model: 'cm.pump_model', model_series: 'cm.model_series',
      ...CLIENT_DIMS,
    },
    measures: {
      complaints:  `count(*)`,
      open:        `count(*) FILTER (WHERE ${COMPLAINT_OPEN})`,
      closed:      `count(*) FILTER (WHERE NOT (${COMPLAINT_OPEN}))`,
      capa_raised: `count(*) FILTER (WHERE cm.capa_needed IS TRUE)`,
      repeat_rate: `100.0 * count(*) FILTER (WHERE cm.repeat_complaint IS TRUE) / nullif(count(*), 0)`,
      fr_value:    `sum(coalesce(cm.fr_transport_value, 0) + coalesce(cm.fr_material_value, 0))`,
    },
    nums: {},
  },

  clients: {
    // The only dataset whose fact IS the client, so it joins nothing but its
    // own rep. %FK% would be c.id = c.id.
    from: `clients c LEFT JOIN users rp ON rp.id = c.primary_rep_id`,
    where: `c.deleted_at IS NULL`,
    scopeCol: 'c.id',
    dates: {
      created:    { expr: 'c.created_at',      tz: true },
      last_visit: { expr: 'c.last_visit_date', tz: false },
    },
    dims: {
      status: 'c.status', country: 'c.country',
      is_sugar: `CASE WHEN c.is_sugar THEN 'Sugar' ELSE 'Non-sugar' END`,
      ...CLIENT_DIMS,
    },
    measures: {
      client_count: `count(*)`,
      outstanding:  `sum(c.total_outstanding)`,
    },
    nums: { total_outstanding: 'c.total_outstanding', tcd: 'c.tcd' },
  },

  pumps: {
    from: `client_pumps cp ${CLIENT_JOIN.replace('%FK%', 'cp.client_id')}`,
    where: `c.deleted_at IS NULL`,
    scopeCol: 'cp.client_id',
    // so_date is null on all 6,016 rows, so there is no date to offer and the
    // page date filter is reported as ignored rather than silently dropped.
    dates: {},
    dims: {
      model: 'cp.pump_model_plate', liquid: 'cp.liquid',
      capacity: 'cp.capacity', head: 'cp.head',
      ...CLIENT_DIMS,
    },
    measures: {
      pump_rows:    `count(*)`,
      pump_qty:     `sum(cp.quantity)`,
      pump_clients: `count(DISTINCT cp.client_id)`,
    },
    nums: { quantity: 'cp.quantity' },
  },

  competitors: {
    from: `competitor_installed_base ci ${CLIENT_JOIN.replace('%FK%', 'ci.client_id')}`,
    where: `c.deleted_at IS NULL`,
    scopeCol: 'ci.client_id',
    dates: {},
    dims: { location: 'ci.location', ...CLIENT_DIMS },
    measures: {
      sites:       `count(*)`,
      total_pumps: `sum(ci.total_pumps)`,
      ril_pumps:   `sum(coalesce(ci.ril_pcp, 0) + coalesce(ci.ril_mmp, 0))`,
      ril_share:   `100.0 * sum(coalesce(ci.ril_pcp, 0) + coalesce(ci.ril_mmp, 0))
                    / nullif(sum(ci.total_pumps), 0)`,
      pcp_pumps:   `sum(ci.total_pcp)`,
      mmp_pumps:   `sum(ci.total_mmp)`,
    },
    nums: {},
  },
};

/**
 * Where each dataset carries the page filters.
 *
 * All eight reach the same client row, so every one of these applies
 * everywhere. A dataset that could not answer one would list it in
 * `ignoredFilters` and the card would show a warning instead of a wrong
 * number; today none of them has to.
 */
export const PAGE_FILTER_SQL = {
  states:      `c.state`,
  industries:  `c.industry`,
  clientTypes: `c.client_type`,
  tiers:       `c.tier`,
  reps:        `c.primary_rep_id`,
} as const;
