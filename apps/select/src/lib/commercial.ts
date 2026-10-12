/**
 * Commercial Summary (pricing v1, manual) — shared types and the totals maths.
 * Client-safe: no DB import. Used by the API route and the page, so the page's
 * live totals and anything computed server-side can never disagree.
 *
 * Every price is per unit and typed in by the quotation team:
 *   BOI row price = base (vendor) price × (1 − vendor disc %) × (1 + markup %)
 *                   — markup auto-filled 25 %, both editable per row
 *   unit price = Pump & Accessories + every BOI item (fixed rows + Others)
 *   sub-total  = unit price × quantity (quantity from the wizard's Pump Model & Qty step)
 *   grand total = sum of every tag's sub-total
 */

import type { OfferConfig } from "./commercial-offer";
import type { CodeHints, CodeParts } from "./pump-code";

/** The fixed BOI rows, in display order. `key` is the API/DB field. */
/** Commercial prices are always whole rupees. */
export const rupees = (n: number): number => Math.round(n);

export const BOI_ITEMS = [
  { key: "motorPrice", label: "Motor" },
  { key: "gearboxPrice", label: "Gearbox" },
  { key: "vfdPrice", label: "VFD" },
  { key: "mechSealPrice", label: "Mechanical Seal" },
  { key: "strainerPrice", label: "Strainer" },
  { key: "prvPrice", label: "PRV" },
  { key: "drpPrice", label: "DRP" },
] as const;

export type BoiKey = (typeof BOI_ITEMS)[number]["key"];

/** Vendor discount and markup on one BOI row (percent; null = 0 discount /
 *  the default markup). */
export type BoiAdjust = { discountPct: number | null; markupPct: number | null };

/** Markup auto-filled on every BOI row (user, 2026-10-03); editable per row. */
export const DEFAULT_MARKUP_PCT = 25;

/** An extra BOI line; `price` is its base (vendor) price, like the fixed rows. */
export type CommercialOther = {
  name: string;
  price: number | null;
  discountPct?: number | null;
  markupPct?: number | null;
};

/** The editable prices of one tag (numbers, or null when not entered). */
export type CommercialPrices = {
  paPrice: number | null;
  /** The BOI Master VFD picked for vfdPrice (drive description), if any.
   *  Missing on quotation snapshots made before VFD was added. */
  vfdModel: string | null;
  /** The BOI Master DRP kit used for drpPrice ("RTD probe 50 mm + RTD panel"),
   *  if any. Missing on older quotation snapshots. */
  drpModel: string | null;
  /** The BOI Master mechanical seal used for mechSealPrice, if any. Missing
   *  on older quotation snapshots. */
  mechSealModel?: string | null;
  /** What a used L1–L4 P&A suggestion was based on, or null (typed by hand).
   *  Missing on older quotation snapshots. */
  paBasis?: string | null;
  others: CommercialOther[];
  remarks: string;
  /** Per fixed BOI row: vendor discount % and markup %. The BoiKey prices
   *  are BASE prices. Missing on quotation snapshots made before 2026-10-03 —
   *  those prices were final and are used as-is. */
  adjust?: Partial<Record<BoiKey, BoiAdjust>>;
} & Record<BoiKey, number | null>;

/** What the wizard already knows about a tag's pick — shown next to the
 *  manual price as a reference, never applied automatically. */
export type CommercialReference = {
  /** e.g. "Siemens · 5.5 kW · Frame 132S" */
  label: string;
  /** Price from the master (uplifted where the wizard applied an uplift). */
  price: number | null;
  confirmed: boolean;
};

