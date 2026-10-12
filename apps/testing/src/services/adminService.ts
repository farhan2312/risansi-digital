import apiClient from "./apiClient";
import type {
  ActionRegistryEntry,
  AuditActivityResult,
  AuditOverview,
  AuditRange,
  AuditSessionListResult,
  AuditSummary,
  AuditUsageRow,
  AuditUserPageRow,
  BugNotificationsResult,
  BugReport,
  BugReportListResult,
  BugReportStatus,
  PaginatedResult,
} from "@/types/testing";

export interface PendingUser {
  id: string;
  email: string;
  name: string | null;
  role: "source" | "testing" | "central-admin" | "admin";
  status: "pending" | "active" | "rejected" | "inactive";
  reviewed_by: string | null;
  reviewed_by_name: string | null;
  reviewed_at: string | null;
  created_at: string;
}

/** Unfiltered counts across the whole `users` table, for the Users & Access
 * page's KPI tiles -- always reflects everyone, regardless of the current
 * page/search/role/status filter. */
export interface UserStats {
  total: number;
  pending: number;
  active: number;
  admins: number;
}

export interface UserListResult extends PaginatedResult<PendingUser> {
  stats: UserStats;
}

/** Every pending access request, unpaginated -- the queue is inherently
 * small, and both the sidebar's pending-badge poll and the Pending Requests
 * panel need the complete set, not one page of it. */
export const listPendingUsers = async (): Promise<PendingUser[]> => {
  const { data } = await apiClient.get<UserListResult>("/users", {
    params: { status: "pending" },
  });
  return data.entries;
};

export const reviewUser = async (
  userId: string,
  status: "active" | "rejected"
): Promise<PendingUser> => {
  const { data } = await apiClient.patch<PendingUser>(`/users/${userId}`, { status });
  return data;
};

/** Suspends (or restores) an existing account without deleting it -- blocks
 * login and, if they're already mid-session, revokes access on their next
 * page load (see GET /api/auth/me). */
export const setUserActive = async (userId: string, active: boolean): Promise<PendingUser> => {
  const { data } = await apiClient.patch<PendingUser>(`/users/${userId}`, {
    status: active ? "active" : "inactive",
  });
  return data;
};

/** Server-paginated, 25/page, with optional search (name/email), role, and
 * status filters. */
export const listAllUsers = async (
  page = 1,
  filters?: { search?: string; role?: string; status?: string }
): Promise<UserListResult> => {
  const { data } = await apiClient.get<UserListResult>("/users", {
    params: {
      page,
      ...(filters?.search ? { search: filters.search } : {}),
      ...(filters?.role ? { role: filters.role } : {}),
      ...(filters?.status ? { status: filters.status } : {}),
    },
  });
  return data;
};

export const createUser = async (input: {
  name: string;
  email: string;
  password: string;
  role: "source" | "testing" | "central-admin" | "admin";
}): Promise<PendingUser> => {
  const { data } = await apiClient.post<PendingUser>("/users", input);
  return data;
};

export const updateUserDetails = async (
  userId: string,
  input: { name?: string; email?: string; role?: "source" | "testing" | "central-admin" | "admin" }
): Promise<PendingUser> => {
  const { data } = await apiClient.patch<PendingUser>(`/users/${userId}`, input);
  return data;
};

export const setUserPassword = async (userId: string, newPassword: string) => {
  const { data } = await apiClient.patch(`/users/${userId}/password`, { newPassword });
  return data;
};

export const deleteUser = async (userId: string): Promise<void> => {
  await apiClient.delete(`/users/${userId}`);
};

export interface BugReportFilters {
  search?: string;
  type?: "bug" | "feature";
  severity?: "Low" | "Medium" | "High" | "Critical";
}

/** Admin-only (role === "admin"), matching Manage Users / Access Requests.
 * Server-paginated, 25/page. */
export const listBugReports = async (
  status?: BugReportStatus,
  page = 1,
  pageSize?: number,
  filters?: BugReportFilters
): Promise<BugReportListResult> => {
  const { data } = await apiClient.get<BugReportListResult>("/bug-reports", {
    params: {
      ...(status ? { status } : {}),
      page,
      ...(pageSize ? { page_size: pageSize } : {}),
      ...(filters?.search ? { search: filters.search } : {}),
      ...(filters?.type ? { type: filters.type } : {}),
      ...(filters?.severity ? { severity: filters.severity } : {}),
    },
  });
  return data;
};

