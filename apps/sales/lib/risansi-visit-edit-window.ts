// A submitted field report shows as "Closed" but stays re-openable for a
// window, so an authorised person (the rep, a manager on their tour, an admin
// or system admin) can fix a genuine mistake without a fresh visit. After the
// window it locks for good, for everyone. The window is measured from the FIRST
// closed date (visits.submitted_at), which never moves on a re-save — so a
// re-opened, re-saved report keeps counting from its original submission. Every
// edit made inside the window is written to the client's activity log, so a
// corrected report is always auditable against that first submission.

export const VISIT_EDIT_WINDOW_DAYS = 30;
const DAY_MS = 86_400_000;

const toMs = (v: string | Date | null | undefined): number | null => {
  if (!v) return null;
  const t = new Date(v).getTime();
  return Number.isNaN(t) ? null : t;
};

/** Unsubmitted visits are always editable; submitted ones for the window only. */
export function withinVisitEditWindow(submittedAt: string | Date | null | undefined): boolean {
  const t = toMs(submittedAt);
  if (t == null) return true;
  return Date.now() - t < VISIT_EDIT_WINDOW_DAYS * DAY_MS;
}

/** Whole days left to correct a submitted report (0 once the window has closed). */
export function visitEditDaysLeft(submittedAt: string | Date | null | undefined): number {
  const t = toMs(submittedAt);
  if (t == null) return VISIT_EDIT_WINDOW_DAYS;
  return Math.max(0, Math.ceil((VISIT_EDIT_WINDOW_DAYS * DAY_MS - (Date.now() - t)) / DAY_MS));
}

/** SQL predicate form, for guarding an UPDATE directly. */
export const VISIT_EDITABLE_SQL = (col = 'submitted_at') =>
  `(${col} IS NULL OR ${col} > NOW() - INTERVAL '${VISIT_EDIT_WINDOW_DAYS} days')`;
