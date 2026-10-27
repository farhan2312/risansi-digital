// Assembly, then packing, of a pump SO — lot by lot, following Planning's
// readiness lots (order_ready_lots, one row per EC per lot, each EC's share
// in qty). A lot is assembled EC by EC: entries that each pick an EC of the
// lot and how many of it, on a day and shift, ticked Assembled with the day
// (order_lot_assembly; an EC's share may take several). Once all of the lot
// is assembled it is packed as one, on a day and shift with or without a PDI.
// The EC's and the SO's status follow. Shared by the browser and the
// server; SQL twins below.

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

/** One assembly entry of a lot: an EC of it, how many, planned when, and assembled when. */
export type AsmEntry = {
  /** Its row id once saved; blank for a new one. */
  id: string;
  /** The EC's row of the lot (order_ready_lots.id). */
  lot_row_id: string;
  item_id: string;
  qty: number;
  plan_date: string;
  shift: string;
  assembled_date: string;
};

/** One of the SO's lots, with its ECs and both stages. */
export type PumpLot = {
  n: number;
  status: string;
  ready_date: string;
  /**
   * The ECs in the lot: how many of each, the EC's row of the lot, and how
   * many of those are assembled (none named on a lot from before ECs were).
   */
  ecs: { id: string; qty: number; row_id: string; assembled: number }[];
  /** Its assembly entries, oldest first. */
  entries: AsmEntry[];
  /** Its next planned assembly day and shift (the last, once all is assembled); assembled once all of it is. */
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
    // Its assembly entries ride on each EC's row of it (asm).
    const entries: AsmEntry[] = per.flatMap((p) => {
      const row = p.rows[i];
      const list = row && Array.isArray(row.asm) ? (row.asm as Row[]) : [];
      return list.map((e) => ({
        id: str(e.id),
        lot_row_id: str(row.id),
        item_id: p.id,
        qty: Number(e.qty ?? 0) || 0,
        plan_date: day(e.plan_date),
        shift: str(e.shift),
        assembled_date: day(e.assembled_date),
      }));
    });
    const ecs = per
      .map((p) => ({ id: p.id, qty: Number(p.rows[i]?.qty ?? 0) || 0, row_id: str(p.rows[i]?.id), assembled: 0 }))
      .filter((e) => e.qty > 0);
    const asm = lotAssembly(ecs, entries);
    lots.push({
      n: i + 1,
      status: pick("status"),
      ready_date: day(pick("ready_date")),
      ecs: ecs.map((e) => ({ ...e, assembled: asm.assembled[e.id] ?? 0 })),
      entries,
      assembly_plan_date: asm.plan_date,
      assembly_shift: asm.shift,
      assembled_date: asm.assembled_date,
      packing_plan_date: day(pick("packing_plan_date")),
      packing_shift: pick("packing_shift"),
      pdi: pick("pdi"),
      packed_date: day(pick("packed_date")),
    });
  }
  return lots;
}

/**
 * A lot's assembly from its entries: how many of each EC are assembled; the
 * lot's assembled day once every EC's share is (the last entry's), else
 * blank; and its next planned day and shift (the last, once all is done).
 */
export function lotAssembly(
  ecs: { id: string; qty: number }[],
  entries: Pick<AsmEntry, "item_id" | "qty" | "plan_date" | "shift" | "assembled_date">[]
): { assembled: Record<string, number>; assembled_date: string; plan_date: string; shift: string } {
  const assembled: Record<string, number> = {};
  for (const e of entries) if (e.assembled_date) assembled[e.item_id] = (assembled[e.item_id] ?? 0) + e.qty;
  const full = ecs.length > 0 && ecs.every((e) => (assembled[e.id] ?? 0) >= e.qty);
  const byPlan = (a: { plan_date: string }, b: { plan_date: string }) => a.plan_date.localeCompare(b.plan_date);
  const open = entries.filter((e) => !e.assembled_date && e.plan_date).sort(byPlan);
  const next = open[0] ?? entries.filter((e) => e.plan_date).sort(byPlan).pop();
  return {
    assembled,
    assembled_date: full ? (entries.map((e) => e.assembled_date).filter(Boolean).sort().pop() ?? "") : "",
    plan_date: next?.plan_date ?? "",
    shift: next?.shift ?? "",
  };
}

