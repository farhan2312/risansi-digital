// ── FY helpers ─────────────────────────────────────────────────

export interface FYInfo {
  label:     string;  // 'FY 25-26'
  code:      string;  // '25-26'
  startDate: string;  // '2025-04-01'
  endDate:   string;  // '2026-03-31'
}

/** The FY-start year for a given date — India FY runs April→March. */
function fyStartYear(d: Date): number {
  return d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1;  // Apr = month index 3
}

/** Current operational FY, derived from today's date (April→March). */
export function getCurrentFY(): FYInfo {
  const s = fyStartYear(new Date());
  const e = s + 1;
  const code = `${String(s % 100).padStart(2, '0')}-${String(e % 100).padStart(2, '0')}`;
  return {
    label:     `FY ${code}`,
    code,
    startDate: `${s}-04-01`,
    endDate:   `${e}-03-31`,
  };
}

/** Previous N completed FYs, oldest first. E.g. n=5 in FY25-26 → ['20-21'…'24-25'] */
export function getPreviousFYCodes(n: number): string[] {
  const startYear = fyStartYear(new Date()) % 100;
  const codes: string[] = [];
  for (let i = n; i >= 1; i--) {
    const s = startYear - i;
    const e = s + 1;
    codes.push(`${String(s).padStart(2, '0')}-${String(e).padStart(2, '0')}`);
  }
  return codes;
}

/** Short label for a FY code: '21-22' → 'FY22' (uses end-year) */
export function fyShortLabel(code: string): string {
  const end = code.split('-')[1];
  return `FY${end}`;
}

/** How far through the FY we are, 0–100 */
export function fyYtdPct(fy: FYInfo): number {
  const start = new Date(fy.startDate).getTime();
  const end   = new Date(fy.endDate).getTime();
  const now   = Date.now();
  if (now >= end)   return 100;
  if (now <= start) return 0;
  return Math.round(((now - start) / (end - start)) * 100);
}

/** Calendar days remaining in FY (0 if ended) */
export function fyDaysLeft(fy: FYInfo): number {
  const end = new Date(fy.endDate).getTime();
  return Math.max(0, Math.ceil((end - Date.now()) / 86_400_000));
}

// ── Date / time formatting ─────────────────────────────────────

/** "Friday, 30 May 2026" */
export function formatIndianDate(date: Date): string {
  return date.toLocaleDateString('en-IN', {
    weekday: 'long',
    day:     'numeric',
    month:   'long',
    year:    'numeric',
  });
}

/** "14:32" from a Date */
export function formatTime(date: Date): string {
  return date.toLocaleTimeString('en-IN', {
    hour:     '2-digit',
    minute:   '2-digit',
    hour12:   false,
  });
}

/** Full days elapsed since a date string ('YYYY-MM-DD' or ISO). Returns 0 for future dates. */
export function daysSince(dateStr: string): number {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return 0;
  return Math.max(0, Math.floor((Date.now() - d.getTime()) / 86_400_000));
}

// ── Last-visit display ─────────────────────────────────────────
// Single source of truth for rendering clients.last_visit_date.
// A future date means a *planned* visit leaked into last_visit_date —
// it is never a real "last visit", so we treat it as "never visited".

/** Whole days from `dateStr` (midnight) to today (midnight). Negative = future. */
function daysBetweenTodayAnd(dateStr: string): number | null {
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  date.setHours(0, 0, 0, 0);
  return Math.floor((today.getTime() - date.getTime()) / 86_400_000);
}

/** Rich last-visit label for KPI cards / detail views. */
export function formatLastVisit(
  dateStr: string | null | undefined,
): { label: string; color: string; isOverdue: boolean } {
  const never = { label: 'Never visited', color: 'var(--neg)', isOverdue: true };
  if (!dateStr) return never;

  const diffDays = daysBetweenTodayAnd(dateStr);
  if (diffDays == null) return never;

  // Future date (planned visit showing as last visit) → treat as never
  if (diffDays < 0)   return never;
  if (diffDays === 0) return { label: 'Today',     color: 'var(--pos)',  isOverdue: false };
  if (diffDays === 1) return { label: '1 day ago', color: 'var(--pos)',  isOverdue: false };
  if (diffDays <= 30) return { label: `${diffDays} days ago`, color: 'var(--pos)',  isOverdue: false };
  if (diffDays <= 90) return { label: `${diffDays} days ago`, color: 'var(--warn)', isOverdue: false };
  if (diffDays <= 365) return { label: `${diffDays} days ago`, color: 'var(--neg)', isOverdue: true };

  const years = Math.floor(diffDays / 365);
  return {
    label: years === 1 ? '1 year ago' : `${years} years ago`,
    color: 'var(--neg)',
    isOverdue: true,
  };
}

