/** Shared requisition-attribute filter predicate -- Testing Summary applies
 * these as SQL WHERE clauses (see /api/requisitions), but Report
 * Compilation needs the exact same rule applied in memory, per-requisition,
 * against a pump's own (already-fetched) requisition list, both server-side
 * (GET /api/pumps, to decide which pumps qualify) and client-side
 * (PumpIndexPage's per-row "N of M match" count on an expanded pump). One
 * shared implementation keeps those two call sites from silently drifting
 * apart on what "matches the filters" means. */

export interface RequisitionFilterValues {
  ecQuotationNo?: string;
  category?: string;
  sourceTeam?: string;
  responsiblePerson?: string;
  submittedBy?: string;
  retestNeeded?: "Yes" | "No";
  month?: string;
  dateFrom?: string;
  dateTo?: string;
}

export interface FilterableRequisition {
  ec_quotation_no: string | null;
  category: string | null;
  source_team: string | null;
  responsible_person: string | null;
  submitted_by: string | null;
  retest_needed: boolean | null;
  date_of_requisition: string | null;
}

export function requisitionMatchesFilters(r: FilterableRequisition, f: RequisitionFilterValues): boolean {
  const ec = f.ecQuotationNo?.trim().toLowerCase();
  if (ec && !(r.ec_quotation_no ?? "").toLowerCase().includes(ec)) return false;
  if (f.category && r.category !== f.category) return false;
  if (f.sourceTeam && r.source_team !== f.sourceTeam) return false;
  if (f.responsiblePerson && r.responsible_person !== f.responsiblePerson) return false;
  if (f.submittedBy && r.submitted_by !== f.submittedBy) return false;
  if (f.retestNeeded === "Yes" && r.retest_needed !== true) return false;
  if (f.retestNeeded === "No" && r.retest_needed !== false) return false;
  if (f.month && r.date_of_requisition?.slice(0, 7) !== f.month) return false;
  if (f.dateFrom && (!r.date_of_requisition || r.date_of_requisition < f.dateFrom)) return false;
  if (f.dateTo && (!r.date_of_requisition || r.date_of_requisition > f.dateTo)) return false;
  return true;
}

export function hasActiveRequisitionFilters(f: RequisitionFilterValues): boolean {
  return Boolean(
    f.ecQuotationNo?.trim() ||
      f.category ||
      f.sourceTeam ||
      f.responsiblePerson ||
      f.submittedBy ||
      f.retestNeeded ||
      f.month ||
      f.dateFrom ||
      f.dateTo
  );
}
