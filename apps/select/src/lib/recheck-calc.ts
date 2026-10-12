/**
 * The Drive step's "Recheck at final selected RPM" calculation, shared by the
 * Recheck popup (DriveDetailsStep) and the Recheck PDF on the Selection
 * Summary, so the two can never disagree.
 *
 * Recomputes the delivered capacity + BKW at the drive-achieved pump RPM (not
 * the entered duty capacity) so the engineer can see whether the selected
 * drive actually lands close to the duty point. Formulas match
 * recommendation-engine.ts:
 *   Q (at 100 rpm, per VE) = qth × VE/100
 *   Cap at final RPM       = Q × final_rpm / 100
 *   BKW                    = Cap × head(MWC) / 367 / (ME/100)
 *
 * Client-safe: unit conversions come from utils/units, not the engine.
 */
import type { PumpRecommendation, PumpSelectionFormData } from "../data/Recommendations";
import { toM3PerHr, toMwc } from "../utils/units";

export const VBELT_DRIVE = "V-Belt Drive";
export const GEARED_DRIVE = "Geared Motor Drive/Gear Box + Motor";

type RecheckForm = Pick<
  PumpSelectionFormData,
  | "driveSystem"
  | "driveVbeltRpm"
  | "vbeltRpmManual"
  | "gearboxOutputRpm"
  | "gearboxRpmManual"
  | "motorRPM"
  | "head"
  | "headUnit"
  | "capacity"
  | "capacityUnit"
  | "sg"
  | "selectedHead"
  | "vfdRequired"
  | "vfdStdHz"
  | "vfdMinHz"
  | "vfdMaxHz"
>;

/** VFD answer that turns the Hz range (and the range recheck) on. */
export const VFD_YES = "Yes";
export const VFD_OPTIONS = ["Yes", "No"] as const;
/** Defaults filled in when VFD is switched on — the usual Indian supply and
 *  a 30-60 Hz window; all three stay editable. */
export const DEFAULT_VFD_STD_HZ = "50";
export const DEFAULT_VFD_MIN_HZ = "30";
export const DEFAULT_VFD_MAX_HZ = "60";

/** The pump RPM the chosen drive actually delivers, and where it comes from:
 *  the V-belt's achieved RPM, the gearbox output RPM, or the motor RPM for a
 *  direct drive. `raw` is "" until that choice has been made. */
export function finalPumpRpm(form: RecheckForm): { raw: string; source: string } {
  if (form.driveSystem === VBELT_DRIVE) {
    return {
      raw: form.driveVbeltRpm || "",
      source: form.vbeltRpmManual ? "V-belt pump RPM (entered manually)" : "V-Belt achieved pump RPM",
    };
  }
  if (form.driveSystem === GEARED_DRIVE) {
    return {
      raw: form.gearboxOutputRpm || "",
      source: form.gearboxRpmManual ? "Gearbox output RPM (entered manually)" : "Gearbox output RPM",
    };
  }
  return { raw: form.motorRPM || "", source: "Motor RPM (direct drive)" };
}

export interface RecheckSpecs {
  qth: number | null;
  voleMin: number | null;
  voleMax: number | null;
  mechEff: number | null;
  /** The head those figures came from, so the output can say which. */
  atHeadMwc: number | null;
}

export interface RecheckCalc {
  qAtMax: number;
  qAtMin: number;
  capAtMax: number;
  capAtMin: number;
  bkwAtMax: number;
  bkwAtMin: number;
}

/** One end of the VFD Hz range, with the pump speed it produces. */
export interface RecheckVfdEnd {
  hz: number;
  rpm: number;
  calc: RecheckCalc | null;
}

export interface RecheckVfdRange {
  stdHz: number;
  min: RecheckVfdEnd;
  /** Midpoint of the range: (min Hz + max Hz) / 2, e.g. 30–50 Hz -> 40 Hz. */
  mid: RecheckVfdEnd;
  max: RecheckVfdEnd;
}

export interface RecheckResult {
  finalRpm: number;
  /** Duty head in MWC — BKW uses this, not the selected charted head. */
  headMwc: number;
  /** Duty capacity as entered, in m³/hr. */
  dutyCap: number;
  specs: RecheckSpecs;
  /** Null when there isn't enough data to recompute. */
  calc: RecheckCalc | null;
  /** Null unless VFD is "Yes" with a usable Hz range. */
  vfd: RecheckVfdRange | null;
}

/**
 * Pump speed at a given supply frequency. The selected speed (belt-achieved,
 * gearbox output, or motor RPM) is what the drive delivers at the nameplate
 * frequency, and speed is proportional to frequency:
 *   rpm at N Hz = final pump RPM × N / std Hz
 */
export const rpmAtHz = (finalRpm: number, hz: number, stdHz: number): number =>
  stdHz > 0 ? (finalRpm * hz) / stdHz : NaN;

