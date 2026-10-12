// Field names are snake_case to match the Next.js API route responses
// (src/lib/api.ts serializers, mirroring the old function_app.py convention).

/** Shape every server-paginated list endpoint returns (see src/lib/pagination.ts
 * -- fixed 25 rows/page). */
export interface PaginatedResult<T> {
  entries: T[];
  total: number;
  page: number;
  page_size: number;
}

export type RequisitionStatus = "Pending" | "In Testing" | "Retest Needed" | "Closed";

export const REQUISITION_CATEGORIES = [
  "Against Pump Testing Project",
  "Against New Die Pin",
  "Against Die Pin Rework",
  "Against Quotation Test",
  "Against R&D Trials",
  "Against EC Based",
  // Testing done to raise a model's VE/ME -- tracked on the VE & ME Performance page, where each
  // Improvement Project test is compared with the test before it on the same model.
  "Against Improvement Project",
] as const;

/** Label for the EC/Quotation/Offer No. field, tailored to the requisition category. */
export const ecQuotationLabel = (category?: string | null): string => {
  if (category === "Against EC Based") return "EC No.";
  if (category === "Against Quotation Test") return "Quotation No.";
  return "EC/Quotation/Offer No.";
};

/** RIL's standard EC/quotation-number schemes, shown as a format hint under
 * the field for the categories that have one -- undefined (no hint) for
 * every other category. */
export const ecQuotationFormatHint = (category?: string | null): string | undefined => {
  if (category === "Against Quotation Test") return "RIL/QT/TSM CODING/CATEGORY OF ITEM/OFFER";
  if (category === "Against EC Based") return "EC/YEAR/1/So No./EC No.";
  return undefined;
};

export const SOURCE_TEAMS = ["Research", "Proposal", "Testing"] as const;

export const RESPONSIBLE_PERSONS = ["Sachin", "Vikash"] as const;

// The two standard motor synchronous speeds used across every requisition
// and report form -- Motor RPM is a fixed-choice field, not free text.
export const MOTOR_RPM_OPTIONS = ["1440", "960"] as const;

export const TEST_TYPES = ["V-notch", "Barrel", "Flow Meter"] as const;
export type TestType = (typeof TEST_TYPES)[number];

export const NPSHA_STATUSES = ["POSITIVE", "NEGATIVE"] as const;

export const CAPACITY_UNITS = ["M3/HR", "MT/HR", "LPH", "KG/MIN", "TPH"] as const;
export const HEAD_UNITS = ["MWC", "MLC", "KG/CM2", "MTR", "TPH"] as const;

// Viscosity Correction Chart form has its own (slightly different) unit lists.
export const VISCOSITY_CAPACITY_UNITS = ["M3/HR", "LPH", "TPH", "MT/HR", "KG"] as const;
export const VISCOSITY_HEAD_UNITS = ["MWC", "MLC", "KG/CM2", "METER"] as const;

export const REPORT_FORMATS = ["observation", "viscosity-chart"] as const;
export type ReportFormat = (typeof REPORT_FORMATS)[number];

export interface TestRequisition {
  id: string;
  /** Human-readable sequential number ("REQ-000123") -- shown in the URL
   * and UI instead of id. */
  requisition_no: string | null;
  model: string;
  category: string | null;
  ec_quotation_no: string | null;
  offer_date: string | null;
  responsible_person: string | null;
  source_team: string | null;
  date_of_requisition: string | null;
  test_qty: number | null;

  qth: number | null;
  specific_gravity: number | null;
  power_hp: number | null;
  power_kw: number | null;
  head_kgcm2: number | null;
  head_unit: string | null;
  rpm: number | null;
  motor_rpm: number | null;
  req_capacity: number | null;
  req_capacity_unit: string | null;

  // Only shown/filled on the requisition form when Category is "Against
  // R&D Trials" -- general_remarks (below) doubles as "Open Remarks" there.
  media_type: string | null;
  target_date: string | null;

