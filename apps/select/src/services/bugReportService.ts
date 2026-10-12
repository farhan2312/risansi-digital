import apiClient from "./apiClient";

export type BugReportType = "bug" | "feature";
export type BugReportSeverity = "Low" | "Medium" | "High" | "Critical";
// "Resolved" is the "Resolved / Closed" column; legacy "Closed" rows map to it.
export type BugReportStatus = "Open" | "Need Clarification" | "In progress" | "Resolved";

// Full row as returned by GET /api/bug-reports (system_admin / Bug Tracker) —
// never includes the raw screenshot bytes; fetch those via
// getBugReportScreenshotUrl() when screenshotFileName is set.
export interface BugReportRow {
  id: string;
  type: BugReportType;
  title: string;
  description: string | null;
  severity: BugReportSeverity;
  page: string | null;
  status: BugReportStatus;
  screenshotFileName: string | null;
  screenshotMimeType: string | null;
  screenshotFileSize: number | null;
  reportedBy: string | null;
  reportedByName: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateBugReportInput {
  type: BugReportType;
  title: string;
  description: string;
  severity: BugReportSeverity;
  page: string;
  /** data: URL (e.g. from FileReader or a clipboard paste) — decoded server-side. */
  screenshotDataUrl?: string;
  screenshotFileName?: string;
}

export const createBugReport = async (
  input: CreateBugReportInput
): Promise<Pick<BugReportRow, "id" | "type" | "title" | "description" | "severity" | "page" | "status" | "createdAt">> => {
  const { data } = await apiClient.post("/bug-reports", input);
  return data;
};

/** Server-side search / filter / paging for the Bug Tracker. */
export interface BugReportQuery {
  /** Words searched in title, description, reporter and page. */
  q?: string;
  type?: BugReportType;
  severity?: BugReportSeverity;
  /** One board column. */
  status?: BugReportStatus;
  /** "board": most severe first, then newest. "newest": newest first. */
  order?: "board" | "newest";
  offset?: number;
  /** 0–100; 0 returns only the counts. */
  limit?: number;
  /** "1" = only the caller's own reports (any signed-in user; My Bug Reports). */
  mine?: "1";
}

/** Unfiltered header figures. */
export interface BugReportSummary {
  total: number;
  open: number;
  criticalOpen: number;
}

export interface BugReportPage {
  rows: BugReportRow[];
  /** Rows matching the query (all pages). */
  total: number;
  summary: BugReportSummary;
}

/** One page of reports: every report for system_admin (Bug Tracker), or the
 *  caller's own with mine: "1" (My Bug Reports, any user). */
export const listBugReports = async (query: BugReportQuery = {}): Promise<BugReportPage> => {
  const params = Object.fromEntries(Object.entries(query).filter(([, v]) => v !== undefined && v !== ""));
  const { data } = await apiClient.get<BugReportPage>("/bug-reports", { params });
  return data;
};

/** system_admin only — triage action on the Bug Tracker page. */
export const updateBugReportStatus = async (
  id: string,
  status: BugReportStatus
): Promise<{ id: string; status: BugReportStatus; updatedAt: string }> => {
  const { data } = await apiClient.patch(`/bug-reports/${id}`, { status });
  return data;
};

/** Relative URL for a report's screenshot (viewable inline via <img src=...>);
 * the browser sends the session cookie automatically since this is same-origin. */
export const getBugReportScreenshotUrl = (id: string): string => `/api/bug-reports/${id}/screenshot`;

export interface BugNotification {
  id: string;
  title: string;
  status: BugReportStatus;
  updatedAt: string;
  /** "status" - a report I filed changed status. "new" - somebody else filed
   *  a report and I am an admin (the triage feed). */
  kind: "status" | "new";
  /** Who filed it. Only set on "new" items; null on my own reports. */
  reportedByName: string | null;
}

/** The caller's own unread status-change notifications, for the top-bar bell. */
export const getBugNotifications = async (): Promise<{ count: number; items: BugNotification[] }> => {
  const { data } = await apiClient.get("/bug-reports/notifications");
  return data;
};

/** Clears the caller's bell — omit `ids` to mark every unread notification read. */
export const markBugNotificationsRead = async (ids?: string[]): Promise<void> => {
  await apiClient.post("/bug-reports/notifications/read", ids ? { ids } : {});
};
