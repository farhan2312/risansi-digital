/**
 * Formatting helpers for the Fluid-Properties inputs that can each be a single
 * value OR a Min–Max range: pH, viscosity, temperature and solid size.
 * Each field carries a `<field>Mode` of "single" | "range" (default/absent =
 * single). When ranged, a second "Max" value is stored alongside the base
 * ("Min") value.
 *
 * These produce the human-readable text used everywhere the value is shown or
 * sent onward — the report summary, the MOC AI prompt, and the PDF — so a
 * range renders as "30–60" rather than just its min. Pure string helpers, no
 * DOM/DB deps, safe to import from client components and server libs alike.
 */

export type FluidMode = "single" | "range";

export interface FluidRangeFields {
  ph?: string;
  phMax?: string;
  phMode?: string;
  viscosity?: string;
  viscosityMax?: string;
  viscosityUnit?: string;
  viscosityMode?: string;
  /** Canonical cP (cP = cSt × SG), min and max. */
  viscosityCp?: string;
  viscosityCpMax?: string;
  temperature?: string; // canonical °C (min/single)
  temperatureMax?: string; // canonical °C (max)
  temperatureRaw?: string; // as-entered (min/single)
  temperatureMaxRaw?: string; // as-entered (max)
  temperatureUnit?: string;
  temperatureMode?: string;
  /** Solid size in mm. The base field is the single value or the range MIN —
   *  the min is what pump screening uses (see findCandidates). */
  solidSize?: string;
  solidSizeMax?: string;
  solidSizeMode?: string;
}

/** "lo–hi" when a range with a distinct hi is set, otherwise "lo" (or "" when
 * no lo). The en-dash matches how the app renders ranges elsewhere. */
export function rangeText(
  lo: string | undefined | null,
  hi: string | undefined | null,
  mode: string | undefined | null,
): string {
  const a = (lo ?? "").trim();
  if (!a) return "";
  if (mode === "range") {
    const b = (hi ?? "").trim();
    if (b && b !== a) return `${a}–${b}`;
  }
  return a;
}

/** Solid size in mm — "10" or "10–25". */
export const solidSizeDisplay = (f: FluidRangeFields): string =>
  rangeText(f.solidSize, f.solidSizeMax, f.solidSizeMode);

/** pH — "6.5" or "4–9". */
export const phDisplay = (f: FluidRangeFields): string =>
  rangeText(f.ph, f.phMax, f.phMode);

/** Canonical viscosity in cP (what the MOC AI prompt wants) — "500" or
 * "500–2000". */
export const viscosityCpDisplay = (f: FluidRangeFields): string =>
  rangeText(f.viscosityCp, f.viscosityCpMax, f.viscosityMode);

/** Viscosity as entered, with its unit — "500 cP" or "500–2000 cP". */
export function viscosityDisplay(f: FluidRangeFields): string {
  const t = rangeText(f.viscosity, f.viscosityMax, f.viscosityMode);
  if (!t) return "";
  return f.viscosityUnit ? `${t} ${f.viscosityUnit}` : t;
}

/** Canonical temperature in °C (what the MOC AI prompt wants) — "45" or
 * "30–60". */
export const temperatureCDisplay = (f: FluidRangeFields): string =>
  rangeText(f.temperature, f.temperatureMax, f.temperatureMode);

/** Temperature as entered, with its unit and (when the unit isn't °C) the
 * canonical °C in parentheses — e.g. "30 °C", "30–60 °C", or "86–140 °F
 * (30–60 °C)". */
export function temperatureDisplay(f: FluidRangeFields): string {
  const rawText = rangeText(f.temperatureRaw, f.temperatureMaxRaw, f.temperatureMode);
  const unit = f.temperatureUnit || "C";
  if (!rawText) {
    const c = temperatureCDisplay(f);
    return c ? `${c} °C` : "";
  }
  const base = `${rawText} °${unit}`;
  if (unit !== "C") {
    const c = temperatureCDisplay(f);
    if (c) return `${base} (${c} °C)`;
  }
  return base;
}
