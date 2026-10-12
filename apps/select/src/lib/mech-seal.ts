/**
 * Mechanical seal type descriptions. Lives in lib (not the Sealing step) so
 * server code — the approval popup and emails — can read it without pulling
 * in a client component.
 */

// Derived from the seal type rather than stored, so the Sealing step, the
// Summary step, the PDF and the approval popup all resolve it through
// mechSealDescription() instead of reading a persisted column.
export const MECH_SEAL_DESCRIPTIONS: Record<string, string> = {
  MSA: "Single Balanced Mechanical Seal with Seal cover, external water quenched.",
  // Plain ASCII punctuation on purpose: these descriptions flow into the
  // Summary step and the generated PDF, and the PDF's standard fonts are
  // normalised to Latin-1 elsewhere in the app (see UNICODE_REPLACEMENTS in
  // moc-pdf-report.ts) - a hyphen renders identically everywhere.
  MSK: "Single Unbalanced spring-loaded O-ring, internally mounted, cooled by liquid - no external water quench.",
  SCG: "Single cartridge Mechanical Seal, internal quenched & flush (water + liquid).",
  DCG: "Double cartridge Mechanical Seal, internal quenched & flush (water + liquid).",
};

/** Description for a Mechanical Seal type, or "" when none applies (no type
 * chosen, or the sealing arrangement is Gland Packing). */
export function mechSealDescription(sealingSubType: string | undefined | null): string {
  if (!sealingSubType) return "";
  return MECH_SEAL_DESCRIPTIONS[sealingSubType] ?? "";
}
