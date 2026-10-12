import apiClient from "./apiClient";

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
  /** Created-date window, ISO instants. */
  from?: string;
  to?: string;
  /** Only enquiries the signed-in user created. */
  mine?: boolean;
}): Promise<ProjectPage> => {
  const { data } = await apiClient.get<ProjectPage>("/projects", {
    params: {
      page: query.page,
      pageSize: query.pageSize,
      clientName: query.clientName?.trim() || undefined,
      enquiryCode: query.enquiryCode?.trim() || undefined,
      from: query.from || undefined,
      to: query.to || undefined,
      mine: query.mine ? "1" : undefined,
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
