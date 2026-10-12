/**
 * Discharge Head Calculator - head the pump must develop on the discharge line.
 *
 * Mirrors the "Working Sheet_Molasses" tab of "Head Loss Pressure Discharge
 * Line Calculation_11th Jan 21 V2" (docs/). Pure functions, no I/O, so the page
 * recalculates on every keystroke.
 *
 *   1. Pressure due to vertical height = vertical height × SG
 *   2. Frictional loss (line)  = table loss × (TPH ÷ 1) × (cP ÷ 10,000) × (total distance ÷ 100)
 *   3. Frictional loss (bends) = loss per bend (by angle) × number of bends
 *   4. Valves                  = valves × 1 MWC
 *   5. NRVs                    = NRVs × 1 MWC   (see note below)
 *   Total discharge head       = 1 + 2 + 3 + 4 + 5
 *
 * Note: the sheet has an NRV input and a 1 MWC NRV loss in its reference
 * table, but its total only adds the valves. NRVs are counted here; with
 * 0 NRVs (the sheet's example) the total is identical: 80.20 MWC.
 */

/**
 * Line friction for the discharge sheet, MWC per 1 TPH, 100 m of pipe,
 * 10,000 cP - by nominal bore (inches). 4"-16" are the sheet's fixed values;
 * 1"-3" are scaled from 6" as the sheet does (0.912 × 6⁴ ÷ d⁴). This is the
 * discharge sheet's own table - different from the suction calculator's formula.
 */
const SIX_INCH = 0.912;
export const DISCHARGE_LINE_LOSS: Record<number, number> = {
  1: (SIX_INCH * 6 ** 4) / 1 ** 4,
  1.5: (SIX_INCH * 6 ** 4) / 1.5 ** 4,
  2: (SIX_INCH * 6 ** 4) / 2 ** 4,
  2.5: (SIX_INCH * 6 ** 4) / 2.5 ** 4,
  3: (SIX_INCH * 6 ** 4) / 3 ** 4,
  4: 3.648,
  5: 1.891,
  6: SIX_INCH,
  8: 0.2885,
  10: 0.1182,
  12: 0.057,
  14: 0.0408,
  16: 0.0181,
};
export const DISCHARGE_LINE_SIZES = Object.keys(DISCHARGE_LINE_LOSS)
  .map(Number)
  .sort((a, b) => a - b);

/** Loss per bend, MWC, by angle (same table as the suction sheet). */
export const DISCHARGE_BEND_LOSS: Record<number, number> = { 90: 1.5, 60: 1, 45: 0.75, 30: 0.5 };
export const DISCHARGE_BEND_ANGLES = [90, 60, 45, 30];
export const DISCHARGE_VALVE_LOSS = 1;
export const DISCHARGE_NRV_LOSS = 1;

export type DischargeCapacityUnit = "TPH" | "M3";

export interface DischargeCalcInput {
  application: string;
  specificGravity: string;
  capacity: string;
  capacityUnit: DischargeCapacityUnit;
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
}

/** The sheet's own worked example (Molasses, 80 TPH, 12" line) -> 80.20 MWC. */
export const DEFAULT_DISCHARGE_INPUT: DischargeCalcInput = {
  application: "Molasses",
  specificGravity: "1.45",
  capacity: "80",
  capacityUnit: "TPH",
  viscosity: "5000",
  lineSize: "12",
  verticalHeight: "43",
  horizontalDistance: "38",
  bendAngle: "90",
  noBends: "10",
  valves: "1",
  nrv: "0",
};

export interface DischargeCalcResult {
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
  /** Total discharge head, MWC. */
  totalHead: number;
  /** Same head as pressure: kg/cm² (MWC ÷ 10) and bar (MWC × 0.0980665). */
  totalKgCm2: number;
  totalBar: number;
}

const num = (value: string): number => {
  const v = parseFloat(value);
  return Number.isNaN(v) ? 0 : v;
};

export function calculateDischarge(form: DischargeCalcInput): DischargeCalcResult {
  const sg = num(form.specificGravity);
  let capacity = num(form.capacity);
  if (form.capacityUnit === "M3") capacity = capacity * sg; // TPH = m³/hr × SG

  const verticalHeight = num(form.verticalHeight);
  const totalDistance = verticalHeight + num(form.horizontalDistance);

  const lineLossBase = DISCHARGE_LINE_LOSS[parseFloat(form.lineSize)] ?? 0;
  const bendLossPerBend = DISCHARGE_BEND_LOSS[parseFloat(form.bendAngle)] ?? 0;

  const pressureFromHeight = verticalHeight * sg; // 1
  const frictionLossLine = lineLossBase * (capacity / 1) * (num(form.viscosity) / 10000) * (totalDistance / 100); // 2
  const frictionLossBends = bendLossPerBend * num(form.noBends); // 3
  const frictionLossValves = num(form.valves) * DISCHARGE_VALVE_LOSS; // 4
  const frictionLossNRV = num(form.nrv) * DISCHARGE_NRV_LOSS; // 5

  const totalHead = pressureFromHeight + frictionLossLine + frictionLossBends + frictionLossValves + frictionLossNRV;

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
    totalHead,
    totalKgCm2: totalHead / 10,
    totalBar: totalHead * 0.0980665,
  };
}
