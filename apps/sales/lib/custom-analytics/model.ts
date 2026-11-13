// The semantic model: the tables and fields a report may ask about.
//
// CLIENT-SAFE. The Data panel renders straight off this, so it carries labels
// and kinds and nothing executable. Every id here has a matching SQL fragment
// in sql.ts, keyed identically; the engine refuses an id that is in one file
// and not the other.
//
// Raw tables are deliberately not exposed. 78 tables and 139 columns on
// `complaints` alone is not a thing anyone can build a report out of, and
// half of them are workflow plumbing. What is here is the business questions.
//
// WHAT IS NOT HERE, AND WHY
//
// Every field below was checked against the live database before being
// written down, because a field that is always blank is worse than a missing
// one: it looks like an answer. Dropped for being empty on every row:
// complaints.basic_value and challan_value, visits.sample_gift_value,
// clients.weightage_score and klpd, client_pumps.so_date,
// competitor_installed_base.assessed_at.
//
// Exhibitions were asked for and are not here. 154 meetings, of which 11
// carry a client_id — so 93% of them cannot be scoped by client ownership,
// which is the only row-level rule this portal has. Their own columns are
// nearly empty too (interest 8/154, outcome 9/154, potential value 4/154).
// A dataset nobody can be given a safe, non-empty view of is not ready.
//
// No field is withheld for sensitivity: outstanding balances, rep targets and
// contact details are all selectable, by decision. Row-level client scope is
// therefore the ONLY limit on what a report can show, which is why the engine
// fails closed rather than open when a scope cannot be resolved.

/** A dimension that means the same thing in every dataset that has it. */
export type SharedDim =
  | 'client' | 'rep' | 'industry' | 'state' | 'city'
  | 'clientType' | 'tier' | 'marketType';

export const SHARED_DIM_LABEL: Record<SharedDim, string> = {
  client: 'Client', rep: 'Sales rep', industry: 'Industry',
  state: 'State', city: 'City', clientType: 'Direct / OEM',
  tier: 'Tier', marketType: 'Market type',
};

export type FieldKind = 'measure' | 'num' | 'dim';
export type Format = 'text' | 'date' | 'inr' | 'cr' | 'int' | 'num' | 'pct';

import type { Agg } from './types';

export interface ModelField {
  id: string;
  label: string;
  kind: FieldKind;
  format: Format;
  /** Set when this field IS one of the shared dimensions. */
  common?: SharedDim;
  /** A dim that holds a timestamp, so it offers a grain. */
  date?: boolean;
  defaultAgg?: Agg;
  hint?: string;
}

export interface Dataset {
  id: string;
  label: string;
  icon: string;
  description: string;
  /** What the page date filter means here. Null when the table has no date. */
  dateLabel: string | null;
  /** The field id the page date filter uses. Null for a dateless table. */
  dateField: string | null;
  fields: ModelField[];
}

// Shared dimension fields, written once. Every dataset reaches `clients`, so
// they resolve identically everywhere and a value clicked in one visual
// filters another built on a different table.
const CLIENT_DIMS: ModelField[] = [
  { id: 'client',      label: 'Client',        kind: 'dim', format: 'text', common: 'client' },
  { id: 'rep',         label: 'Sales rep',     kind: 'dim', format: 'text', common: 'rep',
    hint: 'The account’s primary rep, not whoever happened to log the record.' },
  { id: 'industry',    label: 'Industry',      kind: 'dim', format: 'text', common: 'industry' },
  { id: 'state',       label: 'State',         kind: 'dim', format: 'text', common: 'state' },
  { id: 'city',        label: 'City',          kind: 'dim', format: 'text', common: 'city' },
  { id: 'client_type', label: 'Direct / OEM',  kind: 'dim', format: 'text', common: 'clientType' },
  { id: 'tier',        label: 'Tier',          kind: 'dim', format: 'text', common: 'tier' },
  { id: 'market_type', label: 'Market type',   kind: 'dim', format: 'text', common: 'marketType' },
];

