/**
 * P&A (Pump & Accessories) price suggestion from the L1–L4 price lists
 * ("l1-l4.xlsx", user 2026-10-03; tables pa_price_level / pa_price_list /
 * pa_rubber_addon). For a tag: find its pump model's row, take the MOC
 * column, apply the sheet's notes, and offer one price per list (L1–L4) to
 * use. Never applied on its own.
 *
 * The sheet's notes, as adjustments (each can be switched on/off; the ones
 * the data already decides start on):
 *   With bucket & auger (BAG)   ABBN +15 % · BBBN +20 % · CCCN +25 %
 *   Only auger, no bucket (AG)  ABBN +10 % · BBBN +12 % · CCCN +15 %
 *   EPDM                        × 1.1
 *   Food grade (FGM / FGE)      P+A + 5 %
 *   Viton / HNBR                + fixed amount per family ("added to P&A")
 *   Base plate SS304            + 5 %          (27-10-2025)
 *   Suction / delivery size     +3 % larger / −3 % smaller than standard (27-03-2026)
 *   CI casing, SS304 internals  BBBN price − 10 % (22-01-2026; off by default)
 *   MOC chart (22-07-2026)      AABN price = ABBN
 *   Vertical (VM), by negative depth:  × 1.2 (H15–H60) / × 1.3 (H70–H120);
 *                               5 m depth × 1.5 · 7 m depth × 1.6
 * Percentages multiply; the Viton/HNBR amount is added last.
 *
 * Client-safe (no DB).
 */
import type { CommercialTag } from "./commercial";
import { rubberCodeFor } from "./pump-code";

export type PaLevelKey = "L1" | "L2" | "L3" | "L4";
export type PaMocCol = "abbn" | "bbbn" | "accn" | "cccn";

export interface PaLevel {
  level: PaLevelKey;
  title: string;
  dateText: string | null;
  listDate: string | null;
}

export interface PaPriceRow {
  srNo: number | null;
  pumpModelNo: string;
  /** "l1_abbn" … "l4_cccn" → price (null when the list has no such column). */
  prices: Record<string, number | null>;
}

export interface PaAddon {
  pumpModel: string;
  amount: number;
}

export interface PaPriceData {
  levels: PaLevel[];
  rows: PaPriceRow[];
  addons: PaAddon[];
}

/** What the tag gives the suggestion, and where each piece came from. */
export interface PaInputs {
  /** e.g. "2H48", "H40L6". */
  model: string | null;
  /** Code-builder MOC, e.g. "ABB". */
  moc: string | null;
  /** Code-builder rubber code: N / E / V / H / FGM / FGE. */
  rubber: string | null;
  /** "AG" | "BAG" | null. */
  subCategory: string | null;
  basePlate: string | null;
  recommendedSize: string | null;
  suctionSize: string | null;
  dischargeSize: string | null;
  /** Vertical pump (Operating Conditions pump type). */
  vertical: boolean;
  /** Negative suction depth in metres (null when none / not entered). */
  negativeDepthM: number | null;
  /** "product code" (built or parsed) or "pump selection". */
  source: Partial<Record<"model" | "moc" | "rubber" | "subCategory", string>>;
}

export interface PaAdjustment {
  key: string;
  label: string;
  /** Short form for the saved basis, e.g. "BAG +15%". */
  short: string;
  pct?: number;
  add?: number;
  /** Starts ticked (the data says it applies). */
  defaultOn: boolean;
  /** Price from the BBBN column instead of the MOC's (CI casing rule). */
  fromBbbn?: boolean;
  /** Only one of a group can be on (size up / size down). */
  group?: string;
  note?: string;
}

// --- Model matching ---------------------------------------------------------------

const norm = (s: string) => s.toUpperCase().replace(/[\s-]/g, "");

/** "H-48/50/52" → H48, H50, H52; "2H-50/2H-48/2H-52" → 2H50, 2H48, 2H52;
 *  "H60L-3" → H60L3. A part without its own prefix takes the first part's. */
export function modelAliases(name: string): string[] {
  const parts = name.split("/").map((p) => norm(p)).filter(Boolean);
  if (!parts.length) return [];
  const prefix = parts[0].match(/^(\d*H)/)?.[1] ?? "H";
  return parts.map((p) => (/^\d/.test(p) && !/^\d+H/.test(p) ? prefix + p : p));
}