/** Short last-visit label for dense tables. */
export function formatLastVisitShort(
  dateStr: string | null | undefined,
): { label: string; color: string } {
  if (!dateStr) return { label: 'Never', color: 'var(--neg)' };

  const days = daysBetweenTodayAnd(dateStr);
  if (days == null || days < 0) return { label: 'Never', color: 'var(--neg)' };
  if (days === 0) return { label: 'Today',     color: 'var(--pos)' };
  if (days <= 30) return { label: `${days}d`,  color: 'var(--pos)' };
  if (days <= 90) return { label: `${days}d`,  color: 'var(--warn)' };
  if (days <= 365) return { label: `${days}d`, color: 'var(--neg)' };
  return { label: `${Math.floor(days / 365)}yr`, color: 'var(--neg)' };
}

// ── Currency formatting ────────────────────────────────────────

/** ₹12.4 Cr — null-safe. For values already in Crores (orders.order_value_cr, sales_targets). */
/**
 * Two decimals, because one hides a lakh.
 *
 * This read ₹3.0 Cr on the dashboard beside ₹2.97 Cr on the Executive Review —
 * the same rupees, rounded differently, which looked like two pages
 * disagreeing. At a crore scale the first decimal is ten lakh and the second is
 * one, and a lakh is worth seeing. The exec review's own formatter has always
 * used two; this brings everything else into line with it.
 */
export function fmtCr(val: number | null | undefined, decimals = 2): string {
  if (val == null || isNaN(val)) return '—';
  return `₹${val.toFixed(decimals)} Cr`;
}

/** ₹X.XX L — for values already divided by 100_000 (in Lakhs). */
export function fmtL(val: number | null | undefined, decimals = 2): string {
  if (val == null || isNaN(val) || val === 0) return '—';
  return `₹${val.toFixed(decimals)} L`;
}

/** USD amount from a value already in Crores, at the given ₹/USD rate. */
export function crToUsd(cr: number | null | undefined, rate: number): number {
  const c = Number(cr ?? 0);
  if (!c || !rate) return 0;
  return (c * 10_000_000) / rate;
}

/** "$2.79M" / "$960K" / "$12,345" — USD from a Crore value. null-safe. */
export function fmtUsdFromCr(cr: number | null | undefined, rate: number): string {
  const usd = crToUsd(cr, rate);
  if (!usd) return '—';
  if (usd >= 1_000_000) return '$' + (usd / 1_000_000).toFixed(2) + 'M';
  if (usd >= 1_000)     return '$' + (usd / 1_000).toFixed(1) + 'K';
  return '$' + Math.round(usd).toLocaleString('en-US');
}

export function formatRev(val: number | null | undefined): string {
  const n = Number(val ?? 0)
  if (!n) return '—'
  if (n >= 10_000_000) return '₹' + (n / 10_000_000).toFixed(2) + ' Cr'
  if (n >= 100_000)    return '₹' + (n / 100_000).toFixed(2) + ' L'
  if (n >= 1_000)      return '₹' + (n / 1_000).toFixed(1) + 'K'
  return '₹' + Math.round(n).toLocaleString('en-IN')
}

export function revDelta(curr: number | null, prev: number | null): string {
  const c = Number(curr ?? 0)
  const p = Number(prev ?? 0)
  if (!p) return '—'
  const pct = ((c - p) / p) * 100
  const sign = pct >= 0 ? '+' : ''
  return sign + pct.toFixed(1) + '%'
}

export function revDeltaPos(curr: number | null, prev: number | null): boolean {
  return Number(curr ?? 0) >= Number(prev ?? 0)
}

export function formatDate(val: string | Date | null | undefined): string {
  if (!val) return '—';
  try {
    return new Date(val).toLocaleDateString('en-IN', {
      day: '2-digit', month: 'short', year: 'numeric'
    });
  } catch { return '—'; }
}

