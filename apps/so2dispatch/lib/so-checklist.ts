// Order Making's checklist for every SO: the Spare or the Pump list (by the
// SO's Order Type), as on "CHECKLIST for spare & Pump Orders". The green
// points are the SO team's — filled by the member the SO is assigned to;
// the rest are Order Making PO's. "Auto" points show the SO's own value.
// One checklist per SO version: a new version starts a fresh one. Order
// Making PO then verifies each point (a tick, the verifier's remark).
//
// Plain module (no server imports): the page, the pop-up and the queries
// read one definition.

export type ChecklistTeam = "SO" | "PO";

export type ChecklistPoint = {
  key: string;
  label: string;
  team: ChecklistTeam;
  /** The answers to pick from (Yes / No unless said). */
  options?: string[];
  /** Filled from the SO itself: the orders column (base_plate: from its ECs). */
  auto?: string;
  /** Pump: the points under "These check points are for verifier". */
  verifier?: boolean;
};

const YES_NO = ["Yes", "No"];

const SO = (key: string, label: string, options = YES_NO): ChecklistPoint => ({ key, label, team: "SO", options });
const PO = (key: string, label: string, options = YES_NO): ChecklistPoint => ({ key, label, team: "PO", options });
const AUTO = (key: string, label: string, column: string): ChecklistPoint => ({ key, label, team: "PO", auto: column });
const VER = (key: string, label: string, options = YES_NO): ChecklistPoint => ({ ...PO(key, label, options), verifier: true });

// The head of both lists: read off the SO.
const HEAD = [
  AUTO("industry", "Industry Type", "industry_type"),
  AUTO("market", "Market Type", "market_type"),
  AUTO("reps", "Representative", "reps"),
  AUTO("payment_terms", "Payment Terms", "payment_terms"),
  PO("abg_pbg", "Any payment condition of ABG / PBG"),
  AUTO("delivery_date", "Delivery date as per SO", "delivery_date_as_per_so"),
  AUTO("ld", "LD clause applicable", "ld"),
  AUTO("ld_date", "LD Date", "ld_date"),
  AUTO("freight", "Freight Terms", "freight_terms"),
  AUTO("packing", "Packing Requirement", "packing_requirement"),
];

const PRICE_CHECKS = [
  SO("po_vs_so_price", "PO price v/s SO price checked"),
  SO("so_vs_quote_price", "SO price v/s Quote price checked"),
  SO("order_value", "Order value checked"),
  SO("discount", "Discount % checked"),
  SO("total_price", "Total price checked"),
  SO("tax", "Tax % & value checked"),
  SO("price_increase", "Price increase"),
];

export const SPARE_CHECKLIST: ChecklistPoint[] = [
  ...HEAD,
  PO("fumigation", "Fumigation required"),
  ...PRICE_CHECKS,
  PO("ref_last_invoice", "Ref. last invoice no."),
  SO("item_qty", "Item wise quantity checked (during SO checking)"),
  PO("pending_order", "Are there any pending order"),
  PO("warranty", "Warranty"),
  SO("repeat_order", "Any repeat order"),
  SO("fr_ec", "Any FR EC issued (EC No. & Dt.)"),
  SO("amend_order", "Any amend order (reason and mailed dt.)"),
  SO("uom", "Unit of measurement (as per internal BOM)", ["No.", "Set"]),
  SO("conversion_so", "Conversion SO (if yes, must have Ma'am's sign)"),
  SO("prev_pump_ec", "Previous pump EC check (if exact spare not available — EC No. & Dt.)"),
  SO("prev_spares_ec", "Previous spares EC check (EC No. & Dt.) / MOC"),
  SO("coupling_rod", "Type of coupling rod", ["Bush", "Pin", "NA"]),
  SO("shaft_head", "Type of shaft head", ["Protector", "Pin", "N/A"]),
];