  observation: string | null;
  ra_value: number | null;
  ve_rated_head: number | null;
  me_rated_head: number | null;
  measured_capacity: number | null;
  measured_head: number | null;
  measured_power: number | null;
  noise_jamming_other: string | null;
  action: string | null;
  npsha: number | null;
  test_result: "Positive" | "Negative" | null;

  testing_plan_date: string | null;
  date_of_testing: string | null;
  retest_without_changing_die_pin: boolean | null;
  retest_needed: boolean | null;
  die_pin_rework: boolean | null;
  status: RequisitionStatus;
  general_remarks: string | null;
  action_remarks: string | null;

  created_by: string | null;
  submitted_by: string | null;
  created_at: string;
  updated_at: string;
  closed_at: string | null;

  reports?: PumpTestReport[];
  report_id?: string | null;
  /** The linked report's human-readable number ("TR-000159") -- use this,
   * not report_id, when linking to /reports/[id]. */
  report_no?: string | null;
  /** Which rated fields (Head/Capacity/Power) the linked report's test
   * points never reached -- empty when met or there's no report yet. */
  report_requirement_unmet_fields?: string[];
  /** Whether a Source Team user, a Testing Team user, or someone else raised it (list responses only). */
  raised_by_group?: "source" | "testing" | "other";
  attachments?: RequisitionAttachment[];
}

/** GET /api/requisitions's response -- a paginated page of rows, the
 * Testing Summary filter bar's full filter set applied server-side, plus
 * `report_result_counts` (Green/Met vs Red/Not-Met, only computed once a
 * Category filter narrows the scope -- see that route for why). */
export interface RequisitionListResult extends PaginatedResult<TestRequisition> {
  report_result_counts: { green: number; red: number } | null;
}

/** GET /api/requisitions/target-date-alerts's response -- backs the
 * sidebar target-date bell. Every Pending/Retest Needed requisition due
 * within 5 days (or overdue) whose Responsible Person matches the
 * logged-in user. */
export interface TargetDateAlertItem {
  id: string;
  requisition_no: string | null;
  model: string;
  status: RequisitionStatus;
  target_date: string | null;
}

export interface TargetDateAlertResult {
  count: number;
  items: TargetDateAlertItem[];
}

/** GET /api/requisitions/filter-options's response -- every distinct
 * Model / Submitted By / calendar-month value in the current status tab
 * (and, for the "source" role, only that user's own requisitions), backing
 * the Testing Summary filter bar's dropdowns. Computed server-side since
 * the row list itself is now paginated and can't be used to derive them. */
export interface RequisitionFilterOptions {
  models: string[];
  submitted_by: string[];
  months: string[];
}

/** Metadata only -- file_data is never sent down with the list, only via the
 * dedicated download endpoint (GET .../attachments/[attachmentId]). */
export interface RequisitionAttachment {
  id: string;
  requisition_id: string;
  file_name: string;
  mime_type: string;
  file_size: number;
  uploaded_by: string | null;
  uploaded_by_name: string | null;
  created_at: string;
}

export interface NewRequisitionInput {
  model: string;
  category: string;
  ec_quotation_no?: string;
  offer_date?: string;
  responsible_person: string;
  source_team: string;
  date_of_requisition?: string;
  test_qty?: number;
  qth?: number;
  specific_gravity?: number;
  power_hp?: number;
  power_kw?: number;
  head_kgcm2?: number;
  head_unit?: string;
  rpm?: number;
  motor_rpm?: number;
  req_capacity?: number;
  req_capacity_unit?: string;
  media_type?: string;
  target_date?: string;
  general_remarks?: string;
}

export interface PumpTestReportPoint {
  id?: string;
  rpm: number | null;
  head_kgcm2: number | null;
  head_mwc: number | null;
  vnotch_height: number | null;
  initial_reading: number | null;
  differential_height: number | null;
  capacity_calculated_m3hr: number | null;
  volts: number | null;
  amps: number | null;
  cos_phi: number | null;
  power_calculated_kw: number | null;
  theoretical_power_kw: number | null;
  mechanical_efficiency: number | null;
  theoretical_capacity_at_measured_rpm: number | null;
  slip_water: number | null;
  slip_viscous: number | null;
  theoretical_capacity_at_rated_rpm: number | null;
  capacity_liquid_at_rated_rpm_m3hr: number | null;
  capacity_liquid_at_rated_rpm_lph: number | null;
  // Digital-format additions
  height_taken_for_filling: number | null;
  time_taken_to_fill_bucket_sec: number | null;
  volumetric_efficiency: number | null;
  // Viscosity Correction Chart additions
  volumetric_efficiency_liquid: number | null;
  mechanical_efficiency_liquid: number | null;
}