export type CommercialTag = {
  tagId: string;
  tagName: string;
  status: string;
  model: string | null;
  modelConfirmed: boolean;
  media: string | null;
  driveSystem: string | null;
  /** GM / GB / VB / DD, or null until the Drive step has a drive system. */
  driveGroup: DriveGroup | null;
  /** Parsed from pump_model_qty_input.quantity; null when missing/invalid. */
  quantity: number | null;
  /** ERP pump product code picked on the Pump Model & Qty step. */
  productCode: string | null;
  /** The code's parts when it was built with the code builder, else null. */
  codeParts: CodeParts | null;
  /** What the pump selection says (model, size, rubber, sealing) — prefills
   *  the code builder. */
  codeHints: CodeHints;
  /** Liquid / pump type / pump speed / motor kW, as on the Technical Data Sheet. */
  tech: TagTech;
  /** For the P&A price suggestion (lib/pa-price.ts): base plate material and
   *  the model's standard vs entered suction / delivery size. */
  paHints: {
    basePlate: string | null;
    recommendedSize: string | null;
    dischargeSize: string | null;
    /** Operating Conditions pump type, e.g. "Vertical". */
    pumpType?: string | null;
    /** Negative suction depth as entered (when Negative Suction = Yes) + unit "mt" / "feet". */
    negativeDepth?: string | null;
    negativeDepthUnit?: string | null;
  };
  motorRef: CommercialReference | null;
  gearboxRef: CommercialReference | null;
  /** Drive step answer "VFD Required" = Yes. */
  vfdRequired: boolean;
  /** Drive motor kW the VFD is matched against (null when not entered). */
  motorKw: number | null;
  /** BOI Master drives covering motorKw (every tag, whatever vfdRequired says). */
  vfdOptions: VfdOption[];
  /** BOI Master DRP kit for the tag's model (every tag), or null with the
   *  reason in drpNote. */
  drpOption: DrpOption | null;
  drpNote: string | null;
  /** BOI Master mechanical seal for the Sealing step's choice and the pump's
   *  shaft dia, or null with the reason in mechSealNote. */
  mechSealOption: MechSealOption | null;
  mechSealNote: string | null;
  prices: CommercialPrices;
  updatedAt: string | null;
  updatedByName: string | null;
};

/** Technical lines the Commercial Offer repeats from the Technical Data
 *  Sheet (same values): liquid, pump type, pump speed, motor rating. */
export type TagTech = { liquid: string; pumpType: string; pumpSpeed: string; motorKw: string };

export type CommercialSummary = {
  project: {
    id: string;
    code: string;
    name: string;
    customerName: string | null;
    clientCode: string | null;
    /** The one remarks note for the whole Commercial Summary. */
    remarks: string;
  };
  tags: CommercialTag[];
};

export const MAX_OTHER_ITEMS = 10;

export const emptyPrices = (): CommercialPrices => ({
  paPrice: null,
  motorPrice: null,
  gearboxPrice: null,
  vfdPrice: null,
  mechSealPrice: null,
  mechSealModel: null,
  vfdModel: null,
  drpModel: null,
  paBasis: null,
  strainerPrice: null,
  prvPrice: null,
  drpPrice: null,
  others: [],
  remarks: "",
  adjust: {},
});

// --- VFD (BOI Master, VFD tab) ---------------------------------------------

export type VfdDuty = "Nominal" | "Light Duty" | "Heavy Duty";

/** One boi_vfd row as the matcher needs it (numbers already parsed). */
export type VfdMasterRow = {
  driveDescription: string;
  make: string;
  series: string | null;
  frame: string | null;
  pnKw: number | null;
  pldKw: number | null;
  phdKw: number | null;
  listPrice: number | null;
  discountPct: number | null;
  bopExtra: number | null;
};

/** A drive offered for a tag: the smallest one covering the motor kW for at
 *  least one duty (a drive can be the pick for several duties). */
export type VfdOption = {
  driveDescription: string;
  make: string;
  series: string | null;
  frame: string | null;
  duties: { duty: VfdDuty; kw: number }[];
  listPrice: number | null;
  discountPct: number | null;
  bopExtra: number | null;
  /** list × (1 − discount%) + BOP extra, rounded to the paisa. */
  netPrice: number | null;
};

const VFD_DUTY_KW: { duty: VfdDuty; kw: (r: VfdMasterRow) => number | null }[] = [
  { duty: "Nominal", kw: (r) => r.pnKw },
  { duty: "Light Duty", kw: (r) => r.pldKw },
  { duty: "Heavy Duty", kw: (r) => r.phdKw },
];

/** VFD cost: list less the discount, plus the flat BOP extra per VFD. */
export const vfdNetPrice = (
  listPrice: number | null,
  discountPct: number | null,
  bopExtra: number | null,
): number | null =>
  listPrice === null
    ? null
    : rupees(listPrice * (1 - (discountPct ?? 0) / 100) + (bopExtra ?? 0));

