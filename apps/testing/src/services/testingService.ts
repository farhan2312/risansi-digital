import apiClient from "./apiClient";
import type { PumpStatFilter } from "@/lib/reportVerdict";
import type {
  ActionRegistryEntry,
  ArchiveListResult,
  FlatReportListResult,
  ImprovementModelsResult,
  PerformanceResult,
  ArchiveReportSummary,
  BugReport,
  BugReportSeverity,
  BugReportType,
  DedupCheckResult,
  NewReportInput,
  NewRequisitionInput,
  PaginatedResult,
  PortalOverview,
  PumpDashboardData,
  PumpIndexListResult,
  PumpTestReport,
  RequisitionAttachment,
  RequisitionFilterOptions,
  RequisitionListResult,
  RequisitionStatus,
  TargetDateAlertResult,
  TestRequisition,
} from "../types/testing";

export interface RequisitionFilters {
  model?: string;
  ec_quotation_no?: string;
  category?: string;
  source_team?: string;
  responsible_person?: string;
  submitted_by?: string;
  retest_needed?: "true" | "false";
  month?: string;
  date_from?: string;
  date_to?: string;
  report_result?: "green" | "red";
  /** Not-yet-closed requisitions, optionally narrowed to overdue / due within 5 days. */
  scope?: "open" | "overdue" | "due_soon";
  /** Which kind of account raised the requisition. */
  raised_by?: "source" | "testing" | "other";
}

/** Server-paginated, 25/page, with the Testing Summary filter bar's full
 * filter set applied server-side. */
export const listRequisitions = async (
  status?: RequisitionStatus,
  page = 1,
  filters?: RequisitionFilters
): Promise<RequisitionListResult> => {
  const { data } = await apiClient.get<RequisitionListResult>("/requisitions", {
    params: { ...(status ? { status } : {}), page, ...filters },
  });
  return data;
};

/** Distinct Model / Submitted By / month values for the filter bar's
 * dropdowns, scoped to the given status tab -- see that route for why this
 * can't just be derived from the (now paginated) row list. */
export const getRequisitionFilterOptions = async (
  status?: RequisitionStatus
): Promise<RequisitionFilterOptions> => {
  const { data } = await apiClient.get<RequisitionFilterOptions>("/requisitions/filter-options", {
    params: status ? { status } : undefined,
  });
  return data;
};

/** Pending/Retest Needed requisitions due within 5 days whose Responsible
 * Person matches the logged-in user -- backs the sidebar target-date bell. */
export const getTargetDateAlerts = async (): Promise<TargetDateAlertResult> => {
  const { data } = await apiClient.get<TargetDateAlertResult>("/requisitions/target-date-alerts");
  return data;
};

export const getRequisition = async (id: string): Promise<TestRequisition> => {
  const { data } = await apiClient.get<TestRequisition>(`/requisitions/${id}`);
  return data;
};

export const createRequisition = async (input: NewRequisitionInput): Promise<TestRequisition> => {
  const { data } = await apiClient.post<TestRequisition>("/requisitions", input);
  return data;
};

export const updateRequisition = async (
  id: string,
  patch: Partial<TestRequisition>
): Promise<TestRequisition> => {
  const { data } = await apiClient.patch<TestRequisition>(`/requisitions/${id}`, patch);
  return data;
};

export const listAttachments = async (requisitionId: string): Promise<RequisitionAttachment[]> => {
  const { data } = await apiClient.get<RequisitionAttachment[]>(`/requisitions/${requisitionId}/attachments`);
  return data;
};

export const uploadAttachment = async (
  requisitionId: string,
  file: File
): Promise<RequisitionAttachment> => {
  const form = new FormData();
  form.append("file", file);
  const { data } = await apiClient.post<RequisitionAttachment>(
    `/requisitions/${requisitionId}/attachments`,
    form,
    // Content-Type: undefined overrides apiClient's default "application/json"
    // so the browser sets multipart/form-data with the correct boundary itself.
    { headers: { "Content-Type": undefined } }
  );
  return data;
};

