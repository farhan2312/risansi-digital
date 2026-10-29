// Why an SO is still pending with a department: Proforma Invoice while a PI
// is Pending (or Partially raised), Drawing and Purchase while the SO is
// Open. One reason per SO per department, with remarks (order_pendency).
// Shared by the browser and the server; the SQL is in pendency-db.

export type PendencyDept = "billing" | "drawing" | "purchase";

export const PENDENCY: Record<PendencyDept, { reasons: string[]; key: string }> = {
  billing: {
    reasons: ["Proof of Readiness awaited", "TSM Instruction Awaited", "Client confirmation Awaited", "Along with another SO"],
    key: "pi_pend",
  },
  drawing: {
    reasons: ["Client Confirmation delay on GB/Motor design", "Occupied on other urgent Issues", "EC awaited"],
    key: "drg_pend",
  },
  purchase: {
    reasons: ["EC not received", "Vendor Quotation awaited"],
    key: "pur_pend",
  },
};

/** An SO's pendency with a department, as saved. */
export type Pendency = { reason: string; remarks: string; by: string; at: string };

/** The reasons asked for in the URL, keeping only the department's own. */
export function parsePendencyFilter(get: (key: string) => string | undefined, dept: PendencyDept): string[] {
  const { reasons, key } = PENDENCY[dept];
  return (get(key) ?? "")
    .split(",")
    .map((v) => v.trim())
    .filter((v) => reasons.includes(v));
}
