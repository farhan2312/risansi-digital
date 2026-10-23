// What a rep is measured on. The catalogue only — no database.
//
// Split out of risansi-rep-targets so the panel that draws these can be a
// client component. That module opens a pg pool at import time, and a client
// component importing it drags the driver into the browser bundle, which the
// build rejects. The queries stay there; the three metric definitions live
// here, where both sides can read them.

export const TARGET_METRICS = ['revenue_cr', 'new_clients', 'visits'] as const;
export type TargetMetric = typeof TARGET_METRICS[number];

export interface MetricDef {
  key: TargetMetric;
  label: string;
  /** What the number means, said once, on the tile. */
  unit: 'cr' | 'count';
  hint: string;
}

export const METRIC_DEFS: MetricDef[] = [
  { key: 'revenue_cr',  label: 'Revenue',     unit: 'cr',
    hint: 'Invoiced revenue on the accounts you own, this financial year.' },
  { key: 'new_clients', label: 'New Clients', unit: 'count',
    hint: 'Accounts you added this financial year — bulk imports are not counted.' },
  { key: 'visits',      label: 'Visits',      unit: 'count',
    hint: 'Visit reports you submitted this financial year.' },
];

export type TargetSet = Record<TargetMetric, number | null>;
export const EMPTY_TARGETS: TargetSet = { revenue_cr: null, new_clients: null, visits: null };