export const deleteAttachment = async (requisitionId: string, attachmentId: string): Promise<void> => {
  await apiClient.delete(`/requisitions/${requisitionId}/attachments/${attachmentId}`);
};

/** Opens an attachment in a new tab. Fetches it as a blob rather than a
 * plain <a href> to the API route so the object URL (not the API route
 * itself) is what ends up in browser history/tab. */
export const openAttachment = async (requisitionId: string, attachmentId: string): Promise<void> => {
  const { data } = await apiClient.get(`/requisitions/${requisitionId}/attachments/${attachmentId}`, {
    responseType: "blob",
  });
  const url = URL.createObjectURL(data as Blob);
  window.open(url, "_blank", "noopener,noreferrer");
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
};

export const dedupCheck = async (model: string): Promise<DedupCheckResult> => {
  const { data } = await apiClient.get<DedupCheckResult>("/requisitions/dedup-check", {
    params: { model },
  });
  return data;
};

/** Quick-pick model suggestions for the requisition Model dropdown. */
export const listPumpModels = async (): Promise<string[]> => {
  const { data } = await apiClient.get<string[]>("/pump-models");
  return data;
};

/** Every requisition and report for one physical pump, matched by model. */
export const getPumpDashboard = async (model: string): Promise<PumpDashboardData> => {
  const { data } = await apiClient.get<PumpDashboardData>(`/pumps/${encodeURIComponent(model)}`);
  return data;
};

export interface PumpIndexFilters {
  model?: string;
  ec_quotation_no?: string;
  category?: string;
  source_team?: string;
  responsible_person?: string;
  submitted_by?: string;
  retest_needed?: "Yes" | "No";
  month?: string;
  date_from?: string;
  date_to?: string;
  stat_filter?: Exclude<PumpStatFilter, "all">;
  search?: string;
}

/** Report Compilation, server-paginated 50 pump-groups/page (see
 * GET /api/pumps for why this paginates groups rather than rows). */
export const listGroupedPumps = async (page = 1, filters?: PumpIndexFilters): Promise<PumpIndexListResult> => {
  const { data } = await apiClient.get<PumpIndexListResult>("/pumps", {
    params: { page, ...filters },
  });
  return data;
};

/** Portal-wide counts for the landing overview page. Optional from/to
 * ("YYYY-MM-DD") narrows every count to that window -- omit both for the
 * all-time snapshot. */
export const getOverview = async (range?: {
  from?: string;
  to?: string;
  mine?: boolean;
  category?: string;
  model?: string;
  status?: string;
}): Promise<PortalOverview> => {
  const { data } = await apiClient.get<PortalOverview>("/overview", { params: { ...range, mine: range?.mine ? 1 : undefined } });
  return data;
};

export const submitReport = async (input: NewReportInput): Promise<PumpTestReport> => {
  const { data } = await apiClient.post<PumpTestReport>("/reports", input);
  return data;
};

export const listReports = async (model?: string): Promise<ArchiveReportSummary[]> => {
  const { data } = await apiClient.get<ArchiveReportSummary[]>("/reports", {
    params: { limit: 500, ...(model ? { model } : {}) },
  });
  return data;
};

/** Report Archive, server-paginated 50 pump-groups/page (see
 * /api/reports/grouped for why this paginates groups rather than rows). */
export const listGroupedReports = async (
  page = 1,
  search?: string,
  range?: { from?: string; to?: string; category?: string; report_result?: "green" | "red" }
): Promise<ArchiveListResult> => {
  const { data } = await apiClient.get<ArchiveListResult>("/reports/grouped", {
    params: {
      page,
      ...(search ? { search } : {}),
      ...(range?.from ? { from: range.from } : {}),
      ...(range?.to ? { to: range.to } : {}),
      ...(range?.category ? { category: range.category } : {}),
      ...(range?.report_result ? { report_result: range.report_result } : {}),
    },
  });
  return data;
};

