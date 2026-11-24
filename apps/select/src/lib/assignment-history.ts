// Who an enquiry was assigned to, by whom, when and why (user, 2026-11-25), read back
// from the audit trail: enquiry.create (assigned on creation), enquiry.assign /
// enquiry.reassign (from -> to, and the reason a reassign needs) and enquiry.revise (a new
// version, with what the client asked to change). Across all its versions. Client-safe.

export type AssignmentKind = "created" | "assigned" | "reassigned" | "new version";

export type AssignmentEntry = {
  at: string;
  /** Who did it. */
  byName: string | null;
  kind: AssignmentKind;
  from: string | null;
  to: string | null;
  /** Why (a reassign), or what the client asked to change (a new version). */
  reason: string | null;
};

/** The audit actions it reads. */
export const ASSIGNMENT_ACTIONS = ["enquiry.create", "enquiry.assign", "enquiry.reassign", "enquiry.revise"] as const;

/** The separator a reassign's reason is written after in the audit detail. */
export const REASON_SEP = " - Reason: ";

/** One audit row as an entry, or null when it says nothing about the assignee. */
export function assignmentEntry(row: { action: string; detail: string | null; at: string; byName: string | null }): AssignmentEntry | null {
  const d = row.detail ?? "";
  const base = { at: row.at, byName: row.byName };
  if (row.action === "enquiry.assign" || row.action === "enquiry.reassign") {
    // "Enquiry RIL/EN/26-27/1780: A -> B - Reason: ..."
    const m = /^Enquiry .*?: ([\s\S]*?) -> ([\s\S]*?)(?: - Reason: ([\s\S]*))?$/.exec(d);
    if (!m) return null;
    return { ...base, kind: row.action === "enquiry.reassign" ? "reassigned" : "assigned", from: m[1] === "nobody" ? null : m[1], to: m[2], reason: m[3]?.trim() || null };
  }
  if (row.action === "enquiry.create") {
    const m = /, assigned to ([\s\S]+)$/.exec(d);
    return m ? { ...base, kind: "created", from: null, to: m[1], reason: null } : null;
  }
  if (row.action === "enquiry.revise") {
    // "...: new version created (...), assigned to B - what the client asked"
    const m = /assigned to ([\s\S]*?)(?: - ([\s\S]*))?$/.exec(d);
    return m ? { ...base, kind: "new version", from: null, to: m[1], reason: m[2]?.trim() || null } : null;
  }
  return null;
}
