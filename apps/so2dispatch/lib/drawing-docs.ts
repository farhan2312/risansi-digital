// Documents Drawing shares against a drawing revision. Plain module (no server
// imports): the popup form and the server actions read the same lists.

import { isCentral } from "@/lib/roles";

export const DRAWING_DOC_TYPES = [
  "General Arrangement Drawing",
  "Performance curve",
  "Part Drawing",
] as const;

export type DrawingDocType = (typeof DRAWING_DOC_TYPES)[number];

/** Who a document can be assigned to. */
export const DRAWING_DOC_ASSIGNEES = [
  { role: "planning", label: "Planning" },
  { role: "purchase", label: "Purchase" },
  { role: "central_visibility", label: "Central Visibility" },
] as const;

export type DrawingDocAssignee = (typeof DRAWING_DOC_ASSIGNEES)[number]["role"];

export function isDrawingDocType(value: string): value is DrawingDocType {
  return (DRAWING_DOC_TYPES as readonly string[]).includes(value);
}

export function isDrawingDocAssignee(value: string): value is DrawingDocAssignee {
  return DRAWING_DOC_ASSIGNEES.some((a) => a.role === value);
}

export function assigneeLabel(role: string): string {
  return DRAWING_DOC_ASSIGNEES.find((a) => a.role === role)?.label ?? role;
}

export type DrawingDocument = {
  id: string;
  revision_id: string;
  item_id: string;
  doc_type: string;
  link: string;
  assigned_roles: string[];
  remarks: string | null;
  created_at: string;
  /** The revision it hangs off, for lists that span a whole EC. */
  revision_no: string | null;
  revision_seq: number;
};

/** Drawing owns the revisions; Central Visibility (and Admin) may manage too. */
export function canManageDrawingDocs(role: string): boolean {
  return role === "drawing" || isCentral(role);
}

/**
 * Whether a role sees every document or only those assigned to it. Admin is
 * central, so Admin and Central Visibility see all; Planning and Purchase
 * see what was assigned to them.
 */
export function seesAllDrawingDocs(role: string): boolean {
  return canManageDrawingDocs(role);
}

/**
 * A link a person can safely click: http or https only. Anything else — a
 * javascript: URL above all — is refused rather than stored.
 */
export function normaliseDocLink(raw: string): string | null {
  const text = raw.trim();
  if (!text || text.length > 2000) return null;
  // People paste "www.…" or "sharepoint.com/…" without a scheme.
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text}`;
  try {
    const url = new URL(withScheme);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (!url.hostname.includes(".")) return null;
    return url.toString();
  } catch {
    return null;
  }
}