export const PUMP_CHECKLIST: ChecklistPoint[] = [
  ...HEAD,
  AUTO("boi", "BOI Required", "boi"),
  AUTO("base_plate", "Base Plate Required", "base_plate"),
  ...PRICE_CHECKS,
  SO("item_qty", "Item wise quantity checked (during SO checking)"),
  SO("repeat_order", "Any repeat order"),
  SO("fr_ec", "Any FR EC issued (EC No. & Dt.)"),
  SO("amend_order", "Any amend order (reason and mailed dt.)"),
  SO("scope_of_supply", "Scope of supply", [
    "Bare Pump",
    "Pump with Accessories",
    "Pump with Accessories with Motor",
    "Pump with Accessories with Gear Box",
  ]),
  PO("fumigation", "Fumigation required"),
  PO("ref_last_invoice", "Ref. last invoice no."),
  PO("pending_order", "Are there any pending order"),
  PO("packing_charges", "Packing charges"),
  VER("model_variation", "Variation in model in SO v/s pump selection chart"),
  VER("internal_model_variation", "Variation in internal model or kW & RPM in SO v/s pump selection chart"),
  VER("nameplate_so_po", "SO v/s PO name plate details (Cap. / Head / kW / RPM / Drive RPM / Liquid)"),
  VER("quote_po_details", "PO v/s Quote details (Cap. / Head / kW / RPM / Drive RPM / Liquid)"),
  VER("moc_so_po", "MOC SO v/s PO"),
  VER("moc_so_quote", "MOC SO v/s Quote"),
  VER(
    "rotor_coating",
    "Rotor MOC coating (slurry, lime dosing & magma @ 250 μm on dia ± 10 %; rest liquids @ 150 μm on dia ± 10 %)"
  ),
  VER("scope_so_po", "Scope of supply SO v/s PO (UOM & quantity)", ["STD", "Non STD"]),
  VER("scope_so_quote", "Scope of supply SO v/s Quote"),
  VER("paint_color", "Paint color required (STD / Non-STD)"),
];

/** Which list an SO takes: Spare for a Spare SO, Pump otherwise. */
export function isSpareChecklist(orderType: unknown): boolean {
  return String(orderType ?? "").trim() === "Spare";
}

export function checklistFor(orderType: unknown): ChecklistPoint[] {
  return isSpareChecklist(orderType) ? SPARE_CHECKLIST : PUMP_CHECKLIST;
}

/** The points someone answers (not read off the SO), of one team or both. */
export function fillablePoints(points: ChecklistPoint[], team?: ChecklistTeam): ChecklistPoint[] {
  return points.filter((p) => !p.auto && (!team || p.team === team));
}

const arr = (keys: string[]) => `ARRAY[${keys.map((k) => `'${k}'`).join(", ")}]::text[]`;
const keysOf = (points: ChecklistPoint[], team?: ChecklistTeam) => fillablePoints(points, team).map((p) => p.key);

/** SQL: how many of the SO's points (of a team) its current version has answered. */
export function checklistAnsweredSql(o: string, team?: ChecklistTeam): string {
  return `(SELECT count(*)::int FROM order_so_checklist ck
            WHERE ck.order_id = ${o}.id AND ck.version_no = COALESCE(${o}.version_no, 0)
              AND NULLIF(btrim(ck.answer), '') IS NOT NULL
              AND ck.point_key = ANY(CASE WHEN COALESCE(${o}.order_type, '') = 'Spare'
                                          THEN ${arr(keysOf(SPARE_CHECKLIST, team))}
                                          ELSE ${arr(keysOf(PUMP_CHECKLIST, team))} END))`;
}

/** SQL: how many points (of a team) the SO's list has to answer. */
export function checklistTotalSql(o: string, team?: ChecklistTeam): string {
  return `(CASE WHEN COALESCE(${o}.order_type, '') = 'Spare'
                THEN ${keysOf(SPARE_CHECKLIST, team).length} ELSE ${keysOf(PUMP_CHECKLIST, team).length} END)`;
}

/** SQL: every point (of a team) answered. */
export function checklistDoneSql(o: string, team?: ChecklistTeam): string {
  return `(${checklistAnsweredSql(o, team)} >= ${checklistTotalSql(o, team)})`;
}

/** SQL: how many of the SO's points (every one, auto too) its current version has verified. */
export function checklistVerifiedSql(o: string): string {
  return `(SELECT count(*)::int FROM order_so_checklist ck
            WHERE ck.order_id = ${o}.id AND ck.version_no = COALESCE(${o}.version_no, 0) AND ck.verified
              AND ck.point_key = ANY(CASE WHEN COALESCE(${o}.order_type, '') = 'Spare'
                                          THEN ${arr(SPARE_CHECKLIST.map((p) => p.key))}
                                          ELSE ${arr(PUMP_CHECKLIST.map((p) => p.key))} END))`;
}

/** SQL: how many points the SO's list has, auto ones too (all to verify). */
export function checklistPointsSql(o: string): string {
  return `(CASE WHEN COALESCE(${o}.order_type, '') = 'Spare' THEN ${SPARE_CHECKLIST.length} ELSE ${PUMP_CHECKLIST.length} END)`;
}

/** The checklist filter on Order Making: its SO or PO part still to fill, any part, all filled, verification still to do, or all verified. */
export const CHECKLIST_STATES = [
  { value: "so_pending", label: "SO part pending" },
  { value: "po_pending", label: "PO part pending" },
  { value: "pending", label: "Pending" },
  { value: "done", label: "Done" },
  { value: "verify_pending", label: "Verification pending" },
  { value: "verified", label: "Verified" },
] as const;
export type ChecklistState = (typeof CHECKLIST_STATES)[number]["value"];
