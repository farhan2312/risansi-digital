import apiClient from "./apiClient";
import type { SavedDocKind, SavedDocs, UnsavedSteps } from "../lib/saved-docs";
import type { ClearanceNow } from "../lib/clearance";
import type { OrderSubtype, OrderType } from "../lib/roles";
import type { EnquiryCategory } from "../lib/enquiry-fields";
import type { DocLinks } from "../lib/doc-links";
import type { AssignmentEntry } from "../lib/assignment-history";
import { filterParams, type EnquiryFilters, sortParam, type EnquirySort } from "../lib/enquiry-filters";

// Matches projectToDict() in lib/api.ts — raw snake_case columns plus the
// joined creator display name.
export interface ProjectRecord {
  id: string;
  project_code: string;
  name: string | null;
  customer_name: string | null;
  client_code: string | null;
  industry: string | null;
  /** YYYY-MM-DD, or null on older enquiries. */
  enquiry_date: string | null;
  remarks: string | null;
  /** Lists: the Technical status - Completed when all tags are completed, a
   *  quotation is generated and the data sheet is sent to operation, or what was
   *  picked on the Edit form. */
  status: string | null;
  created_by: string | null;
  created_by_name: string | null;
  created_at: string;
  updated_at: string | null;
  /** Clear or Hold, the newest of its history (list endpoint only). */
  clearance?: ClearanceNow | null;
  /** Quotations generated (list endpoint only); Commercial is locked at 0. */
  quotation_count?: number;
  /** "pump" | "spare". */
  order_type: string;
  /** PCP / MMP / Barrel / Online blind, or Spare / Retrofit spare (lib/roles.ts). */
  order_subtype: string;
  /** "regular" | "project"; a Project enquiry has remarks. */
  enquiry_category: string;
  /** Lists: the Commercial status - Completed when Technical is Completed, every
   *  tag has a P&A price and the quotations are sent to the client, or what was
   *  picked on the Edit form. */
  commercial_status?: string;
  /** Review: the saved versions were looked over, then sent to operation. */
  reviewed_at: string | null;
  released_to_operation_at: string | null;
  /** Changed on the Edit form; null = updating by itself. */
  technical_status_override: string | null;
  commercial_status_override: string | null;
  /** YYYY-MM-DD: when each status was completed, filled in by itself but editable. */
  completed_on: string | null;
  commercial_completed_on: string | null;
  /** The version: 0, 1, 2… Each version is its own row with the same enquiry no. */
  version_no: number;
  /** The Technical version; a Commercial only version leaves it as it was. */
  technical_version_no: number;
  /** The Commercial version; a Technical only version leaves it as it was. */
  commercial_version_no: number;
  /** How this version was made. */
  version_kind: "both" | "technical" | "commercial";
  /** The V0 row of this enquiry; null on V0 itself. */
  root_project_id: string | null;
  /** False on an older version, which is view only. */
  is_latest: boolean;
  /** What the client asked to change in this version. */
  revision_note: string | null;
  /** Who works the enquiry (a worker sees only theirs - lib/roles.ts). */
  assigned_to: string | null;
  assigned_to_name: string | null;
  assigned_at: string | null;
  /** The client's reps, market type and zone from Market Intell. */
  client_primary_rep: string | null;
  client_secondary_reps: string | null;
  client_market_type: string | null;
  client_zone: string | null;
  /** The TSM on its first quotation (list endpoint only). */
  quotation_tsm?: { initials: string; zone: string | null } | null;
}

/** Every enquiry, unpaginated. Used where the whole set is genuinely needed:
 * the Dashboard's stat cards, and the Copy-tag destination picker. */
export const listProjects = async (): Promise<ProjectRecord[]> => {
  const { data } = await apiClient.get<ProjectRecord[]>("/projects");
  return data;
};

