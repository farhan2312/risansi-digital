// Assembly, then packing, of a pump SO — lot by lot, following Planning's
// readiness lots (order_ready_lots, one row per EC per lot, each EC's share
// in qty). A lot is assembled on one day and shift, then packed on one day
// and shift with or without a PDI. The EC's and the SO's status follow from
// the lots done. Shared by the browser and the server; SQL twins below.

export type Stage = "assembly" | "packing";

export const ASSEMBLY_SHIFTS = ["Day", "Night"];
export const PDI_CHOICES = ["Yes", "No"];

export const EC_ASSEMBLY_STATUSES = ["Pending", "Partially assembled", "Assembled"];
export const SO_ASSEMBLY_STATUSES = ["Assembly pending", "Partial assembled", "Fully assembled"];
export const EC_PACKING_STATUSES = ["Pending", "Partially packed", "Packed"];
export const SO_PACKING_STATUSES = ["Packing pending", "Partially packed", "Fully packed"];

/** The URL params the SO status filters live under. */
export const ASSEMBLY_STATUS_KEY = "asm";
export const PACKING_STATUS_KEY = "pkg";

export const STAGE_WORDS: Record<Stage, { title: string; done: string; ec: string[]; so: string[] }> = {
  assembly: { title: "Assembly", done: "Assembled", ec: EC_ASSEMBLY_STATUSES, so: SO_ASSEMBLY_STATUSES },
  packing: { title: "Packing", done: "Packed", ec: EC_PACKING_STATUSES, so: SO_PACKING_STATUSES },
};

type Row = Record<string, unknown>;
const str = (v: unknown) => (v === null || v === undefined ? "" : String(v));
const day = (v: unknown) => str(v).slice(0, 10);

/** One of the SO's lots, with its ECs and both stages. */
export type PumpLot = {
  n: number;
  status: string;
  ready_date: string;
  /** The ECs in the lot and how many of each (none on a lot from before ECs were named). */
  ecs: { id: string; qty: number }[];
  assembly_plan_date: string;
  assembly_shift: string;
  assembled_date: string;
  packing_plan_date: string;
  packing_shift: string;
  pdi: string;
  packed_date: string;
};

/** The SO's lots from its pump ECs' lot rows: lot n is each EC's n-th row. */
export function pumpLotsFromEcs(ecRows: Row[]): PumpLot[] {
  const per = ecRows.map((ec) => ({
    id: str(ec.id),
    rows: Array.isArray(ec.ready_lots) ? (ec.ready_lots as Row[]) : [],
  }));
  const count = Math.max(0, ...per.map((p) => p.rows.length));
  const lots: PumpLot[] = [];
  for (let i = 0; i < count; i++) {
    const rows = per.map((p) => p.rows[i]).filter(Boolean);
    // The lot's own values are the same on every EC's row; the first that has one stands.
    const pick = (k: string) => rows.map((r) => str(r[k])).find(Boolean) ?? "";
    lots.push({
      n: i + 1,
      status: pick("status"),
      ready_date: day(pick("ready_date")),
      ecs: per
        .map((p) => ({ id: p.id, qty: Number(p.rows[i]?.qty ?? 0) || 0 }))
        .filter((e) => e.qty > 0),
      assembly_plan_date: day(pick("assembly_plan_date")),
      assembly_shift: pick("assembly_shift"),
      assembled_date: day(pick("assembled_date")),
      packing_plan_date: day(pick("packing_plan_date")),
      packing_shift: pick("packing_shift"),
      pdi: pick("pdi"),
      packed_date: day(pick("packed_date")),
    });
  }
  return lots;
}

/** How many of an EC the lots have assembled, and packed. */
export function ecDone(lots: PumpLot[], ecId: string): { assembled: number; packed: number } {
  return lots.reduce(
    (t, l) => {
      const q = l.ecs.find((e) => e.id === ecId)?.qty ?? 0;
      return {
        assembled: t.assembled + (l.assembled_date ? q : 0),
        packed: t.packed + (l.packed_date ? q : 0),
      };
    },
    { assembled: 0, packed: 0 }
  );
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

/** The SO's two statuses from its ECs (each with its quantity) and lots. */
export function soStatuses(ecs: { id: string; quantity: number }[], lots: PumpLot[]): { assembly: string; packing: string } {
  const per = ecs.map((e) => ({ e, d: ecDone(lots, e.id) }));
  return {
    assembly: soStageStatus(per.map(({ e, d }) => ecStageStatus(d.assembled, e.quantity, "assembly")), "assembly"),
    packing: soStageStatus(per.map(({ e, d }) => ecStageStatus(d.packed, e.quantity, "packing")), "packing"),
  };
}

/** What Assembly & Packing edits on a lot. */
export type LotStages = Pick<
  PumpLot,
  "n" | "assembly_plan_date" | "assembly_shift" | "assembled_date" | "packing_plan_date" | "packing_shift" | "pdi" | "packed_date"
>;

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** The first thing wrong with the lots' assembly and packing, or null. */
export function lotStagesError(lots: LotStages[]): string | null {
  for (const l of lots) {
    const n = `Lot ${l.n}`;
    for (const [k, label] of [
      ["assembly_plan_date", "assembly date"],
      ["assembled_date", "assembled date"],
      ["packing_plan_date", "packing date"],
      ["packed_date", "packed date"],
    ] as const) {
      if (l[k] && !ISO.test(l[k])) return `${n}: enter a valid ${label}.`;
    }
    if (l.assembly_shift && !ASSEMBLY_SHIFTS.includes(l.assembly_shift)) return `${n}: choose the assembly shift.`;
    if (l.packing_shift && !ASSEMBLY_SHIFTS.includes(l.packing_shift)) return `${n}: choose the packing shift.`;
    if (l.pdi && !PDI_CHOICES.includes(l.pdi)) return `${n}: choose PDI Yes or No.`;
    if (l.packed_date && !l.assembled_date) return `${n} cannot be packed before it is assembled.`;
    if (l.packed_date && l.assembled_date && l.packed_date < l.assembled_date) {
      return `${n} cannot be packed before the day it was assembled.`;
    }
  }
  return null;
}

// ---- SQL: the SO's status in a stage over an SO alias, for the filters.

export function soStageStatusSql(stage: Stage, o = "o"): string {
  const [pending, partial, full] = STAGE_WORDS[stage].so;
  const col = stage === "assembly" ? "assembled_date" : "packed_date";
  const done = (it: string) =>
    `(SELECT COALESCE(sum(rl.qty), 0) FROM order_ready_lots rl
       WHERE rl.item_id = ${it}.id AND rl.${col} IS NOT NULL)`;
  const pumps = `FROM order_items s WHERE s.order_id = ${o}.id AND s.item_type IN ('Pump', 'ROLB')`;
  return `(CASE
             WHEN NOT EXISTS (SELECT 1 ${pumps} AND ${done("s")} > 0) THEN '${pending}'
             WHEN NOT EXISTS (SELECT 1 ${pumps} AND ${done("s")} < COALESCE(NULLIF(s.quantity, 0), 1)) THEN '${full}'
             ELSE '${partial}' END)`;
}