/** Capacity + BKW at one pump speed, at both VE limits. */
function calcAtRpm(specs: RecheckSpecs, rpm: number, headMwc: number): RecheckCalc | null {
  const { qth, voleMax: veMax, voleMin: veMin, mechEff: me } = specs;
  if (
    qth == null ||
    veMax == null ||
    veMin == null ||
    me == null ||
    !Number.isFinite(rpm) ||
    rpm <= 0 ||
    !Number.isFinite(headMwc)
  ) {
    return null;
  }
  const qAtMax = qth * (veMax / 100);
  const qAtMin = qth * (veMin / 100);
  const capAtMax = (qAtMax * rpm) / 100;
  const capAtMin = (qAtMin * rpm) / 100;
  const bkwAtMax = me > 0 ? (capAtMax * headMwc) / 367 / (me / 100) : NaN;
  const bkwAtMin = me > 0 ? (capAtMin * headMwc) / 367 / (me / 100) : NaN;
  return { qAtMax, qAtMin, capAtMax, capAtMin, bkwAtMax, bkwAtMin };
}

/** The VFD range for this form, or null when it is off / not filled in. */
function vfdRange(
  form: RecheckForm,
  specs: RecheckSpecs,
  finalRpm: number,
  headMwc: number,
): RecheckVfdRange | null {
  if (form.vfdRequired !== VFD_YES) return null;
  const stdHz = parseFloat(form.vfdStdHz ?? "");
  const minHz = parseFloat(form.vfdMinHz ?? "");
  const maxHz = parseFloat(form.vfdMaxHz ?? "");
  if (![stdHz, minHz, maxHz].every((v) => Number.isFinite(v) && v > 0)) return null;
  const minRpm = rpmAtHz(finalRpm, minHz, stdHz);
  const maxRpm = rpmAtHz(finalRpm, maxHz, stdHz);
  const midHz = (minHz + maxHz) / 2;
  const midRpm = rpmAtHz(finalRpm, midHz, stdHz);
  return {
    stdHz,
    min: { hz: minHz, rpm: minRpm, calc: calcAtRpm(specs, minRpm, headMwc) },
    mid: { hz: midHz, rpm: midRpm, calc: calcAtRpm(specs, midRpm, headMwc) },
    max: { hz: maxHz, rpm: maxRpm, calc: calcAtRpm(specs, maxRpm, headMwc) },
  };
}

export function computeRecheck(
  form: RecheckForm,
  pumpSpecs: PumpRecommendation | null,
  finalRpmRaw: string,
): RecheckResult {
  const finalRpm = Number(finalRpmRaw);
  const sg = Number(form.sg) || 1;
  const headMwc = form.head ? toMwc(Number(form.head), form.headUnit || "MWC", sg) : NaN;
  const dutyCap = form.capacity
    ? toM3PerHr(Number(form.capacity), form.capacityUnit || "m3/hr", sg)
    : NaN;

  // VE / ME / Qth are read at the head the engineer SELECTED for this model,
  // not the duty-point row — that head's figures are what the recommendation
  // card showed, and what the motor rating and drive screening already use.
  // BKW still uses the entered duty head (headMwc above).
  const selectedPoint =
    (pumpSpecs?.headPoints ?? []).find((p) => String(p.headMwc) === String(form.selectedHead)) ??
    null;
  const specs: RecheckSpecs = {
    qth: selectedPoint ? selectedPoint.qth : pumpSpecs?.qth ?? null,
    voleMin: selectedPoint ? selectedPoint.voleMin : pumpSpecs?.voleMin ?? null,
    voleMax: selectedPoint ? selectedPoint.voleMax : pumpSpecs?.voleMax ?? null,
    mechEff: selectedPoint ? selectedPoint.mechEff : pumpSpecs?.mechEff ?? null,
    atHeadMwc: selectedPoint ? selectedPoint.headMwc : pumpSpecs?.headMwc ?? null,
  };

  const calc = pumpSpecs !== null ? calcAtRpm(specs, finalRpm, headMwc) : null;
  const vfd = calc ? vfdRange(form, specs, finalRpm, headMwc) : null;

  return { finalRpm, headMwc, dutyCap, specs, calc, vfd };
}

export const fmtRecheckNum = (n: number, dp = 2): string =>
  Number.isFinite(n) ? n.toFixed(dp) : "—";

/** One label/value line of the inputs table. */
export interface RecheckInputRow {
  label: string;
  value: string;
  note?: string;
}

/** One line of the results table: the figure at VE max and at VE min. */
export interface RecheckOutputRow {
  label: string;
  hi: number;
  lo: number;
  unit?: string;
  highlight?: boolean;
}

/** One line of the VFD table: the same figure at the min, mid and max of the
 *  Hz range. */
export interface RecheckVfdRow {
  label: string;
  min: string;
  mid: string;
  max: string;
}

export interface RecheckVfdTable {
  minHeading: string;
  midHeading: string;
  maxHeading: string;
  rows: RecheckVfdRow[];
}

