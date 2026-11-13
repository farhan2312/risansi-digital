// Four reports somebody can open on their first visit.
//
// CLIENT-SAFE. These are plain report documents, identical in shape to one
// the builder saves, so "Use this template" is a copy and nothing more — the
// result is the reader's own report, editable, with no link back to here.
//
// WHY THESE FOUR, AND NOT THE ONES IN THE BRIEF
//
// The brief asked for Sales overview, Pipeline health, Production & quality,
// and Inventory health. The last two have nothing behind them: this portal
// holds no production, batch, scrap or stock data at all, so a template on
// either subject would open as four empty cards and teach the reader the
// tool is broken. Service & complaints and Coverage & visits are the two
// subjects the data actually answers, and the complaint module is the one
// the quality team already works out of daily.
//
// Every field id below is checked by the build: a template naming a field
// the model does not have is dropped by sanitizeDoc on save, so it would
// fail quietly. scripts/report-templates-check.mjs fails the build instead.

import type { ReportDoc, ReportPage, Visual, VisualType, FieldRef, ValueRef, Layout } from './types';
import { VISUAL_META } from './types';

export interface Template {
  key: string;
  title: string;
  description: string;
  icon: string;
  /** What a reader learns from it, for the card. */
  answers: string[];
  doc: ReportDoc;
}

// ── a small builder, so the layouts stay honest ───────────────
//
// Positions are written as rows of cards rather than as x/y pairs: a 12-column
// grid typed out by hand is how two cards end up on top of each other.

let seq = 0;
const id = (p: string) => `${p}${++seq}`;

type Spec = {
  type: VisualType;
  title?: string;
  dataset: string;
  axis?: FieldRef;
  split?: FieldRef;
  dims?: FieldRef[];
  values: ValueRef[];
  topN?: number;
  stacked?: boolean;
  /** Width in grid columns. Defaults to the type's own. */
  w?: number;
  h?: number;
};

/** Lay a row of cards out left to right, wrapping when the row is full. */
function row(y: number, specs: Spec[]): { visuals: Visual[]; next: number } {
  let x = 0, maxH = 0;
  const visuals: Visual[] = [];
  for (const s of specs) {
    const meta = VISUAL_META[s.type];
    const w = Math.min(s.w ?? meta.size.w, 12);
    const h = s.h ?? meta.size.h;
    if (x + w > 12) { x = 0; y += maxH; maxH = 0; }
    const layout: Layout = { x, y, w, h };
    visuals.push({
      id: id('v'),
      type: s.type,
      dataset: s.dataset,
      ...(s.axis ? { axis: s.axis } : {}),
      ...(s.split ? { split: s.split } : {}),
      ...(s.dims ? { dims: s.dims } : {}),
      values: s.values,
      ...(s.title ? { title: s.title } : {}),
      ...(s.topN ? { topN: s.topN } : {}),
      ...(s.stacked ? { stacked: true } : {}),
      layout,
    });
    x += w;
    maxH = Math.max(maxH, h);
  }
  return { visuals, next: y + maxH };
}

/** A page from rows of cards, stacked in order. */
function page(name: string, preset: string | null, rows: Spec[][]): ReportPage {
  let y = 0;
  const visuals: Visual[] = [];
  for (const r of rows) {
    const laid = row(y, r);
    visuals.push(...laid.visuals);
    y = laid.next;
  }
  return {
    id: id('p'),
    name,
    filters: preset ? { datePreset: preset } : {},
    visuals,
  };
}

const kpi = (dataset: string, field: string, title: string): Spec =>
  ({ type: 'kpi', dataset, title, values: [{ field }] });

const FY = 'This FY';

// ── 1. Sales overview ─────────────────────────────────────────