export interface PumpTestReport {
  id: string;
  requisition_id: string | null;
  /** The linked requisition's human-readable number ("REQ-000123") -- only
   * present where the route actually joins for it (report detail, pump
   * dashboard); use this, not requisition_id, when linking to it. */
  requisition_no?: string | null;
  report_no: string | null;
  model: string;
  gearbox_no: string | null;
  gearbox_ratio: string | null;
  motor: string | null;
  motor_rpm: number | null;
  suction_type: string | null;
  liquid: string | null;
  rated_capacity: number | null;
  rated_head: number | null;
  specific_gravity: number | null;
  viscosity_cps: number | null;
  k_for_given_cps: number | null;
  rated_rpm: number | null;
  q_theoretical_100rev: number | null;
  calculated_head: number | null;
  rated_power_kw: number | null;
  // Digital-format additions
  test_type: TestType | null;
  npsha_status: string | null;
  capacity_unit: string | null;
  head_unit: string | null;
  reference_voltage: number | null;
  reference_current: number | null;
  vnotch_baseline: number | null;
  tested_by: string | null;
  test_date: string | null;
  created_at: string;
  // Format tag + Viscosity Correction Chart header fields
  report_format: ReportFormat | null;
  po_no: string | null;
  ec_no: string | null;
  rev_no: string | null;
  rev_date: string | null;
  pump_serial_no: string | null;

  // Vibration test + run summary footer block, Observation Sheet only.
  vibration_sound_db: number | null;
  vibration_x_mm_sec: number | null;
  vibration_y_mm_sec: number | null;
  vibration_z_mm_sec: number | null;
  pump_started_at: string | null;
  pump_stopped_at: string | null;
  total_run: string | null;
  ambient_temp_c: number | null;
  max_bearing_temp_c: number | null;
  total_rise_c: number | null;
  witness: string | null;
  inspector: string | null;
  recorder: string | null;

  remarks: string | null;
  prepared_by: string | null;

  points: PumpTestReportPoint[];
}

export interface NewReportInput {
  requisitionId?: string;
  model: string;
  gearbox_no?: string;
  gearbox_ratio?: string;
  motor?: string;
  motor_rpm?: number;
  suction_type?: string;
  liquid?: string;
  rated_capacity?: number;
  rated_head?: number;
  specific_gravity?: number;
  viscosity_cps?: number;
  k_for_given_cps?: number;
  rated_rpm?: number;
  q_theoretical_100rev?: number;
  calculated_head?: number;
  rated_power_kw?: number;
  test_type?: string;
  npsha_status?: string;
  capacity_unit?: string;
  head_unit?: string;
  reference_voltage?: number;
  reference_current?: number;
  vnotch_baseline?: number;
  tested_by?: string;
  test_date?: string;
  report_format?: ReportFormat;
  po_no?: string;
  ec_no?: string;
  rev_no?: string;
  rev_date?: string;
  pump_serial_no?: string;
  vibration_sound_db?: number;
  vibration_x_mm_sec?: number;
  vibration_y_mm_sec?: number;
  vibration_z_mm_sec?: number;
  pump_started_at?: string;
  pump_stopped_at?: string;
  total_run?: string;
  ambient_temp_c?: number;
  max_bearing_temp_c?: number;
  total_rise_c?: number;
  witness?: string;
  inspector?: string;
  recorder?: string;
  remarks?: string;
  points: Omit<PumpTestReportPoint, "id">[];
}

