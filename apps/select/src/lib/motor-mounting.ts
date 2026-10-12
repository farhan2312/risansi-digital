/**
 * Matching a wizard mounting selection against motor_master.mounting.
 *
 * The wizard's values are labels carrying an IEC code — "Foot B3",
 * "Flange B5", "Foot cum Flange B35" — while the master stores the
 * descriptive part on its own ("FOOT"). The two have to be reconciled, and
 * the FULL descriptive text matters: "Foot cum Flange" is its own mounting,
 * not a variant of "Foot". Matching on the first word alone made a B35
 * selection silently return plain foot-mounted motors.
 */

/** Upper-case, punctuation dropped, whitespace collapsed — so "Foot-cum-Flange"
 * and "FOOT CUM  FLANGE" compare equal. */
export function normalizeMounting(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim();
}

/** Splits a mounting label into the descriptive text the master stores and its
 * trailing IEC code, so a row matching either is accepted:
 *   "Foot B3"             -> { text: "FOOT",            code: "B3"  }
 *   "Foot cum Flange B35" -> { text: "FOOT CUM FLANGE", code: "B35" }
 * A label with no code (or a bare "B35") degrades to a plain text match. */
export function mountingMatchTerms(label: string): { text: string; code: string | null } {
  const norm = normalizeMounting(label);
  const m = norm.match(/^(.*?)\s*(B\d{1,2})$/);
  if (m && m[1].trim()) return { text: m[1].trim(), code: m[2] };
  return { text: norm, code: null };
}