/** The price row for a model. "H40L6" falls back to a plain "H-40L" row (the
 *  list writes the L6 pumps of 20/30/40/50 as "…L"). */
export function findPriceRow(rows: PaPriceRow[], model: string | null): { row: PaPriceRow; note?: string } | null {
  if (!model) return null;
  const m = norm(model);
  const exact = rows.find((r) => modelAliases(r.pumpModelNo).includes(m));
  if (exact) return { row: exact };
  if (/L6$/.test(m)) {
    const plain = rows.find((r) => modelAliases(r.pumpModelNo).includes(m.slice(0, -1)));
    if (plain) return { row: plain, note: `${model} taken as "${plain.pumpModelNo}"` };
  }
  return null;
}

/** Viton / HNBR amount: an exact family row starts ticked; otherwise the
 *  nearest single-stage family (2H48 → H-48/52, H40L6 → H-40, H50 via its
 *  price-list group) is offered unticked. */
function findAddon(data: PaPriceData, model: string): { addon: PaAddon; exact: boolean } | null {
  const m = norm(model);
  const exact = data.addons.find((a) => modelAliases(a.pumpModel).includes(m));
  if (exact) return { addon: exact, exact: true };
  const base = m.replace(/^\d+(?=H)/, "").replace(/L\d*$/, "");
  const group = data.rows.find((r) => modelAliases(r.pumpModelNo).includes(base));
  const family = new Set([base, ...(group ? modelAliases(group.pumpModelNo) : [])]);
  const near = data.addons.find((a) => modelAliases(a.pumpModel).some((x) => family.has(x)));
  return near ? { addon: near, exact: false } : null;
}

/** MOC code → the list's column. AAB is priced as ABBN (MOC chart). */
export const MOC_COLUMN: Record<string, PaMocCol> = { ABB: "abbn", AAB: "abbn", BBB: "bbbn", CCC: "cccn", ACC: "accn" };

const SUBCAT_PCT: Record<string, Partial<Record<PaMocCol, number>>> = {
  BAG: { abbn: 15, bbbn: 20, cccn: 25 },
  AG: { abbn: 10, bbbn: 12, cccn: 15 },
};

/** Larger / smaller suction or delivery size than the model's standard. */
function sizeChange(i: PaInputs): "up" | "down" | null {
  const rec = parseFloat(i.recommendedSize ?? "");
  if (!Number.isFinite(rec)) return null;
  const sizes = [i.suctionSize, i.dischargeSize].map((v) => parseFloat(v ?? "")).filter(Number.isFinite);
  if (sizes.some((s) => s > rec)) return "up";
  if (sizes.some((s) => s < rec)) return "down";
  return null;
}

/** The model's size number: "2H48" → 48, "H40L6" → 40. */
const modelSize = (model: string): number | null => {
  const m = norm(model).match(/H(\d+)/);
  return m ? Number(m[1]) : null;
};

/** Vertical (VM) multiplier — only the one the negative depth calls for:
 *  under 5 m the standard × 1.2 (H15–H60) / × 1.3 (H70–H120), 5 to under
 *  7 m × 1.5, 7 m and over × 1.6. */
function verticalAdjustments(i: PaInputs, notes: string[]): PaAdjustment[] {
  if (!i.vertical || !i.model) return [];
  const d = i.negativeDepthM;
  const depth = d === null ? "no negative depth entered" : `negative depth ${+d.toFixed(2)} m`;
  if (d !== null && d >= 7)
    return [{ key: "vm_7", label: `Vertical (VM), ${depth} × 1.6`, short: "VM 7m ×1.6", pct: 60, defaultOn: true }];
  if (d !== null && d >= 5)
    return [{ key: "vm_5", label: `Vertical (VM), ${depth} × 1.5`, short: "VM 5m ×1.5", pct: 50, defaultOn: true }];
  const size = modelSize(i.model);
  const std = size === null ? null : size >= 15 && size <= 60 ? 1.2 : size >= 70 && size <= 120 ? 1.3 : null;
  if (std === null) {
    notes.push(`Vertical (VM): no factor listed for ${i.model} (H15–H60 × 1.2, H70–H120 × 1.3) — add by hand`);
    return [];
  }
  return [{ key: "vm_std", label: `Vertical (VM), ${depth} × ${std}`, short: `VM ×${std}`, pct: Math.round((std - 1) * 100), defaultOn: true }];
}