export interface ArchiveReportSummary extends Omit<PumpTestReport, "points"> {
  /** The category the report states for itself (lib/reportCategory.ts) -- a
   * category name, or "none" when it doesn't state one. Report Archive only. */
  report_category?: string;
  pointCount: number;
  /** Which rated fields (Head/Capacity/Power) the report's own test points
   * never reached -- empty when met or when there's nothing to compare. */
  requirement_unmet_fields: string[];
  /** True when the report has a rated Head/Capacity/Power with a measured value to compare it with.
   * False = "not judged": neither Met nor Did Not Meet (see lib/reportVerdict.ts). */
  has_target: boolean;
  /** Highest Volumetric/Mechanical Efficiency reached across this report's
   * own test points -- null when there's no VE/ME data to max over. */
  max_ve: number | null;
  max_me: number | null;
  /** Every test point's own head/capacity/power, in the same order across
   * all three arrays (sorted by head ascending, same convention the report
   * detail page's Test Data table uses) -- backs the Pump Dashboard's
   * expanded "rated vs every measured point" columns. */
  points_head_kgcm2: (number | null)[];
  points_capacity_m3hr: (number | null)[];
  points_power_kw: (number | null)[];
}

/** One row of GET /api/reports/grouped's paginated (50/page) response --
 * Report Archive groups reports by physical pump, so it paginates pump
 * groups rather than raw report rows. */
export interface ArchivePumpGroup {
  model: string;
  report_count: number;
  total_points: number;
  latest_test_date: string;
  has_observation: boolean;
  has_viscosity_chart: boolean;
  reports: ArchiveReportSummary[];
}

/** GET /api/reports/grouped -- pump groups plus the number of reports behind them (across all pages). */
export interface ArchiveListResult extends PaginatedResult<ArchivePumpGroup> {
  total_reports: number;
}

/** GET /api/reports/list -- flat, report-level pagination (50/page), unlike /reports/grouped's
 * per-pump pagination. Used for the Overview's Met/Missed drill-down. */
export type FlatReportListResult = PaginatedResult<ArchiveReportSummary>;

/** One row of GET /api/pumps's paginated (50/page) response -- Report
 * Compilation, same as Report Archive, paginates pump groups rather than
 * raw rows. Carries its own full (unfiltered) reports/requisitions so the
 * client's existing per-row "which of this pump's rows match" display
 * logic (see requisitionFilters.ts) keeps working unchanged. */
export interface PumpIndexGroup {
  model: string;
  report_count: number;
  requisition_count: number;
  latest_date: string;
  reports: ArchiveReportSummary[];
  requisitions: TestRequisition[];
}

/** Portal-wide totals (role-scoped only, not filtered) backing the Report
 * Compilation KPI tiles. */
export interface PumpIndexSummary {
  /** Every report in the portal = historical + portal. */
  total_reports: number;
  /** Imported old reports (prepared by "Legacy Import"). */
  historical: number;
  /** Filed through the portal = total_reports - historical. */
  portal: number;
  /** met + unmet + not_judged = total_reports. */
  met: number;
  unmet: number;
  /** Nothing to judge: no rated target, or no measured value to compare it with. */
  not_judged: number;
  /** All pump models (grouped by name) -- including ones that only have requisitions. */
  pump_count: number;
  /** Pump models with at least one report. */
  pumps_with_reports: number;
}

export interface PumpIndexFilterOptions {
  models: string[];
  submitted_by: string[];
  months: string[];
}

/** A report filed through the portal (not an imported one) -- listed in the "Filed in Portal" tile's hover. */
export interface PortalReportRef {
  report_no: string | null;
  model: string;
}

export interface PumpIndexListResult extends PaginatedResult<PumpIndexGroup> {
  summary: PumpIndexSummary;
  portal_reports: PortalReportRef[];
  filter_options: PumpIndexFilterOptions;
}

export interface DedupCheckResult {
  model: string;
  priorReports: PumpTestReport[];
  alreadyTested: boolean;
}

export interface PumpDashboardData {
  model: string;
  requisitions: TestRequisition[];
  reports: PumpTestReport[];
}