export function visitHealthColor(days: number | null, tier: string): string {
  if (days === null) return 'var(--neg)';
  const threshold = tier === 'Key' ? 100 : 200;
  if (days > threshold) return 'var(--neg)';
  if (days > threshold * 0.75) return 'var(--warn)';
  return 'var(--pos)';
}

export function safeNum(val: unknown): number {
  const n = Number(val);
  return isNaN(n) ? 0 : n;
}

// ── Name helpers ───────────────────────────────────────────────

/** "VB" initials from a display name */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return (parts[0][0] ?? '?').toUpperCase();
  return ((parts[0][0] ?? '') + (parts[parts.length - 1][0] ?? '')).toUpperCase();
}

// ── Visit / alert helpers ──────────────────────────────────────

/**
 * CSS variable string for a visit status badge.
 * Maps to the design token system.
 */
export function getVisitStatusColor(status: string): string {
  const map: Record<string, string> = {
    'planned':    'var(--info)',
    'checked-in': 'var(--accent)',
    'completed':  'var(--pos)',
    'missed':     'var(--neg)',
  };
  return map[status.toLowerCase()] ?? 'var(--fg-3)';
}

/**
 * Alert level based on days since last visit and client tier.
 *
 * Tier A (key account) — visit every 30 days
 * Tier B (regular)     — visit every 60 days
 * Tier C (long-tail)   — visit every 90 days
 */
const TIER_OVERDUE:   Record<string, number> = { A: 30,  B: 60,  C: 90  };
const TIER_DUE_SOON:  Record<string, number> = { A: 21,  B: 45,  C: 70  };

export function getAlertLevel(
  daysSinceVisit: number,
  tier: string,
): 'overdue' | 'due-soon' | 'ok' {
  const t        = tier.toUpperCase();
  const overdue  = TIER_OVERDUE[t]  ?? 90;
  const dueSoon  = TIER_DUE_SOON[t] ?? 70;
  if (daysSinceVisit >= overdue)  return 'overdue';
  if (daysSinceVisit >= dueSoon)  return 'due-soon';
  return 'ok';
}

/**
 * Today's date in IST, as 'YYYY-MM-DD'.
 *
 * The server runs in UTC, so `new Date().toISOString()` is yesterday for the
 * five and a half hours after midnight in India. Anything comparing a
 * user-entered date against "today" has to use this, or a PO raised at 9am in
 * Lucknow reads as dated in the future.
 */
/**
 * A date field's value, as the database wants it: 'YYYY-MM-DD', or null.
 *
 * Forms send a date input's value, which is already in that shape. What they
 * also send, when a page hands the client a `date` column without casting it
 * to text, is a serialised JS Date — "Wed Jul 15 2026 00:00:00 GMT+0400".
 * Postgres rejects that outright, and the future-date check compared it as a
 * string against today, so a July PO date was refused for being "after
 * 2026-09-24" and the whole save was lost with it (24 Sep). Parsing here
 * means neither can happen again, wherever the value came from.
 */
