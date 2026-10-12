export const REPORT_EDIT_WINDOW_DAYS = 10;

/** Whether a report submitted at `createdAt` is still within the edit window. */
export function isWithinReportEditWindow(createdAt: string | Date): boolean {
  const createdMs = new Date(createdAt).getTime();
  const windowMs = REPORT_EDIT_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  return Date.now() - createdMs <= windowMs;
}