const salesOverview: ReportDoc = {
  version: 1,
  pages: [
    page('Revenue', FY, [
      [
        kpi('revenue', 'revenue', 'Revenue'),
        kpi('revenue', 'pump_revenue', 'Pumps'),
        kpi('revenue', 'spare_revenue', 'Spares'),
        kpi('revenue', 'clients_billed', 'Clients billed'),
      ],
      [
        { type: 'column', dataset: 'revenue', title: 'Revenue by month',
          axis: { field: 'month', grain: 'month' }, values: [{ field: 'revenue' }] },
        { type: 'bar', dataset: 'revenue', title: 'Top clients',
          axis: { field: 'client' }, values: [{ field: 'revenue' }], topN: 12 },
      ],
      [
        { type: 'donut', dataset: 'revenue', title: 'Direct vs OEM',
          axis: { field: 'client_type' }, values: [{ field: 'revenue' }] },
        { type: 'bar', dataset: 'revenue', title: 'By state',
          axis: { field: 'state' }, values: [{ field: 'revenue' }], topN: 10 },
      ],
      [
        { type: 'table', dataset: 'revenue', title: 'Revenue by client',
          dims: [{ field: 'client' }, { field: 'rep' }],
          values: [{ field: 'revenue' }, { field: 'pump_revenue' }, { field: 'spare_revenue' }],
          w: 12 },
      ],
    ]),
    page('Orders in hand', FY, [
      [
        kpi('orders', 'orders', 'Orders'),
        kpi('orders', 'order_value', 'Order value'),
        kpi('orders', 'avg_order', 'Average order'),
      ],
      [
        { type: 'column', dataset: 'orders', title: 'Order value by month',
          axis: { field: 'order_date', grain: 'month' }, values: [{ field: 'order_value' }] },
        { type: 'bar', dataset: 'orders', title: 'By product category',
          axis: { field: 'product_category' }, values: [{ field: 'order_value' }], topN: 12 },
      ],
      [
        { type: 'table', dataset: 'orders', title: 'Orders by client',
          dims: [{ field: 'client' }, { field: 'rep' }],
          values: [{ field: 'orders' }, { field: 'order_value' }], w: 12 },
      ],
    ]),
    // No date filter on purpose. This page exists to show the long arc — 92
    // months of billing against orders taken — and the question it answers
    // ("have orders kept up?") is not one a single financial year can.
    page('Revenue vs orders', null, [
      [
        { type: 'line', dataset: 'revenue', title: 'Billed revenue against orders taken',
          axis: { field: 'month', grain: 'month' },
          values: [{ field: 'revenue' }, { field: 'order_value', dataset: 'orders' }], w: 12, h: 7 },
      ],
      [
        { type: 'table', dataset: 'revenue', title: 'By client, both tables',
          dims: [{ field: 'client' }],
          values: [{ field: 'revenue' }, { field: 'order_value', dataset: 'orders' }], w: 12 },
      ],
    ]),
  ],
};

// ── 2. Pipeline health ────────────────────────────────────────

const pipelineHealth: ReportDoc = {
  version: 1,
  pages: [
    page('Where it stands', FY, [
      [
        kpi('pipeline', 'opportunities', 'Opportunities'),
        kpi('pipeline', 'open_value', 'Open value'),
        kpi('pipeline', 'won_value', 'Won value'),
        kpi('pipeline', 'win_rate', 'Win rate'),
      ],
      [
        { type: 'column', dataset: 'pipeline', title: 'By stage',
          axis: { field: 'stage' }, values: [{ field: 'opportunities' }] },
        { type: 'bar', dataset: 'pipeline', title: 'Open value by client',
          axis: { field: 'client' }, values: [{ field: 'open_value' }], topN: 12 },
      ],
      [
        { type: 'line', dataset: 'pipeline', title: 'Raised each month',
          axis: { field: 'created', grain: 'month' },
          values: [{ field: 'opportunities' }, { field: 'won' }, { field: 'lost' }] },
        { type: 'donut', dataset: 'pipeline', title: 'By market',
          axis: { field: 'market' }, values: [{ field: 'offer_value' }] },
      ],
    ]),
    page('Won and lost', FY, [
      [
        kpi('pipeline', 'won', 'Won'),
        kpi('pipeline', 'lost', 'Lost'),
        kpi('pipeline', 'win_rate', 'Win rate'),
      ],
      [
        { type: 'bar', dataset: 'pipeline', title: 'Lost to whom',
          axis: { field: 'lost_to' }, values: [{ field: 'lost' }], topN: 12 },
        { type: 'bar', dataset: 'pipeline', title: 'Why they were dropped',
          axis: { field: 'drop_reason' }, values: [{ field: 'opportunities' }], topN: 12 },
      ],
      [
        { type: 'matrix', dataset: 'pipeline', title: 'Stage by rep',
          axis: { field: 'rep' }, split: { field: 'stage' },
          values: [{ field: 'opportunities' }], w: 12 },
      ],
      [
        { type: 'table', dataset: 'pipeline', title: 'Opportunities by rep',
          dims: [{ field: 'rep' }],
          values: [{ field: 'opportunities' }, { field: 'offer_value' }, { field: 'won' },
                   { field: 'lost' }, { field: 'win_rate' }], w: 12 },
      ],
    ]),
  ],
};

// ── 3. Service and complaints ─────────────────────────────────

