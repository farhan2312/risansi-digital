// One Click's department statuses: each department's standing on an SO as
// text, read with the same rules as the Orders list (lib/pump-summary for the
// departments' own stages, listOrderDeptStatuses for Billing and Accounts),
// for a Status column at the head of each department's group.

import { listOrderDeptStatuses } from "@/lib/orders";
import { listPumpSummaries } from "@/lib/pump-summary";

export type OneClickDept =
  | "drawing"
  | "purchase"
  | "quality"
  | "planning"
  | "assembly"
  | "packing"
  | "billing"
  | "accounts"
  | "dispatch";

export type OneClickStatuses = Map<string, Partial<Record<OneClickDept, string>>>;

/**
 * Each SO's department statuses, by SO id — two reads for the whole sheet. A
 * Spare is packed lot by lot, with no assembly of its own: its packing status
 * is its lots', as the Orders list shows it.
 */
export async function listOneClickStatuses(orderIds: string[], spare = false): Promise<OneClickStatuses> {
  const out: OneClickStatuses = new Map();
  if (orderIds.length === 0) return out;
  const [pumps, depts] = await Promise.all([listPumpSummaries(orderIds), listOrderDeptStatuses(orderIds)]);
  for (const id of orderIds) {
    const s = pumps[id];
    const d = depts.get(id);
    const row: Partial<Record<OneClickDept, string>> = {};
    if (s) {
      const g = s.drawing.gad;
      const stage = (name: string, st: { label: string; done: number; total: number } | null, verb: string) =>
        st ? `${name}: ${st.label} (${st.done}/${st.total} ${verb})` : `${name}: Not required`;
      row.drawing = g.total
        ? [
            s.drawing.closed ? "Closed" : null,
            stage("GAD", g, "issued"),
            stage("Curve", s.drawing.curve, "approved"),
            stage("Part", s.drawing.part, "complete"),
          ]
            .filter(Boolean)
            .join("\n")
        : "—";
      row.purchase = s.purchase.required
        ? `${s.purchase.state}${s.purchase.items ? ` · ${s.purchase.received}/${s.purchase.items} received` : " · No items yet"}`
        : "Not required";
      row.quality = s.quality.required
        ? `${s.quality.state}${s.quality.total ? ` · ${s.quality.submitted}/${s.quality.total} ECs submitted` : ""}`
        : "Not required";
      row.planning = s.planning.status;
      row.assembly = s.assembly.status;
      row.packing = s.packing.status;
      row.dispatch = s.dispatch;
    }
    if (d) {
      if (spare) {
        delete row.assembly;
        row.packing = d.ecs.map((e) => e.assembly).find((c) => c.state !== "na")?.label ?? "—";
      }
      row.billing = d.billing.label;
      row.accounts = d.accounts.label;
      row.dispatch = row.dispatch ?? d.dispatch.label;
    }
    out.set(id, row);
  }
  return out;
}
