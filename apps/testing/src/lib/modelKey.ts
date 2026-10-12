/**
 * Shared pump-model matching helpers — used by the Report Archive grouping,
 * the per-pump dashboard (client and API route), and anywhere else that
 * needs to treat "2H-100" / "2h -100" / "2H100" as the same physical pump.
 */

// Same physical model gets typed with inconsistent spacing/punctuation as
// well as casing -- strip everything but letters/digits so those all match.
export const normalizeModelKey = (model: string) => model.toUpperCase().replace(/[^A-Z0-9]/g, "");

// Display label for a set of records sharing a model: whichever raw
// formatting was used most often (ties broken alphabetically), so the UI
// shows a real formatting someone actually typed rather than an invented
// one. Hyphens are stripped regardless, matching the app's no-hyphen
// convention for models entered going forward.
export const modelDisplayLabel = (records: { model: string }[]): string => {
  const counts = new Map<string, number>();
  for (const r of records) counts.set(r.model, (counts.get(r.model) ?? 0) + 1);
  const [mostCommon] = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return mostCommon[0].replace(/-/g, "");
};
