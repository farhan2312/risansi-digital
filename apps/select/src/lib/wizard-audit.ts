/**
 * Decides whether a wizard step save is worth an audit entry, and says what
 * changed in words a person can read.
 *
 * Every step is re-saved on each Next / Previous (and General Information on
 * every navigation, since it carries the progress marker), so logging every
 * save filled the trail with "Saved …" entries for steps nobody touched. A
 * save is now audited only when a field the user controls actually moved, and
 * the entry lists those fields with their old and new values.
 *
 * Pure functions, no DB access — the route reads the stored row and passes it
 * in. That also keeps them directly testable.
 */

export type FieldChange = { key: string; from: string; to: string };

/**
 * Never counted as a change.
 *
 *  - progress bookkeeping, not user input;
 *  - values DERIVED from other fields, which would otherwise be listed twice
 *    (editing viscosity also recomputes its cP value; editing a temperature
 *    also recomputes the canonical °C). The field the user typed is the one
 *    reported;
 *  - upload metadata that always moves together with the file name.
 */
const IGNORED_FIELDS = new Set([
  "wizardStep",
  "wizardMaxStep",
  "viscosityCp",
  "viscosityCpMax",
  "temperature",
  "temperatureMax",
  "clientRequirementsMime",
]);

/**
 * Counted, but reported by name only — never "old → new". These are long AI
 * texts (a before/after of several paragraphs would bury the entry) and
 * timestamps (the instant itself says nothing useful).
 */
const NAME_ONLY_FIELDS: Record<string, string> = {
  mocAiSuggestedSummary: "AI summary regenerated",
  mocAiSuggestedAlternatives: "AI alternatives regenerated",
  mocAiSuggestedSealRationale: "AI seal rationale regenerated",
  mocAiGeneratedAt: "AI suggestion regenerated",
  clientRequirementsUploadedAt: "Client requirements re-uploaded",
  headCalc: "Head calculator updated",
};

/** Labels where the generated one would read badly. Everything else is
 *  derived from the field name by humanize(). */
const LABELS: Record<string, string> = {
  // General Information
  sg: "SG",
  rpmRange: "RPM range",
  selectedModel: "Pump model",
  selectedHead: "Selected head",
  // Pump Model & Qty
  productCode: "Pump model (product code)",
  modelConfirmed: "Model confirmed",
  // Fluid Properties
  ph: "pH",
  phMax: "pH max",
  phMode: "pH single/range",
  viscosityMode: "Viscosity single/range",
  temperatureRaw: "Temperature",
  temperatureMaxRaw: "Temperature max",
  temperatureMode: "Temperature single/range",
  solidPercentage: "Solids %",
  sizeRemarks: "Suction / discharge size remarks",
  solidSizeMode: "Solid size single/range",
  // Specifications
  agBk: "AG / BK",
  agBkRemarks: "AG / BK remarks",
  bearingHousing: "Pump support & drive arrangement",
  // MOC & Sealing
  clientRequirementsFilename: "Client requirements file",
  mocAiProvider: "AI provider",
  mechSealMoc: "Mechanical seal MOC",
  mechSealFace: "Mechanical seal face",
  mechSealMake: "Mechanical seal make",
  // Motor & Drive
  driveMotorKw: "Motor rating (kW)",
  driveMotorKwRemarks: "Motor rating remarks",
  motorRPM: "Motor RPM",
  driveStdNonStd: "Standard / non-standard",
  driveMotorProtectionPct: "Protection uplift %",
  driveMotorFrequencyPct: "Frequency uplift %",
  driveMotorVoltagePct: "Voltage uplift %",
  driveMotorLpPrice: "Motor LP price",
  driveMotorFinalPrice: "Motor final price",
  driveMotorPriceUplifted: "Motor uplifted price",
  driveMotorConfirmed: "Motor confirmed",
  // V-Belt
  driveVbeltGroove: "V-belt groove",
  driveVbeltRpm: "V-belt RPM",
  driveVbeltNo: "No. of V-belts",
  vbeltConfirmed: "V-belt confirmed",
  vbeltRpmManual: "V-belt RPM entered manually",
  // Geared
  gbConstructionType: "Gearbox construction",
  asfRange: "ASF range",
  gearboxConfirmed: "Gearbox confirmed",
  gearboxRpmManual: "Gearbox RPM entered manually",
};

