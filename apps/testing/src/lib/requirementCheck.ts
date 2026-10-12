/**
 * Did testing actually satisfy the pump's rated requirements? A report is
 * still valid/submittable even if it didn't -- this is a flag, not a
 * validation error. There's no rated target to compare against (met is
 * null) if the field wasn't filled in.
 *
 * Head and Capacity are "reach at least" targets: the highest value across
 * all test points has to get to the rated figure. Power runs the other way
 * -- it's a ceiling, not a target. A pump drawing more kW than its rated
 * motor is overloaded, so Power fails when the measured maximum goes ABOVE
 * the rating, not below it.
 */

export interface RequirementInputs {
  rated_head: number | null;
  rated_capacity: number | null;
  rated_power_kw: number | null;
}

export interface RequirementPoints {
  head_kgcm2: number | null;
  capacity_calculated_m3hr: number | null;
  power_calculated_kw: number | null;
}

export interface RequirementStatus {
  head: boolean | null;
  capacity: boolean | null;
  power: boolean | null;
}

/** Exported so anything that needs the same "highest recorded value" a
 * report was actually judged against (e.g. the Assign Retest modal's rated
 * vs. measured snapshot) doesn't have to re-derive it separately. */
export const maxOf = (points: RequirementPoints[], field: keyof RequirementPoints): number | null => {
  const values = points.map((p) => p[field]).filter((v): v is number => v !== null && v !== undefined);
  return values.length ? Math.max(...values) : null;
};

/** null = no rated target to check against; true/false = met / not met. */
export const computeRequirementStatus = (
  report: RequirementInputs,
  points: RequirementPoints[]
): RequirementStatus => {
  /** Floor targets (Head, Capacity): the max recorded has to reach `rated`. */
  const checkReaches = (rated: number | null, field: keyof RequirementPoints): boolean | null => {
    if (rated === null || rated === undefined) return null;
    const max = maxOf(points, field);
    if (max === null) return null;
    return max >= rated;
  };

  /** Ceiling target (Power): drawing more than the rating is an overload. */
  const checkStaysWithin = (rated: number | null, field: keyof RequirementPoints): boolean | null => {
    if (rated === null || rated === undefined) return null;
    const max = maxOf(points, field);
    if (max === null) return null;
    return max <= rated;
  };

  return {
    head: checkReaches(report.rated_head, "head_kgcm2"),
    capacity: checkReaches(report.rated_capacity, "capacity_calculated_m3hr"),
    power: checkStaysWithin(report.rated_power_kw, "power_calculated_kw"),
  };
};

export interface UnmetRow {
  label: string;
  unit: string;
  rated: number | null;
  measured: number | null;
  /** Head/Capacity: measured has to reach rated (a floor). Power: measured
   * has to stay under rated (a ceiling). Only changes the wording. */
  direction: "below-target" | "over-limit";
}

/** Rated-vs-measured snapshot for whichever fields are in `unmetLabels` --
 * shared by the Assign Retest modal so both call sites (the report detail
 * page, which has raw points to max over, and the pump index page, which
 * already has the maxed arrays) build the identical row shape. */
export const buildUnmetRows = (
  rated: RequirementInputs,
  measured: { head: number | null; capacity: number | null; power: number | null },
  unmetLabels: string[]
): UnmetRow[] =>
  [
    unmetLabels.includes("Head") && {
      label: "Head",
      unit: "KG/CM2",
      rated: rated.rated_head,
      measured: measured.head,
      direction: "below-target" as const,
    },
    unmetLabels.includes("Capacity") && {
      label: "Capacity",
      unit: "M3/HR",
      rated: rated.rated_capacity,
      measured: measured.capacity,
      direction: "below-target" as const,
    },
    unmetLabels.includes("Power") && {
      label: "Power",
      unit: "KW",
      rated: rated.rated_power_kw,
      measured: measured.power,
      direction: "over-limit" as const,
    },
  ].filter((r): r is UnmetRow => Boolean(r));

/** Human-readable labels for whichever fields came back "not met" -- shared
 * by every place a report shows this flag (detail page, archive/list rows,
 * pump dashboard, requisition's own report cards). */
export const unmetRequirementLabels = (status: RequirementStatus): string[] =>
  [
    status.head === false && "Head",
    status.capacity === false && "Capacity",
    status.power === false && "Power",
  ].filter((v): v is string => Boolean(v));

/** Rated power in kW from a requisition's Power (HP) / Power (KW) fields --
 * KW is used directly if present, otherwise HP is converted (1 HP = 0.746 kW). */
export const ratedPowerKwFromRequisition = (requisition: {
  power_kw?: number | string | null;
  power_hp?: number | string | null;
}): number | undefined => {
  if (requisition.power_kw !== null && requisition.power_kw !== undefined && requisition.power_kw !== "") {
    return Number(requisition.power_kw);
  }
  if (requisition.power_hp !== null && requisition.power_hp !== undefined && requisition.power_hp !== "") {
    return Math.round(Number(requisition.power_hp) * 0.746 * 10000) / 10000;
  }
  return undefined;
};
