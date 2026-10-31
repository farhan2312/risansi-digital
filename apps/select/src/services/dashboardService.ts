import apiClient from "./apiClient";
import type { DashboardData, DashboardListPage, DashboardListQuery } from "../lib/dashboard-shared";
import { filterParams, type EnquiryFilters } from "../lib/enquiry-filters";

export type {
  DashboardData,
  DashboardEnquiry,
  DashboardListEnquiry,
  DashboardListKind,
  DashboardListPage,
  DashboardListStatus,
  DashboardListTag,
  DashboardTag,
} from "../lib/dashboard-shared";

/** Everything the Dashboard shows. `from` / `to` are ISO instants; `mine`
 *  limits it to enquiries the signed-in user created. */
export const getDashboard = async (params: {
  from?: string;
  to?: string;
  mine?: boolean;
  filters?: EnquiryFilters;
  /** Rep Manager: one of their reps (a sales user id). */
  rep?: string;
}): Promise<DashboardData> => {
  const { data } = await apiClient.get<DashboardData>("/dashboard", {
    params: {
      from: params.from || undefined,
      to: params.to || undefined,
      mine: params.mine ? 1 : undefined,
      ...filterParams(params.filters),
      rep: params.rep || undefined,
    },
  });
  return data;
};

/** One page of the list behind a KPI card, with the same period / "mine" scope. */
export const getDashboardList = async (
  query: DashboardListQuery & { from?: string; to?: string; mine?: boolean; filters?: EnquiryFilters; rep?: string },
  signal?: AbortSignal,
): Promise<DashboardListPage> => {
  const { data } = await apiClient.get<DashboardListPage>("/dashboard/list", {
    params: {
      kind: query.kind,
      status: query.status,
      q: query.q?.trim() || undefined,
      offset: query.offset ?? 0,
      limit: query.limit ?? 20,
      from: query.from || undefined,
      to: query.to || undefined,
      mine: query.mine ? 1 : undefined,
      ...filterParams(query.filters),
      rep: query.rep || undefined,
    },
    signal,
  });
  return data;
};