/** Per duty, the smallest drive whose rating for that duty is ≥ the motor kW
 *  (the cheaper one on a tie); drives picked by more than one duty merge into
 *  one option. Ordered Nominal → Heavy Duty (smallest drive first). */
export function vfdOptionsFor(rows: VfdMasterRow[], motorKw: number | null): VfdOption[] {
  if (motorKw === null || !(motorKw > 0)) return [];
  const byDrive = new Map<string, VfdOption>();
  for (const { duty, kw } of VFD_DUTY_KW) {
    const best = rows
      .filter((r) => (kw(r) ?? -1) >= motorKw)
      .sort((a, b) => kw(a)! - kw(b)! || (a.listPrice ?? Infinity) - (b.listPrice ?? Infinity))[0];
    if (!best) continue;
    const opt = byDrive.get(best.driveDescription) ?? {
      driveDescription: best.driveDescription,
      make: best.make,
      series: best.series,
      frame: best.frame,
      duties: [],
      listPrice: best.listPrice,
      discountPct: best.discountPct,
      bopExtra: best.bopExtra,
      netPrice: vfdNetPrice(best.listPrice, best.discountPct, best.bopExtra),
    };
    opt.duties.push({ duty, kw: kw(best)! });
    byDrive.set(best.driveDescription, opt);
  }
  return [...byDrive.values()];
}

// --- DRP (BOI Master, DRP tab) ----------------------------------------------
// Dry Run Protection per pump = RTD probe + RTD panel. The probe is the
// smallest size ≥ the model's shaft dia (pump_shaft_dia, one row per model).

export type DrpShaftRow = { model: string; shaftDia: number | null };
export type DrpProbeRow = { description: string; sizeMm: number; ratePerNos: number | null };
export type DrpPanelRow = { description: string; ratePerNos: number | null };

export type DrpOption = {
  shaftDia: number;
  probeSizeMm: number;
  probeRate: number | null;
  panelRate: number | null;
  /** probe + panel. */
  total: number;
  /** Saved as commercial_tag_price.drp_model when used. */
  label: string;
};


