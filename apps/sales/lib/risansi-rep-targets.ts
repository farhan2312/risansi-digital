// Targets, and what has actually been done against them.
//
// Three metrics, one row each per person per financial year (migration 0122).
// Everything here is read-only; Admin › Settings owns the writing.
//
// ── Attribution ─────────────────────────────────────────────────
//
// Revenue and new clients follow the ACCOUNT: a rep's figure is their own
// accounts, the ones they are primary rep on. Visits follow the PERSON: the
// rep who made the visit, whoever owns the account. That split is deliberate
// and matches how the rest of the portal counts — covering somebody's account
// does not make its revenue yours, but a visit you drove to is yours.
//
// A manager's own row is their own book by the same rule, and their team is
// summed separately rather than folded in. Adding the two would double-count
// a manager who owns accounts directly, and plenty do.

import risansiPool from '@/lib/db-risansi';

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
    hint: 'Accounts added this financial year with you as primary rep.' },
  { key: 'visits',      label: 'Visits',      unit: 'count',
    hint: 'Visit reports you submitted this financial year.' },
];

export type TargetSet = Record<TargetMetric, number | null>;
export const EMPTY_TARGETS: TargetSet = { revenue_cr: null, new_clients: null, visits: null };

export interface RepProgress {
  repId: number;
  name: string;
  role: string;
  target: TargetSet;
  achieved: Record<TargetMetric, number>;
}

/**
 * Every target for a year, by rep.
 *
 * Returns an empty map rather than throwing when rep_targets does not exist.
 * The table arrives by migration, and a deploy that reaches production first
 * must show a dashboard with no targets on it, not a stack trace on the
 * portal's front page.
 */
export async function loadTargets(fy: string): Promise<Map<number, TargetSet>> {
  const out = new Map<number, TargetSet>();
  try {
    const { rows } = await risansiPool.query<{ user_id: number; metric: string; value: string }>(
      `SELECT user_id, metric, value::text AS value FROM rep_targets WHERE fy = $1`, [fy]);
    for (const r of rows) {
      const cur = out.get(r.user_id) ?? { ...EMPTY_TARGETS };
      if ((TARGET_METRICS as readonly string[]).includes(r.metric)) {
        const n = Number(r.value);
        // 0 is stored and means "no target set". A denominator of nothing is
        // not a bar anybody can clear, so it reads the same as unset.
        cur[r.metric as TargetMetric] = Number.isFinite(n) && n > 0 ? n : null;
      }
      out.set(r.user_id, cur);
    }
  } catch (e) {
    console.error('[targets] rep_targets unreadable — showing no targets', e);
  }
  return out;
}

/**
 * What each rep has actually done this year.
 *
 * One query per metric over every rep at once, rather than three per rep: the
 * dashboard draws sixteen people and forty-eight round trips would be felt.
 */
export async function loadAchieved(
  fyStart: string, fyEnd: string,
): Promise<Map<number, Record<TargetMetric, number>>> {
  const out = new Map<number, Record<TargetMetric, number>>();
  const put = (id: number, k: TargetMetric, v: number) => {
    const cur = out.get(id) ?? { revenue_cr: 0, new_clients: 0, visits: 0 };
    cur[k] = v;
    out.set(id, cur);
  };

  // Revenue, in Crores, on the accounts this person is primary rep for.
  // client_revenue_monthly.month is a date; the FY window is half-open on the
  // end so the last day of March is included exactly once.
  const rev = await risansiPool.query<{ rep_id: number; cr: string }>(
    `SELECT c.primary_rep_id AS rep_id,
            (COALESCE(SUM(crm.total_value), 0) / 10000000.0)::text AS cr
       FROM client_revenue_monthly crm
       JOIN clients c ON c.id = crm.client_id
      WHERE c.primary_rep_id IS NOT NULL
        AND crm.month >= $1::date AND crm.month <= $2::date
      GROUP BY 1`, [fyStart, fyEnd]).catch(() => ({ rows: [] as { rep_id: number; cr: string }[] }));
  for (const r of rev.rows) put(Number(r.rep_id), 'revenue_cr', Number(r.cr) || 0);

  // Accounts added this year. DUPLICATE is excluded: merging two records of
  // one customer is housekeeping, not a new account.
  const cl = await risansiPool.query<{ rep_id: number; n: string }>(
    `SELECT primary_rep_id AS rep_id, count(*)::text AS n
       FROM clients
      WHERE primary_rep_id IS NOT NULL AND deleted_at IS NULL
        AND status <> 'DUPLICATE'
        AND created_at >= $1::date AND created_at < ($2::date + 1)
      GROUP BY 1`, [fyStart, fyEnd]).catch(() => ({ rows: [] as { rep_id: number; n: string }[] }));
  for (const r of cl.rows) put(Number(r.rep_id), 'new_clients', Number(r.n) || 0);

  // Visits, counted when the report was submitted rather than when the visit
  // was planned — a plan is not a visit, and a check-in with no report is not
  // one either.
  const vis = await risansiPool.query<{ rep_id: number; n: string }>(
    `SELECT rep_id, count(*)::text AS n
       FROM visits
      WHERE rep_id IS NOT NULL AND submitted_at IS NOT NULL
        AND submitted_at >= $1::date AND submitted_at < ($2::date + 1)
      GROUP BY 1`, [fyStart, fyEnd]).catch(() => ({ rows: [] as { rep_id: number; n: string }[] }));
  for (const r of vis.rows) put(Number(r.rep_id), 'visits', Number(r.n) || 0);

  return out;
}

/**
 * How far through the financial year we are, 0..1.
 *
 * The on-track marker uses it: in July, 2.5 Cr of a 10 Cr year is behind, and
 * a dashboard that only shows 25% against 100% says that badly. Clamped,
 * because a target dashboard opened on 31 March should not read 100.3%.
 */
export function fyElapsed(fyStart: string, fyEnd: string, now = new Date()): number {
  const s = Date.parse(`${fyStart}T00:00:00Z`);
  const e = Date.parse(`${fyEnd}T23:59:59Z`);
  if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s) return 0;
  return Math.min(1, Math.max(0, (now.getTime() - s) / (e - s)));
}

/** Everyone who can hold a target: the people with a book to answer for. */
export async function targetHolders(): Promise<{ id: number; name: string; role: string }[]> {
  const { rows } = await risansiPool.query<{ id: number; name: string; role: string }>(
    `SELECT id, name, role FROM users
      WHERE is_active AND role IN ('rep', 'manager')
      ORDER BY role, name`);
  return rows;
}

/** rep_id → manager_id, for rolling a manager's team up. */
export async function teamsByManager(): Promise<Map<number, number[]>> {
  const { rows } = await risansiPool.query<{ manager_id: number; rep_id: number }>(
    `SELECT manager_id, rep_id FROM manager_reps`);
  const out = new Map<number, number[]>();
  for (const r of rows) {
    const cur = out.get(Number(r.manager_id)) ?? [];
    cur.push(Number(r.rep_id));
    out.set(Number(r.manager_id), cur);
  }
  return out;
}
