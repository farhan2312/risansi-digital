// Shared bug-tracker vocabulary — imported by the server actions, the admin page,
// and the client kanban so the status pipeline stays defined in exactly one place.

export const BUG_STATUSES = ['reported', 'recorded', 'in_progress', 'testing', 'fixed'] as const;
export type BugStatus = typeof BUG_STATUSES[number];

export const BUG_STATUS_LABELS: Record<BugStatus, string> = {
  reported:    'Reported',
  // Renamed 19 Sep: the keys stay (they are the stored values on every bug),
  // only the words changed. `recorded` is a report the admin has read and
  // needs more from the reporter; `in_progress` is one parked for now.
  recorded:    'Needs Clarification',
  in_progress: 'On Hold',
  testing:     'Testing',
  fixed:       'Fixed / Closed',
};

// One-line hint under each pipeline column header.
export const BUG_STATUS_HINTS: Record<BugStatus, string> = {
  reported:    'User submitted',
  recorded:    'Admin needs more from the reporter',
  in_progress: 'Parked for now',
  testing:     'Under verification',
  fixed:       'Resolved & closed',
};

// Chosen so white text on the colour meets WCAG AA (≥4.5:1) for the active pills.
export const BUG_STATUS_COLORS: Record<BugStatus, string> = {
  reported:    '#64748B',
  recorded:    '#2563EB',
  in_progress: '#B45309',
  testing:     '#7C3AED',
  fixed:       '#0B7A55',
};

export function isBugStatus(v: unknown): v is BugStatus {
  return typeof v === 'string' && (BUG_STATUSES as readonly string[]).includes(v);
}

// Bug vs feature request — set by the reporter, editable by the sysadmin.
export const BUG_TYPES = ['bug', 'feature'] as const;
export type BugType = typeof BUG_TYPES[number];

export const BUG_TYPE_LABELS: Record<BugType, string> = {
  bug: 'Bug', feature: 'Feature',
};

/**
 * Literals on purpose, not tokens awaiting conversion.
 *
 * These are filled pill backgrounds carrying a white label. A token such as
 * --neg or --purple lightens in dark mode, which would drop the label to around
 * 2.8:1; held at these values white stays at 5.7:1 in both themes. They read a
 * little flat against the dark page (2.75:1) and that is the trade — a quiet
 * pill rather than an unreadable one. Do not "fix" these into --neg / --purple.
 */
export const BUG_TYPE_COLORS: Record<BugType, string> = {
  bug: '#C81E1E', feature: '#7C3AED',
};

export function isBugType(v: unknown): v is BugType {
  return typeof v === 'string' && (BUG_TYPES as readonly string[]).includes(v);
}

export const BUG_SEVERITIES = ['low', 'medium', 'high'] as const;
export type BugSeverity = typeof BUG_SEVERITIES[number];

export const BUG_SEVERITY_LABELS: Record<BugSeverity, string> = {
  low: 'Low', medium: 'Medium', high: 'High',
};

export const BUG_SEVERITY_COLORS: Record<BugSeverity, string> = {
  low: '#64748B', medium: '#B45309', high: '#C81E1E',
};

export function isBugSeverity(v: unknown): v is BugSeverity {
  return typeof v === 'string' && (BUG_SEVERITIES as readonly string[]).includes(v);
}

/** "3h", "2d", "45m" — compact elapsed time between two ISO/Date values. */
export function turnaround(fromISO: string | Date | null, toISO: string | Date | null): string {
  if (!fromISO || !toISO) return '—';
  const a = new Date(fromISO).getTime();
  const b = new Date(toISO).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return '—';
  const mins = Math.round((b - a) / 60000);
  if (mins < 60) return `${mins}m`;
  const hrs = mins / 60;
  if (hrs < 24) return `${Math.round(hrs)}h`;
  const days = hrs / 24;
  return `${days.toFixed(days < 10 ? 1 : 0)}d`;
}
