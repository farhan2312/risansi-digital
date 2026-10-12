import apiClient from "./apiClient";

// Master option lists for the per-component MOC panel's manual dropdowns —
// mirrors src/lib/moc-ai-suggestion.ts (server-side, can't be imported into
// a client component since that file has no "use client"/DB dependency
// concerns but keeping the lists independently defined avoids ever needing
// to import a server-only module from client code).
export const MOC_AI_MATERIALS = [
  "CI IS210 FG 260",
  "Mild Steel",
  "SS304",
  "SS316",
  "SS316L",
  "SDSS 2507",
  "DSS 2505",
  "Hastelloy",
  "Ni-Hard CI",
  "SS410",
  "Others"
] as const;

/** Rotor and Shaft only: the standard list plus Tool Steel (before "Others"). */
export const ROTOR_SHAFT_MATERIALS = [
  ...MOC_AI_MATERIALS.filter((m) => m !== "Others"),
  "Tool Steel",
  "Others",
] as const;

export const MOC_AI_ELASTOMERS = [
  "Nitrile",
  "FG Nitrile",
  "White Nitrile",
  "Natural",
  "Hypalon",
  "EPDM",
  "Viton",
  "Others"
] as const;

// Mirrors src/lib/moc-ai-suggestion.ts's MOC_AI_PROVIDERS — kept as an
// independent client-side literal for the same reason MOC_AI_MATERIALS is
// (that file has server-only concerns and can't be imported into a client
// component). Gemini was removed; Anthropic is the only provider now.
export const MOC_AI_PROVIDERS = [
  { value: "anthropic", label: "Claude Haiku 4.5" },
] as const;
export type MocAiProvider = (typeof MOC_AI_PROVIDERS)[number]["value"];

export interface MocComponentSuggestions {
  bearingHousing: string;
  /** Horizontal pump types. */
  basePlate: string;
  /** Vertical pump types - a different component, not a renamed base plate. */
  mountingPlate: string;
  tieRod: string;
  nutBolt: string;
  pumpHousing: string;
  rotor: string;
  shaft: string;
  statorRubber: string;
  /** Stator sleeve - wetted on Vertical pumps, structural on Horizontal. */
  statorSleeve: string;
  sealRecommendation: string;
  /** MOC of the recommended seal - mechanical seal body/face/O-ring, or the
   * gland packing material. */
  sealMoc: string;
  /** Short (1-2 sentence) reason for the seal pick specifically. */
  sealRationale: string;
  /** Detailed multi-paragraph engineering report — rendered in the Summary
   * panel and exported to PDF. */
  summary: string;
  /** 1-3 alternative material/elastomer combinations with trade-off notes. */
  alternatives: string;
}

/** Why the AI path produced no suggestion: "not_configured" = no usable API
 * key; "failed" = key present but the upstream call errored or was blocked.
 * The UI maps these to different messages. */
export type MocAiUnavailable = { unavailable: "not_configured" | "failed" };

/** Advisory AI-generated per-component MOC/elastomer/sealing suggestion (not
 * a verified spec) — scoped to whatever process data the wizard has
 * collected so far. Resolves to the suggestion on success, or a
 * `{ unavailable }` reason otherwise (distinguish with `"unavailable" in x`).
 * Only throws on a genuine transport/HTTP error (axios), which the caller
 * treats as a failed request. Uses Anthropic (Claude Haiku) server-side. */
export const getMocAiSuggestion = async (input: {
  media: string;
  /** Operating-Conditions pump type - decides the stator sleeve wetted status. */
  pumpType?: string;
  /** Pump Support and Drive Arrangement from the Specifications step. */
  pumpSupport?: string;
  head?: string;
  headUnit?: string;
  ph?: string;
  temperatureC?: string;
  viscosityCp?: string;
  sg?: string;
  capacity?: string;
  capacityUnit?: string;
  solidPct?: string;
  solidSize?: string;
  solidType?: string;
  /** Legacy free-text client requirements (kept for old drafts saved before
   * the field became a file upload). */
  clientRequirements?: string;
  /** Project id, used by the server to fetch any uploaded client-
   * requirements file (image or PDF) and attach it to the model call. */
  projectId?: string;
  /** Tag id. Preferred over projectId; server falls back to the project's
   * Default tag when only projectId is supplied. */
  tagId?: string;
  /** Which LLM to use — defaults server-side to "anthropic" if omitted. */
  provider?: MocAiProvider;
}): Promise<MocComponentSuggestions | MocAiUnavailable> => {
  const { data } = await apiClient.post<MocComponentSuggestions | MocAiUnavailable>(
    "/moc-recommendation/ai-suggest",
    input
  );
  return data;
};