/** Flat, report-level pagination (50/page) -- unlike listGroupedReports (paginated by pump), used
 * wherever the point is a straight list of individual reports, e.g. the Overview's Met/Missed drill-down. */
export const listReportsFlat = async (
  page = 1,
  range?: { from?: string; to?: string; category?: string; report_result?: "green" | "red"; model?: string; status?: string }
): Promise<FlatReportListResult> => {
  const { data } = await apiClient.get<FlatReportListResult>("/reports/list", {
    params: {
      page,
      ...(range?.from ? { from: range.from } : {}),
      ...(range?.to ? { to: range.to } : {}),
      ...(range?.category ? { category: range.category } : {}),
      ...(range?.report_result ? { report_result: range.report_result } : {}),
      ...(range?.model ? { model: range.model } : {}),
      ...(range?.status ? { status: range.status } : {}),
    },
  });
  return data;
};

export const getReport = async (id: string): Promise<PumpTestReport> => {
  const { data } = await apiClient.get<PumpTestReport>(`/reports/${id}`);
  return data;
};

export const updateReport = async (
  id: string,
  input: Omit<NewReportInput, "requisitionId">
): Promise<PumpTestReport> => {
  const { data } = await apiClient.patch<PumpTestReport>(`/reports/${id}`, input);
  return data;
};

export const deleteRequisition = async (id: string): Promise<void> => {
  await apiClient.delete(`/requisitions/${id}`);
};

export const deleteReport = async (id: string): Promise<void> => {
  await apiClient.delete(`/reports/${id}`);
};

export interface AssignRetestResult {
  requisition: TestRequisition;
  action_registry_entry: ActionRegistryEntry;
}

/** Raises a fresh Pending requisition for this report's model, Retest Needed
 * pre-set, and records an Action Registry entry (unmet fields, rated/
 * measured snapshot, the given action points) -- Admin / Central Admin
 * only. */
export const assignRetest = async (reportId: string, actionPoints: string[] = []): Promise<AssignRetestResult> => {
  const { data } = await apiClient.post<AssignRetestResult>(`/reports/${reportId}/assign-retest`, {
    action_points: actionPoints,
  });
  return data;
};

/** Latest Observation Sheet report submitted for this exact pump model, if
 * any — used to prefill the Viscosity Correction Chart form for the same pump. */
export const getLatestObservationReport = async (model: string): Promise<ArchiveReportSummary | null> => {
  const trimmed = model.trim();
  if (!trimmed) return null;
  const rows = await listReports(trimmed);
  const matches = rows
    .filter((r) => r.model.toLowerCase() === trimmed.toLowerCase())
    .filter((r) => (r.report_format ?? "observation") === "observation")
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  return matches[0] ?? null;
};

export interface NewBugReportInput {
  type: BugReportType;
  title: string;
  description?: string;
  severity: BugReportSeverity;
  page?: string;
  screenshot?: File;
}

/** Available to every logged-in user regardless of role. */
export const submitBugReport = async (input: NewBugReportInput): Promise<BugReport> => {
  const form = new FormData();
  form.append("type", input.type);
  form.append("title", input.title);
  if (input.description) form.append("description", input.description);
  form.append("severity", input.severity);
  if (input.page) form.append("page", input.page);
  if (input.screenshot) form.append("screenshot", input.screenshot);
  const { data } = await apiClient.post<BugReport>("/bug-reports", form, {
    headers: { "Content-Type": undefined },
  });
  return data;
};

/** The models on the Improvement Projects list (compact -- no per-report history). */
export const getImprovementModels = async (): Promise<ImprovementModelsResult> => {
  const { data } = await apiClient.get<ImprovementModelsResult>("/performance", { params: { view: "improvement-models" } });
  return data;
};

/** VE & ME Performance page -- every model, its acceptance criteria and every report in date order. */
export const getPerformance = async (): Promise<PerformanceResult> => {
  const { data } = await apiClient.get<PerformanceResult>("/performance");
  return data;
};
