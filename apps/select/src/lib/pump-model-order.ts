/**
 * Natural ordering for pump model names, used by the Pump Model and Pulley
 * masters. Families come in this order:
 *   Barrel (BarrelH10, BarrelH20L) -> H (H15, H20 … H120) -> 2H -> 4H -> 8H …
 * Within a family, by the size number (H15 before H100, not after), then any
 * suffix ("H60" < "H60L3" < "H60L6").
 */
const MODEL_RE = /^(barrel)?\s*(\d*)\s*h\s*(\d+)(.*)$/i;

function modelKey(model: string): [number, number, string] {
  const m = MODEL_RE.exec(model.trim());
  if (!m) return [Number.MAX_SAFE_INTEGER, 0, model.trim().toUpperCase()];
  const rank = m[1] ? 0 : m[2] ? 1 + parseInt(m[2], 10) : 1;
  return [rank, parseInt(m[3], 10), m[4].trim().toUpperCase()];
}

export function comparePumpModels(a: string, b: string): number {
  const ka = modelKey(a);
  const kb = modelKey(b);
  if (ka[0] !== kb[0]) return ka[0] - kb[0];
  if (ka[1] !== kb[1]) return ka[1] - kb[1];
  if (ka[2] !== kb[2]) return ka[2].localeCompare(kb[2], undefined, { numeric: true });
  return a.localeCompare(b);
}

/** Family label for filtering: "Barrel", "H", "2H", "4H", … or "Other". */
export function pumpModelFamily(model: string): string {
  const m = MODEL_RE.exec(model.trim());
  if (!m) return "Other";
  if (m[1]) return "Barrel";
  return m[2] ? `${m[2]}H` : "H";
}

/** Orders family labels the same way as the models themselves. */
export function comparePumpFamilies(a: string, b: string): number {
  const rank = (f: string) =>
    f === "Barrel" ? 0 : f === "H" ? 1 : f === "Other" ? Number.MAX_SAFE_INTEGER : 1 + parseInt(f, 10);
  return rank(a) - rank(b);
}