/** The DRP kit for a model, or the reason there isn't one. */
export function drpOptionFor(
  model: string | null,
  shafts: DrpShaftRow[],
  probes: DrpProbeRow[],
  panel: DrpPanelRow | null,
): { option: DrpOption | null; note: string | null } {
  if (!model) return { option: null, note: "No pump model selected yet" };
  const key = model.trim().toUpperCase();
  const shaftDia = shafts.find((s) => s.model.trim().toUpperCase() === key)?.shaftDia ?? null;
  if (shaftDia === null) return { option: null, note: `No shaft dia for ${model} in the BOI Master Shaft Dia tab` };
  const probe = probes.filter((p) => p.sizeMm >= shaftDia).sort((a, b) => a.sizeMm - b.sizeMm)[0];
  if (!probe) return { option: null, note: `No RTD probe of ${shaftDia} mm or more in the BOI Master` };
  const panelRate = panel?.ratePerNos ?? null;
  return {
    option: {
      shaftDia,
      probeSizeMm: probe.sizeMm,
      probeRate: probe.ratePerNos,
      panelRate,
      total: rupees((probe.ratePerNos ?? 0) + (panelRate ?? 0)),
      label: `RTD probe ${probe.sizeMm} mm${panel ? " + RTD panel" : ""}`,
    },
    note: null,
  };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** base × (1 − disc%) × (1 + markup%), in whole rupees; null base stays null. */
export const netPrice = (base: number | null, discountPct: number | null, markupPct: number | null): number | null =>
  base === null ? null : rupees(base * (1 - (discountPct ?? 0) / 100) * (1 + (markupPct ?? DEFAULT_MARKUP_PCT) / 100));

/** A fixed BOI row's quoted price (after vendor discount and markup). */
export function boiNet(p: CommercialPrices, key: BoiKey): number | null {
  const base = p[key] ?? null;
  if (!p.adjust) return base === null ? null : rupees(base); // snapshot from before discount/markup: final already
  const a = p.adjust[key];
  return netPrice(base, a?.discountPct ?? 0, a?.markupPct ?? DEFAULT_MARKUP_PCT);
}

/** An Other line's quoted price (after vendor discount and markup). */
export function otherNet(p: CommercialPrices, o: CommercialOther): number | null {
  if (!p.adjust) return o.price === null ? null : rupees(o.price);
  return netPrice(o.price, o.discountPct ?? 0, o.markupPct ?? DEFAULT_MARKUP_PCT);
}

// --- Mechanical seal (BOI Master, Mech Seal tab) ------------------------------
// Sealing step: Mechanical Seal + type (SCG / DCG / MSA / MSK), make, MOC, face.
// ACME list only, SiC vs SiC faces, SS304 / SS316 (user, 2026-10-04). Row =
// the series for the type at the pump's shaft dia (pump_shaft_dia); auger
// pumps take SCG's "AUGAR" row when there is one.

export type MechSealRow = {
  make: string;
  series: string;
  drawingNo: string;
  shaftSizeMm: number;
  type: string | null;
  material304: string | null;
  price304: number | null;
  material316: string | null;
  price316: number | null;
};

export type MechSealOption = {
  drawingNo: string;
  series: string;
  shaftSizeMm: number;
  material: string;
  price: number;
  /** Saved as commercial_tag_price.mech_seal_model when used. */
  label: string;
};

/** Wizard seal type → ACME series. */
export const MECH_SEAL_SERIES: Record<string, string> = { SCG: "SCG", DCG: "DCG", MSA: "N SERIES", MSK: "K SERIES" };

export function mechSealOptionFor(
  seal: { sealingType: string | null; type: string | null; make: string | null; moc: string | null; face: string | null },
  shaftDia: number | null,
  auger: boolean,
  rows: MechSealRow[],
): { option: MechSealOption | null; note: string | null } {
  const none = (note: string) => ({ option: null, note });
  if (seal.sealingType !== "Mechanical Seal") return none(seal.sealingType ? `${seal.sealingType} — no mechanical seal` : "No sealing chosen yet");
  if (!seal.type) return none("Seal type not picked on the Sealing step");
  const series = MECH_SEAL_SERIES[seal.type];
  if (!series) return none(`No price list for seal type ${seal.type}`);
  const make = (seal.make ?? "").trim();
  const listed = rows.filter((r) => r.series === series && r.make.toUpperCase() === make.toUpperCase());
  if (!listed.length) return none(make ? `No ${make} price list — only ACME is loaded` : "Seal make not picked on the Sealing step");
  if (!/sic/i.test(seal.face ?? "")) return none(`${seal.face || "Face"} not priced — the list is SiC vs SiC only`);
  const moc = (seal.moc ?? "").toUpperCase().replace(/\s+/g, "");
  const grade = moc === "SS304" ? "304" : moc === "SS316" ? "316" : null;
  if (!grade) return none(`${seal.moc || "Seal MOC"} not priced — the list is SS304 / SS316 only`);
  if (shaftDia === null) return none("No shaft dia for this pump model in the BOI Master Shaft Dia tab");
  const atShaft = listed.filter((r) => Math.abs(r.shaftSizeMm - shaftDia) < 0.01);
  const row = (auger ? atShaft.find((r) => /AUG/i.test(r.type ?? "")) : undefined) ?? atShaft.find((r) => !/AUG/i.test(r.type ?? ""));
  if (!row) return none(`No ${series} seal for a ${shaftDia} mm shaft`);
  const price = grade === "304" ? row.price304 : row.price316;
  const material = (grade === "304" ? row.material304 : row.material316) ?? `SiC / ${grade}`;
  if (price === null) return none(`${row.drawingNo} has no ${grade} price`);
  return {
    option: { drawingNo: row.drawingNo, series, shaftSizeMm: row.shaftSizeMm, material, price: rupees(price), label: `${row.make} ${row.drawingNo} · ${material}` },
    note: null,
  };
}

/** Sum of the BOI items only (fixed rows + Others, quoted prices), per unit. */
export function boiTotal(p: CommercialPrices): number {
  const fixed = BOI_ITEMS.reduce((s, it) => s + (boiNet(p, it.key) ?? 0), 0);
  return fixed + (p.others ?? []).reduce((s, o) => s + (otherNet(p, o) ?? 0), 0);
}

/** A percentage as sent / typed: "" or null → null; undefined when invalid
 *  (negative, not a number, or not below `max`). */
export function parsePct(raw: unknown, max: number): number | null | undefined {
  if (raw === null || raw === undefined || raw === "") return null;
  const n = typeof raw === "number" ? raw : Number(String(raw).replace(/%/g, "").trim());
  if (!Number.isFinite(n) || n < 0 || n >= max) return undefined;
  return round2(n);
}
/** Vendor discount must stay below 100 %; markup up to 1000 %. */
export const MAX_DISCOUNT_PCT = 100;
export const MAX_MARKUP_PCT = 1000;

/** P&A + all BOI, per unit. */
export const unitTotal = (p: CommercialPrices): number => rupees(p.paPrice ?? 0) + boiTotal(p);

/** Unit total × quantity. A missing quantity counts as 0 so an unfinished tag
 *  never inflates the grand total; the page flags it instead. */
export const subTotal = (p: CommercialPrices, quantity: number | null): number =>
  unitTotal(p) * (quantity ?? 0);

export const grandTotal = (tags: { prices: CommercialPrices; quantity: number | null }[]): number =>
  tags.reduce((s, t) => s + subTotal(t.prices, t.quantity), 0);

/** Whole number ≥ 1, else null. */
export function parseQuantity(raw: unknown): number | null {
  const s = String(raw ?? "").trim();
  return /^[1-9]\d*$/.test(s) ? Number(s) : null;
}

/** A price as the user may send it: number, numeric string, "" or null.
 *  Returns undefined for anything invalid (negative, not a number, too big). */
export function parsePrice(raw: unknown): number | null | undefined {
  if (raw === null || raw === "" || raw === undefined) return null;
  const n = typeof raw === "number" ? raw : Number(String(raw).replace(/,/g, "").trim());
  if (!Number.isFinite(n) || n < 0 || n >= 1e12) return undefined;
  return rupees(n);
}

const INR = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });

/** "₹1,50,000" (Indian grouping); "—" for null. */
export const formatInr = (n: number | null | undefined): string =>
  n === null || n === undefined ? "—" : `₹${INR.format(n)}`;

// --- Quotation (v1) ----------------------------------------------------------
// One quotation per enquiry, independent of the sales portal. Number:
// RIL/QT/<region>/<FY>/<PCP|SPR>/<serial>; region = the TSM's initials for
// now; the serial is from 6000 upwards, one per enquiry (a gap only if missing).

export type QuotationTrack = "internal" | "client";

/** A sales (Market Intell) user who can be the TSM. */
export type TsmOption = {
  id: number;
  name: string;
  initials: string;
  zone: string | null;
  role: string;
};

/** Frozen copy of the prices when a version was made. */
export type QuotationSnapshot = {
  tags: {
    /** Missing on snapshots made before the Commercial Offer (2026-10-01). */
    tagId?: string;
    tagName: string;
    productCode: string | null;
    model: string | null;
    quantity: number | null;
    /** Missing on snapshots made before 2026-10-05. */
    tech?: TagTech;
    prices: CommercialPrices;
    unit: number;
    sub: number;
  }[];
  grandTotal: number;
  /** The Commercial Offer sheet edits for this drive group when the version
   *  was made (lib/commercial-offer). Missing on older snapshots = defaults. */
  offer?: OfferConfig;
  /** The Commercial Summary's remarks when the version was made. */
  remarks?: string;
};

export type QuotationVersionInfo = {
  id: string;
  track: QuotationTrack;
  version: number;
  reason: string | null;
  /** Internal versions: who asked for the changes ("TSM"). */
  requestedBy: string | null;
  /** Internal versions: what they asked to change. */
  note: string | null;
  /** The live internal version — its snapshot is the current saved prices. */
  live: boolean;
  tsmName: string | null;
  tsmInitials: string | null;
  snapshot: QuotationSnapshot;
  createdAt: string | null;
  createdByName: string | null;
};

export type QuotationInfo = {
  id: string;
  /** The drive group it covers (GM / GB / VB / DD). */
  driveGroup: string;
  /** Includes the "/GM" suffix when the enquiry mixes drives. */
  number: string;
  productType: string;
  quoteDate: string;
  finYear: string;
  serial: number | null;
  /** ERP serial typed in by hand, or null. */
  erpSerial: string | null;
  /** "RIL/QT/SV/26-27/PCP/<ERP serial>[/GM]", or null without an ERP serial. */
  erpNumber: string | null;
  regionCode: string | null;
  tsmRepId: number | null;
  tsmName: string | null;
  tsmInitials: string | null;
  tsmZone: string | null;
  clientCode: string | null;
  clientName: string | null;
  internalVersion: number;
  /** null until the quotation is first sent to the client. */
  clientVersion: number | null;
  versions: QuotationVersionInfo[];
};

