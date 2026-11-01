import apiClient from "./apiClient";
import type { OrderSubtype, OrderType } from "../lib/roles";
import { filterParams, type EnquiryFilters } from "../lib/enquiry-filters";

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
  status: string | null;
  created_by: string | null;
  created_by_name: string | null;
  created_at: string;
  updated_at: string | null;
  /** Quotations generated (list endpoint only); Commercial is locked at 0. */
  quotation_count?: number;
  /** "pump" | "spare". */
  order_type: string;
  /** PCP / MMP / Barrel / Online blind, or Spare / Retrofit spare (lib/roles.ts). */
  order_subtype: string;
  /** Who works the enquiry (a worker sees only theirs - lib/roles.ts). */
  assigned_to: string | null;
  assigned_to_name: string | null;
  assigned_at: string | null;
  /** The client's reps, market type and zone from Market Intell. */
  client_primary_rep: string | null;
  client_secondary_reps: string | null;
  client_market_type: string | null;
  client_zone: string | null;
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
export const listProjectsPage = async (query: {
  page: number;
  pageSize?: number;
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
}): Promise<ProjectPage> => {
  const { data } = await apiClient.get<ProjectPage>("/projects", {
    params: {
      page: query.page,
      pageSize: query.pageSize,
      clientName: query.clientName?.trim() || undefined,
      enquiryCode: query.enquiryCode?.trim() || undefined,
      from: query.from || undefined,
      dateField: query.dateField || undefined,
      to: query.to || undefined,
      mine: query.mine ? "1" : undefined,
      ...filterParams(query.filters),
      rep: query.rep || undefined,
    },
  });
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
  status?: string;
  remarks?: string;
  orderType?: OrderType;
  orderSubtype?: OrderSubtype;
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

/** Assign or reassign an enquiry (User-Master / system admins only). */
export const assignProject = async (
  id: string,
  assignedTo: string,
): Promise<{ assigned_to: string; assigned_to_name: string | null }> => {
  const { data } = await apiClient.post(`/projects/${id}/assign`, { assignedTo });
  return data;
};