export interface PaSuggestion {
  /** Why there is no suggestion (model / MOC not in the list), else null. */
  problem: string | null;
  row: PaPriceRow | null;
  col: PaMocCol | null;
  notes: string[];
  adjustments: PaAdjustment[];
}

/** The matched row + MOC column and the adjustments that apply. */
export function paSuggestion(data: PaPriceData, i: PaInputs): PaSuggestion {
  const notes: string[] = [];
  const found = findPriceRow(data.rows, i.model);
  if (!i.model) return { problem: "No pump model selected for this tag.", row: null, col: null, notes, adjustments: [] };
  if (!found) return { problem: `${i.model} is not in the L1–L4 price list.`, row: null, col: null, notes, adjustments: [] };
  if (found.note) notes.push(found.note);
  if (!i.moc) {
    return {
      problem: "No MOC yet — build the product code on the Pump & Qty step (it carries the MOC).",
      row: found.row,
      col: null,
      notes,
      adjustments: [],
    };
  }
  const col = MOC_COLUMN[i.moc] ?? null;
  if (!col) {
    return {
      problem: `MOC ${i.moc} is not priced in the L1–L4 list (ABBN, BBBN, ACCN, CCCN; AABN = ABBN).`,
      row: found.row,
      col: null,
      notes,
      adjustments: [],
    };
  }
  if (i.moc === "AAB") notes.push("AABN priced as ABBN (MOC chart 22-07-2026)");

  const adj: PaAdjustment[] = [];
  if (i.subCategory === "BAG" || i.subCategory === "AG") {
    const pct = SUBCAT_PCT[i.subCategory][col];
    const label = i.subCategory === "BAG" ? "With bucket & auger (BAG)" : "Auger only, no bucket (AG)";
    if (pct !== undefined) adj.push({ key: "subcat", label: `${label} +${pct}%`, short: `${i.subCategory} +${pct}%`, pct, defaultOn: true });
    else notes.push(`${label}: no % listed for ${col.toUpperCase()} — add by hand`);
  }
  if (i.rubber === "E") adj.push({ key: "epdm", label: "EPDM × 1.1 (+10%)", short: "EPDM +10%", pct: 10, defaultOn: true });
  if (i.rubber === "FGM" || i.rubber === "FGE")
    adj.push({ key: "food", label: "Food grade +5%", short: "Food grade +5%", pct: 5, defaultOn: true });
  if (i.rubber === "V" || i.rubber === "H") {
    const name = i.rubber === "V" ? "Viton" : "HNBR";
    const a = findAddon(data, i.model);
    if (a)
      adj.push({
        key: "addon",
        label: `${name}: + ₹${a.addon.amount.toLocaleString("en-IN")} (${a.addon.pumpModel})`,
        short: `${name} +${a.addon.amount}`,
        add: a.addon.amount,
        defaultOn: a.exact,
        note: a.exact ? undefined : `listed for ${a.addon.pumpModel}, not ${i.model} — tick if it applies`,
      });
    else notes.push(`${name}: no amount listed for ${i.model} — add by hand`);
  }
  adj.push({
    key: "baseplate",
    label: "Base plate SS304 +5%",
    short: "SS304 base plate +5%",
    pct: 5,
    defaultOn: /304/.test(i.basePlate ?? ""),
  });
  const size = sizeChange(i);
  adj.push(
    { key: "size_up", label: "Suction/delivery larger than standard +3%", short: "Size up +3%", pct: 3, defaultOn: size === "up", group: "size" },
    { key: "size_down", label: "Suction/delivery smaller than standard −3%", short: "Size down −3%", pct: -3, defaultOn: size === "down", group: "size" },
  );
  if (col === "abbn")
    adj.push({
      key: "ci_casing",
      label: "CI casing, SS304 internals: BBBN price −10%",
      short: "BBBN −10% (CI casing)",
      pct: -10,
      fromBbbn: true,
      defaultOn: false,
    });
  adj.push(...verticalAdjustments(i, notes));
  return { problem: null, row: found.row, col, notes, adjustments: adj };
}

const round = (n: number) => Math.round(n);

/** One list's suggested price with the ticked adjustments (null when that
 *  list has no price for the column). */