/** Indian financial year (Apr–Mar) of a yyyy-mm-dd date: 2026-09-26 → "2627". */
export function finYearOf(isoDate: string): string {
  const [y, m] = isoDate.split("-").map(Number);
  const start = m >= 4 ? y : y - 1;
  return `${String(start).slice(-2)}${String(start + 1).slice(-2)}`;
}

/** "RIL/QT/SV/26-27/PCP/6000" — a missing serial shows as a gap.
 *  fin_year is stored as "2627" and printed as "26-27". With `mixed` (the
 *  enquiry has tags on more than one drive system) the quotation's drive group
 *  goes after the serial: ".../PCP/6000/GM". */
export function quotationNumber(
  q: {
    regionCode: string | null;
    finYear: string;
    productType: string;
    serial: number | null;
    driveGroup?: string | null;
  },
  mixed = false,
): string {
  const fy = /^\d{4}$/.test(q.finYear) ? `${q.finYear.slice(0, 2)}-${q.finYear.slice(2)}` : q.finYear;
  const parts: (string | number)[] = ["RIL", "QT", q.regionCode || "—", fy, q.productType, q.serial ?? "····"];
  if (mixed && q.driveGroup) parts.push(q.driveGroup);
  return parts.join("/");
}

/** The ERP quotation number: the portal number's prefix with the ERP serial. */
export function erpQuotationNumber(
  q: Parameters<typeof quotationNumber>[0] & { erpSerial: string | null },
  mixed = false,
): string | null {
  if (!q.erpSerial) return null;
  const fy = /^\d{4}$/.test(q.finYear) ? `${q.finYear.slice(0, 2)}-${q.finYear.slice(2)}` : q.finYear;
  const parts: string[] = ["RIL", "QT", q.regionCode || "—", fy, q.productType, q.erpSerial];
  if (mixed && q.driveGroup) parts.push(q.driveGroup);
  return parts.join("/");
}

/** An ERP serial as typed: letters, digits, "-" and "/", up to 30; "" → null;
 *  undefined when invalid. */
export function parseErpSerial(raw: unknown): string | null | undefined {
  const v = String(raw ?? "").trim().toUpperCase();
  if (!v) return null;
  return /^[A-Z0-9][A-Z0-9/-]{0,29}$/.test(v) ? v : undefined;
}

/** "V0" / "V3"; "Not sent" for a client track that has no version yet. */
export const versionLabel = (v: number | null): string => (v === null ? "Not sent" : `V${v}`);

// --- Drive groups --------------------------------------------------------------
// An enquiry's tags are quoted per drive system: one quotation (own versions),
// one price summary and one data sheet per group. The code goes after the
// serial in the quotation number only when the enquiry mixes drives.

export const DRIVE_GROUPS = ["GM", "GB", "VB", "DD"] as const;
export type DriveGroup = (typeof DRIVE_GROUPS)[number];

export const DRIVE_GROUP_LABEL: Record<DriveGroup, string> = {
  GM: "Geared Motor",
  GB: "Gear Box + Motor",
  VB: "V-Belt",
  DD: "Direct",
};

export const isDriveGroup = (v: unknown): v is DriveGroup => (DRIVE_GROUPS as readonly string[]).includes(String(v));

/** A tag's group from its Drive step: null until a drive system is chosen. */
export function driveGroupOf(driveSystem: unknown, gearedConfigType: unknown): DriveGroup | null {
  const d = String(driveSystem ?? "");
  if (d === "V-Belt Drive") return "VB";
  if (d === "Direct Drive") return "DD";
  if (d.startsWith("Geared")) return String(gearedConfigType ?? "") === "Gear Box + Motor" ? "GB" : "GM";
  return null;
}

/** The groups present, in DRIVE_GROUPS order. */
export const groupsIn = (groups: (DriveGroup | null)[]): DriveGroup[] =>
  DRIVE_GROUPS.filter((g) => groups.includes(g));
