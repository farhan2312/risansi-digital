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
    hint: 'Accounts you added this financial year — bulk imports are not counted.' },
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

  // Accounts added this year, by a PERSON.
  //
  // created_by is an email address when somebody adds a client and a tag when
  // a loader does — 'migration', 'leads-import', 'prospect-import-0707',
  // 'quote-import' and so on. Requiring the '@' is what separates the two, and
  // it has to be separated: the book was loaded into the portal in June and
  // July 2026, so counting every row created this financial year gives 2,433
  // "new clients" against 386 that a person actually added. A target set
  // against the first number would be meaningless and a rep's tile would read
  // 300 clients against a target of 40.
  //
  // It keeps working without maintenance — a future import carries its own tag
  // and is excluded for the same reason, not because its date was hardcoded.
  //
  // DUPLICATE is excluded too: merging two records of one customer is
  // housekeeping, not a new account.
  const cl = await risansiPool.query<{ rep_id: number; n: string }>(
    `SELECT primary_rep_id AS rep_id, count(*)::text AS n
       FROM clients
      WHERE primary_rep_id IS NOT NULL AND deleted_at IS NULL
        AND status <> 'DUPLICATE'
        AND created_by LIKE '%@%'
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

/**
 * The rows a TargetsPanel draws, assembled for one person or for everybody.
 *
 * `self` gives the person their own row, plus a team row when they manage
 * one. `all` gives the company total and then every rep individually, which
 * is what the front dashboard asks for by name.
 *
 * One pair of queries either way — the targets and the achieved figures are
 * both read for everyone and then picked from, because the alternative is a
 * round trip per rep per metric and this sits on the portal's front page.
 */
export async function buildTargetEntries(opts: {
  scope: 'self' | 'all';
  repId: number | null;
  fy: { code: string; label: string; startDate: string; endDate: string };
}): Promise<{ fyLabel: string; elapsedPct: number; entries: TargetEntryData[] }> {
  const { scope, repId, fy } = opts;
  const elapsedPct = fyElapsed(fy.startDate, fy.endDate) * 100;
  const base = { fyLabel: fy.label, elapsedPct, entries: [] as TargetEntryData[] };

  const [targets, achieved, holders, teams] = await Promise.all([
    loadTargets(fy.code),
    loadAchieved(fy.startDate, fy.endDate),
    targetHolders(),
    teamsByManager(),
  ]);

  const zero = (): Record<TargetMetric, number> => ({ revenue_cr: 0, new_clients: 0, visits: 0 });
  const got = (id: number) => achieved.get(id) ?? zero();
  const tgt = (id: number) => targets.get(id) ?? { ...EMPTY_TARGETS };

  /** Sum a set of people into one row. A target of null stays null unless at
   *  least one person in the set has one — a team where nobody was given a
   *  visits target has no team visits target, rather than one of zero. */
  const roll = (ids: number[]) => {
    const t: TargetSet = { ...EMPTY_TARGETS };
    const a = zero();
    for (const id of ids) {
      const ti = tgt(id), ai = got(id);
      for (const m of TARGET_METRICS) {
        if (ti[m] != null) t[m] = (t[m] ?? 0) + ti[m]!;
        a[m] += ai[m] ?? 0;
      }
    }
    return { target: t, achieved: a };
  };

  if (scope === 'self') {
    if (repId == null) return base;
    const me = holders.find(h => h.id === repId);
    base.entries.push({
      label: me ? me.name : 'You',
      sub: 'your own accounts and visits',
      target: tgt(repId), achieved: got(repId),
    });
    const team = teams.get(repId) ?? [];
    if (team.length > 0) {
      base.entries.push({
        label: 'Your team',
        sub: `${team.length} rep${team.length === 1 ? '' : 's'}, not counting your own book`,
        ...roll(team),
      });
    }
    return base;
  }

  const ids = holders.map(h => h.id);
  base.entries.push({
    label: 'All reps',
    sub: `${ids.length} people`,
    ...roll(ids),
  });
  for (const h of holders) {
    base.entries.push({ label: h.name, sub: h.role, target: tgt(h.id), achieved: got(h.id) });
  }
  return base;
}

export interface TargetEntryData {
  label: string;
  sub?: string | null;
  target: TargetSet;
  achieved: Record<TargetMetric, number>;
}
