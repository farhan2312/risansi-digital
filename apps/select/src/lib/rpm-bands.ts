/**
 * The RPM bands the wizard screens on — ONE definition, shared by the General
 * Information dropdown, the model-screening filter in /api/recommendations and
 * the report labels, so those three can't drift apart.
 *
 * Kept in its own module (no DB/drizzle imports, same as fluid-inputs.ts) so
 * client components can pull the labels in without dragging the recommendation
 * engine and the whole schema into the browser bundle.
 */

/**
 * Boundaries are as the bands have always behaved: vlow/low are upper-
 * EXCLUSIVE (200 rpm is Medium, not Low), while medium/high are upper-
 * INCLUSIVE (320 is Medium; 400 is High). `rpmBandFor` takes the first
 * matching band, so a shared endpoint resolves to the lower band.
 */
export const RPM_BANDS = [
  { key: "vlow", label: "Very Low (0–50)", min: 0, max: 50, maxInclusive: false },
  { key: "low", label: "Low (50–200)", min: 50, max: 200, maxInclusive: false },
  { key: "medium", label: "Medium (200–320)", min: 200, max: 320, maxInclusive: true },
  { key: "high", label: "High (320–400)", min: 320, max: 400, maxInclusive: true },
  { key: "vhigh", label: "Very High (> 400)", min: 400, max: Infinity, maxInclusive: true },
] as const;

export type RpmBand = (typeof RPM_BANDS)[number];
export type RpmBandKey = RpmBand["key"];

/** The band for a stored `rpmRange` key, or null when nothing is selected. */
export const rpmBandByKey = (key: string): RpmBand | null =>
  RPM_BANDS.find((b) => b.key === key) ?? null;

/** The band ONE rpm value falls in. */
export function rpmBandFor(rpm: number): RpmBand {
  return (
    RPM_BANDS.find((b) => rpm < b.max || (b.maxInclusive && rpm === b.max)) ??
    RPM_BANDS[RPM_BANDS.length - 1]
  );
}

/**
 * Does a pump's achievable RPM WINDOW reach into this band?
 *
 * A pump whose window is 158–500 can be driven at 250 rpm, so it genuinely
 * satisfies a "Medium (200–320)" requirement even though neither endpoint sits
 * in that band. Screening therefore tests the window against the band rather
 * than classifying a single endpoint, which used to hide such models.
 */
export function rpmBandOverlaps(band: RpmBand, lo: number, hi: number): boolean {
  const [windowLo, windowHi] = lo <= hi ? [lo, hi] : [hi, lo];
  // The band's top follows its own rule: exclusive for vlow/low (a window
  // sitting exactly at 200 is Medium, not Low), inclusive for the rest.
  const reachesTop = band.maxInclusive ? windowLo <= band.max : windowLo < band.max;
  return reachesTop && windowHi >= band.min;
}

/** Human label for one rpm value (e.g. the per-VOLE-end class on a card). */
export function classifyRpm(rpm: number): string {
  return rpmBandFor(rpm).label;
}