export const setBugReportStatus = async (id: string, status: BugReportStatus): Promise<BugReport> => {
  const { data } = await apiClient.patch<BugReport>(`/bug-reports/${id}`, { status });
  return data;
};

export const deleteBugReport = async (id: string): Promise<void> => {
  await apiClient.delete(`/bug-reports/${id}`);
};

/** "Visiting" a report -- fetching its detail also marks it read
 * server-side, dropping it out of the sidebar bell's unread count. */
export const getBugReport = async (id: string): Promise<BugReport> => {
  const { data } = await apiClient.get<BugReport>(`/bug-reports/${id}`);
  return data;
};

/** Lightweight count-only poll for the sidebar notification bell. */
/** The signed-in user's own bug-report status notifications (any role -- these are about reports THEY filed). */
export const getBugNotifications = async (): Promise<BugNotificationsResult> => {
  const { data } = await apiClient.get<BugNotificationsResult>("/bug-notifications");
  return data;
};

export const markBugNotificationsRead = async (): Promise<void> => {
  await apiClient.patch("/bug-notifications", { all: true });
};

export const getUnreadBugReportCount = async (): Promise<number> => {
  const { data } = await apiClient.get<{ count: number }>("/bug-reports/unread-count");
  return data.count;
};

/** Fetched as a blob (rather than a bare <a href>) so it can be opened in a
 * new tab without the screenshot's URL ever appearing in browser history. */
export const openBugReportScreenshot = async (id: string): Promise<void> => {
  const { data } = await apiClient.get(`/bug-reports/${id}/screenshot`, {
    responseType: "blob",
  });
  const url = URL.createObjectURL(data as Blob);
  window.open(url, "_blank", "noopener,noreferrer");
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
};

// ----- Audit Log (admin-only, same access level as the rest of this file) -----

export const getAuditSummary = async (): Promise<AuditSummary> => {
  const { data } = await apiClient.get<AuditSummary>("/audit-log/summary");
  return data;
};

const rangeParams = (range: AuditRange) => ({
  ...(range.from ? { from: range.from } : {}),
  ...(range.to ? { to: range.to } : {}),
});

export const getAuditOverview = async (range: AuditRange): Promise<AuditOverview> => {
  const { data } = await apiClient.get<AuditOverview>("/audit-log/overview", { params: rangeParams(range) });
  return data;
};

/** Where the "Generate Report" button sends the browser -- same-origin, so the auth cookie rides along. */
export const auditExportUrl = (range: AuditRange): string => {
  const qs = new URLSearchParams(rangeParams(range)).toString();
  return `/api/audit-log/export${qs ? `?${qs}` : ""}`;
};

export const getAuditUsage = async (range: AuditRange): Promise<AuditUsageRow[]> => {
  const { data } = await apiClient.get<AuditUsageRow[]>("/audit-log/usage", { params: rangeParams(range) });
  return data;
};

export const getAuditSessions = async (range: AuditRange, page = 1): Promise<AuditSessionListResult> => {
  const { data } = await apiClient.get<AuditSessionListResult>("/audit-log/sessions", {
    params: { ...rangeParams(range), page },
  });
  return data;
};

export const getAuditActivity = async (
  range: AuditRange,
  page = 1,
  filters?: { search?: string; action?: "create" | "update" | "delete"; entity?: "user" }
): Promise<AuditActivityResult> => {
  const { data } = await apiClient.get<AuditActivityResult>("/audit-log/activity", {
    params: {
      ...rangeParams(range),
      page,
      ...(filters?.search ? { search: filters.search } : {}),
      ...(filters?.action ? { action: filters.action } : {}),
      ...(filters?.entity ? { entity: filters.entity } : {}),
    },
  });
  return data;
};

/** Which pages one user visited within a range, and how often -- backs the
 * "click a user for the page breakdown" drill-down on Usage by User. */
export const getAuditUserPages = async (userId: string, range: AuditRange): Promise<AuditUserPageRow[]> => {
  const { data } = await apiClient.get<AuditUserPageRow[]>(`/audit-log/usage/${userId}/pages`, {
    params: rangeParams(range),
  });
  return data;
};

/** Admin / Central Admin only, matching who can Assign Retest. Server-paginated,
 * 25/page. */
export const listActionRegistry = async (page = 1): Promise<PaginatedResult<ActionRegistryEntry>> => {
  const { data } = await apiClient.get<PaginatedResult<ActionRegistryEntry>>("/action-registry", {
    params: { page },
  });
  return data;
};
