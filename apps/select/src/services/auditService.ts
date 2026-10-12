import apiClient from "./apiClient";
import type { AuditOverview } from "../lib/audit-overview-shared";

export type { AuditOverview } from "../lib/audit-overview-shared";

/** The four "last 24h" counters across the top of the Audit Log page. These
 * are always 24h, independent of the table's own date filter. */
export interface AuditSummary {
  logins24h: number;
  failed24h: number;
  activeUsers24h: number;
  actions24h: number;
}

/** One person's rolled-up usage over the selected window ("Usage by User"). */
export interface AuditUsageRow {
  email: string | null;
  role: string | null;
  actions: number;
  sessions: number;
  lastActive: string | null;
  /** The IP of their most recent event in the window, and how many distinct
   *  IPs they used. */
  lastIp: string | null;
  ipCount: number;
  /** Estimated time actively using the app over the window, in seconds —
   *  summed gaps between consecutive events, idle gaps excluded (see
   *  lib/audit-stats.ts). */
  activeSeconds: number;
}

/** One recorded event (Activity / Logins & Sessions / Access Changes). */
export interface AuditEventRow {
  id: string;
  email: string | null;
  role: string | null;
  eventType: "login" | "login_failed" | "logout" | "action";
  action: string;
  entity: string | null;
  entityId: string | null;
  detail: string | null;
  ip: string | null;
  userAgent: string | null;
  createdAt: string | null;
  /** The enquiry and tag this event touched, resolved server-side from
   *  entity_id. Null for events that aren't about an enquiry (sign-ins, user
   *  admin) or whose tag has since been deleted. */
  enquiryCode: string | null;
  clientName: string | null;
  tagName: string | null;
}

export interface AuditResponse {
  summary: AuditSummary;
  rows: AuditUsageRow[] | AuditEventRow[];
  /** Rows matching the filters across the WHOLE set, not just this page. */
  total: number;
  page: number;
  pageSize: number;
  /** Only on the Overview tab. */
  overview?: AuditOverview;
}

/** The time window shared by the page and the report: explicit `from`/`to`
 * ISO instants win; otherwise the quick `range` chip applies. */
export interface AuditWindowParams {
  range: string;
  from?: string;
  to?: string;
}

/** System-admin only; the route rejects anyone else with 403. */
export const getAuditLog = async (
  params: AuditWindowParams & { tab: string; q?: string; page: number },
): Promise<AuditResponse> => {
  const { data } = await apiClient.get<AuditResponse>("/admin/audit", {
    params: {
      ...params,
      from: params.from || undefined,
      to: params.to || undefined,
      q: params.q || undefined,
    },
  });
  return data;
};

/** Everything the Audit Log PDF report needs for one window. */
export interface AuditReport {
  /** A range chip key, or "custom" when From/To dates were used. */
  range: string;
  since: string | null;
  until: string | null;
  generatedAt: string;
  /** Gaps between events longer than this count as idle, not active. */
  idleCutoffMinutes: number;
  totals: {
    events: number;
    logins: number;
    failed: number;
    actions: number;
    activeUsers: number;
    first: string | null;
    last: string | null;
    totalActiveSeconds: number;
  };
  usage: (AuditUsageRow & {
    failed: number;
    firstSeen: string | null;
  })[];
  byAction: { action: string; count: number; users: number }[];
  logins: AuditReportSection;
  access: AuditReportSection;
  activity: AuditReportSection;
}

export interface AuditReportSection {
  rows: AuditEventRow[];
  /** True when the section hit the server's row cap — the PDF says so. */
  truncated: boolean;
}

/** System-admin only. Also records an "audit.report" entry in the trail. */
export const getAuditReport = async (params: AuditWindowParams): Promise<AuditReport> => {
  const { data } = await apiClient.get<AuditReport>("/admin/audit/report", {
    params: {
      range: params.range,
      from: params.from || undefined,
      to: params.to || undefined,
    },
  });
  return data;
};
