/**
 * Motor rating-plate units. Frequency is always Hz and voltage always V, so
 * the wizard stores the bare number and the unit is added wherever the value
 * is shown (Selection Summary, PDF, approval popup).
 *
 * Older rows were free text and carry their own unit ("50 Hz", "50HZ",
 * "415 V "), so the unit is stripped before it is re-appended — never doubled.
 */

/** "50" -> "50 Hz". Empty in, empty out. */
export function withRatingUnit(value: string | undefined | null, unit: string): string {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) return "";
  const bare = trimmed.replace(new RegExp(`\\s*${unit}\\s*$`, "i"), "").trim();
  return bare ? `${bare} ${unit}` : "";
}

export const frequencyText = (value: string | undefined | null): string =>
  withRatingUnit(value, "Hz");

export const voltageText = (value: string | undefined | null): string =>
  withRatingUnit(value, "V");

/** The bare number to store/show in a numeric input, dropping any unit text a
 *  legacy row carries. */
export const ratingPlateNumber = (value: string | undefined | null): string =>
  String(value ?? "")
    .replace(/[^0-9.]/g, "")
    .trim();