/** Portal-wide counts for the landing overview page -- see /api/overview. */
export interface PortalOverview {
  total_requisitions: number;
  requisitions_by_status: Partial<Record<RequisitionStatus, number>>;
  total_reports: number;
  reports_by_format: Partial<Record<ReportFormat, number>>;
  total_test_points: number;
  /** Distinct pump models raised for testing OR actually tested -- same
   * normalized-key count as the Pump Dashboard's "Pump Models" tile. */
  distinct_models_tested: number;
  requirement_met: number;
  requirement_unmet: number;
  /** Of the judged reports above, how many missed each rated parameter (a
   * report can miss more than one). */
  unmet_by_parameter: { head: number; capacity: number; power: number };
  open_statuses: RequisitionStatus[];
  /** Open requisitions past / within 5 days of their effective target date. */
  overdue_count: number;
  due_soon_count: number;
  /** Mean days from a requisition being raised to it closing. */
  avg_turnaround_days: number | null;
  /** Same counts for the equal-length window just before `from`..`to` --
   * null unless both bounds are set. */
  previous_period: { total_requisitions: number; total_reports: number } | null;
  /** Whether `monthly_trend` / `category_matrix` buckets are YYYY-MM or (for windows <= 31 days) YYYY-MM-DD. */
  trend_granularity: "day" | "month";
  monthly_trend: { month: string; raised: number; reports: number; closed: number }[];
  by_category: { label: string; count: number }[];
  /** Requisitions AND reports by category, for the Dashboard's "Requisitions by category" table.
   * total = requisitions + reports; completed = Closed requisitions + every report (a report is
   * always "done"); pending = requisitions not yet Closed (reports are never pending). `requisitions`
   * / `reports` are the raw counts behind `total`, for a breakdown tooltip. Fixed category order,
   * "Uncategorised" last, empty categories omitted. */
  requisitions_by_category_status: {
    label: string;
    total: number;
    completed: number;
    pending: number;
    requisitions: number;
    reports: number;
  }[];
  by_source_team: { label: string; count: number }[];
  /** Every report in the portal, regardless of the date range. */
  total_reports_all_time: number;
  /** Reports in range by category (taken from the requisition / pump model -- see lib/reportCategory.ts); empty buckets omitted. */
  reports_by_category: { key: string; label: string; count: number }[];
  /** Requisitions by the raiser's role -- always all three groups, zeros included. */
  by_raiser: { group: "source" | "testing" | "other"; label: string; count: number }[];
  workload: { person: string; pending: number; in_testing: number; retest_needed: number; total: number }[];
  category_matrix: { months: string[]; rows: { category: string; counts: number[] }[] };
  upcoming_deadlines: {
    id: string;
    requisition_no: string | null;
    model: string;
    ec_quotation_no: string | null;
    status: RequisitionStatus;
    responsible_person: string | null;
    target_date: string;
    days_left: number;
  }[];
  recent_reports: {
    id: string;
    report_no: string | null;
    model: string;
    report_format: ReportFormat | null;
    date: string | null;
    unmet_fields: string[];
    has_target: boolean;
  }[];
}

export type BugReportType = "bug" | "feature";
export type BugReportSeverity = "Low" | "Medium" | "High" | "Critical";
export type BugReportStatus = "Open" | "In Progress" | "Resolved";

/** Metadata only -- screenshot bytes are never sent down with the list, only
 * via the dedicated GET .../bug-reports/[id]/screenshot endpoint. */
/** One "your bug report's status changed" notification for the signed-in user (top-bar bell). */
export interface BugNotification {
  id: string;
  bug_report_id: string | null;
  bug_title: string;
  old_status: string | null;
  new_status: string;
  changed_by_name: string | null;
  created_at: string;
  is_read: boolean;
}

export interface BugNotificationsResult {
  unread: number;
  items: BugNotification[];
}

export interface BugReport {
  id: string;
  type: BugReportType;
  title: string;
  description: string | null;
  severity: BugReportSeverity;
  page: string | null;
  status: BugReportStatus;
  screenshot_file_name: string | null;
  screenshot_mime_type: string | null;
  screenshot_file_size: number | null;
  has_screenshot: boolean;
  reported_by: string | null;
  reported_by_name: string | null;
  created_at: string;
  is_read: boolean;
}

