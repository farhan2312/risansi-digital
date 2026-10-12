/**
 * Shapes and labels for the Audit Log "Overview" tab. No DB imports, so the
 * client page and the server route (lib/audit-overview.ts) share them.
 */

/** Headline figures for one window. */
export interface AuditOverviewKpis {
  events: number;
  actions: number;
  logins: number;
  failed: number;
  activeUsers: number;
  uniqueIps: number;
  enquiries: number;
  /** Tags created: the Default tag every new enquiry gets, plus added and
   *  copied tags. */
  tags: number;
  reports: number;
  approvalsSent: number;
  totalActiveSeconds: number;
}

export interface AuditOverviewDay {
  /** IST calendar day, YYYY-MM-DD. */
  day: string;
  actions: number;
  logins: number;
  failed: number;
  users: number;
  enquiries: number;
  tags: number;
  activeSeconds: number;
}

export interface AuditBreakdownItem {
  label: string;
  count: number;
  /** Distinct people behind the count. */
  users: number;
}

export interface AuditUserDayCell {
  day: string;
  actions: number;
  enquiries: number;
  tags: number;
  activeSeconds: number;
}

export interface AuditOverviewUser {
  email: string;
  role: string | null;
  actions: number;
  enquiries: number;
  tags: number;
  activeSeconds: number;
  activeDays: number;
  lastIp: string | null;
  /** Keyed by IST day; days with nothing are left out. */
  days: Record<string, AuditUserDayCell>;
}

export interface AuditOverviewIp {
  ip: string;
  events: number;
  users: number;
  failed: number;
  emails: string[];
  lastAt: string | null;
}

export interface AuditOverview {
  since: string | null;
  until: string | null;
  /** Every IST day in the window (capped to the most recent MAX_DAYS). */
  days: string[];
  daysCapped: boolean;
  kpis: AuditOverviewKpis;
  /** The same figures for the window just before this one, for the trend
   *  arrows. Null when the window has no start ("All"). */
  previous: AuditOverviewKpis | null;
  daily: AuditOverviewDay[];
  /** [weekday 0=Mon..6=Sun][hour 0..23] event counts, IST. */
  heatmap: number[][];
  actionBreakdown: AuditBreakdownItem[];
  eventTypes: AuditBreakdownItem[];
  devices: AuditBreakdownItem[];
  browsers: AuditBreakdownItem[];
  os: AuditBreakdownItem[];
  users: AuditOverviewUser[];
  ips: AuditOverviewIp[];
}

export const OVERVIEW_MAX_DAYS = 92;

/** Action verb -> the group it is counted under in the Actions chart. */
export function actionGroup(action: string): string {
  if (action === "wizard.save") return "Step saves";
  if (action === "wizard.clear") return "Step clears";
  if (action.startsWith("enquiry.")) return "Enquiries created";
  if (action === "tag.create") return "Tags created";
  if (action === "tag.copy") return "Tags copied";
  if (action.startsWith("report.")) return "Reports generated";
  if (action.startsWith("approval.")) return "Approvals";
  if (action.startsWith("user.")) return "User admin";
  if (action.startsWith("master.") || action.startsWith("drive_option.")) return "Master data";
  if (action.startsWith("audit.")) return "Audit reports";
  return "Other";
}

export const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
