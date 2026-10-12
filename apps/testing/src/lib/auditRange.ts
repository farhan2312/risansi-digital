/**
 * Shared date-window handling for every Audit Log route. The page sends
 * `?from=YYYY-MM-DD&to=YYYY-MM-DD` (either may be omitted = open-ended) and
 * those are calendar days in IST -- the team all works in India, and the
 * page labels its day/hour buckets "IST", so a day boundary here is IST
 * midnight rather than the server's (UTC on Vercel).
 */
import { sql, type AnyColumn, type SQL } from "drizzle-orm";

export const IST_OFFSET_MINUTES = 330;
const DAY_MS = 86_400_000;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

export interface AuditWindow {
  fromDay: string | null;
  toDay: string | null;
  /** Inclusive start / exclusive end instants, null = open-ended. */
  start: Date | null;
  end: Date | null;
}

export const istToday = (): string => new Date(Date.now() + IST_OFFSET_MINUTES * 60_000).toISOString().slice(0, 10);

const istMidnight = (day: string) => new Date(`${day}T00:00:00+05:30`);

export function windowFor(fromDay: string | null, toDay: string | null): AuditWindow {
  return {
    fromDay,
    toDay,
    start: fromDay ? istMidnight(fromDay) : null,
    end: toDay ? new Date(istMidnight(toDay).getTime() + DAY_MS) : null,
  };
}

export function parseAuditWindow(searchParams: URLSearchParams): AuditWindow {
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  return windowFor(from && DAY_RE.test(from) ? from : null, to && DAY_RE.test(to) ? to : null);
}

/** `col >= start and col < end`, skipping whichever bound is open. */
export function windowCondition(col: AnyColumn | SQL, w: AuditWindow): SQL {
  const parts: SQL[] = [];
  if (w.start) parts.push(sql`${col} >= ${w.start}`);
  if (w.end) parts.push(sql`${col} < ${w.end}`);
  return parts.length ? sql.join(parts, sql` and `) : sql`true`;
}

/** Every YYYY-MM-DD from `fromDay` to `toDay` inclusive. */
export function daysBetween(fromDay: string, toDay: string): string[] {
  const days: string[] = [];
  for (let t = Date.parse(`${fromDay}T00:00:00Z`); t <= Date.parse(`${toDay}T00:00:00Z`); t += DAY_MS) {
    days.push(new Date(t).toISOString().slice(0, 10));
  }
  return days;
}

/** The equal-length window immediately before this one -- only meaningful
 * when both ends are set (otherwise there is nothing to compare against). */
export function previousWindow(w: AuditWindow): AuditWindow | null {
  if (!w.fromDay || !w.toDay) return null;
  const length = daysBetween(w.fromDay, w.toDay).length;
  const prevTo = new Date(Date.parse(`${w.fromDay}T00:00:00Z`) - DAY_MS);
  const prevFrom = new Date(prevTo.getTime() - (length - 1) * DAY_MS);
  return windowFor(prevFrom.toISOString().slice(0, 10), prevTo.toISOString().slice(0, 10));
}
