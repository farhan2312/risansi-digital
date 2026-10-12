/**
 * Live formula engine for the digital test-report formats, ported exactly from
 * "NEW PUMP TESTING FORMATE FOR DIGITAL" — sheet "v notch" (Observation Sheet)
 * and sheet "UPDATE SHEET V-NOTCH (2)" (Viscosity Correction Chart). Every
 * formula below was verified against sample values baked into that workbook
 * before porting — see the conversation for the check.
 */
import type { TestType } from "@/types/testing";

export interface ReportHeaderForCalc {
  testType: TestType | "";
  qTheoretical100rev: number | null; // QTH, m3/hr per 100 rev
  ratedRpm: number | null;
  kForGivenCps: number | null; // defaults to 1 (no viscosity correction) if absent
}

export interface PointRawInputs {
  rpm: number | null;
  headKgcm2: number | null;
  volts: number | null;
  amps: number | null;
  cosPhi: number | null;
  // Exactly one of these is meaningful, depending on header.testType:
  heightTakenForFilling: number | null; // V-notch, Observation Sheet: single report-level baseline
  timeTakenToFillBucketSec: number | null; // Barrel
  capacityDirect: number | null; // Flow Meter
}

export interface PointComputed {
  vnotchHeight: number | null;
  headMwc: number | null;
  capacityCalculatedM3hr: number | null;
  powerCalculatedKw: number | null;
  theoreticalPowerKw: number | null;
  mechanicalEfficiency: number | null;
  volumetricEfficiency: number | null;
  theoreticalCapacityAtMeasuredRpm: number | null;
  slipWater: number | null;
  slipViscous: number | null;
  theoreticalCapacityAtRatedRpm: number | null;
  capacityLiquidAtRatedRpmM3hr: number | null;
  capacityLiquidAtRatedRpmLph: number | null;
}

const round = (v: number, dp = 6) => {
  if (!Number.isFinite(v)) return null;
  const f = 10 ** dp;
  return Math.round(v * f) / f;
};

/** Capacity via the V-notch weir formula: H^2.47/5320, H = height over notch (mm). */
function vnotchCapacity(heightOverNotch: number | null, baseline: number | null): {
  vnotchHeight: number | null;
  capacity: number | null;
} {
  if (heightOverNotch === null || baseline === null) return { vnotchHeight: null, capacity: null };
  const h = heightOverNotch - baseline;
  if (h <= 0) return { vnotchHeight: round(h, 2), capacity: null };
  return { vnotchHeight: round(h, 2), capacity: Math.pow(h, 2.47) / 5320 };
}

/** Capacity via the barrel method: 5 litres / t seconds, converted to m3/hr. */
function barrelCapacity(timeSec: number | null): number | null {
  if (!timeSec || timeSec <= 0) return null;
  return (5 / timeSec) * 3600 / 1000;
}

/** Fields common to both formats, computed once capacity/headMwc are known. */
function computeCommon(
  capacity: number | null,
  headMwc: number | null,
  power: number | null,
  rpm: number | null,
  header: ReportHeaderForCalc
) {
  const theoreticalPower = capacity !== null && headMwc !== null ? (capacity * headMwc) / 367 : null;

  const mechanicalEfficiency =
    theoreticalPower !== null && power !== null && power !== 0 ? (theoreticalPower / power) * 100 : null;

  const qth = header.qTheoretical100rev;
  const volumetricEfficiency =
    capacity !== null && rpm !== null && qth !== null && rpm !== 0 && qth !== 0
      ? (capacity / ((rpm / 100) * qth)) * 100
      : null;

  const theoreticalCapacityAtMeasuredRpm = qth !== null && rpm !== null ? (qth * rpm) / 100 : null;

  const slipWater =
    theoreticalCapacityAtMeasuredRpm !== null && capacity !== null
      ? theoreticalCapacityAtMeasuredRpm - capacity
      : null;

  const k = header.kForGivenCps ?? 1;
  const slipViscous = slipWater !== null ? k * slipWater : null;

  const theoreticalCapacityAtRatedRpm =
    header.ratedRpm !== null && qth !== null ? (header.ratedRpm * qth) / 100 : null;

  const capacityLiquidAtRatedRpmM3hr =
    theoreticalCapacityAtRatedRpm !== null && slipViscous !== null
      ? theoreticalCapacityAtRatedRpm - slipViscous
      : null;

  const capacityLiquidAtRatedRpmLph =
    capacityLiquidAtRatedRpmM3hr !== null ? capacityLiquidAtRatedRpmM3hr * 1000 : null;

  return {
    theoreticalPower,
    mechanicalEfficiency,
    volumetricEfficiency,
    theoreticalCapacityAtMeasuredRpm,
    slipWater,
    slipViscous,
    theoreticalCapacityAtRatedRpm,
    capacityLiquidAtRatedRpmM3hr,
    capacityLiquidAtRatedRpmLph,
  };
}

