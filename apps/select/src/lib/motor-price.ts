/**
 * Drive price rules: motor mounting uplift (below) and gear-box mounting
 * uplift (end of file).
 *
 * Motor price rules applied on top of motor_master's Final Price.
 *
 * motor_master only holds FOOT (B3) prices. A Flange (B5) or Foot cum Flange
 * (B35) motor is priced from the same row plus a mounting uplift:
 *   up to and including 11 kW -> +3%
 *   above 11 kW               -> +5%
 * The uplift is added to any Non-Standard % (protection / frequency /
 * voltage) and the total is applied once to the Final Price — additive, the
 * same way the Non-Standard percentages already combine.
 */
import { normalizeMounting } from "./motor-mounting";

export const FLANGE_UPLIFT_UPTO_11KW = 3;
export const FLANGE_UPLIFT_ABOVE_11KW = 5;

/** True for Flange (B5) and Foot cum Flange (B35); false for Foot (B3) or blank. */
export function isFlangeMounting(mounting: string | null | undefined): boolean {
  return !!mounting && normalizeMounting(mounting).includes("FLANGE");
}

/** Mounting uplift % for a motor of this rating; 0 for foot-mounted. */
export function mountingUpliftPct(mounting: string | null | undefined, kw: string | number | null | undefined): number {
  if (!isFlangeMounting(mounting)) return 0;
  const k = typeof kw === "number" ? kw : parseFloat(String(kw ?? ""));
  if (Number.isNaN(k)) return 0;
  return k <= 11 ? FLANGE_UPLIFT_UPTO_11KW : FLANGE_UPLIFT_ABOVE_11KW;
}

/**
 * Label for the uplifted-price row in summaries, or null when no uplift
 * applies (a Standard foot-mounted motor — the row would just repeat Final
 * Price).
 */
export function upliftedPriceLabel(f: {
  driveStdNonStd?: string | null;
  driveMotorMounting?: string | null;
  driveMotorKw?: string | number | null;
}): string | null {
  const mountPct = mountingUpliftPct(f.driveMotorMounting, f.driveMotorKw);
  if (f.driveStdNonStd === "Non-Standard") {
    return mountPct ? `Final Non-Standard Price (incl. +${mountPct}% flange)` : "Final Non-Standard Price";
  }
  return mountPct ? `Final Price (+${mountPct}% flange)` : null;
}

// --- Gear box ---------------------------------------------------------------
// The gearbox masters' Rate per Nos. is the foot-mounted (B3) price. A gear box
// converted to Flange Mount (B5) costs 5% more. Foot cum Flange (B35) is not
// covered by the rule and keeps the master rate. The stored gearboxRatePerNos
// stays the master rate; the flange price is derived wherever it is shown.
export const GEARBOX_FLANGE_UPLIFT = 5;

/** Gear-box mounting uplift %: 5 for Flange Mount B5, else 0. */
export function gearboxMountingUpliftPct(mounting: string | null | undefined): number {
  if (!mounting) return 0;
  const m = normalizeMounting(mounting);
  return m.includes("FLANGE") && !m.includes("FOOT") ? GEARBOX_FLANGE_UPLIFT : 0;
}

/** Rate after the mounting uplift, rounded to paise; null if the rate is blank. */
export function gearboxUpliftedRate(
  rate: string | number | null | undefined,
  mounting: string | null | undefined,
): number | null {
  const r = typeof rate === "number" ? rate : parseFloat(String(rate ?? ""));
  if (Number.isNaN(r)) return null;
  return Math.round(r * (1 + gearboxMountingUpliftPct(mounting) / 100) * 100) / 100;
}

/** Summary rows for the gearbox rate: the master rate, plus the flange price
 *  when the uplift applies. */
export function gearboxRateItems(f: {
  gearboxRatePerNos?: string | null;
  gearBoxMounting?: string | null;
}): [string, string][] {
  const rate = f.gearboxRatePerNos ?? "";
  const pctUp = gearboxMountingUpliftPct(f.gearBoxMounting);
  const up = gearboxUpliftedRate(rate, f.gearBoxMounting);
  if (!pctUp || up === null) return [["Gearbox Rate", rate]];
  return [
    ["Gearbox Rate", rate],
    [`Gearbox Rate (+${pctUp}% flange)`, String(up)],
  ];
}
