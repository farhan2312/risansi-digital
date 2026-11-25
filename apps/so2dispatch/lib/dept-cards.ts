// The department pages' summary cards (Drawing, Purchase, Quality and
// Assembly & Packing's Pump view), shared with the Orders page's department
// board so both count exactly the same. Plain module.

import { deptKpiCards, totalHoldCard } from "@/lib/orders";
import { DEPT_VIEWS } from "@/lib/dept-view";
import { toneFor, type KpiCardDef } from "@/lib/kpis";
import { CURVE_STATUSES, drawingFilterSql, ecStatusCountSql, GAD_STATUSES, NOT_REQUIRED, PART_STATUSES, SO_STATES } from "@/lib/drawing-filter";
import { BOI_STATUSES, PURCHASE_STATES, boiCountSql, ecCountSql, purchaseFilterSql } from "@/lib/purchase-filter";
import { QC_EC_STATUSES, QC_SO_STATES, qcEcCountSql, qcFilterSql } from "@/lib/qc-filter";
import { SO_ASSEMBLY_STATUSES, SO_PACKING_STATUSES, soStageStatusSql } from "@/lib/assembly";

/** Central Visibility holds the SO (alias o): its cards say how many, the hold a badge. */
const CV_HELD = "COALESCE(o.clearance_status, '') = 'Hold'";
/** Drawing's SO versions card: SOs made into a new version (v1 on; a new SO is v0). */
const VERSIONED_SQL = "COALESCE(o.version_no, 0) > 0";
const none = { so: [] as string[], ec: [] as string[], item: [] as string[], boi: [] as string[], vendor: [] as string[] };

export function drawingCards(): KpiCardDef[] {
  const clear = { drg_so: null, drg_gad: null, drg_pc: null, drg_part: null, drg_ver: null, overdue: null, hold: null } as Record<string, string | null>;
  const none = { so: [] as string[], gad: [] as string[], curve: [] as string[], part: [] as string[] };
  const overdue = deptKpiCards("drawing").find((c) => c.key === "overdue");
  return [
    { key: "all", label: "All SOs", group: "SO", sql: null, params: { ...clear }, tone: "neutral" },
    ...SO_STATES.map((st) => ({
      key: `so:${st}`,
      label: `SO ${st}`,
      group: "SO",
      sql: drawingFilterSql({ ...none, so: [st] }),
      params: { ...clear, drg_so: st },
      // How many of them Central Visibility holds (a badge: they count here).
      held: CV_HELD,
      tone: st === "Closed" ? ("done" as const) : ("pending" as const),
    })),
    ...(overdue ? [{ ...overdue, group: "SO", params: { ...clear, overdue: "1" } }] : []),
    // Its SOs on any hold.
    // Its SOs on each hold — but not Dispatch's: Drawing's work comes long before it.
    ...totalHoldCard("drawing", clear, "SO").filter((c) => c.key !== "hold:dispatch"),
    {
      key: "versioned",
      label: "SO versions",
      group: "SO",
      sql: VERSIONED_SQL,
      params: { ...clear, drg_ver: "1" },
      held: CV_HELD,
      tone: "part" as const,
    },
    ...GAD_STATUSES.map((st) => ({
      key: `gad:${st}`,
      label: `GAD & Base Plate ${st}`,
      group: "GAD & Base Plate",
      sql: drawingFilterSql({ ...none, gad: [st] }),
      params: { ...clear, drg_gad: st },
      // Beside the SOs: how many of their ECs stand there.
      also: { label: "ECs", measure: ecStatusCountSql("gad", st) },
      // How many of them Central Visibility holds (a badge: they count here).
      held: CV_HELD,
      tone: toneFor(st),
    })),
    ...CURVE_STATUSES.filter((st) => st !== NOT_REQUIRED).map((st) => ({
      key: `pc:${st}`,
      label: `Curve ${st}`,
      group: "Performance Curve",
      sql: drawingFilterSql({ ...none, curve: [st] }),
      params: { ...clear, drg_pc: st },
      also: { label: "ECs", measure: ecStatusCountSql("curve", st) },
      // How many of them Central Visibility holds (a badge: they count here).
      held: CV_HELD,
      tone: toneFor(st),
    })),
    ...PART_STATUSES.filter((st) => st !== NOT_REQUIRED).map((st) => ({
      key: `part:${st}`,
      label: `Part ${st}`,
      group: "Part Drawing",
      sql: drawingFilterSql({ ...none, part: [st] }),
      params: { ...clear, drg_part: st },
      also: { label: "ECs", measure: ecStatusCountSql("part", st) },
      // How many of them Central Visibility holds (a badge: they count here).
      held: CV_HELD,
      tone: toneFor(st),
    })),
  ];
}

