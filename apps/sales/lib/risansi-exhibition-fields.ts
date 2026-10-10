/**
 * Exhibition module — shared vocabulary and money helpers.
 *
 * Single source of truth for the module's enums, mirroring how
 * lib/risansi-opportunity-fields.ts serves the pipeline. Every dropdown, badge,
 * filter and validation reads from here so the UI and the server cannot drift.
 *
 * Money note: exhibition figures are RUPEES throughout — never crores. The
 * pipeline stores value_cr / final_value_cr in crores; mixing the two units is
 * the failure mode that has already cost this codebase real data, so nothing in
 * this module converts to crores except at a display boundary.
 */

export const EXHIBITION_STATUSES = [
  'Draft',
  'Shortlisted',
  'Submitted',
  'Approved',
  'Rejected',
  'Ongoing',
  'Completed',
  'Closed',
] as const;
export type ExhibitionStatus = typeof EXHIBITION_STATUSES[number];

/**
 * Statuses that put an attendance block on a team member's Field Activity
 * calendar.
 *
 * Only once the exhibition is actually committed. Draft, Shortlisted and
 * Submitted are still proposals — most exhibitions on file are Drafts that may
 * never happen, and blocking calendars on them would train people to ignore the
 * blocks. Rejected never shows. Completed and Closed stay, because the calendar
 * is a record of where someone was, not only a plan of where they will be.
 */
export const CALENDAR_BLOCKING_STATUSES: readonly ExhibitionStatus[] = [
  'Approved', 'Ongoing', 'Completed', 'Closed',
];

/** Statuses a user may pick directly. Submitted/Approved/Rejected are reached
 *  only through the approval actions, never by editing a dropdown. */
export const EDITABLE_STATUSES: readonly ExhibitionStatus[] = [
  'Draft', 'Shortlisted', 'Ongoing', 'Completed', 'Closed',
];

/** Still in the running — used for the "active" KPI and the default board. */
export const OPEN_STATUSES: readonly ExhibitionStatus[] = [
  'Draft', 'Shortlisted', 'Submitted', 'Approved', 'Ongoing',
];

export const PARTICIPATION = ['Exhibit', 'Visit'] as const;
export type Participation = typeof PARTICIPATION[number];

/** What the approver may decide. 'More Info' bounces it back to the submitter
 *  without losing the earlier trail. */
export const DECISIONS = ['Exhibit', 'Visit', 'Reject', 'More Info'] as const;
export type Decision = typeof DECISIONS[number];

export const TEAM_ROLES = ['Team Lead', 'Member'] as const;
export type TeamRole = typeof TEAM_ROLES[number];

export const EXPENSE_CATEGORIES = [
  'Stall / Booth',
  'Registration',
  'Travel',
  'Hotel',
  'Branding & Printing',
  'Delegate Fees',
  'Logistics',
  'Miscellaneous',
] as const;

export const INTEREST_LEVELS = ['Hot', 'Warm', 'Cold'] as const;
export type Interest = typeof INTEREST_LEVELS[number];

export const DISCOVERY_SOURCES = [
  'Website', 'LinkedIn', 'Email', 'Organizer', 'Referral', 'Other',
] as const;

// ── Status presentation ──────────────────────────────────────────
// Tokens only — never raw hex, so both themes stay correct.
export const STATUS_TONE: Record<ExhibitionStatus, { bg: string; fg: string }> = {
  'Draft':       { bg: 'var(--bg-elev)',    fg: 'var(--fg-2)' },
  'Shortlisted': { bg: 'var(--accent-soft)', fg: 'var(--title)' },
  'Submitted':   { bg: 'var(--warn-soft, var(--accent-soft))', fg: 'var(--title)' },
  'Approved':    { bg: 'var(--pos-soft)',   fg: 'var(--pos-strong)' },
  'Rejected':    { bg: 'var(--neg-soft)',   fg: 'var(--neg-strong)' },
  'Ongoing':     { bg: 'var(--accent-soft)', fg: 'var(--title)' },
  'Completed':   { bg: 'var(--pos-soft)',   fg: 'var(--pos-strong)' },
  'Closed':      { bg: 'var(--bg-elev)',    fg: 'var(--fg-3)' },
};

export const isExhibitionStatus = (v: unknown): v is ExhibitionStatus =>
  typeof v === 'string' && (EXHIBITION_STATUSES as readonly string[]).includes(v);

export const isDecision = (v: unknown): v is Decision =>
  typeof v === 'string' && (DECISIONS as readonly string[]).includes(v);

// ── Money (rupees) ───────────────────────────────────────────────

/** Compact rupee label: 12,50,000 → "₹12.5 L", 1,20,00,000 → "₹1.2 Cr". */
export function fmtInr(v: number | string | null | undefined): string {
  const n = v == null ? NaN : Number(v);
  if (!Number.isFinite(n)) return '—';
  if (n === 0) return '₹0';
  const abs = Math.abs(n);
  if (abs >= 1e7) return `₹${(n / 1e7).toFixed(2)} Cr`;
  if (abs >= 1e5) return `₹${(n / 1e5).toFixed(1)} L`;
  return `₹${Math.round(n).toLocaleString('en-IN')}`;
}

