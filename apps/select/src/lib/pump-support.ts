/**
 * Pump Support and Drive Arrangement — how the wet end is carried and coupled
 * to the drive. Chosen on the Specifications step; the MOC step then names its
 * drive-end component to match, since only one of the two ever exists on a
 * given pump.
 *
 * Stored on `formData.bearingHousing` / `operating_conditions_input
 * .bearing_housing`. The column and field keep their original names so no
 * saved enquiry has to be migrated — only what the user sees changed.
 *
 * No DB imports, so client components can use this freely.
 */

export const BEARING_HOUSING = "Bearing Housing";
export const CLOSE_COUPLED = "Close Coupled";

/** The options offered on the Specifications step, in order. */
export const PUMP_SUPPORT_OPTIONS = [BEARING_HOUSING, CLOSE_COUPLED] as const;

export type PumpSupport = (typeof PUMP_SUPPORT_OPTIONS)[number];

/** Label for the field itself, used on the Specifications step. */
export const PUMP_SUPPORT_LABEL = "Pump Support and Drive Arrangement";

/**
 * What the MOC step calls its drive-end component for a given arrangement.
 *
 * A close-coupled pump has no bearing housing — it bolts straight to the motor
 * flange — so calling that row "Bearing Housing" would name a part the pump
 * doesn't have. Falls back to "Bearing Housing" while nothing is selected yet,
 * which is what the row was called before the arrangement existed.
 */
export function pumpSupportComponentName(arrangement: string | undefined | null): string {
  return (arrangement ?? "").trim() === CLOSE_COUPLED ? CLOSE_COUPLED : BEARING_HOUSING;
}
