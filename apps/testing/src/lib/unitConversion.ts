/**
 * Live "converted to base unit" hints for the requisition form's Req.
 * Capacity and Head fields — display only, never written back to the
 * stored value (see CAPACITY_UNITS / HEAD_UNITS in types/testing.ts).
 *
 * Mass-based units (MT/HR, KG/MIN, TPH for capacity; MLC for head) need the
 * liquid's Specific Gravity to convert correctly -- density = SG x 1000
 * kg/m3. Defaults to 1 (water) when Specific Gravity hasn't been entered,
 * matching the app's existing default liquid elsewhere. KG/CM2 -> MWC is a
 * pure pressure conversion and doesn't depend on SG.
 */

const round = (n: number) => Math.round(n * 10000) / 10000;

const capacityFactor = (unit: string, sg: number): number | undefined => {
  switch (unit) {
    case "M3/HR":
      return 1;
    case "LPH":
      return 0.001;
    case "MT/HR": // mass water-equivalent tons/hr -> m3/hr
    case "TPH":
      return 1 / sg;
    case "KG/MIN": // kg/min -> kg/hr (x60) -> m3/hr (/1000/sg)
      return 0.06 / sg;
    default:
      return undefined;
  }
};

const headFactor = (unit: string, sg: number): number | undefined => {
  switch (unit) {
    case "MWC":
      return 1;
    case "MLC": // meters of liquid column -> meters of water column
      return sg;
    case "KG/CM2": // 1 kgf/cm2 = 10 m water column, independent of SG
      return 10;
    case "MTR":
      return 1;
    case "TPH": // not a real head unit, but present in HEAD_UNITS -- treated as identity
      return 1;
    default:
      return undefined;
  }
};

export const capacityToM3hr = (
  value: number | undefined | null,
  unit: string | undefined | null,
  specificGravity?: number | undefined | null
): number | null => {
  if (value === undefined || value === null || Number.isNaN(value) || !unit) return null;
  const sg = specificGravity && specificGravity > 0 ? specificGravity : 1;
  const factor = capacityFactor(unit, sg);
  return factor === undefined ? null : round(value * factor);
};

export const headToMwc = (
  value: number | undefined | null,
  unit: string | undefined | null,
  specificGravity?: number | undefined | null
): number | null => {
  if (value === undefined || value === null || Number.isNaN(value) || !unit) return null;
  const sg = specificGravity && specificGravity > 0 ? specificGravity : 1;
  const factor = headFactor(unit, sg);
  return factor === undefined ? null : round(value * factor);
};

/**
 * Head converted to KG/CM2 — the unit every stored "head" value is
 * normalized to on submit (test_requisitions.head_kgcm2 is literally named
 * for it, and pump_test_reports.rated_head is compared directly against
 * test points' head_kgcm2 for the requirement-met check, so both need to be
 * true KG/CM2, not whatever unit was picked at entry). 1 kgf/cm2 = 10 MWC.
 */
export const headToKgcm2 = (
  value: number | undefined | null,
  unit: string | undefined | null,
  specificGravity?: number | undefined | null
): number | null => {
  const mwc = headToMwc(value, unit, specificGravity);
  return mwc === null ? null : round(mwc / 10);
};

/**
 * Normalizes a form's Head value + unit for submission: converts to KG/CM2
 * and resets the unit label to match, so the stored pair always agrees.
 * Falls back to the raw entry (unit label as originally picked) when there's
 * no value or no unit to convert from -- e.g. Head Unit left on "Select".
 */
export const normalizeHeadForSubmit = (
  value: number | undefined | null,
  unit: string | undefined | null,
  specificGravity?: number | undefined | null
): { head: number | undefined | null; unit: string | undefined | null } => {
  const converted = headToKgcm2(value, unit, specificGravity);
  if (converted === null) return { head: value, unit };
  return { head: converted, unit: "KG/CM2" };
};

/**
 * Normalizes a form's Rated Capacity value + unit for submission: converts
 * to M3/HR and resets the unit label to match, so the stored pair always
 * agrees -- mirrors normalizeHeadForSubmit above. Without this, a report
 * submitted with e.g. LPH picked stored a raw LPH figure in rated_capacity
 * while the requirement check compares it directly against test points'
 * capacity_calculated_m3hr (always M3/Hr), silently comparing mismatched
 * units. Falls back to the raw entry when there's nothing (or nothing
 * convertible, e.g. an unrecognized unit) to convert from.
 */
export const normalizeCapacityForSubmit = (
  value: number | undefined | null,
  unit: string | undefined | null,
  specificGravity?: number | undefined | null
): { capacity: number | undefined | null; unit: string | undefined | null } => {
  const converted = capacityToM3hr(value, unit, specificGravity);
  if (converted === null) return { capacity: value, unit };
  return { capacity: converted, unit: "M3/HR" };
};