const serviceQuality: ReportDoc = {
  version: 1,
  pages: [
    page('Complaints', FY, [
      [
        kpi('complaints', 'complaints', 'Complaints'),
        kpi('complaints', 'open', 'Still open'),
        kpi('complaints', 'capa_raised', 'CAPA raised'),
        kpi('complaints', 'fr_value', 'Free replacement'),
      ],
      [
        { type: 'column', dataset: 'complaints', title: 'Raised each month',
          axis: { field: 'complaint_date', grain: 'month' },
          split: { field: 'status' }, values: [{ field: 'complaints' }], stacked: true },
        { type: 'bar', dataset: 'complaints', title: 'By category',
          axis: { field: 'category' }, values: [{ field: 'complaints' }], topN: 12 },
      ],
      [
        { type: 'donut', dataset: 'complaints', title: 'By criticality',
          axis: { field: 'severity' }, values: [{ field: 'complaints' }] },
        { type: 'bar', dataset: 'complaints', title: 'Clients complaining most',
          axis: { field: 'client' }, values: [{ field: 'complaints' }], topN: 12 },
      ],
      [
        { type: 'table', dataset: 'complaints', title: 'By category and root cause',
          dims: [{ field: 'category' }, { field: 'root_cause' }],
          values: [{ field: 'complaints' }, { field: 'open' }, { field: 'capa_raised' },
                   { field: 'fr_value' }], w: 12 },
      ],
    ]),
    page('Product', FY, [
      [
        { type: 'bar', dataset: 'complaints', title: 'By model series',
          axis: { field: 'model_series' }, values: [{ field: 'complaints' }], topN: 12 },
        { type: 'bar', dataset: 'complaints', title: 'By pump model',
          axis: { field: 'pump_model' }, values: [{ field: 'complaints' }], topN: 12 },
      ],
      [
        { type: 'matrix', dataset: 'complaints', title: 'Category by criticality',
          axis: { field: 'category' }, split: { field: 'severity' },
          values: [{ field: 'complaints' }], w: 12 },
      ],
    ]),
  ],
};

// ── 4. Coverage and visits ────────────────────────────────────

const coverage: ReportDoc = {
  version: 1,
  pages: [
    page('Visits', FY, [
      [
        kpi('visits', 'visits', 'Visits'),
        kpi('visits', 'clients_visited', 'Clients seen'),
        kpi('visits', 'completed', 'Completed'),
        kpi('visits', 'planned_pct', 'Planned'),
      ],
      [
        { type: 'column', dataset: 'visits', title: 'Visits each month',
          axis: { field: 'visit_date', grain: 'month' },
          values: [{ field: 'visits' }, { field: 'clients_visited' }] },
        { type: 'bar', dataset: 'visits', title: 'By visiting rep',
          axis: { field: 'visit_rep' }, values: [{ field: 'visits' }], topN: 15 },
      ],
      [
        { type: 'donut', dataset: 'visits', title: 'Why they went',
          axis: { field: 'purpose' }, values: [{ field: 'visits' }] },
        { type: 'bar', dataset: 'visits', title: 'By state',
          axis: { field: 'state' }, values: [{ field: 'visits' }], topN: 12 },
      ],
      [
        { type: 'table', dataset: 'visits', title: 'Coverage by rep',
          dims: [{ field: 'visit_rep' }],
          values: [{ field: 'visits' }, { field: 'clients_visited' }, { field: 'completed' },
                   { field: 'followups_open' }, { field: 'planned_pct' }], w: 12 },
      ],
    ]),
    // The client master has no useful main date for this question — "Added" is
    // when the row was typed in, not when the account became live — so this
    // page carries no date filter rather than one that misleads.
    page('The accounts themselves', null, [
      [
        kpi('clients', 'client_count', 'Clients'),
        kpi('clients', 'outstanding', 'Outstanding'),
      ],
      [
        { type: 'treemap', dataset: 'clients', title: 'Clients by industry',
          axis: { field: 'industry' }, values: [{ field: 'client_count' }] },
        { type: 'bar', dataset: 'clients', title: 'Outstanding by client',
          axis: { field: 'client' }, values: [{ field: 'outstanding' }], topN: 15 },
      ],
      [
        { type: 'table', dataset: 'clients', title: 'Accounts by rep and tier',
          dims: [{ field: 'rep' }, { field: 'tier' }],
          values: [{ field: 'client_count' }, { field: 'outstanding' }], w: 12 },
      ],
    ]),
  ],
};

export const TEMPLATES: Template[] = [
  {
    key: 'sales-overview',
    title: 'Sales overview',
    description: 'Billed revenue and orders in hand, by month, client, state and channel.',
    icon: '\u{1F4B0}',
    answers: ['Where is the revenue coming from?', 'Pumps or spares?', 'Have orders kept up with billing?'],
    doc: salesOverview,
  },
  {
    key: 'pipeline-health',
    title: 'Pipeline health',
    description: 'What is open, what closed, and what it closed against.',
    icon: '\u{1F3AF}',
    answers: ['How much is sitting at each stage?', 'What is our win rate?', 'Who are we losing to?'],
    doc: pipelineHealth,
  },
  {
    key: 'service-quality',
    title: 'Service and complaints',
    description: 'Complaints by category, criticality, root cause and model.',
    icon: '⚠️',
    answers: ['What is still open?', 'Which models come back?', 'What is free replacement costing?'],
    doc: serviceQuality,
  },
  {
    key: 'coverage',
    title: 'Coverage and visits',
    description: 'Field activity by rep and state, against the accounts themselves.',
    icon: '\u{1F697}',
    answers: ['Who is getting out?', 'Which states are being covered?', 'Where is the outstanding?'],
    doc: coverage,
  },
];

export const templateByKey = (key: string): Template | null =>
  TEMPLATES.find(t => t.key === key) ?? null;
