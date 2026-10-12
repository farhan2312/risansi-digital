/**
 * One definition of "how did this report do against its rated requirement",
 * shared by the Report Compilation tiles (server counts + client list) so the
 * numbers can never disagree again.
 *
 *   met        every rated target that could be checked was reached
 *   unmet      at least one rated Head / Capacity was not reached, or Power went over its rating
 *   not_judged nothing to judge: no rated Head/Capacity/Power on the report, or no measured value
 *              to compare it with
 *
 * Every report is exactly one of the three, so  met + unmet + not_judged = total reports.
 * (`has_target` comes from enrichReports: a rated field that has a matching measured point.)
 */
export type ReportVerdict = "met" | "unmet" | "not_judged";

export interface VerdictInputs {
  has_target: boolean;
  requirement_unmet_fields: string[];
}

export const reportVerdict = (r: VerdictInputs): ReportVerdict =>
  !r.has_target ? "not_judged" : r.requirement_unmet_fields.length > 0 ? "unmet" : "met";

/** What a Report Compilation tile narrows the pump list to. */
export const PUMP_STAT_FILTERS = ["all", "reports", "historical", "portal", "met", "unmet", "not_judged"] as const;
export type PumpStatFilter = (typeof PUMP_STAT_FILTERS)[number];

export const isPumpStatFilter = (v: unknown): v is PumpStatFilter =>
  typeof v === "string" && (PUMP_STAT_FILTERS as readonly string[]).includes(v);

/** Imported old reports -- prepared_by is stamped by the legacy import script. */
export const isHistoricalReport = (r: { prepared_by: string | null }): boolean => r.prepared_by === "Legacy Import";

/** Does this single report belong under the given tile? ("all" and "reports" accept every report.) */
export const reportMatchesStat = (r: VerdictInputs & { prepared_by: string | null }, filter: PumpStatFilter): boolean => {
  switch (filter) {
    case "all":
    case "reports":
      return true;
    case "historical":
      return isHistoricalReport(r);
    case "portal":
      return !isHistoricalReport(r);
    default:
      return reportVerdict(r) === filter;
  }
};
