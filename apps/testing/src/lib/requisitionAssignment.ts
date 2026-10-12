import type { RESPONSIBLE_PERSONS } from "@/types/testing";

/** Who a new requisition is assigned to, decided by its category: EC-based work goes to Vikash,
 * everything else to Sachin. Used by the New Requisition form (to show the assignee) and enforced
 * by POST /api/requisitions, so the rule holds however the requisition is created. The testing
 * team can still reassign afterwards from the Testing Summary list. */
export const autoResponsiblePerson = (category: string | null | undefined): (typeof RESPONSIBLE_PERSONS)[number] =>
  category === "Against EC Based" ? "Vikash" : "Sachin";