export function purchaseCards(purchaseFilter: { vendor: string[]; item: string[] } = { vendor: [], item: [] }): KpiCardDef[] {
  const clear = { pur_so: null, pur_ec: null, pur_boi: null, overdue: null, hold: null, dstatus: null } as Record<string, string | null>;
  const overdue = deptKpiCards("purchase", [], DEPT_VIEWS.purchase.hasTarget).find((c) => c.key === "overdue");
  const tone = (st: string) => (st === "Closed" ? ("done" as const) : st === "Open" ? ("pending" as const) : ("neutral" as const));
  return [
    { key: "all", label: "All SOs", group: "SO", sql: null, params: { ...clear }, tone: "neutral" },
    ...PURCHASE_STATES.map((st) => ({
      key: `so:${st}`,
      label: `SO ${st}`,
      group: "SO",
      sql: purchaseFilterSql({ ...none, so: [st] }),
      params: { ...clear, pur_so: st },
      // How many of them Central Visibility holds (a badge: they count here).
      held: CV_HELD,
      tone: tone(st),
    })),
    ...(overdue ? [{ ...overdue, group: "SO", params: { ...clear, overdue: "1" } }] : []),
    // Its SOs on any hold.
    ...totalHoldCard("purchase", clear, "SO"),
    { key: "ecs", label: "ECs", group: "EC", sql: null, params: {}, tone: "neutral", measure: ecCountSql("o") },
    ...PURCHASE_STATES.map((st) => ({
      key: `ec:${st}`,
      label: `EC ${st}`,
      group: "EC",
      sql: null,
      params: { ...clear, pur_ec: st },
      // How many of them Central Visibility holds (a badge: they count here).
      held: CV_HELD,
      tone: tone(st),
      measure: ecCountSql("o", st),
    })),
    { key: "boi", label: "BOI items", group: "BOI", sql: null, params: {}, tone: "neutral", measure: boiCountSql("o", null, purchaseFilter.vendor, purchaseFilter.item) },
    ...BOI_STATUSES.map((st) => ({
      key: `boi:${st}`,
      label: st,
      group: "BOI",
      sql: null,
      params: { ...clear, pur_boi: st },
      // How many of them Central Visibility holds (a badge: they count here).
      held: CV_HELD,
      tone: toneFor(st),
      measure: boiCountSql("o", st, purchaseFilter.vendor, purchaseFilter.item),
    })),
  ];
}

export function qcCards(): KpiCardDef[] {
  const clear = { qc_so: null, qc_ec: null, overdue: null, hold: null, dstatus: null } as Record<string, string | null>;
  const overdue = deptKpiCards("quality", [], DEPT_VIEWS.quality.hasTarget).find((c) => c.key === "overdue");
  return [
    { key: "all", label: "All SOs", group: "SO", sql: null, params: { ...clear }, tone: "neutral" },
    ...QC_SO_STATES.map((st) => ({
      key: `so:${st}`,
      label: `SO ${st}`,
      group: "SO",
      sql: qcFilterSql({ so: [st], ec: [], asm: [] }),
      params: { ...clear, qc_so: st },
      // How many of them Central Visibility holds (a badge: they count here).
      held: CV_HELD,
      tone: st === "Closed" ? ("done" as const) : ("pending" as const),
    })),
    ...(overdue ? [{ ...overdue, group: "SO", params: { ...clear, overdue: "1" } }] : []),
    // Its SOs on any hold.
    ...totalHoldCard("quality", clear, "SO"),
    { key: "ecs", label: "ECs", group: "EC", sql: null, params: {}, tone: "neutral", measure: qcEcCountSql("o") },
    ...QC_EC_STATUSES.map((st) => ({
      key: `ec:${st}`,
      label: st,
      group: "EC",
      sql: null,
      params: { ...clear, qc_ec: st },
      // How many of them Central Visibility holds (a badge: they count here).
      held: CV_HELD,
      tone: toneFor(st),
      measure: qcEcCountSql("o", st),
    })),
  ];
}

export function assemblyPumpCards(): KpiCardDef[] {
  const clear = { asm: null, pkg: null, dstatus: null, overdue: null, hold: null } as Record<string, string | null>;
  const pumpQty =
    "(SELECT COALESCE(sum(s.quantity), 0) FROM order_items s WHERE s.order_id = o.id AND s.item_type IN ('Pump', 'ROLB'))";
  const cards: KpiCardDef[] = [
    { key: "all", label: "All SOs", sql: null, params: { ...clear }, tone: "neutral" },
    // How many pump ECs those SOs hold: a figure, not a filter.
    {
      key: "ecs",
      label: "ECs",
      sql: null,
      params: {},
      tone: "neutral",
      measure: "(SELECT count(*) FROM order_items s WHERE s.order_id = o.id AND s.item_type IN ('Pump', 'ROLB'))",
    },
    // The pumps themselves: every pump EC's quantity, added up — as on Planning.
    {
      key: "pumps",
      label: "Pumps",
      sql: null,
      params: {},
      tone: "neutral",
      measure: pumpQty,
    },
    ...SO_ASSEMBLY_STATUSES.map((st) => ({
      key: `a:${st}`,
      label: st,
      sql: `${soStageStatusSql("assembly", "o")} = '${st}'`,
      params: { ...clear, asm: st },
      tone: toneFor(st),
      // How many of them Central Visibility holds (a badge: they count here).
      held: "COALESCE(o.clearance_status, '') = 'Hold'",
    })),
    ...SO_PACKING_STATUSES.map((st) => ({
      key: `p:${st}`,
      label: st,
      sql: `${soStageStatusSql("packing", "o")} = '${st}'`,
      params: { ...clear, pkg: st },
      tone: toneFor(st),
      held: "COALESCE(o.clearance_status, '') = 'Hold'",
    })),
    // Its SOs on any hold.
    ...totalHoldCard("assembly", clear),
  ];
  // Each SO card also counts the pumps on its SOs — as Planning's.
  return cards.map((c) => (c.measure ? c : { ...c, also: { label: "pumps", measure: pumpQty } }));
}
