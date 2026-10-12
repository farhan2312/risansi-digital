/** Shapes for GET /api/dashboard, shared by the route and the Dashboard page. */

export type TagStatus = "Pending" | "In Progress" | "Completed";

export interface DashboardTag {
  id: string;
  name: string;
  status: string;
  liquid: string | null;
  pumpType: string | null;
  model: string | null;
  duty: string | null;
  reportGeneratedAt: string | null;
  /** Step approvals for this tag, by status (only steps put up for approval). */
  approvals: { awaiting: number; approved: number; rejected: number };
  createdAt: string | null;
  updatedAt: string | null;
}

export interface DashboardEnquiry {
  id: string;
  code: string;
  client: string;
  customer: string | null;
  clientCode: string | null;
  industry: string | null;
  /** Rolled up from the tags, same rule as the Enquiries list. */
  status: string;
  createdByName: string | null;
  createdAt: string | null;
  tags: DashboardTag[];
}

export interface DashboardData {
  kpis: {
    enquiries: number;
    tags: number;
    pending: number;
    inProgress: number;
    completed: number;
    reports: number;
    /** Steps sent for approval and not yet decided. */
    awaitingApproval: number;
    /** Tags with at least one such step. */
    awaitingTags: number;
  };
  /** IST days, zero-filled, capped to the last 92. */
  trend: { day: string; enquiries: number; tags: number; completed: number }[];
  enquiryStatus: { label: string; count: number }[];
  industries: { label: string; count: number }[];
  engineers: { label: string; enquiries: number; tags: number }[];
  approvals: { awaiting: number; approved: number; rejected: number };
  recent: DashboardEnquiry[];
}

// --- GET /api/dashboard/list: the list behind a KPI card ----------------------

export type DashboardListKind = "enquiries" | "tags";
/** Enquiry (rolled-up) or tag status; "awaiting" = tags with a step awaiting approval. */
export type DashboardListStatus = "all" | "Pending" | "In Progress" | "Completed" | "awaiting";

export interface DashboardListQuery {
  kind: DashboardListKind;
  status: DashboardListStatus;
  q?: string;
  offset?: number;
  limit?: number;
}

export interface DashboardListEnquiry {
  kind: "enquiry";
  id: string;
  code: string;
  client: string;
  customer: string | null;
  status: string;
  createdByName: string | null;
  createdAt: string | null;
  tagCount: number;
}

export interface DashboardListTag {
  kind: "tag";
  id: string;
  name: string;
  status: string;
  liquid: string | null;
  model: string | null;
  awaitingSteps: number;
  reportGeneratedAt: string | null;
  createdAt: string | null;
  enquiry: {
    id: string;
    code: string;
    client: string;
    customer: string | null;
    status: string | null;
    createdByName: string | null;
  };
}

export interface DashboardListPage {
  rows: (DashboardListEnquiry | DashboardListTag)[];
  /** Rows matching the query (all pages). */
  total: number;
}