export type ProjectPage = {
  items: ProjectRecord[];
  /** Rows matching the filters across the WHOLE table, not just this page. */
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

/** One page of enquiries, filtered and counted server-side. Filtering has to
 * happen on the server now: the client only holds one page, so filtering
 * there would search 20 rows rather than the whole table. */
export type ProjectListQuery = {
  clientName?: string;
  enquiryCode?: string;
  /** Date window, ISO instants, on `dateField`. */
  from?: string;
  to?: string;
  /** Which date the window is on: the enquiry date (default) or the date it was assigned. */
  dateField?: "enquiry" | "assigned";
  /** Only enquiries assigned to the signed-in user. */
  mine?: boolean;
  /** Reps / zone / market / industry / status (shared with the Dashboard). */
  filters?: EnquiryFilters;
  /** Rep Manager: one of their reps (a sales user id); empty = the team. */
  rep?: string;
  /** Column sorts, in order of priority; none = newest created first. */
  sort?: EnquirySort;
};

const listParams = (query: ProjectListQuery) => ({
  clientName: query.clientName?.trim() || undefined,
  enquiryCode: query.enquiryCode?.trim() || undefined,
  from: query.from || undefined,
  dateField: query.dateField || undefined,
  to: query.to || undefined,
  mine: query.mine ? "1" : undefined,
  ...filterParams(query.filters),
  rep: query.rep || undefined,
  sort: sortParam(query.sort),
});

export const listProjectsPage = async (query: ProjectListQuery & { page: number; pageSize?: number }): Promise<ProjectPage> => {
  const { data } = await apiClient.get<ProjectPage>("/projects", {
    params: { page: query.page, pageSize: query.pageSize, ...listParams(query) },
  });
  return data;
};

/** Every enquiry the filters match, for the Enquiry Report. */
export const listProjectsReport = async (query: ProjectListQuery): Promise<ProjectRecord[]> => {
  const { data } = await apiClient.get<ProjectRecord[]>("/projects", { params: listParams(query) });
  return data;
};

/** Fetches a single project, for validating a stashed sessionStorage
 * selection is still real (e.g. wasn't deleted since it was picked). Returns
 * null on 404 — not an error state. */
export const getProject = async (id: string): Promise<ProjectRecord | null> => {
  try {
    const { data } = await apiClient.get<ProjectRecord>(`/projects/${id}`);
    return data;
  } catch (err) {
    const status = (err as { response?: { status?: number } })?.response?.status;
    if (status === 404) return null;
    throw err;
  }
};

export interface CreateProjectInput {
  /** Enquiry no. — user-supplied and required; sent as `project_code` to
   * match the API contract (the column kept its original name). */
  projectCode: string;
  name: string;
  clientCode: string;
  industry: string;
  /** YYYY-MM-DD */
  enquiryDate: string;
  orderType: OrderType;
  orderSubtype: OrderSubtype;
  enquiryCategory: EnquiryCategory;
  /** Required when the category is Project. */
  remarks: string;
  /** User id; the creator when empty. */
  assignedTo: string;
  clientPrimaryRep: string;
  clientSecondaryReps: string;
  clientMarketType: string;
  clientZone: string;
}

export const createProject = async (
  input: CreateProjectInput
): Promise<ProjectRecord> => {
  const { projectCode, ...rest } = input;
  const { data } = await apiClient.post<ProjectRecord>("/projects", {
    ...rest,
    project_code: projectCode,
  });
  return data;
};

// Any of these may be sent; only the provided keys are updated server-side.
export interface UpdateProjectInput {
  /** Enquiry no. — editable. */
  projectCode?: string;
  name?: string;
  customerName?: string;
  clientCode?: string;
  industry?: string;
  /** YYYY-MM-DD; empty clears it. */
  enquiryDate?: string;
  /** Pending / In Progress / Completed. The same as the automatic status means it
   *  keeps updating by itself. */
  technicalStatus?: string;
  /** With Completed: the completion date. */
  completedOn?: string;
  commercialStatus?: string;
  commercialCompletedOn?: string;
  remarks?: string;
  orderType?: OrderType;
  orderSubtype?: OrderSubtype;
  enquiryCategory?: EnquiryCategory;
  clientPrimaryRep?: string;
  clientSecondaryReps?: string;
  clientMarketType?: string;
  clientZone?: string;
}

export const updateProject = async (
  id: string,
  input: UpdateProjectInput
): Promise<ProjectRecord> => {
  const { data } = await apiClient.patch<ProjectRecord>(`/projects/${id}`, input);
  return data;
};

/** Every version of an enquiry, newest first. */
export const listEnquiryVersions = async (id: string): Promise<ProjectRecord[]> => {
  const { data } = await apiClient.get<ProjectRecord[]>(`/projects/${id}/versions`);
  return data;
};

/** The next version of a Completed enquiry (User-Master / system admins only). */
export const createEnquiryRevision = async (
  id: string,
  input: { enquiryDate: string; assignedTo: string; note: string; kind?: "both" | "technical" | "commercial" },
): Promise<ProjectRecord> => {
  const { data } = await apiClient.post<ProjectRecord>(`/projects/${id}/versions`, input);
  return data;
};

export const deleteProject = async (id: string): Promise<void> => {
  await apiClient.delete(`/projects/${id}`);
};

/** Someone an enquiry can be assigned to (GET /projects/assignees). */
export interface Assignee {
  id: string;
  name: string | null;
  email: string;
  role: string | null;
  is_me: boolean;
}

/** Workers and the master (plus the caller) - User-Master / system admins only. */
export const listAssignees = async (): Promise<Assignee[]> => {
  const { data } = await apiClient.get<Assignee[]>("/projects/assignees");
  return data;
};

/** Who it was assigned to, by whom, when and why (GET /projects/[id]/assign). */
export const getAssignmentHistory = async (id: string): Promise<AssignmentEntry[]> => {
  const { data } = await apiClient.get<AssignmentEntry[]>(`/projects/${id}/assign`);
  return data;
};

/** The assignment history of many enquiries at once, for the Enquiry Report (POST /projects/assignment-history). */
export const getAssignmentHistories = async (ids: string[]): Promise<Record<string, AssignmentEntry[]>> => {
  if (ids.length === 0) return {};
  const { data } = await apiClient.post<Record<string, AssignmentEntry[]>>("/projects/assignment-history", { ids });
  return data;
};

/** Assign or reassign an enquiry (User-Master / system admins only); a reassign needs its reason. */
export const assignProject = async (
  id: string,
  assignedTo: string,
  reason = "",
): Promise<{ assigned_to: string; assigned_to_name: string | null }> => {
  const { data } = await apiClient.post(`/projects/${id}/assign`, { assignedTo, reason });
  return data;
};

/** The saved documents, and what still needs Save Version before this enquiry can be reviewed (or null). */
/** The saved documents, the steps still needing Save Version, and those completed by hand. */
export type ReviewState = { unsaved: UnsavedSteps; hand: { technical: boolean; commercial: boolean }; docs: SavedDocs };
export const getReviewState = async (projectId: string): Promise<ReviewState> => {
  const { data } = await apiClient.get<ReviewState>(`/projects/${projectId}/review`);
  return data;
};

/** Client's own format on / off, and its documents' SharePoint links ("" clears one).
 *  Returns the links, or null when off. */
export const saveDocLinks = async (projectId: string, body: { clientFormat: boolean } & DocLinks): Promise<{ links: DocLinks | null; changed: boolean }> => {
  const { data } = await apiClient.put<{ links: DocLinks | null; changed: boolean }>(`/projects/${projectId}/doc-links`, body);
  return data;
};

/** Marks the saved versions as reviewed, then records them as sent to operation; reopen
 *  takes a sent version back to be sent again. docs: a pump's documents picked to go. */
export const reviewEnquiry = async (
  projectId: string,
  action: "reviewed" | "send" | "reopen",
  docs?: SavedDocKind[],
): Promise<Pick<ProjectRecord, "reviewed_at" | "released_to_operation_at"> & { operation_docs: SavedDocKind[] | null }> => {
  const { data } = await apiClient.post(`/projects/${projectId}/review`, { action, ...(docs ? { docs } : {}) });
  return data;
};
