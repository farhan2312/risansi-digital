/**
 * The Head Calculator inputs saved against an enquiry tag
 * (general_info_input.head_calc): the suction (NPSH) and discharge
 * calculators, as typed. Results are always recalculated from these, never
 * stored. Client-safe (no DB).
 */
import { DEFAULT_HEAD_CALC_INPUT, type HeadCalcInput } from "./head-calculator";
import { DEFAULT_DISCHARGE_INPUT, type DischargeCalcInput } from "./discharge-calculator";

export interface SavedHeadCalc {
  suction: HeadCalcInput;
  discharge: DischargeCalcInput;
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** Only the calculator's own keys, as short strings; missing keys take the default. */
function pick<T extends object>(raw: unknown, defaults: T): T {
  const r = isObj(raw) ? raw : {};
  const out = { ...defaults } as Record<string, string>;
  for (const k of Object.keys(defaults)) if (k in r) out[k] = String(r[k] ?? "").slice(0, 100);
  return out as T;
}

/** Whatever is stored / sent → a valid saved calculation, or null when there is none. */
export function normalizeHeadCalc(raw: unknown): SavedHeadCalc | null {
  if (!isObj(raw)) return null;
  return {
    suction: pick(raw.suction, DEFAULT_HEAD_CALC_INPUT),
    discharge: pick(raw.discharge, DEFAULT_DISCHARGE_INPUT),
  };
}

/** A new calculation seeded from the General Information step (application,
 *  SG and capacity when it is in TPH or m³/hr). */
export function seedHeadCalc(f: { media?: string; sg?: string; capacity?: string; capacityUnit?: string }): SavedHeadCalc {
  const seed: Partial<HeadCalcInput & DischargeCalcInput> = {};
  if (f.media) seed.application = f.media;
  if (f.sg && Number(f.sg) > 0) seed.specificGravity = f.sg;
  if (f.capacity && Number(f.capacity) > 0 && (f.capacityUnit === "TPH" || f.capacityUnit === "M3/hr")) {
    seed.capacity = f.capacity;
    seed.capacityUnit = f.capacityUnit === "TPH" ? "TPH" : "M3";
  }
  return {
    suction: { ...DEFAULT_HEAD_CALC_INPUT, ...seed } as HeadCalcInput,
    discharge: { ...DEFAULT_DISCHARGE_INPUT, ...seed } as DischargeCalcInput,
  };
}
