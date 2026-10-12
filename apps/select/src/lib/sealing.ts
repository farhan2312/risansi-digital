/**
 * Short form of the sealing type for compact display on the pump cards:
 * MS (Mechanical Seal) or GP (Gland Packing). Empty string if unset/unknown.
 */
export function sealingShort(sealingType: string | null | undefined): string {
  if (sealingType === "Mechanical Seal") return "MS";
  if (sealingType === "Gland Packing") return "GP";
  return "";
}