export const DATASETS: Dataset[] = [
  {
    id: 'revenue', label: 'Revenue', icon: '\u{1F4B0}',
    description: 'Billed revenue by client and month. 2019 to date.',
    dateLabel: 'Revenue month', dateField: 'month',
    fields: [
      { id: 'revenue',       label: 'Revenue ₹',       kind: 'measure', format: 'inr' },
      { id: 'pump_revenue',  label: 'Pump revenue ₹',  kind: 'measure', format: 'inr' },
      { id: 'spare_revenue', label: 'Spare revenue ₹', kind: 'measure', format: 'inr' },
      { id: 'clients_billed', label: 'Clients billed',      kind: 'measure', format: 'int' },
      { id: 'months_billed',  label: 'Months billed',       kind: 'measure', format: 'int' },
      { id: 'month', label: 'Revenue month', kind: 'dim', format: 'date', date: true },
      ...CLIENT_DIMS,
      { id: 'total_value', label: 'Line value ₹', kind: 'num', format: 'inr', defaultAgg: 'sum' },
      { id: 'pump_value',  label: 'Line pump ₹',  kind: 'num', format: 'inr', defaultAgg: 'sum' },
      { id: 'spare_value', label: 'Line spare ₹', kind: 'num', format: 'inr', defaultAgg: 'sum' },
    ],
  },
  {
    id: 'pipeline', label: 'Pipeline', icon: '\u{1F3AF}',
    description: 'Opportunities: enquiries, quotations, and what they became.',
    dateLabel: 'Created', dateField: 'created',
    fields: [
      { id: 'opportunities', label: 'Opportunities',  kind: 'measure', format: 'int' },
      { id: 'offer_value',   label: 'Offer value ₹', kind: 'measure', format: 'inr' },
      { id: 'won_value',     label: 'Won value ₹',   kind: 'measure', format: 'inr',
        hint: 'Final value of Won opportunities, in rupees.' },
      { id: 'open_value',    label: 'Open value ₹',  kind: 'measure', format: 'inr',
        hint: 'Offer value of anything not Won, Lost or Dropped.' },
      { id: 'won',           label: 'Won',            kind: 'measure', format: 'int' },
      { id: 'lost',          label: 'Lost',           kind: 'measure', format: 'int' },
      { id: 'win_rate',      label: 'Win rate %',     kind: 'measure', format: 'pct',
        hint: 'Won as a share of Won plus Lost. Open opportunities are not counted either way.' },
      { id: 'pumps_quoted',  label: 'Pumps quoted',   kind: 'measure', format: 'int' },
      { id: 'created',       label: 'Created',        kind: 'dim', format: 'date', date: true },
      { id: 'enquiry_date',  label: 'Enquiry date',   kind: 'dim', format: 'date', date: true },
      { id: 'quote_date',    label: 'Quotation date', kind: 'dim', format: 'date', date: true },
      { id: 'po_date',       label: 'PO date',        kind: 'dim', format: 'date', date: true },
      { id: 'stage',         label: 'Stage',          kind: 'dim', format: 'text' },
      { id: 'product_type',  label: 'Product type',   kind: 'dim', format: 'text' },
      { id: 'market',        label: 'Market',         kind: 'dim', format: 'text' },
      { id: 'opp_type',      label: 'Opportunity type', kind: 'dim', format: 'text' },
      { id: 'opp_source',    label: 'Source',         kind: 'dim', format: 'text' },
      { id: 'lost_to',       label: 'Lost to competitor', kind: 'dim', format: 'text' },
      { id: 'drop_reason',   label: 'Drop reason',    kind: 'dim', format: 'text' },
      ...CLIENT_DIMS,
      { id: 'value_cr',         label: 'Value (Cr)',  kind: 'num', format: 'cr',  defaultAgg: 'sum' },
      { id: 'offer_value_inr',  label: 'Offer ₹', kind: 'num', format: 'inr', defaultAgg: 'sum' },
      { id: 'pump_qty',         label: 'Pump qty',    kind: 'num', format: 'int', defaultAgg: 'sum' },
    ],
  },
  {
    id: 'orders', label: 'Order in hand', icon: '\u{1F4E6}',
    description: 'Confirmed orders and their value.',
    dateLabel: 'Order date', dateField: 'order_date',
    fields: [
      { id: 'orders',      label: 'Orders',        kind: 'measure', format: 'int' },
      { id: 'order_value', label: 'Order value ₹', kind: 'measure', format: 'inr' },
      { id: 'avg_order',   label: 'Average order ₹', kind: 'measure', format: 'inr' },
      { id: 'order_date',   label: 'Order date',    kind: 'dim', format: 'date', date: true },
      { id: 'invoice_date', label: 'Invoice date',  kind: 'dim', format: 'date', date: true },
      { id: 'financial_year', label: 'Financial year', kind: 'dim', format: 'text' },
      { id: 'product_category', label: 'Product category', kind: 'dim', format: 'text' },
      ...CLIENT_DIMS,
      { id: 'order_value_inr', label: 'Order ₹', kind: 'num', format: 'inr', defaultAgg: 'sum' },
    ],
  },
  {
    id: 'visits', label: 'Visits', icon: '\u{1F697}',
    description: 'Field visits: who went where, and what came of it.',
    dateLabel: 'Visit date', dateField: 'visit_date',
    fields: [
      { id: 'visits',          label: 'Visits',           kind: 'measure', format: 'int' },
      { id: 'clients_visited', label: 'Clients visited',  kind: 'measure', format: 'int' },
      { id: 'completed',       label: 'Completed',        kind: 'measure', format: 'int' },
      { id: 'planned_pct',     label: 'Planned %',        kind: 'measure', format: 'pct',
        hint: 'Share of visits that were planned rather than unplanned.' },
      { id: 'followups_open',  label: 'Follow-ups needed', kind: 'measure', format: 'int' },
      { id: 'visit_date',  label: 'Visit date',   kind: 'dim', format: 'date', date: true },
      { id: 'visit_rep',   label: 'Visiting rep', kind: 'dim', format: 'text',
        hint: 'Who made the visit. The account’s own rep is the shared "Sales rep" field.' },
      { id: 'purpose',     label: 'Purpose',      kind: 'dim', format: 'text' },
      { id: 'outcome',     label: 'Outcome',      kind: 'dim', format: 'text', hint: 'Recorded on about a fifth of visits.' },
      { id: 'visit_status', label: 'Status',      kind: 'dim', format: 'text' },
      { id: 'planned',     label: 'Planned?',     kind: 'dim', format: 'text' },
      ...CLIENT_DIMS,
    ],
  },
  {
    id: 'complaints', label: 'Complaints', icon: '⚠️',
    description: 'Customer complaints, their category and where they got to.',
    dateLabel: 'Complaint date', dateField: 'complaint_date',
    fields: [
      { id: 'complaints',   label: 'Complaints',      kind: 'measure', format: 'int' },
      { id: 'open',         label: 'Open',            kind: 'measure', format: 'int' },
      { id: 'closed',       label: 'Closed',          kind: 'measure', format: 'int' },
      { id: 'capa_raised',  label: 'CAPA raised',     kind: 'measure', format: 'int',
        hint: 'The internal corrective action of page 3, not the CAPA asked of a vendor.' },
      { id: 'repeat_rate',  label: 'Repeat %',        kind: 'measure', format: 'pct' },
      { id: 'fr_value',     label: 'Free-replacement ₹', kind: 'measure', format: 'inr',
        hint: 'Transport plus material, where recorded.' },
      { id: 'complaint_date', label: 'Complaint date', kind: 'dim', format: 'date', date: true },
      { id: 'closed_date',  label: 'Closed date',     kind: 'dim', format: 'date', date: true },
      { id: 'status',       label: 'Status',          kind: 'dim', format: 'text' },
      { id: 'category',     label: 'Category',        kind: 'dim', format: 'text' },
      { id: 'subcategory',  label: 'Sub-category',    kind: 'dim', format: 'text' },
      { id: 'severity',     label: 'Criticality',     kind: 'dim', format: 'text' },
      { id: 'root_cause',   label: 'Root cause',      kind: 'dim', format: 'text' },
      { id: 'responsible',  label: 'Responsible department', kind: 'dim', format: 'text',
        hint: 'Recorded on 66 of 414. Its vocabulary is not the one that governs access.' },
      { id: 'pump_model',   label: 'Pump model',      kind: 'dim', format: 'text' },
      { id: 'model_series', label: 'Model series',    kind: 'dim', format: 'text' },
      ...CLIENT_DIMS,
    ],
  },
  {
    id: 'clients', label: 'Clients', icon: '\u{1F3E2}',
    description: 'The customer master itself: who they are and what they are worth.',
    dateLabel: 'Added', dateField: 'created',
    fields: [
      { id: 'client_count',  label: 'Clients',          kind: 'measure', format: 'int' },
      { id: 'outstanding',   label: 'Outstanding ₹', kind: 'measure', format: 'inr',
        hint: 'Recorded for 334 clients.' },
      { id: 'created',       label: 'Added',            kind: 'dim', format: 'date', date: true },
      { id: 'last_visit',    label: 'Last visit',       kind: 'dim', format: 'date', date: true },
      { id: 'status',        label: 'Status',           kind: 'dim', format: 'text' },
      { id: 'is_sugar',      label: 'Sugar / non-sugar', kind: 'dim', format: 'text' },
      { id: 'country',       label: 'Country',          kind: 'dim', format: 'text' },
      ...CLIENT_DIMS,
      { id: 'total_outstanding', label: 'Outstanding ₹ (column)', kind: 'num', format: 'inr', defaultAgg: 'sum' },
      { id: 'tcd',               label: 'TCD',          kind: 'num', format: 'int', defaultAgg: 'avg' },
    ],
  },
  {
    id: 'pumps', label: 'Installed base', icon: '⚙️',
    description: 'Risansi pumps in the field, from the despatch records.',
    dateLabel: null, dateField: null,
    fields: [
      { id: 'pump_rows', label: 'Records',   kind: 'measure', format: 'int' },
      { id: 'pump_qty',  label: 'Pumps',     kind: 'measure', format: 'int' },
      { id: 'pump_clients', label: 'Clients with pumps', kind: 'measure', format: 'int' },
      { id: 'model',     label: 'Pump model', kind: 'dim', format: 'text' },
      { id: 'liquid',    label: 'Liquid',     kind: 'dim', format: 'text' },
      { id: 'capacity',  label: 'Capacity',   kind: 'dim', format: 'text' },
      { id: 'head',      label: 'Head',       kind: 'dim', format: 'text' },
      ...CLIENT_DIMS,
      { id: 'quantity',  label: 'Quantity',   kind: 'num', format: 'int', defaultAgg: 'sum' },
    ],
  },
  {
    id: 'competitors', label: 'Competitor base', icon: '\u{1F94A}',
    description: 'Whose pumps are on each site, and our share of them.',
    dateLabel: null, dateField: null,
    fields: [
      { id: 'sites',      label: 'Sites assessed', kind: 'measure', format: 'int' },
      { id: 'total_pumps', label: 'Pumps on site', kind: 'measure', format: 'int' },
      { id: 'ril_pumps',  label: 'Risansi pumps',  kind: 'measure', format: 'int' },
      { id: 'ril_share',  label: 'Risansi share %', kind: 'measure', format: 'pct' },
      { id: 'pcp_pumps',  label: 'PCP pumps',      kind: 'measure', format: 'int' },
      { id: 'mmp_pumps',  label: 'MMP pumps',      kind: 'measure', format: 'int' },
      { id: 'location',   label: 'Location',       kind: 'dim', format: 'text' },
      ...CLIENT_DIMS,
    ],
  },
];