export interface RecheckTables {
  inputs: RecheckInputRow[];
  outputs: RecheckOutputRow[];
  /** Column headings for the results table's two value columns. */
  hiHeading: string;
  loHeading: string;
  /** Null unless the motor runs on a VFD with a usable Hz range. */
  vfd: RecheckVfdTable | null;
}

/** Capacity and BKW at the min, mid and max of the VFD range, at both VE
 *  limits. */
function vfdTable(vfd: RecheckVfdRange | null): RecheckVfdTable | null {
  if (!vfd || !vfd.min.calc || !vfd.mid.calc || !vfd.max.calc) return null;
  const minC = vfd.min.calc;
  const midC = vfd.mid.calc;
  const maxC = vfd.max.calc;
  const num = (v: number, unit?: string) => `${fmtRecheckNum(v)}${unit ? ` ${unit}` : ""}`;
  return {
    minHeading: `Min ${fmtRecheckNum(vfd.min.hz, 0)} Hz`,
    // Half-hertz midpoints (e.g. 30–55 -> 42.5) keep their decimal.
    midHeading: `Mid ${fmtRecheckNum(vfd.mid.hz, Number.isInteger(vfd.mid.hz) ? 0 : 1)} Hz`,
    maxHeading: `Max ${fmtRecheckNum(vfd.max.hz, 0)} Hz`,
    rows: [
      {
        label: "Pump RPM",
        min: fmtRecheckNum(vfd.min.rpm, 0),
        mid: fmtRecheckNum(vfd.mid.rpm, 0),
        max: fmtRecheckNum(vfd.max.rpm, 0),
      },
      { label: "Cap at VE max", min: num(minC.capAtMax, "m³/hr"), mid: num(midC.capAtMax, "m³/hr"), max: num(maxC.capAtMax, "m³/hr") },
      { label: "Cap at VE min", min: num(minC.capAtMin, "m³/hr"), mid: num(midC.capAtMin, "m³/hr"), max: num(maxC.capAtMin, "m³/hr") },
      { label: "BKW at VE max", min: num(minC.bkwAtMax, "kW"), mid: num(midC.bkwAtMax, "kW"), max: num(maxC.bkwAtMax, "kW") },
      { label: "BKW at VE min", min: num(minC.bkwAtMin, "kW"), mid: num(midC.bkwAtMin, "kW"), max: num(maxC.bkwAtMin, "kW") },
    ],
  };
}

/** The rows the Recheck popup and the Recheck PDF both show, or null when
 *  there isn't enough data to recompute. */
export function recheckTables(
  form: RecheckForm,
  result: RecheckResult,
  pumpModel: string,
  finalRpmSource: string,
): RecheckTables | null {
  const { calc, specs, finalRpm, headMwc, dutyCap } = result;
  if (!calc) return null;
  const atHeadNote =
    specs.atHeadMwc != null ? `at selected head ${specs.atHeadMwc} MWC` : undefined;
  return {
    inputs: [
      { label: finalRpmSource, value: String(finalRpm) },
      { label: "Pump Model", value: pumpModel },
      {
        label: "Head (duty, used for BKW)",
        value: `${fmtRecheckNum(headMwc, 2)} MWC`,
        note:
          form.headUnit && form.headUnit !== "MWC"
            ? `entered: ${form.head} ${form.headUnit}`
            : "as entered",
      },
      { label: "Duty Capacity (entered)", value: `${fmtRecheckNum(dutyCap, 2)} m³/hr` },
      { label: "VE min / max (%)", value: `${specs.voleMin} / ${specs.voleMax}`, note: atHeadNote },
      { label: "ME (%)", value: String(specs.mechEff), note: atHeadNote },
      { label: "Q th", value: specs.qth != null ? fmtRecheckNum(specs.qth, 2) : "—" },
      {
        label: "VFD",
        value:
          form.vfdRequired === VFD_YES && result.vfd
            ? `Yes — ${fmtRecheckNum(result.vfd.min.hz, 0)} to ${fmtRecheckNum(
                result.vfd.max.hz,
                0,
              )} Hz (std ${fmtRecheckNum(result.vfd.stdHz, 0)} Hz)`
            : form.vfdRequired || "",
      },
    ],
    outputs: [
      { label: "Q", hi: calc.qAtMax, lo: calc.qAtMin },
      {
        label: `Cap at ${finalRpm} rpm (Q × RPM/100)`,
        hi: calc.capAtMax,
        lo: calc.capAtMin,
        unit: "m³/hr",
        highlight: true,
      },
      {
        label: "BKW = Cap × Head / 367 / (ME/100)",
        hi: calc.bkwAtMax,
        lo: calc.bkwAtMin,
        unit: "kW",
      },
    ],
    hiHeading: `VE max (${specs.voleMax}%)`,
    loHeading: `VE min (${specs.voleMin}%)`,
    vfd: vfdTable(result.vfd),
  };
}