/** GET /api/bug-reports's response -- a paginated page of rows (optionally
 * narrowed by `status`) plus `status_counts`, which is always unfiltered so
 * the admin page's status-tab pill counts reflect the whole table
 * regardless of which tab/page is currently selected. */
export interface BugReportListResult extends PaginatedResult<BugReport> {
  status_counts: Partial<Record<BugReportStatus, number>>;
}

// ----- Audit Log (admin-only) -----

/** Audit Log date window -- IST calendar days (YYYY-MM-DD), either end optional. */
export interface AuditRange {
  from?: string;
  to?: string;
}

export interface AuditSummary {
  logins_24h: number;
  failed_24h: number;
  active_users_24h: number;
  actions_24h: number;
}

export interface AuditUsageRow {
  user_id: string;
  user_name: string | null;
  user_email: string | null;
  /** Null when the account has since been deleted -- role comes from a live
   * join against users, not a snapshot. */
  user_role: string | null;
  session_count: number;
  /** Seconds -- format for display, don't reformat server-side. */
  active_seconds: number;
  page_count: number;
  last_active: string;
}

/** Per-page breakdown for one user within a range -- backs the "click a
 * user for the page breakdown" drill-down on Usage & Time. */
export interface AuditUserPageRow {
  path: string;
  view_count: number;
  last_viewed: string;
}

export interface AuditSessionEntry {
  id: string;
  user_name: string | null;
  user_email: string | null;
  event_type: "login" | "login_failed" | "logout";
  details: string | null;
  ip_address: string | null;
  created_at: string;
}

export interface AuditActivityEntry {
  id: string;
  user_name: string | null;
  user_email: string | null;
  user_role: string | null;
  event_type: "create" | "update" | "delete";
  entity_type: string | null;
  entity_id: string | null;
  /** The entity's human-readable number (requisition_no/report_no) when
   * entity_type is "requisition"/"report" -- use this, not entity_id, when
   * linking to it. Null for every other entity type, or when the id no
   * longer resolves to anything (the row was since deleted). */
  entity_no: string | null;
  entity_label: string | null;
  details: string | null;
  ip_address: string | null;
  created_at: string;
}

export interface AuditActivityResult extends PaginatedResult<AuditActivityEntry> {}

export interface AuditDailyPoint {
  /** IST calendar day, YYYY-MM-DD. */
  day: string;
  actions: number;
  sign_ins: number;
  failed: number;
  sign_outs: number;
  /** Distinct signed-in users with any event that day. */
  users: number;
  active_seconds: number;
  requisitions: number;
  reports: number;
}

/** One user's row in the Overview tab's day grids -- each array is aligned to `matrix_days`. */
export interface AuditUserDayRow {
  user_id: string;
  email: string | null;
  name: string | null;
  role: string | null;
  active_days: number;
  actions: number[];
  active_seconds: number[];
  requisitions: number[];
  reports: number[];
}

export interface AuditIpRow {
  ip: string;
  events: number;
  users: number;
  failed: number;
  emails: string[];
  last_at: string;
}

/** One podium place. `value` is seconds (by time) or a count (by actions); `share_pct` is that person's share of the range's total. */
export interface AuditLeader {
  rank: number;
  user_id: string;
  email: string | null;
  name: string | null;
  role: string | null;
  value: number;
  share_pct: number;
}

export interface AuditCount {
  label: string;
  count: number;
}

