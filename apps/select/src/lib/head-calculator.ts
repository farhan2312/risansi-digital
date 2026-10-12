/**
 * Head Calculator — NPSH and suction-line losses.
 *
 * Ported unchanged from the reference calculator (calculator/App.jsx), which
 * mirrors the "Reference & Calculations" tab of the source workbook. Pure
 * functions, no I/O, so the page can recalculate on every keystroke.
 */

/** Table 2 — Frictional loss per bend, MWC, by bend angle (degrees). */
export const BEND_LOSS_TABLE: Record<number, number> = { 90: 1.5, 60: 1, 45: 0.75, 30: 0.5 };

/** Table 3 — Fixed loss per fitting, MWC. */
export const VALVE_LOSS = 1;
export const NRV_LOSS = 1;

export const LINE_SIZES = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10, 12, 14, 16];
export const BEND_ANGLES = [90, 60, 45, 30];

/**
 * Table 1 — Frictional loss for the line size, MWC.
 * Base value at 1 TPH, 10,000 cP over 100 m, as a function of nominal bore (in).
 */
export function lineSizeFrictionLoss(diaInches: number): number {
  return (((0.0273 * (10000 * 1 * 0.2728)) / Math.pow(diaInches, 4)) * ((10.5 / 14.7) * 100)) / 3.28 / 1.4;
}

export type CapacityUnit = "TPH" | "M3";

export interface HeadCalcInput {
  application: string;
  specificGravity: string;
  capacity: string;
  capacityUnit: CapacityUnit;
  /** cP */
  viscosity: string;
  /** Nominal bore, inches */
  lineSize: string;
  /** m */
  verticalHeight: string;
  /** m */
  horizontalDistance: string;
  /** degrees */
  bendAngle: string;
  noBends: string;
  valves: string;
  nrv: string;
  /** Atmospheric / source head, MWC */
  atmPressure: string;
  /** NPSH required, MWC */
  npshr: string;
}

export const DEFAULT_HEAD_CALC_INPUT: HeadCalcInput = {
  application: "Molasses",
  specificGravity: "1.4",
  capacity: "5",
  capacityUnit: "TPH",
  viscosity: "15000",
  lineSize: "4",
  verticalHeight: "3",
  horizontalDistance: "0",
  bendAngle: "45",
  noBends: "1",
  valves: "0",
  nrv: "0",
  atmPressure: "10.5",
  npshr: "3.5",
};

export type HeadCalcStatus = "ok" | "caution" | "bad";

export interface HeadCalcResult {
  /** Capacity used in the loss formula (TPH, or m³/hr × SG). */
  capacityTph: number;
  totalDistance: number;
  lineLossBase: number;
  bendLossPerBend: number;
  pressureFromHeight: number;
  frictionLossLine: number;
  frictionLossBends: number;
  frictionLossValves: number;
  frictionLossNRV: number;
  totalLoss: number;
  npsha: number;
  npshr: number;
  margin: number;
  status: HeadCalcStatus;
  statusText: string;
  /** 0–100, for the gauge bars. */
  npshaPct: number;
  npshrPct: number;
}

const num = (value: string): number => {
  const v = parseFloat(value);
  return Number.isNaN(v) ? 0 : v;
};

export function calculateHead(form: HeadCalcInput): HeadCalcResult {
  const sg = num(form.specificGravity);

  // Capacity, converted to TPH-equivalent if entered as m³/hr.
  let capacity = num(form.capacity);
  if (form.capacityUnit === "M3") capacity = capacity * sg;

  const lineSize = parseFloat(form.lineSize);
  const verticalHeight = num(form.verticalHeight);
  const horizontalDistance = num(form.horizontalDistance);
  const totalDistance = verticalHeight + horizontalDistance;

  const bendAngle = parseFloat(form.bendAngle);
  const noBends = num(form.noBends);
  const valves = num(form.valves);
  const nrv = num(form.nrv);
  const viscosity = num(form.viscosity);
  const atmPressure = num(form.atmPressure);
  const npshr = num(form.npshr);

  // Lookups
  const lineLossBase = lineSizeFrictionLoss(lineSize);
  const bendLossPerBend = BEND_LOSS_TABLE[bendAngle] || 0;

  // Step-by-step losses
  const pressureFromHeight = verticalHeight * sg; // 1
  const frictionLossLine = lineLossBase * (capacity / 1) * (viscosity / 10000) * (totalDistance / 100); // 2
  const frictionLossBends = bendLossPerBend * noBends; // 3
  const frictionLossValves = valves * VALVE_LOSS; // 4
  const frictionLossNRV = nrv * NRV_LOSS; // 5

  const totalLoss = pressureFromHeight + frictionLossLine + frictionLossBends + frictionLossValves + frictionLossNRV;
  const npsha = atmPressure - totalLoss;
  const margin = npsha - npshr;

  let status: HeadCalcStatus;
  let statusText: string;
  if (margin >= 1) {
    status = "ok";
    statusText = "OK — adequate margin";
  } else if (margin >= 0.5) {
    status = "caution";
    statusText = "CAUTION — marginal";
  } else {
    status = "bad";
    statusText = "INSUFFICIENT — review suction system";
  }

  // Gauge scale
  const scaleMax = Math.max(atmPressure, npshr, npsha, 1) * 1.15;
  const npshaPct = Math.max(0, Math.min(100, (npsha / scaleMax) * 100));
  const npshrPct = Math.max(0, Math.min(100, (npshr / scaleMax) * 100));

  return {
    capacityTph: capacity,
    totalDistance,
    lineLossBase,
    bendLossPerBend,
    pressureFromHeight,
    frictionLossLine,
    frictionLossBends,
    frictionLossValves,
    frictionLossNRV,
    totalLoss,
    npsha,
    npshr,
    margin,
    status,
    statusText,
    npshaPct,
    npshrPct,
  };
}