export function paPrice(s: PaSuggestion, level: PaLevelKey, on: Set<string>): { base: number | null; price: number | null } {
  if (!s.row || !s.col) return { base: null, price: null };
  const ticked = s.adjustments.filter((a) => on.has(a.key));
  const col = ticked.some((a) => a.fromBbbn) ? "bbbn" : s.col;
  const base = s.row.prices[`${level.toLowerCase()}_${col}`] ?? null;
  if (base === null) return { base: null, price: null };
  const factor = ticked.reduce((f, a) => f * (1 + (a.pct ?? 0) / 100), 1);
  const add = ticked.reduce((t, a) => t + (a.add ?? 0), 0);
  return { base, price: round(base * factor) + add };
}

/** Saved with the price: "L3 · H-48/50/52 · ABBN · BAG +15% · EPDM +10%". */
export function paBasisText(s: PaSuggestion, level: PaLevelKey, on: Set<string>): string {
  const ticked = s.adjustments.filter((a) => on.has(a.key));
  const col = ticked.some((a) => a.fromBbbn) ? "bbbn" : s.col;
  return [level, s.row?.pumpModelNo, col?.toUpperCase(), ...ticked.map((a) => a.short)]
    .filter(Boolean)
    .join(" · ")
    .slice(0, 300);
}

// --- Inputs from a tag ----------------------------------------------------------------

const MOC_RE = /(AB1B1|AC1C1|AAA|AAB|ABB|BBB|CCC|ACC|SSS)(FGM|FGE|N|E|V|H)?/g;

/** MOC, rubber and sub-category read from a product code picked from the
 *  list (e.g. RTOHAGV6OF4152BBBN → AG, BBB, N). */
export function partsFromProductCode(code: string | null): { moc?: string; rubber?: string; subCategory?: string } {
  const head = (code ?? "").toUpperCase().split("-")[0].split(" ")[0];
  if (!head) return {};
  const matches = [...head.matchAll(MOC_RE)];
  const last = matches[matches.length - 1];
  const sub = head.match(/^[A-Z]+?(BAG|AG)(?=[V\d])/)?.[1];
  return { moc: last?.[1], rubber: last?.[2], subCategory: sub };
}

/** "6" mt → 6; "20" feet → 6.1; blank / not a number → null. */
function depthMetres(size: string | null | undefined, unit: string | null | undefined): number | null {
  const n = parseFloat(size ?? "");
  if (!Number.isFinite(n) || n <= 0) return null;
  return /f/i.test(unit ?? "") ? n * 0.3048 : n;
}

/** A Commercial Summary tag's inputs: the built product code's parts first,
 *  then what a picked code spells out, then the pump selection. */
export function paInputsFor(t: CommercialTag): PaInputs {
  const source: PaInputs["source"] = {};
  const fromCode = partsFromProductCode(t.productCode);
  const parts = t.codeParts;
  let model: string | null = null;
  if (parts?.model) {
    model = `${parts.stage && parts.stage !== "1" ? parts.stage : ""}H${parts.model}`;
    source.model = "product code";
  } else if (t.model) {
    model = t.model;
    source.model = "pump selection";
  }
  const pick = (key: "moc" | "rubber" | "subCategory", built: string | undefined, parsed: string | undefined, wizard?: string | null) => {
    if (built) {
      source[key] = "product code";
      return built;
    }
    if (parsed) {
      source[key] = "product code";
      return parsed;
    }
    if (wizard) {
      source[key] = "pump selection";
      return wizard;
    }
    return null;
  };
  return {
    model,
    moc: pick("moc", parts?.moc, fromCode.moc),
    rubber: pick("rubber", parts?.rubber, fromCode.rubber, rubberCodeFor(t.codeHints.statorRubber)),
    // A built code without a sub-category means none; only a picked code is parsed.
    subCategory: parts ? parts.subCategory || null : (fromCode.subCategory ?? null),
    basePlate: t.paHints.basePlate,
    recommendedSize: t.paHints.recommendedSize,
    suctionSize: t.codeHints.suctionSize,
    dischargeSize: t.paHints.dischargeSize,
    vertical: /vertical/i.test(t.paHints.pumpType ?? ""),
    negativeDepthM: depthMetres(t.paHints.negativeDepth, t.paHints.negativeDepthUnit),
    source,
  };
}
