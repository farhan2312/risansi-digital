// Named date ranges, for the quick-select beside a date-range filter.
//
// The financial year is April to March, so "this quarter" is Q1 Apr–Jun and
// not the calendar quarter — a report that says Q3 and means Jul–Sep would be
// read wrong by everyone here. Everything is computed in IST for the same
// reason the rest of the portal is: the server runs on UTC, five and a half
// hours behind, so late in the evening "today" would otherwise be yesterday.

export interface DateRange { from: string; to: string }

const iso = (d: Date) => d.toISOString().slice(0, 10);
/** Today in IST, as a UTC-midnight Date so the arithmetic below stays date-only. */
function istNow(now = Date.now()): Date {
  const d = new Date(now + 5.5 * 60 * 60 * 1000);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}
const monthStart = (y: number, m: number) => new Date(Date.UTC(y, m, 1));
const monthEnd   = (y: number, m: number) => new Date(Date.UTC(y, m + 1, 0));
const addDays    = (d: Date, n: number) => new Date(d.getTime() + n * 86400000);

/** The financial year a month belongs to: April 2026 → 2026, February 2027 → 2026. */
export const fyOf = (y: number, m: number) => (m >= 3 ? y : y - 1);
/** Which FY quarter a month is in, 0-based from April. */
const fyQuarterOf = (m: number) => Math.floor(((m - 3) + 12) % 12 / 3);

export const DATE_PRESETS = [
  'Today', 'This week', 'Last 7 days', 'Last 30 days',
  'This month', 'Last month', 'Next month',
  'This quarter', 'Last quarter', 'Next quarter',
  'This FY', 'Last FY',
] as const;
export type DatePreset = typeof DATE_PRESETS[number];

/** The from/to a named range means today. Null for a name it does not know. */
export function presetRange(name: string, now = Date.now()): DateRange | null {
  const t = istNow(now);
  const y = t.getUTCFullYear(), m = t.getUTCMonth(), dow = t.getUTCDay();
  const qStart = (fy: number, q: number) => monthStart(fy + (q === 3 ? 1 : 0), (3 + q * 3) % 12);
  const qEnd   = (fy: number, q: number) => monthEnd(fy + (q >= 2 ? 1 : 0) - (q === 2 ? 1 : 0), (5 + q * 3) % 12);
  const fy = fyOf(y, m), q = fyQuarterOf(m);

  switch (name) {
    case 'Today':        return { from: iso(t), to: iso(t) };
    // Monday to Sunday: the week a field plan is written against.
    case 'This week':    { const mon = addDays(t, -((dow + 6) % 7)); return { from: iso(mon), to: iso(addDays(mon, 6)) }; }
    case 'Last 7 days':  return { from: iso(addDays(t, -6)), to: iso(t) };
    case 'Last 30 days': return { from: iso(addDays(t, -29)), to: iso(t) };
    case 'This month':   return { from: iso(monthStart(y, m)), to: iso(monthEnd(y, m)) };
    case 'Last month':   return { from: iso(monthStart(y, m - 1)), to: iso(monthEnd(y, m - 1)) };
    case 'Next month':   return { from: iso(monthStart(y, m + 1)), to: iso(monthEnd(y, m + 1)) };
    case 'This quarter':  return { from: iso(qStart(fy, q)), to: iso(qEnd(fy, q)) };
    case 'Last quarter':  { const pq = (q + 3) % 4, pfy = q === 0 ? fy - 1 : fy; return { from: iso(qStart(pfy, pq)), to: iso(qEnd(pfy, pq)) }; }
    case 'Next quarter':  { const nq = (q + 1) % 4, nfy = q === 3 ? fy + 1 : fy; return { from: iso(qStart(nfy, nq)), to: iso(qEnd(nfy, nq)) }; }
    case 'This FY':      return { from: `${fy}-04-01`, to: `${fy + 1}-03-31` };
    case 'Last FY':      return { from: `${fy - 1}-04-01`, to: `${fy}-03-31` };
    default:             return null;
  }
}

/** The preset a from/to pair matches exactly, so the dropdown can show it. */
export function matchPreset(from: string, to: string, now = Date.now()): DatePreset | null {
  if (!from || !to) return null;
  return DATE_PRESETS.find(p => { const r = presetRange(p, now); return r && r.from === from && r.to === to; }) ?? null;
}

/** "1–31 Oct 2026", or the two dates when the range is not a whole month. */
export function rangeLabel(from: string, to: string): string {
  if (!from && !to) return '';
  const d = (s: string) => new Date(s + 'T00:00:00Z').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: '2-digit', timeZone: 'UTC' });
  if (!from) return `until ${d(to)}`;
  if (!to) return `from ${d(from)}`;
  return from === to ? d(from) : `${d(from)} → ${d(to)}`;
}