export function normaliseDate(raw: unknown): string | null {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const iso = s.match(/^(\d{4}-\d{2}-\d{2})T/);          // an ISO timestamp: the date part is already UTC-correct
  if (iso) return iso[1];
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  // A parsed Date is local to the server; read its local parts so the day is
  // the day the string named, not the day it becomes in UTC.
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function istToday(): string {
  const ist = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
  return ist.toISOString().slice(0, 10);
}

// ── Greeting ──────────────────────────────────────────────────

/** IST-aware server-side greeting. Runs at render time. */
export function getGreeting(): string {
  const now = new Date();
  // IST = UTC + 5:30
  const ist  = new Date(now.getTime() + 5.5 * 60 * 60 * 1000);
  const hour = ist.getUTCHours();
  if (hour >= 5  && hour < 12) return 'Good Morning';
  if (hour >= 12 && hour < 17) return 'Good Afternoon';
  if (hour >= 17 && hour < 21) return 'Good Evening';
  return 'Good Evening';
}

// ── Industry normalisation ─────────────────────────────────────

// Canonical industry vocabulary. Keyed on the lower-cased, trimmed raw value →
// the one clean display name. Covers every historical spelling/case variant seen
// in the data, plus each canonical form itself so re-normalising is idempotent.
// Acronyms (CBG, EPC, FMCG, ETP/STP/WTP) live here explicitly so the Title-Case
// fallback below never mangles them.
const INDUSTRY_ALIASES: Record<string, string> = {
  'adhesive': 'Adhesive',
  'agriculture': 'Agriculture',
  'automation': 'Automation',
  'bio-fuel': 'Bio-Fuel', 'biofuel': 'Bio-Fuel',
  'bio gas': 'Biogas', 'biogas': 'Biogas',
  'cattle feed': 'Cattle Feed',
  'cbg': 'CBG',
  'chemical': 'Chemicals', 'chemicals': 'Chemicals',
  'construction': 'Construction', 'constructions': 'Construction',
  'dairy': 'Dairy',
  'distillery': 'Distillery',
  'edible oil': 'Edible Oil',
  'engineering': 'Engineering',
  'epc': 'EPC',
  'ethanol': 'Ethanol',
  'etp/stp/wtp': 'ETP/STP/WTP', 'etp/wtp/stp': 'ETP/STP/WTP', 'wastewater treatment plant': 'ETP/STP/WTP',
  'explosive': 'Explosives', 'explosives': 'Explosives',
  'fertilizers': 'Fertilizers', 'fertilisers': 'Fertilizers', 'manufacture of fertilizers and nitrogen': 'Fertilizers',
  'fmcg': 'FMCG',
  'food': 'Food & Beverages', 'food & bvgs.': 'Food & Beverages', 'food & beverage': 'Food & Beverages',
  'food & beverages': 'Food & Beverages', 'food and beverage': 'Food & Beverages', 'f&b': 'Food & Beverages',
  'khandsari and jaggery': 'Khandsari & Jaggery', 'khandsari & jaggery': 'Khandsari & Jaggery',
  'manifacturer': 'Manufacturing', 'manufacturer': 'Manufacturing', 'manufacturing': 'Manufacturing',
  'marine': 'Marine',
  'metals & minerals': 'Metals & Minerals', 'metals and minerals': 'Metals & Minerals',
  'mining': 'Mining',
  'oil & gas': 'Oil & Gas', 'oil and gas': 'Oil & Gas', 'o&g': 'Oil & Gas', 'oil/gas': 'Oil & Gas',
  'oil / gas refiner': 'Oil & Gas', 'refinery': 'Oil & Gas',
  'other': 'Other', 'others': 'Other',
  'paint': 'Paint',
  'paper': 'Paper', 'paper & pulp': 'Paper', 'pulp & paper': 'Paper', 'pulp and paper': 'Paper',
  'petrochemical': 'Petrochemical',
  'pharma': 'Pharma', 'pharma & cosmetics': 'Pharma', 'pharmaceutical': 'Pharma', 'pharmaceuticals': 'Pharma',
  'plastic': 'Plastics', 'plastics': 'Plastics',
  'sugar': 'Sugar',
  'textile': 'Textile',
  'thermal power production': 'Thermal Power', 'thermal power': 'Thermal Power',
};

/**
 * Normalise a raw industry string from the DB or user input to its one canonical
 * display name. Known aliases map straight through; anything unknown falls back
 * to Title Case so a brand-new value still comes out tidy.
 */
export function normaliseIndustry(name: string | null | undefined): string {
  if (!name || !name.trim()) return 'Other';
  const key = name.toLowerCase().trim();
  return (
    INDUSTRY_ALIASES[key] ??
    name.trim().replace(/\s+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
  );
}

// ── UI labels ──────────────────────────────────────────────────
// Single source of truth for the Plan Visit button label across the app.
export const PLAN_VISIT_LABEL = 'Plan Visit';


// ── Local calendar date, not UTC ────────────────────────────────
// new Date(dateOnly) parses as UTC midnight, and toISOString() serialises in
// UTC — so before ~05:30 IST the "date" is yesterday. These stay in local time.

/** Today (or a given date) as YYYY-MM-DD in the viewer's local zone. */
export function localDateStr(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Is a date-only (or ISO) due date strictly before today, compared as dates?
 *  Tolerates a runtime Date: a pg DATE column selected without ::text arrives as
 *  a Date object (typed as string but not one at runtime), and String(date) would
 *  yield "Wed Aug 06 …" — not a YYYY-MM-DD prefix — silently breaking the compare.
 *  A Date is normalised via its local calendar parts; a string is sliced as-is. */
export function isPastDue(due: string | Date | null | undefined): boolean {
  if (!due) return false;
  const day = due instanceof Date ? localDateStr(due) : String(due).slice(0, 10);
  return day < localDateStr();
}