/** Observation Sheet ("v notch" sheet): single report-level V-notch baseline (Hin). */
export function computePoint(
  raw: PointRawInputs,
  header: ReportHeaderForCalc & { vnotchBaseline: number | null }
): PointComputed {
  let vnotchHeight: number | null = null;
  let capacity: number | null = null;

  if (header.testType === "V-notch") {
    const r = vnotchCapacity(raw.heightTakenForFilling, header.vnotchBaseline);
    vnotchHeight = r.vnotchHeight;
    capacity = r.capacity;
  } else if (header.testType === "Barrel") {
    capacity = barrelCapacity(raw.timeTakenToFillBucketSec);
  } else if (header.testType === "Flow Meter") {
    capacity = raw.capacityDirect;
  }

  const headMwc = raw.headKgcm2 !== null ? raw.headKgcm2 * 10 : null;
  const power =
    raw.volts !== null && raw.amps !== null && raw.cosPhi !== null
      ? (1.7321 * raw.volts * raw.amps * raw.cosPhi) / 1000
      : null;

  const common = computeCommon(capacity, headMwc, power, raw.rpm, header);

  return {
    vnotchHeight,
    headMwc: round(headMwc ?? NaN, 2),
    capacityCalculatedM3hr: round(capacity ?? NaN, 4),
    powerCalculatedKw: round(power ?? NaN, 6),
    theoreticalPowerKw: round(common.theoreticalPower ?? NaN, 6),
    mechanicalEfficiency: round(common.mechanicalEfficiency ?? NaN, 4),
    volumetricEfficiency: round(common.volumetricEfficiency ?? NaN, 4),
    theoreticalCapacityAtMeasuredRpm: round(common.theoreticalCapacityAtMeasuredRpm ?? NaN, 4),
    slipWater: round(common.slipWater ?? NaN, 4),
    slipViscous: round(common.slipViscous ?? NaN, 4),
    theoreticalCapacityAtRatedRpm: round(common.theoreticalCapacityAtRatedRpm ?? NaN, 4),
    capacityLiquidAtRatedRpmM3hr: round(common.capacityLiquidAtRatedRpmM3hr ?? NaN, 4),
    capacityLiquidAtRatedRpmLph: round(common.capacityLiquidAtRatedRpmLph ?? NaN, 2),
  };
}

export interface ViscosityChartRawInputs {
  rpm: number | null;
  headKgcm2: number | null;
  volts: number | null;
  amps: number | null;
  cosPhi: number | null;
  // V-notch height and its baseline are BOTH entered per test point on this
  // form (unlike the Observation Sheet's single report-level Hin).
  heightOverVNotch: number | null;
  initialReading: number | null;
  timeTakenToFillBucketSec: number | null; // Barrel
  capacityDirect: number | null; // Flow Meter
}

export interface ViscosityChartPointComputed extends PointComputed {
  differentialHeight: number | null;
  volumetricEfficiencyLiquid: number | null;
  mechanicalEfficiencyLiquid: number | null;
}

/** Viscosity Correction Chart ("UPDATE SHEET V-NOTCH (2)"): per-point baseline,
 * plus liquid-corrected (viscosity-corrected) efficiency figures. */
export function computeViscosityChartPoint(
  raw: ViscosityChartRawInputs,
  header: ReportHeaderForCalc
): ViscosityChartPointComputed {
  let differentialHeight: number | null = null;
  let capacity: number | null = null;

  if (header.testType === "V-notch") {
    const r = vnotchCapacity(raw.heightOverVNotch, raw.initialReading);
    differentialHeight = r.vnotchHeight;
    capacity = r.capacity;
  } else if (header.testType === "Barrel") {
    capacity = barrelCapacity(raw.timeTakenToFillBucketSec);
  } else if (header.testType === "Flow Meter") {
    capacity = raw.capacityDirect;
  }

  const headMwc = raw.headKgcm2 !== null ? raw.headKgcm2 * 10 : null;
  const power =
    raw.volts !== null && raw.amps !== null && raw.cosPhi !== null
      ? (1.732 * raw.volts * raw.amps * raw.cosPhi) / 1000
      : null;

  const common = computeCommon(capacity, headMwc, power, raw.rpm, header);

  const volumetricEfficiencyLiquid =
    common.capacityLiquidAtRatedRpmM3hr !== null &&
    raw.rpm !== null &&
    header.qTheoretical100rev !== null &&
    raw.rpm !== 0 &&
    header.qTheoretical100rev !== 0
      ? (common.capacityLiquidAtRatedRpmM3hr / ((raw.rpm / 100) * header.qTheoretical100rev)) * 100
      : null;

  const mechanicalEfficiencyLiquid =
    common.capacityLiquidAtRatedRpmM3hr !== null && headMwc !== null && power !== null && power !== 0
      ? ((common.capacityLiquidAtRatedRpmM3hr * headMwc) / 367 / power) * 100
      : null;

  return {
    vnotchHeight: differentialHeight,
    differentialHeight,
    headMwc: round(headMwc ?? NaN, 2),
    capacityCalculatedM3hr: round(capacity ?? NaN, 4),
    powerCalculatedKw: round(power ?? NaN, 6),
    theoreticalPowerKw: round(common.theoreticalPower ?? NaN, 6),
    mechanicalEfficiency: round(common.mechanicalEfficiency ?? NaN, 4),
    volumetricEfficiency: round(common.volumetricEfficiency ?? NaN, 4),
    theoreticalCapacityAtMeasuredRpm: round(common.theoreticalCapacityAtMeasuredRpm ?? NaN, 4),
    slipWater: round(common.slipWater ?? NaN, 4),
    slipViscous: round(common.slipViscous ?? NaN, 4),
    theoreticalCapacityAtRatedRpm: round(common.theoreticalCapacityAtRatedRpm ?? NaN, 4),
    capacityLiquidAtRatedRpmM3hr: round(common.capacityLiquidAtRatedRpmM3hr ?? NaN, 4),
    capacityLiquidAtRatedRpmLph: round(common.capacityLiquidAtRatedRpmLph ?? NaN, 2),
    volumetricEfficiencyLiquid: round(volumetricEfficiencyLiquid ?? NaN, 4),
    mechanicalEfficiencyLiquid: round(mechanicalEfficiencyLiquid ?? NaN, 4),
  };
}
