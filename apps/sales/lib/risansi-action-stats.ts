// The numbers above the Action Registry list.
//
// Pure: takes the rows buildTasksStatsQuery returns and today's date as text,
// and gives back every tile and chart. Kept out of the page so it can be run
// against production rows in a script (scripts/action-stats-preview.mjs) and
// so the sums can be checked — every owner's open + done must equal their
// total, every action must land in exactly one age bucket, and so on.
//
// Dates are YYYY-MM-DD strings throughout; "days between" is done on UTC
// midnights built from the parts, which is timezone-proof for whole days.

export interface ActionStatRow {
  id: number;
  status: string;
  priority: string;
  due_date: string | null;
  created_on: string;
  completed_on: string | null;
  owner: string;
  client_name: string | null;
  extensions: number;
  comments: number;
  first_response_h: number | null;
}

export interface OwnerBar { label: string; total: number; open: number; overdue: number; done: number }
export interface CountBucket { label: string; count: number }
export interface MonthPoint { key: string; label: string; raised: number; closed: number }

const dayIdx = (iso: string) => {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 86400000);
};
const daysBetween = (a: string, b: string) => dayIdx(b) - dayIdx(a);
const avg = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);
const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b), m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export const AGE_BUCKETS = [
  { label: '0–7d',   min: 0,  max: 7 },
  { label: '8–30d',  min: 8,  max: 30 },
  { label: '31–90d', min: 31, max: 90 },
  { label: '90d+',   min: 91, max: null as number | null },
];

export function summariseActions(rows: ActionStatRow[], today: string) {
  const isOpen = (r: ActionStatRow) => r.status !== 'completed';
  const isOverdue = (r: ActionStatRow) => isOpen(r) && !!r.due_date && r.due_date < today;
  const open = rows.filter(isOpen);
  const done = rows.filter(r => !isOpen(r));
  const overdue = rows.filter(isOverdue);
  const weekEnd = (() => { const d = new Date(dayIdx(today) * 86400000 + 7 * 86400000); return d.toISOString().slice(0, 10); })();
  const dueSoon = open.filter(r => r.due_date && r.due_date >= today && r.due_date <= weekEnd);

  const openAges = open.map(r => daysBetween(r.created_on, today));
  const closeTimes = done.filter(r => r.completed_on).map(r => daysBetween(r.created_on, r.completed_on as string));
  const withDue = done.filter(r => r.completed_on && r.due_date);
  const onTime = withDue.filter(r => (r.completed_on as string) <= (r.due_date as string));
  const overdueDays = overdue.map(r => daysBetween(r.due_date as string, today));

  const extended = rows.filter(r => r.extensions > 0);
  const responded = rows.filter(r => r.first_response_h != null);

  // Per owner: total, open, overdue, done. Overdue is a subset of open.
  const byOwner = (() => {
    const m = new Map<string, OwnerBar>();
    for (const r of rows) {
      const cur = m.get(r.owner) ?? { label: r.owner, total: 0, open: 0, overdue: 0, done: 0 };
      cur.total++;
      if (isOpen(r)) { cur.open++; if (isOverdue(r)) cur.overdue++; } else cur.done++;
      m.set(r.owner, cur);
    }
    return [...m.values()].sort((a, b) => b.open - a.open || b.total - a.total || a.label.localeCompare(b.label));
  })();

  const PRI = ['High', 'Medium', 'Low'];
  const byPriority: OwnerBar[] = PRI.map(p => {
    const xs = rows.filter(r => (r.priority || 'Medium') === p);
    return { label: p, total: xs.length, open: xs.filter(isOpen).length, overdue: xs.filter(isOverdue).length, done: xs.filter(r => !isOpen(r)).length };
  }).filter(b => b.total > 0);

  const openByAge: CountBucket[] = AGE_BUCKETS.map(b => ({
    label: b.label,
    count: openAges.filter(a => a >= b.min && (b.max == null || a <= b.max)).length,
  }));

  // Raised and closed per month, the last six months including this one.
  const monthKey = (iso: string) => iso.slice(0, 7);
  const months: MonthPoint[] = [];
  {
    const [ty, tm] = today.split('-').map(Number);
    for (let i = 5; i >= 0; i--) {
      const d = new Date(Date.UTC(ty, tm - 1 - i, 1));
      const key = d.toISOString().slice(0, 7);
      months.push({
        key,
        label: d.toLocaleString('en-GB', { month: 'short', timeZone: 'UTC' }),
        raised: rows.filter(r => monthKey(r.created_on) === key).length,
        closed: rows.filter(r => r.completed_on && monthKey(r.completed_on) === key).length,
      });
    }
  }

  const mostExtended = [...extended].sort((a, b) => b.extensions - a.extensions).slice(0, 5);

  return {
    total: rows.length,
    open: open.length, overdue: overdue.length, done: done.length, dueSoon: dueSoon.length,
    avgOpenAge: avg(openAges), oldestOpen: openAges.length ? Math.max(...openAges) : null,
    avgOverdueBy: avg(overdueDays),
    avgTimeToClose: avg(closeTimes), medianTimeToClose: median(closeTimes),
    onTimeRate: withDue.length ? onTime.length / withDue.length : null, onTimeBase: withDue.length,
    extensionsTotal: rows.reduce((s, r) => s + r.extensions, 0),
    extendedCount: extended.length,
    avgExtensions: rows.length ? rows.reduce((s, r) => s + r.extensions, 0) / rows.length : 0,
    avgFirstResponseH: avg(responded.map(r => r.first_response_h as number)),
    medianFirstResponseH: median(responded.map(r => r.first_response_h as number)),
    respondedCount: responded.length,
    commentsTotal: rows.reduce((s, r) => s + r.comments, 0),
    byOwner, byPriority, openByAge, months, mostExtended,
  };
}

export type ActionSummary = ReturnType<typeof summariseActions>;
