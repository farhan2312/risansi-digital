// Assembly, then packing, of a pump SO: each planned EC by EC
// (order_assembly_plans, by stage) — a day, a Day or Night shift, an EC and
// how many — and ticked done. Assembly takes what Planning has ready; packing
// takes what is assembled. The EC's and the SO's status follow. Shared by the
// browser and the server; the SQL twins are below.

export type Stage = "assembly" | "packing";
export const STAGES: Stage[] = ["assembly", "packing"];

export const ASSEMBLY_SHIFTS = ["Day", "Night"];
export const PDI_CHOICES = ["Yes", "No"];

export const EC_ASSEMBLY_STATUSES = ["Pending", "Partially assembled", "Assembled"];
export const SO_ASSEMBLY_STATUSES = ["Assembly pending", "Partial assembled", "Fully assembled"];
export const EC_PACKING_STATUSES = ["Pending", "Partially packed", "Packed"];
export const SO_PACKING_STATUSES = ["Packing pending", "Partially packed", "Fully packed"];

/** The URL params the SO status filters live under. */
export const ASSEMBLY_STATUS_KEY = "asm";
export const PACKING_STATUS_KEY = "pkg";

/** Each stage's words. */
export const STAGE_WORDS: Record<Stage, { title: string; done: string; doneOn: string; ec: string[]; so: string[] }> = {
  assembly: { title: "Assembly", done: "Assembled", doneOn: "Assembled On", ec: EC_ASSEMBLY_STATUSES, so: SO_ASSEMBLY_STATUSES },
  packing: { title: "Packing", done: "Packed", doneOn: "Packed On", ec: EC_PACKING_STATUSES, so: SO_PACKING_STATUSES },
};

/** One planned entry, as the form edits it. */
export type AssemblyPlan = {
  id?: string;
  item_id: string;
  plan_date: string;
  shift: string;
  qty: number;
  /** Done: assembled, or packed. */
  assembled: boolean;
  assembled_date: string;
  /** Packing only: whether the lot needs a PDI. */
  pdi: string;
  remarks: string;
};

type Row = Record<string, unknown>;
const str = (v: unknown) => (v === null || v === undefined ? "" : String(v));

/** The entries of one stage from the rows the server sent (assembly when unmarked). */
export function plansFromRows(rows: unknown, stage: Stage = "assembly"): AssemblyPlan[] {
  if (!Array.isArray(rows)) return [];
  return rows
    .filter((r) => (str((r as Row)?.stage) || "assembly") === stage)
    .map((r) => {
      const p = (r ?? {}) as Row;
      return {
        id: str(p.id) || undefined,
        item_id: str(p.item_id),
        plan_date: str(p.plan_date).slice(0, 10),
        shift: str(p.shift),
        qty: Math.max(0, Math.floor(Number(p.qty) || 0)),
        assembled: p.assembled === true || str(p.assembled).toLowerCase() === "yes",
        assembled_date: str(p.assembled_date).slice(0, 10),
        pdi: str(p.pdi),
        remarks: str(p.remarks),
      };
    });
}

/** How many of an EC the entries hold, and how many of those are done. */
export function ecAssembly(plans: AssemblyPlan[], itemId: string): { planned: number; assembled: number } {
  return plans
    .filter((p) => p.item_id === itemId)
    .reduce((t, p) => ({ planned: t.planned + p.qty, assembled: t.assembled + (p.assembled ? p.qty : 0) }), {
      planned: 0,
      assembled: 0,
    });
}

/** An EC's status in a stage, from how many are done against its quantity. */
export function ecStageStatus(done: number, quantity: number, stage: Stage): string {
  const [pending, partial, full] = STAGE_WORDS[stage].ec;
  if (done <= 0) return pending;
  return quantity > 0 && done >= quantity ? full : partial;
}

/** The SO's status in a stage, from its ECs'. */
export function soStageStatus(ecStatuses: string[], stage: Stage): string {
  const [ecPending, , ecFull] = STAGE_WORDS[stage].ec;
  const [pending, partial, full] = STAGE_WORDS[stage].so;
  if (ecStatuses.length > 0 && ecStatuses.every((s) => s === ecFull)) return full;
  if (ecStatuses.some((s) => s !== ecPending)) return partial;
  return pending;
}

export const ecAssemblyStatus = (assembled: number, quantity: number) => ecStageStatus(assembled, quantity, "assembly");
export const soAssemblyStatus = (ecStatuses: string[]) => soStageStatus(ecStatuses, "assembly");

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The first thing wrong with an SO's entries in a stage, or null. `cap` is
 * how many of each EC the stage may take: what Planning has ready for
 * assembly, what is assembled for packing.
 */
export function plansError(
  plans: AssemblyPlan[],
  ecs: { id: string; label: string; cap: number }[],
  stage: Stage = "assembly"
): string | null {
  const byId = new Map(ecs.map((e) => [e.id, e]));
  const done = STAGE_WORDS[stage].done.toLowerCase();
  for (let i = 0; i < plans.length; i++) {
    const p = plans[i];
    const n = i + 1;
    if (!byId.get(p.item_id)) return `Plan ${n}: choose the EC.`;
    if (!(p.qty > 0)) return `Plan ${n}: enter how many.`;
    if (p.plan_date && !ISO.test(p.plan_date)) return `Plan ${n}: enter a valid date.`;
    if (p.shift && !ASSEMBLY_SHIFTS.includes(p.shift)) return `Plan ${n}: choose Day or Night.`;
    if (p.pdi && !PDI_CHOICES.includes(p.pdi)) return `Plan ${n}: choose PDI Yes or No.`;
    if (p.assembled && !ISO.test(p.assembled_date)) return `Plan ${n}: enter the day it was ${done}.`;
  }
  for (const ec of ecs) {
    const { planned } = ecAssembly(plans, ec.id);
    if (planned > ec.cap) {
      return `${ec.label}: ${planned} planned, but only ${ec.cap} ${stage === "assembly" ? "ready to assemble" : "assembled to pack"}.`;
    }
  }
  return null;
}

// ---- SQL: the SO's status in a stage over an SO alias, for the filters.

export function soStageStatusSql(stage: Stage, o = "o"): string {
  const [pending, partial, full] = STAGE_WORDS[stage].so;
  const done = (it: string) =>
    `(SELECT COALESCE(sum(ap.qty), 0) FROM order_assembly_plans ap
       WHERE ap.item_id = ${it}.id AND ap.stage = '${stage}' AND lower(COALESCE(ap.assembled, '')) = 'yes')`;
  const pumps = `FROM order_items s WHERE s.order_id = ${o}.id AND s.item_type IN ('Pump', 'ROLB')`;
  return `(CASE
             WHEN NOT EXISTS (SELECT 1 ${pumps} AND ${done("s")} > 0) THEN '${pending}'
             WHEN NOT EXISTS (SELECT 1 ${pumps} AND ${done("s")} < COALESCE(NULLIF(s.quantity, 0), 1)) THEN '${full}'
             ELSE '${partial}' END)`;
}

export const soAssemblyStatusSql = (o = "o") => soStageStatusSql("assembly", o);
