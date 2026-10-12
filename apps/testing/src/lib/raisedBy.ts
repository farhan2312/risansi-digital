/** "Raised by" classification for requisitions -- which kind of account put
 * the requisition in: a Source Team user, a Testing Team user, or anyone else
 * (admin, central admin, or an account that has since been deleted).
 *
 * Derived from the raiser's CURRENT role via test_requisitions.created_by ->
 * users.role; the requisition itself only stores the raiser's name. So if
 * someone's role changes later, their older requisitions move with them. */

export type RaisedByGroup = "source" | "testing" | "other";

export const RAISED_BY_GROUPS: RaisedByGroup[] = ["source", "testing", "other"];

export const RAISED_BY_LABELS: Record<RaisedByGroup, string> = {
  source: "Source Team",
  testing: "Testing Team",
  other: "Other (Admin / Central Admin)",
};

/** Short label for a table badge. */
export const RAISED_BY_SHORT: Record<RaisedByGroup, string> = {
  source: "Source",
  testing: "Testing",
  other: "Other",
};

export const raisedByGroup = (role: string | null | undefined): RaisedByGroup =>
  role === "source" ? "source" : role === "testing" ? "testing" : "other";

export const isRaisedByGroup = (value: string | null | undefined): value is RaisedByGroup =>
  value === "source" || value === "testing" || value === "other";