export const DATASET_BY_ID = new Map(DATASETS.map(d => [d.id, d]));

export function fieldOf(datasetId: string, fieldId: string): ModelField | null {
  return DATASET_BY_ID.get(datasetId)?.fields.find(f => f.id === fieldId) ?? null;
}

/** The aggregations a field offers. A measure brings its own, so none. */
export function aggsFor(f: ModelField): Agg[] {
  if (f.kind === 'measure') return [];
  if (f.kind === 'num') return ['sum', 'avg', 'min', 'max', 'count'];
  return ['count', 'countd'];
}

/**
 * The same dimension, over on another table.
 *
 * Returns the target dataset's field id, or null when the two tables do not
 * line up on it. Shared dimensions map by their `common` key; a dataset's own
 * main date maps to the other's main date, so "by month" means each table's
 * own month rather than a join nobody asked for.
 */
export function mapDim(fromDs: string, fieldId: string, toDs: string): string | null {
  if (fromDs === toDs) return fieldId;
  const from = DATASET_BY_ID.get(fromDs), to = DATASET_BY_ID.get(toDs);
  if (!from || !to) return null;
  const f = from.fields.find(x => x.id === fieldId);
  if (!f) return null;
  if (f.common) return to.fields.find(x => x.common === f.common)?.id ?? null;
  if (fieldId === from.dateField && to.dateField) return to.dateField;
  return null;
}

/** Plain-English list of what two tables can be combined on. For the refusal message. */
export function combinableOn(toDs: string): string {
  const d = DATASET_BY_ID.get(toDs);
  if (!d) return '';
  const names = (d.fields.filter(f => f.common).map(f => SHARED_DIM_LABEL[f.common!]));
  if (d.dateField) names.push('their main date');
  return names.join(', ');
}
