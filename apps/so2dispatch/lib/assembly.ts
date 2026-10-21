// Assembly of a pump SO: planned EC by EC (order_assembly_plans) — a day, a
// Day or Night shift, an EC and how many — and ticked Assembled. The EC's
// and the SO's status follow from what is assembled. Shared by the browser
// and the server; the SQL twins are below.

export const ASSEMBLY_SHIFTS = ["Day", "Night"];

export const EC_ASSEMBLY_STATUSES = ["Pending", "Partially assembled", "Assembled"];
export const SO_ASSEMBLY_STATUSES = ["Assembly pending", "Partial assembled", "Fully assembled"];

/** The URL param Assembly's SO status filter lives under. */
export const ASSEMBLY_STATUS_KEY = "asm";

/** One planned assembly, as the form edits it. */
export type AssemblyPlan = {
  id?: string;
  item_id: string;
  plan_date: string;
  shift: string;
  qty: number;
  assembled: boolean;
  assembled_date: string;
  remarks: string;
};

type Row = Record<string, unknown>;
const str = (v: unknown) => (v === null || v === undefined ? "" : String(v));

export function plansFromRows(rows: unknown): AssemblyPlan[] {
  if (!Array.isArray(rows)) return [];
  return rows.map((r) => {
    const p = (r ?? {}) as Row;
    return {
      id: str(p.id) || undefined,
      item_id: str(p.item_id),
      plan_date: str(p.plan_date).slice(0, 10),
      shift: str(p.shift),
      qty: Math.max(0, Math.floor(Number(p.qty) || 0)),
      assembled: p.assembled === true || str(p.assembled).toLowerCase() === "yes",
      assembled_date: str(p.assembled_date).slice(0, 10),
      remarks: str(p.remarks),
    };
  });
}

/** How many of an EC the plans hold, and how many of those are assembled. */
export function ecAssembly(plans: AssemblyPlan[], itemId: string): { planned: number; assembled: number } {
  return plans
    .filter((p) => p.item_id === itemId)
    .reduce((t, p) => ({ planned: t.planned + p.qty, assembled: t.assembled + (p.assembled ? p.qty : 0) }), {
      planned: 0,
      assembled: 0,
    });
}

/** An EC's assembly: Pending, Partially assembled, or Assembled (all of its quantity). */
export function ecAssemblyStatus(assembled: number, quantity: number): string {
  if (assembled <= 0) return "Pending";
  return quantity > 0 && assembled >= quantity ? "Assembled" : "Partially assembled";
}

/** The SO's, from its ECs': pending until one is assembled, fully once all are. */
export function soAssemblyStatus(ecStatuses: string[]): string {
  if (ecStatuses.length > 0 && ecStatuses.every((s) => s === "Assembled")) return "Fully assembled";
  if (ecStatuses.some((s) => s !== "Pending")) return "Partial assembled";
  return "Assembly pending";
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The first thing wrong with an SO's plans, or null. `ecs` gives each EC's
 * quantity and how many Planning has ready: no EC is planned beyond what is
 * ready, nor assembled without a day.
 */
export function plansError(
  plans: AssemblyPlan[],
  ecs: { id: string; label: string; quantity: number; ready: number }[]
): string | null {
  const byId = new Map(ecs.map((e) => [e.id, e]));
  for (let i = 0; i < plans.length; i++) {
    const p = plans[i];
    const n = i + 1;
    const ec = byId.get(p.item_id);
    if (!ec) return `Plan ${n}: choose the EC.`;
    if (!(p.qty > 0)) return `Plan ${n}: enter how many.`;
    if (p.plan_date && !ISO.test(p.plan_date)) return `Plan ${n}: enter a valid date.`;
    if (p.shift && !ASSEMBLY_SHIFTS.includes(p.shift)) return `Plan ${n}: choose Day or Night.`;
    if (p.assembled && !ISO.test(p.assembled_date)) return `Plan ${n}: enter the day it was assembled.`;
  }
  for (const ec of ecs) {
    const { planned } = ecAssembly(plans, ec.id);
    const cap = Math.min(ec.quantity || Infinity, ec.ready);
    if (planned > cap) return `${ec.label}: ${planned} planned, but only ${cap} ready to assemble.`;
  }
  return null;
}

// ---- SQL: the SO's assembly status over an SO alias, for the filter.

/** The SO's assembly status, in SQL over its alias (pump ECs only). */
export function soAssemblyStatusSql(o = "o"): string {
  const assembled = (it: string) =>
    `(SELECT COALESCE(sum(ap.qty), 0) FROM order_assembly_plans ap
       WHERE ap.item_id = ${it}.id AND lower(COALESCE(ap.assembled, '')) = 'yes')`;
  const pumps = `FROM order_items s WHERE s.order_id = ${o}.id AND s.item_type IN ('Pump', 'ROLB')`;
  return `(CASE
             WHEN NOT EXISTS (SELECT 1 ${pumps} AND ${assembled("s")} > 0) THEN 'Assembly pending'
             WHEN NOT EXISTS (SELECT 1 ${pumps} AND ${assembled("s")} < COALESCE(NULLIF(s.quantity, 0), 1)) THEN 'Fully assembled'
             ELSE 'Partial assembled' END)`;
}
