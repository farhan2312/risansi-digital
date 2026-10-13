/**
 * Range presets for the audit log, shared by the page (which turns one into a
 * SQL cutoff) and the view (which renders the buttons). Plain module so both
 * sides agree on the keys.
 */

export type AuditRange = "today" | "7d" | "30d" | "all";
export type AuditTab = "overview" | "by_user" | "activity" | "logins" | "ownership";

/** The tab the page opens on, which the URL leaves out. */
export const DEFAULT_AUDIT_TAB: AuditTab = "overview";

export const AUDIT_RANGES: { key: AuditRange; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "7d", label: "7 days" },
  { key: "30d", label: "30 days" },
  { key: "all", label: "All" },
];

export const AUDIT_TABS: { key: AuditTab; label: string }[] = [
  { key: "overview", label: "Overview" },
  { key: "by_user", label: "Usage by User" },
  { key: "activity", label: "Activity" },
  { key: "logins", label: "Logins & Sessions" },
  { key: "ownership", label: "Ownership Changes" },
];

/** Which `audit_log.category` each event tab shows. */
export const AUDIT_CATEGORY_BY_TAB: Record<string, string | null> = {
  overview: null,
  by_user: null,
  activity: "activity",
  logins: "auth",
  ownership: "ownership",
};

const DAY = 86_400_000;

/**
 * Midnight IST today. Not `setHours(0,0,0,0)`, which zeroes the *runtime's*
 * local timezone — UTC on the server, the browser's tz after hydration — and
 * would split "Today" across two different cutoffs.
 */
function todayStartIst(): Date {
  const isoDate = new Date().toLocaleDateString("en-CA", {
    timeZone: "Asia/Kolkata",
  });
  return new Date(`${isoDate}T00:00:00+05:30`);
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** A YYYY-MM-DD that is a real calendar date, or null. */
export function parseAuditDate(value: string | undefined): string | null {
  if (!value || !ISO_DATE.test(value)) return null;
  const d = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== value
    ? null
    : value;
}

/** Midnight IST at the start of a YYYY-MM-DD. */
function istMidnight(date: string): Date {
  return new Date(`${date}T00:00:00+05:30`);
}

/**
 * The period to read, as a lower and an exclusive upper bound. A custom
 * From/To wins over the preset; either end may be left open. The To date is
 * inclusive to the person picking it, so the bound is the midnight after it.
 */
export function auditWindow(
  range: string,
  from: string | null,
  to: string | null
): { since: string | null; until: string | null } {
  if (from || to) {
    // Picked backwards, the two dates still mean the span between them.
    const [lo, hi] = from && to && from > to ? [to, from] : [from, to];
    return {
      since: lo ? istMidnight(lo).toISOString() : null,
      until: hi ? new Date(istMidnight(hi).getTime() + DAY).toISOString() : null,
    };
  }
  return { since: auditSince(range), until: null };
}

/** The SQL cutoff for a range preset — null means "no lower bound". */
export function auditSince(range: string): string | null {
  const now = Date.now();
  if (range === "today") return todayStartIst().toISOString();
  if (range === "7d") return new Date(now - 7 * DAY).toISOString();
  if (range === "30d") return new Date(now - 30 * DAY).toISOString();
  return null;
}