/** Tokens that should keep their capitalisation once camelCase is split. */
const ACRONYMS: Record<string, string> = {
  rpm: "RPM",
  kw: "kW",
  moc: "MOC",
  ai: "AI",
  sg: "SG",
  lp: "LP",
  asf: "ASF",
  gb: "GB",
  ph: "pH",
};

/**
 * camelCase field -> readable label.
 *   mocAiPumpHousing          -> "Pump housing MOC"
 *   mocAiPumpHousingRemarks   -> "Pump housing MOC remarks"
 *   mocAiSuggestedShaft       -> "AI suggested shaft"
 *   driveMotorMake            -> "Motor make"
 *   gearboxOutputRpm          -> "Gearbox output RPM"
 */
function humanize(key: string): string {
  const words = (s: string) =>
    s
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      .split(/\s+/)
      .filter(Boolean)
      .map((w) => ACRONYMS[w.toLowerCase()] ?? w.toLowerCase());
  const sentence = (ws: string[]) => {
    const s = ws.join(" ");
    return s.charAt(0).toUpperCase() + s.slice(1);
  };

  if (key.startsWith("mocAiSuggested")) {
    return sentence(["AI", "suggested", ...words(key.slice("mocAiSuggested".length))]);
  }
  if (key.startsWith("mocAi")) {
    // The manual MOC pick for a component: "<component> MOC [remarks]".
    const rest = key.slice("mocAi".length);
    const isRemarks = rest.endsWith("Remarks");
    const component = words(isRemarks ? rest.slice(0, -"Remarks".length) : rest);
    return sentence([...component, "MOC", ...(isRemarks ? ["remarks"] : [])]);
  }
  // "drive" is the table's namespace, not part of what the user sees.
  const body = /^drive[A-Z]/.test(key) ? key.slice("drive".length) : key;
  return sentence(words(body));
}

export const fieldLabel = (key: string): string => LABELS[key] ?? humanize(key);

/** As the user sees it: blank / null / undefined are all "not set"; booleans
 *  read yes/no; dates compare by instant. */
function normalize(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "boolean") return v ? "yes" : "no";
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? "" : v.toISOString();
  // Sorted keys: a jsonb column hands keys back in its own order, which must
  // not read as an edit.
  if (typeof v === "object") return stableJson(v);
  return String(v).trim();
}

function stableJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableJson).join(",")}]`;
  if (v && typeof v === "object")
    return `{${Object.keys(v as object)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableJson((v as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  return JSON.stringify(v) ?? "";
}

const NUMERIC = /^-?\d+(\.\d+)?$/;

/** "33730.8" and "33730.80" are the same price, not an edit. Only applies
 *  when BOTH sides are plain numbers, so codes and text compare exactly. */
function sameValue(a: string, b: string): boolean {
  if (a === b) return true;
  return NUMERIC.test(a) && NUMERIC.test(b) && Number(a) === Number(b);
}

/**
 * Fields in this save whose value differs from what was stored.
 *
 * Only keys the request actually SENT are compared, so a partial save (just
 * the pump pick, just the progress marker) is judged on exactly what it
 * touched. With no stored row yet, every non-blank value sent is new.
 */
export function changedFields(
  previous: Record<string, unknown> | undefined,
  incoming: Record<string, unknown>,
): FieldChange[] {
  const out: FieldChange[] = [];
  for (const [key, value] of Object.entries(incoming)) {
    if (IGNORED_FIELDS.has(key)) continue;
    const from = normalize(previous?.[key]);
    const to = normalize(value);
    if (!sameValue(from, to)) out.push({ key, from, to });
  }
  return out;
}

/** Keep one value from swamping the entry (remarks, file names). */
const clip = (s: string, max = 40): string => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

/**
 * "Capacity 20 → 25, Head unit MWC → MLC" — what actually changed. Batches
 * longer than a handful (typically the first fill of a step) are summarised
 * with "+N more" so the entry stays one readable line.
 */
export function describeChanges(changes: FieldChange[], max = 4): string {
  const shown = changes.slice(0, max).map(({ key, from, to }) => {
    if (key in NAME_ONLY_FIELDS) return NAME_ONLY_FIELDS[key];
    const label = fieldLabel(key);
    if (!to) return `${label} cleared`;
    return from ? `${label} ${clip(from)} → ${clip(to)}` : `${label} ${clip(to)}`;
  });
  const more = changes.length > max ? `, +${changes.length - max} more` : "";
  return shown.join(", ") + more;
}
