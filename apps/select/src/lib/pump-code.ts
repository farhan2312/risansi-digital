/**
 * Pump product-code builder (Commercial → Pump & Qty). The ERP product code is
 * assembled from parts, in this order (user, 2026-10-03):
 *
 *   SERIES [SUB-CATEGORY] SIZE STAGE MODEL MOC RUBBER  -SEALING  [-HOUSING]
 *   RTOH   BAG            6    1     70    ABB N       -SCG      -CC
 *   → RTOHBAG6170ABBN-SCG-CC
 *
 * No separator up to the rubber; a hyphen before the sealing and the housing,
 * as in the existing codes. Sealing: Gland Packing → "GP"; Mechanical Seal →
 * its sub-type (MSA / SCG / DCG / MSK), or "MS" when none is picked. Model is
 * the family without the "H" (H40L6 → 40L6). Sub-category and housing are
 * optional. Choices come from pump_code_option.
 *
 * Client-safe (no DB): the page, the save and the checks all use it.
 */

export const CODE_SEGMENTS = [
  { key: "series", label: "Series", required: true, addable: true },
  { key: "subCategory", label: "Sub-category", required: false, addable: true },
  { key: "size", label: "Size", required: true, addable: true },
  { key: "stage", label: "Stage", required: true, addable: false },
  { key: "model", label: "Model", required: true, addable: true },
  { key: "moc", label: "MOC", required: true, addable: true },
  { key: "rubber", label: "Rubber", required: true, addable: true },
  { key: "sealing", label: "Sealing", required: true, addable: false },
  { key: "subSealing", label: "Sub-sealing", required: false, addable: false },
  { key: "housing", label: "Housing", required: false, addable: false },
] as const;

export type CodeSegmentKey = (typeof CODE_SEGMENTS)[number]["key"];
export type CodeParts = Record<CodeSegmentKey, string>;

/** pump_code_option.segment for each part. */
export const SEGMENT_DB: Record<CodeSegmentKey, string> = {
  series: "series",
  subCategory: "sub_category",
  size: "size",
  stage: "stage",
  model: "model",
  moc: "moc",
  rubber: "rubber",
  sealing: "sealing",
  subSealing: "sub_sealing",
  housing: "housing",
};

/** pump_model_qty_input field (formData / wizard-input name) for each part. */
export const SEGMENT_FIELD: Record<CodeSegmentKey, string> = {
  series: "codeSeries",
  subCategory: "codeSubCategory",
  size: "codeSize",
  stage: "codeStage",
  model: "codeModel",
  moc: "codeMoc",
  rubber: "codeRubber",
  sealing: "codeSealing",
  subSealing: "codeSubSealing",
  housing: "codeHousing",
};

export type CodeOption = { segment: string; code: string; label: string };

export const EMPTY_PARTS: CodeParts = {
  series: "",
  subCategory: "",
  size: "",
  stage: "",
  model: "",
  moc: "",
  rubber: "",
  sealing: "",
  subSealing: "",
  housing: "",
};

/** Sub-sealing only applies to a Mechanical Seal. */
export const usesSubSealing = (p: CodeParts) => p.sealing === "MS";

/** The assembled product code ("" until a part is picked). */
export function buildPumpCode(p: CodeParts): string {
  const head = [p.series, p.subCategory, p.size, p.stage, p.model, p.moc, p.rubber].join("");
  const seal = p.sealing === "GP" ? "GP" : p.sealing === "MS" ? p.subSealing || "MS" : p.sealing;
  return [head, seal, p.housing]
    .filter(Boolean)
    .join("-")
    .toUpperCase();
}

/** Required parts still missing (sub-sealing is required with a Mechanical Seal). */
export function missingParts(p: CodeParts): CodeSegmentKey[] {
  const missing: CodeSegmentKey[] = CODE_SEGMENTS.filter((s) => s.required && !p[s.key]).map((s) => s.key);
  if (usesSubSealing(p) && !p.subSealing) missing.push("subSealing");
  return missing;
}

/** What the pump selection already says about a tag, for prefilling. */
export interface CodeHints {
  /** Confirmed model, e.g. "2H48", "H40L6". */
  model: string | null;
  /** Suction size as entered, e.g. "3". */
  suctionSize: string | null;
  /** Stator rubber, e.g. "Nitrile (abrasion grade)". */
  statorRubber: string | null;
  /** "Gland Packing" | "Mechanical Seal". */
  sealingType: string | null;
  /** Mechanical Seal sub-type, e.g. "MSA". */
  sealingSubType: string | null;
}

const RUBBER_CODE: [RegExp, string][] = [
  [/hnbr/i, "H"],
  [/nitrile|nbr/i, "N"],
  [/epdm/i, "E"],
  [/viton|fkm/i, "V"],
];

/** Rubber code (N / E / V / H) for a stator rubber name, or null. */
export const rubberCodeFor = (statorRubber: string | null | undefined): string | null =>
  RUBBER_CODE.find(([re]) => re.test(statorRubber ?? ""))?.[1] ?? null;

/** Parts the wizard already decides: model + stage (2H48 → stage 2, model
 *  48), size from the suction size, rubber, sealing. Only codes that exist in
 *  the options are used; the rest stay blank to pick. */
export function partsFromHints(h: CodeHints, options: CodeOption[]): Partial<CodeParts> {
  const has = (segment: string, code: string) => options.some((o) => o.segment === segment && o.code === code);
  const out: Partial<CodeParts> = {};
  const m = (h.model ?? "").trim().match(/^(\d+)?H(\d.*)$/i);
  if (m) {
    const stage = m[1] ?? "1";
    const model = m[2].toUpperCase();
    if (has("stage", stage)) out.stage = stage;
    if (has("model", model)) out.model = model;
  }
  const size = (h.suctionSize ?? "").replace(/["”\s]/g, "");
  if (size && has("size", size)) out.size = size;
  const rubber = rubberCodeFor(h.statorRubber);
  if (rubber && has("rubber", rubber)) out.rubber = rubber;
  if (h.sealingType === "Gland Packing") out.sealing = "GP";
  else if (h.sealingType === "Mechanical Seal") {
    out.sealing = "MS";
    const sub = (h.sealingSubType ?? "").toUpperCase();
    if (sub && has("sub_sealing", sub)) out.subSealing = sub;
  }
  return out;
}

/** Saved parts from the pump_model_qty_input fields, or null when the tag's
 *  code was not built with the builder. */
export function partsFromFields(f: Record<string, unknown>): CodeParts | null {
  const parts = { ...EMPTY_PARTS };
  let any = false;
  for (const s of CODE_SEGMENTS) {
    const v = f[SEGMENT_FIELD[s.key]];
    if (typeof v === "string" && v) {
      parts[s.key] = v;
      any = true;
    }
  }
  return any ? parts : null;
}

/** Fields to save for these parts (nulls clear a picked-from-list code's parts). */
export function fieldsFromParts(p: CodeParts | null): Record<string, string | null> {
  return Object.fromEntries(CODE_SEGMENTS.map((s) => [SEGMENT_FIELD[s.key], p ? p[s.key] || null : null]));
}