/** GET /api/audit-log/overview -- everything the Audit Log's Overview tab draws. */
export interface AuditOverview {
  /** IST days the trend covers (the range, capped to its latest 62). */
  days: string[];
  daily_capped: boolean;
  /** The latest <= 14 of `days` -- the per-user grids' columns. */
  matrix_days: string[];
  /** How much of the live user base actually uses the portal in this range. */
  adoption: {
    accounts: number;
    active_users: number;
    never_signed_in: number;
    dormant: number;
    sessions: number;
    avg_session_seconds: number;
    active_seconds: number;
    page_views: number;
    /** Length of the range in days -- null when it is open-ended ("all time"). */
    window_days: number | null;
  };
  kpis: {
    requisitions_created: number;
    reports_created: number;
    sign_ins: number;
    failed_sign_ins: number;
    distinct_ips: number;
    previous: { requisitions_created: number; reports_created: number; sign_ins: number } | null;
  };
  daily: AuditDailyPoint[];
  event_types: { actions: number; sign_ins: number; failed_sign_ins: number; sign_outs: number };
  action_breakdown: AuditCount[];
  /** [weekday Mon=0..Sun=6][hour 0..23] event counts, IST. */
  heatmap: number[][];
  insights: {
    busiest_day: { day: string; events: number; users: number } | null;
    peak_hour: { hour: number; events: number; hottest: { dow: number; hour: number; events: number } | null } | null;
    top_user: { email: string | null; name: string | null; actions: number; active_seconds: number } | null;
  };
  /** Top 3 people over the whole range (not just the grids' latest 14 days). */
  leaderboards: { by_time: AuditLeader[]; by_actions: AuditLeader[] };
  user_days: AuditUserDayRow[];
  devices: AuditCount[];
  browsers: AuditCount[];
  operating_systems: AuditCount[];
  ips: AuditIpRow[];
}

export interface AuditSessionListResult extends PaginatedResult<AuditSessionEntry> {}

// ----- Action Registry (Admin / Central Admin only) -----

/** One "Assign Retest" -- a durable rated-vs-measured snapshot of why a
 * retest was raised, plus any action points the assigner typed in. See
 * /api/reports/[id]/assign-retest. */
export interface ActionRegistryEntry {
  id: string;
  requisition_id: string;
  /** The requisition's human-readable number ("REQ-000123") -- use this, not
   * requisition_id, when linking to it. */
  requisition_no: string | null;
  report_id: string;
  model: string;
  report_no: string | null;
  /** e.g. "Head, Power" */
  unmet_fields: string;
  rated_head: number | null;
  measured_head: number | null;
  rated_capacity: number | null;
  measured_capacity: number | null;
  rated_power_kw: number | null;
  measured_power_kw: number | null;
  action_points: string[];
  assigned_by: string | null;
  assigned_by_name: string | null;
  originally_raised_by: string | null;
  created_at: string;
}

/** One report on the VE & ME Performance page -- its best physically-possible VE / ME point. */
export interface PerformanceHistoryEntry {
  id: string;
  report_no: string | null;
  date: string;
  category: string;
  is_improvement: boolean;
  ve: number | null;
  me: number | null;
  /** Recorded point values too high to be real (see VE_SUSPECT_ABOVE / ME_SUSPECT_ABOVE) -- shown for correction, never judged. */
  suspect_ve: number[];
  suspect_me: number[];
  /** null = no acceptance criteria for this model, or no value to judge. */
  ve_meets: boolean | null;
  me_meets: boolean | null;
  /** The same model's previous report that had VE/ME data -- what an Improvement Project is judged against. */
  prev_ve: number | null;
  prev_me: number | null;
  /** The report number of that previous test, so a comparison can say which test it is against. */
  prev_report_no: string | null;
  /** This report's own rated targets, and the best point it reached against each (Capacity/Head:
   * floor, has to reach rated; Power: ceiling, has to stay under it -- same rule as the report
   * detail page's red flags). null meets = no rated value to judge against. */
  rated_capacity: number | null;
  rated_head: number | null;
  rated_power_kw: number | null;
  max_capacity: number | null;
  max_head: number | null;
  max_power: number | null;
  capacity_meets: boolean | null;
  head_meets: boolean | null;
  power_meets: boolean | null;
}