/** Full rupee figure with Indian grouping, for tables and totals. */
export function fmtInrFull(v: number | string | null | undefined): string {
  const n = v == null ? NaN : Number(v);
  return Number.isFinite(n) ? `₹${Math.round(n).toLocaleString('en-IN')}` : '—';
}

export interface ExpenseTotals {
  estimated: number;
  actual: number;
  paid: number;
  pending: number;   // actual not yet paid
  variance: number;  // actual vs estimated; positive = over budget
}

/** Roll a set of expense lines into the figures the UI shows. Kept pure so the
 *  detail page, the board and any export all agree by construction. */
export function sumExpenses(
  rows: { estimated_inr?: number | string | null; actual_inr?: number | string | null; paid_inr?: number | string | null }[],
): ExpenseTotals {
  const num = (v: unknown) => { const n = Number(v ?? 0); return Number.isFinite(n) ? n : 0; };
  const estimated = rows.reduce((s, r) => s + num(r.estimated_inr), 0);
  const actual    = rows.reduce((s, r) => s + num(r.actual_inr), 0);
  const paid      = rows.reduce((s, r) => s + num(r.paid_inr), 0);
  return { estimated, actual, paid, pending: Math.max(0, actual - paid), variance: actual - estimated };
}

/** Inclusive day count for an event, used on cards and the detail header. */
export function eventDays(start?: string | null, end?: string | null): number | null {
  if (!start) return null;
  const s = new Date(`${start}T00:00:00Z`).getTime();
  const e = new Date(`${(end || start)}T00:00:00Z`).getTime();
  if (!Number.isFinite(s) || !Number.isFinite(e) || e < s) return null;
  return Math.round((e - s) / 86400000) + 1;
}

// ── Lifecycle gating ─────────────────────────────────────────────
//
// The module runs in two stages. Before approval an exhibition is still a
// proposal: you describe the event and name who would go, and that is all. Once a
// decision is recorded it becomes a real commitment, and the operational tabs —
// meetings, expenses and the post-event review — open up.
//
// This keeps spend and captured leads from accumulating against an event nobody
// has agreed to attend, which is the whole point of having an approval step.

/** Statuses at which the operational tabs are usable. */
export const UNLOCKED_STATUSES: readonly ExhibitionStatus[] = [
  'Approved', 'Ongoing', 'Completed', 'Closed',
];

export const isUnlocked = (s: ExhibitionStatus): boolean => UNLOCKED_STATUSES.includes(s);

/** The post-event review only makes sense once the event has actually happened. */
export const canReview = (s: ExhibitionStatus): boolean =>
  s === 'Ongoing' || s === 'Completed' || s === 'Closed';

export interface SubmitCheck {
  ready: boolean;
  missing: string[];
}

/**
 * What still has to be filled in before an exhibition can go for approval.
 * Returned as a list rather than a boolean so the UI can tell the user exactly
 * what is outstanding instead of leaving a disabled button unexplained.
 */
export function submitReadiness(ex: {
  name?: string | null; start_date?: string | null; end_date?: string | null;
  city?: string | null; approver_id?: number | null;
}, teamCount: number, hasLead: boolean): SubmitCheck {
  const missing: string[] = [];
  if (!ex.name?.trim())  missing.push('Exhibition name');
  if (!ex.start_date)    missing.push('Start date');
  if (!ex.end_date)      missing.push('End date');
  if (!ex.city?.trim())  missing.push('City');
  if (!ex.approver_id)   missing.push('An approver');
  if (teamCount === 0)   missing.push('At least one team member');
  else if (!hasLead)     missing.push('A team lead');
  return { ready: missing.length === 0, missing };
}

/**
 * SQL predicate limiting an `exhibitions` query (aliased `alias`) to what this
 * user may SEE. Returns null for admins and sysadmins, meaning no restriction.
 *
 * Four ways in, because all four have a reason to be there:
 *   - on the team          (exhibition_team)
 *   - proposed it          (created_by)
 *   - is the approver      (approver_id)
 *   - admin or sysadmin    (no restriction at all)
 *
 * The approver matters more than it looks. They are named per exhibition and are
 * usually NOT on the team, so a strict team-only rule would hide the very
 * exhibition they have been asked to decide on, and approvals would silently
 * stall.
 *
 * The id is an integer straight from the session, so inlining it is
 * injection-safe and keeps callers free of parameter-index juggling — the same
 * approach clientScopeSql takes.
 */
export function exhibitionVisibilitySql(
  role: string | null | undefined, userId: number | null, alias = 'e',
): string | null {
  if (role === 'admin' || role === 'sysadmin') return null;
  const uid = Number(userId);
  if (!Number.isInteger(uid)) return 'FALSE';
  return `(${alias}.created_by = ${uid}
        OR ${alias}.approver_id = ${uid}
        OR EXISTS (SELECT 1 FROM exhibition_team t WHERE t.exhibition_id = ${alias}.id AND t.user_id = ${uid}))`;
}
