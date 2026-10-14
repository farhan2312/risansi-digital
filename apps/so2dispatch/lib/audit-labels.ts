// How each audit action reads to a person, shared by the audit screen and the
// PDF report so the two never describe the same event differently. Plain
// module: the screen is a client component.

export type AuditTone = "green" | "red" | "amber" | "blue" | "neutral";

export const ACTION_META: Record<string, { label: string; tone: AuditTone }> = {
  login: { label: "Signed in", tone: "green" },
  login_failed: { label: "Failed sign-in", tone: "red" },
  logout: { label: "Signed out", tone: "neutral" },
  "password.change": { label: "Changed password", tone: "blue" },
  "order.create": { label: "Created order", tone: "green" },
  "order.update": { label: "Updated order", tone: "blue" },
  "order.delete": { label: "Deleted order", tone: "red" },
  "order.import": { label: "Imported orders", tone: "blue" },
  "order.target_date": { label: "Target date", tone: "amber" },
  "order.dept_complete": { label: "Sign-off", tone: "green" },
  "access.request": { label: "Requested access", tone: "amber" },
  "access.approve": { label: "Approved access", tone: "green" },
  "access.reject": { label: "Rejected access", tone: "red" },
  "user.create": { label: "Added user", tone: "green" },
  "user.approved": { label: "Approved user", tone: "green" },
  "user.disabled": { label: "Disabled user", tone: "red" },
  "user.delete": { label: "Deleted user", tone: "red" },
  "user.update": { label: "Edited user", tone: "blue" },
  "user.role_change": { label: "Changed role", tone: "blue" },
  "user.password_reset": { label: "Reset password", tone: "amber" },
  "bug.report": { label: "Bug report", tone: "amber" },
};

/**
 * The longest pause between two of a user's actions that still counts as
 * working. Sign-in to sign-out cannot measure a session — people close the tab
 * rather than sign out — so active time is read off the actions themselves:
 * each user's recorded times in order, the gap to the next one measured, and
 * every gap up to this long added up. A longer gap means they stepped away,
 * and counts for nothing.
 *
 *   10:00, 10:04, 10:09, 11:30  →  4m + 5m = 9m
 */
export const ACTIVE_GAP_MINUTES = 15;

export function actionLabel(action: string): string {
  return ACTION_META[action]?.label ?? action;
}

/** 0 → "—", 45 → "45m", 125 → "2h 05m". */
export function formatActiveMinutes(minutes: number): string {
  if (!minutes) return "—";
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}h ${String(m).padStart(2, "0")}m`;
}