/** GET /api/performance -- one row per model (every tested model + every model on the acceptance sheet). */
export interface PerformanceModel {
  model: string;
  series: "H" | "2H" | "L" | "L6" | "Other";
  acceptance: { ve: number; me: number } | null;
  report_count: number;
  reports_with_data: number;
  latest: PerformanceHistoryEntry | null;
  best_ve: number | null;
  best_me: number | null;
  /** Latest minus first report's value; null with fewer than two reports carrying data. */
  ve_change: number | null;
  me_change: number | null;
  reports_meeting_both: number | null;
  improvement_count: number;
  /** True when the model would have had reports under Improvement Projects, but at least one of its reports
   * meets both the VE and the ME acceptance value -- so none of its reports are listed there. */
  improvement_cleared: boolean;
  suspect_count: number;
  /** Oldest first. */
  history: PerformanceHistoryEntry[];
}

export interface PerformanceImprovement {
  model: string;
  acceptance: { ve: number; me: number } | null;
  id: string;
  report_no: string | null;
  date: string;
  ve: number | null;
  me: number | null;
  prev_ve: number | null;
  prev_me: number | null;
  prev_report_no: string | null;
  ve_meets: boolean | null;
  me_meets: boolean | null;
}

export interface PerformanceResult {
  models: PerformanceModel[];
  improvements: PerformanceImprovement[];
}

/** One model on the Improvement Projects list, from GET /api/performance?view=improvement-models. */
export interface ImprovementModelRow {
  model: string;
  series: "H" | "2H" | "L" | "L6" | "Other";
  acceptance: { ve: number; me: number } | null;
  /** How many of its reports are below VE or ME acceptance (or filed as an Improvement Project). */
  improvement_reports: number;
  report_count: number;
  latest_report_no: string | null;
  latest_ve: number | null;
  latest_me: number | null;
  latest_ve_meets: boolean | null;
  latest_me_meets: boolean | null;
}

export interface ImprovementModelsResult {
  models: ImprovementModelRow[];
  /** Models taken off the list because at least one of their reports meets both VE and ME acceptance. */
  not_listed: string[];
}

/** A Test must be linked to a requisition; a Meeting or Calibration is not a test. */
export const CALENDAR_EVENT_TYPES = ["Test", "Meeting", "Calibration"] as const;
export type CalendarEventType = (typeof CALENDAR_EVENT_TYPES)[number];

export const CALENDAR_EVENT_STATUSES = ["Planned", "In Testing", "Completed"] as const;
export type CalendarEventStatus = (typeof CALENDAR_EVENT_STATUSES)[number];

/** One event on the Testing Calendar. Everyone signed in can see it; only Admin can create/update/
 * delete (enforced server-side, /api/calendar-events). */
export interface CalendarEvent {
  id: string;
  title: string;
  /** The pump model this event is about, if any -- not every event is (a team meeting isn't). */
  model: string | null;
  /** The EC/Quotation No. this event relates to, if any -- see GET /api/calendar-events/ec-options. */
  ec_quotation_no: string | null;
  /** Test (needs a requisition) or a non-test Meeting / Calibration. */
  event_type: CalendarEventType;
  /** The requisition this event is the test for (REQ-000123), if any -- completing it needs that test's report. */
  requisition_no: string | null;
  /** Who it's for -- the calendar's row grouping (RESPONSIBLE_PERSONS); null = unassigned. */
  responsible_person: string | null;
  status: CalendarEventStatus;
  event_date: string;
  start_time: string | null;
  end_time: string | null;
  notes: string | null;
  created_by: string | null;
  created_by_name: string;
  created_at: string;
  updated_at: string;
}

export interface NewCalendarEventInput {
  title: string;
  event_date: string;
  model?: string;
  ec_quotation_no?: string;
  event_type?: CalendarEventType;
  /** "" clears the link. */
  requisition_no?: string;
  responsible_person?: string;
  status?: CalendarEventStatus;
  start_time?: string;
  end_time?: string;
  notes?: string;
}

/** One row of GET /api/calendar-events/requisition-options. */
export interface CalendarRequisitionOption {
  requisition_no: string;
  model: string;
  ec_quotation_no: string | null;
  status: RequisitionStatus;
}

/** One row of GET /api/calendar-events/ec-options. */
export interface CalendarEcOption {
  ec_quotation_no: string;
  model: string | null;
}
