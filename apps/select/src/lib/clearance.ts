// An enquiry's clearance (user, 2026-11-04): Clear or Hold, with remarks; Hold also
// has a reason. Every change is a row in enquiry_clearance, so the history is kept
// and the newest row is the current one. Client-safe.

export const CLEARANCE_STATUSES = ["Clear", "Hold"] as const;
export type ClearanceStatus = (typeof CLEARANCE_STATUSES)[number];

/** Reasons added by hand go here (table clearance_reason). */
export const OTHER_REASON_GROUP = "Other";

/** The Hold reasons: a group alone, or a group with its own choices. */
export const HOLD_REASONS: { group: string; reasons: string[] }[] = [
  { group: "Client Side delay", reasons: ["Technical Awaited", "Part confirmation", "Model not Clear"] },
  { group: "Agent Side Delay", reasons: [] },
  { group: "Delay from Assign person", reasons: ["Overloaded with quotations", "Overloaded with Order making"] },
  { group: "Approval Awaited by Ma'am", reasons: [] },
  { group: "Purchase Awaited", reasons: [] },
  { group: "Holiday & Sunday", reasons: [] },
  { group: "Not Quoted & Regret", reasons: [] },
];

/** "Client Side delay - Technical Awaited", or the group alone. */
export const holdReasonText = (group: string | null | undefined, reason: string | null | undefined): string =>
  [group === OTHER_REASON_GROUP ? null : group, reason].filter(Boolean).join(" - ");

/** The current clearance, on an enquiry row of the list. */
export type ClearanceNow = {
  status: ClearanceStatus;
  group: string | null;
  reason: string | null;
  remarks: string | null;
  at: string;
};

/** One change in the history. */
export type ClearanceEntry = {
  id: string;
  status: ClearanceStatus;
  group: string | null;
  reason: string | null;
  remarks: string | null;
  at: string;
  byName: string | null;
  /** Which version of the enquiry it was made on. */
  version: number;
};