/** How many of an EC the lots have assembled, and packed. */
export function ecDone(lots: PumpLot[], ecId: string): { assembled: number; packed: number } {
  return lots.reduce(
    (t, l) => {
      const e = l.ecs.find((x) => x.id === ecId);
      return {
        assembled: t.assembled + (e?.assembled ?? 0),
        packed: t.packed + (l.packed_date ? (e?.qty ?? 0) : 0),
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

/** What Assembly & Packing edits on a lot as a whole: its packing. */
export type LotStages = Pick<PumpLot, "n" | "packing_plan_date" | "packing_shift" | "pdi" | "packed_date">;

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The first thing wrong with the lots' assembly entries and packing, or null.
 * `lots` are the SO's lots as they stand (their ECs and shares); `entries`
 * the assembly entries as they are to be saved.
 */
export function lotStagesError(
  lots: Pick<PumpLot, "n" | "status" | "ecs">[],
  stages: LotStages[],
  entries: AsmEntry[]
): string | null {
  if (entries.some((e) => !lots.some((l) => l.ecs.some((x) => x.row_id === e.lot_row_id && x.id === e.item_id)))) {
    return "An assembly entry is for an EC that is not in its lot.";
  }
  for (const l of lots) {
    const n = `Lot ${l.n}`;
    const mine = entries.filter((e) => l.ecs.some((x) => x.row_id === e.lot_row_id));
    if (mine.length && l.status === "In plan") return `${n} is In plan, not ready: nothing to assemble yet.`;
    for (const e of mine) {
      if (!Number.isInteger(e.qty) || e.qty < 1) return `${n}: enter how many to assemble (1 or more).`;
      if (e.plan_date && !ISO.test(e.plan_date)) return `${n}: enter a valid assembly date.`;
      if (e.assembled_date && !ISO.test(e.assembled_date)) return `${n}: enter a valid assembled date.`;
      if (e.shift && !ASSEMBLY_SHIFTS.includes(e.shift)) return `${n}: choose the assembly shift.`;
    }
    for (const x of l.ecs) {
      const picked = mine.filter((e) => e.lot_row_id === x.row_id).reduce((t, e) => t + e.qty, 0);
      if (picked > x.qty) return `${n}: more than the lot's ${x.qty} of an EC picked to assemble.`;
    }
    const s = stages.find((st) => st.n === l.n);
    if (!s) continue;
    for (const [k, label] of [
      ["packing_plan_date", "packing date"],
      ["packed_date", "packed date"],
    ] as const) {
      if (s[k] && !ISO.test(s[k])) return `${n}: enter a valid ${label}.`;
    }
    if (s.packing_shift && !ASSEMBLY_SHIFTS.includes(s.packing_shift)) return `${n}: choose the packing shift.`;
    if (s.pdi && !PDI_CHOICES.includes(s.pdi)) return `${n}: choose PDI Yes or No.`;
    const assembled = lotAssembly(l.ecs, mine).assembled_date;
    if (s.packed_date && !assembled) return `${n} cannot be packed until all of it is assembled.`;
    if (s.packed_date && s.packed_date < assembled) return `${n} cannot be packed before the day it was assembled.`;
  }
  return null;
}

// ---- SQL: the SO's status in a stage over an SO alias, for the filters.

export function soStageStatusSql(stage: Stage, o = "o"): string {
  const [pending, partial, full] = STAGE_WORDS[stage].so;
  // Assembled: what its assembly entries say; packed: its packed lots' shares.
  const done = (it: string) =>
    stage === "assembly"
      ? `(SELECT COALESCE(sum(la.qty), 0) FROM order_lot_assembly la
           WHERE la.item_id = ${it}.id AND la.assembled_date IS NOT NULL)`
      : `(SELECT COALESCE(sum(rl.qty), 0) FROM order_ready_lots rl
           WHERE rl.item_id = ${it}.id AND rl.packed_date IS NOT NULL)`;
  const pumps = `FROM order_items s WHERE s.order_id = ${o}.id AND s.item_type IN ('Pump', 'ROLB')`;
  return `(CASE
             WHEN NOT EXISTS (SELECT 1 ${pumps} AND ${done("s")} > 0) THEN '${pending}'
             WHEN NOT EXISTS (SELECT 1 ${pumps} AND ${done("s")} < COALESCE(NULLIF(s.quantity, 0), 1)) THEN '${full}'
             ELSE '${partial}' END)`;
}
