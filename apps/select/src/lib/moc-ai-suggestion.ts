
import { pumpSupportComponentName } from "./pump-support";

export const MOC_AI_MATERIALS = [
  "CI IS210 FG 260",
  "Mild Steel",
  "SS410",
  "SS304",
  "SS316",
  "SS316L",
  "SDSS 2507",
  "DSS 2505",
  "Hastelloy",
  "Ni-Hard CI",
] as const;

export const MOC_AI_ELASTOMERS = [
  "Nitrile",
  "FG Nitrile",
  "White Nitrile",
  "Natural",
  "Hypalon",
  "EPDM",
  "Viton",
] as const;

export const MOC_AI_SEAL_TYPES = ["Gland Packing", "Mechanical Seal"] as const;


export const MOC_AI_PROVIDERS = ["anthropic"] as const;
export type MocAiProvider = (typeof MOC_AI_PROVIDERS)[number];

export interface MocAiContext {
  media: string;

  pumpType: string | null;

  pumpSupport: string | null;
  head: string | null;
  headUnit: string | null;
  capacity: string | null;
  capacityUnit: string | null;
  ph: string | null;
  temperatureC: string | null;
  viscosityCp: string | null;
  sg: string | null;
  solidPct: string | null;
  solidSize: string | null;
  solidType: string | null;

  clientRequirements: string | null;

  clientRequirementsFile: { mediaType: string; base64: string } | null;
}

export interface MocComponentSuggestions {
  // Non-wettable components
  bearingHousing: string;

  basePlate: string;
  /** Vertical pump types only. */
  mountingPlate: string;
  tieRod: string;
  nutBolt: string;
  // Wettable casting components
  pumpHousing: string;
  rotor: string;
  shaft: string;
  // Elastomer
  statorRubber: string;
  // Stator sleeve (wetted on Vertical pumps, structural on Horizontal)
  statorSleeve: string;
  // Sealing
  sealRecommendation: string;

  sealMoc: string;
  sealRationale: string;

  summary: string;
  alternatives: string;
}


const BASE_REQUIRED_FIELDS: (keyof MocComponentSuggestions)[] = [
  "bearingHousing", "tieRod", "nutBolt",
  "pumpHousing", "rotor", "shaft", "statorRubber", "statorSleeve",
  "sealRecommendation", "sealMoc", "sealRationale", "summary", "alternatives",
];


function activePlateField(pumpType: string | null): "mountingPlate" | "basePlate" {
  return pumpType === "Vertical" ? "mountingPlate" : "basePlate";
}

function requiredFieldsFor(pumpType: string | null): (keyof MocComponentSuggestions)[] {
  return [...BASE_REQUIRED_FIELDS, activePlateField(pumpType)];
}


const WETTED =
  "WETTED - in direct contact with the pumped media. Material must resist the media (corrosion/abrasion) at the stated pH, temperature and solids.";
const DRY =
  "NON-WETTED structural part - no media contact. Choose for strength and cost; media resistance does not apply, so do not over-specify an expensive alloy here.";

// Per-component choices - the same lists as the MOC step's dropdowns
// (services/mocRecommendationService.ts; keep the two in step). The AI picks
// from these so its answer lands on a dropdown entry; anything else shows as
// "Others" with the text typed in.
const SS_GRADES = ["SS304", "SS316", "SS316L"];
/** Cast iron and mild steel are never a shaft or rotor material. */
const SHAFT_ROTOR_BASE = MOC_AI_MATERIALS.filter((m) => m !== "CI IS210 FG 260" && m !== "Mild Steel");
const MOC_COMPONENT_OPTIONS = {
  bearingHousing: ["CI IS210 FG 260"],
  plate: ["Mild Steel", ...SS_GRADES],
  fastener: ["Mild Steel", ...SS_GRADES],
  statorSleeve: ["Mild Steel", ...SS_GRADES],
  pumpHousing: [...MOC_AI_MATERIALS],
  shaft: [...SHAFT_ROTOR_BASE.map((m) => (m === "SS410" ? "SS410 HT" : m)), "Tool Steel"],
  rotor: [...SHAFT_ROTOR_BASE.map((m) => (m === "SS410" ? "SS410 HT HCP" : m)), "Tool Steel"],
};
const choose = (status: string, options: string[], note = "") =>
  `${status} Choose one of: ${options.join(", ")}.${note} Another material only if the media truly requires it - then say why.`;


// Material rules (sent as the system prompt). Without them "cost optimised"
// always won: 60 of the first 108 answers, across 41 different media (a pH-3
// acid and sodium hydrosulphite among them), were CI / SS410 / Nitrile. The
// cheap build is stated WITH the conditions it needs, and the ways out of it by
// chemistry. Update here when the house rules change.
const MOC_RULES_PROMPT =
  "You are a senior materials engineer for progressive cavity (PCP) pumps. Choose, per component, the LOWEST-COST material that is RELIABLE for the media's chemistry. " +
  "Never trade corrosion resistance for cost on a wetted part; never over-alloy a dry structural part. Judge every enquiry on its own chemistry - do not fall back to a common answer because it is common.\n\n" +
  "First assess the media (the mediaAssessment field): what the liquid is (the media field is sometimes a duty name such as 'Sludge Recycle' - infer the liquid and say it is an assumption), pH, chlorides or salts, oxidisers, reducing or sulphur compounds, oils or solvents, abrasive solids, temperature, food or hygienic duty. Where a value is missing, assume a typical one for that media.\n\n" +
  "The economical build - CI IS210 FG 260 pump housing, SS410 HT shaft, SS410 HT HCP rotor, Nitrile stator - is right ONLY when ALL hold: pH about 6-9; no significant chlorides, brine or sea water; no oxidisers; not food, beverage, dairy, pharma or potable duty; temperature within Nitrile's range (about 90 C); and the media is a neutral water-based sludge/slurry, sewage, an oil, or a molasses/sugar-type liquid.\n" +
  "When a condition fails, move away from it (judge concentration and temperature):\n" +
  "- Acidic, pH below about 6: CI and SS410 corrode - SS316/SS316L wetted parts; strong or hot acid, or acid with chlorides -> Duplex / Super Duplex or Hastelloy.\n" +
  "- Alkaline or caustic, pH above about 10: SS304/SS316 wetted parts; EPDM stator.\n" +
  "- Chlorides, brine, sea or produced water: SS316L minimum; high chloride or hot -> Duplex / Super Duplex.\n" +
  "- Oxidisers (hypochlorite, peroxide, nitric, chlorine, ozone): SS316L only if dilute and cold, otherwise Super Duplex or Hastelloy; Viton or EPDM stator - not Nitrile or Natural.\n" +
  "- Reducing or sulphur salts (hydrosulphite, dithionite, sulphides, bisulphite): corrosive to CI and SS410 - SS316/SS316L wetted parts.\n" +
  "- Oils, fuels, hydrocarbons: CI is fine; Nitrile stator; aromatics, solvents or hot oil -> Viton. Never EPDM with oils.\n" +
  "- Food, beverage, dairy, pharma, potable: SS316L (or SS304) wetted parts; food-grade elastomer (FG Nitrile, White Nitrile or food-grade EPDM).\n" +
  "- Abrasive solids: hardened / hard-chrome rotor; Natural rubber or abrasion-grade Nitrile within temperature; Ni-Hard CI for very abrasive duty.\n" +
  "- Stator elastomer temperature limits (approx.): Natural 70 C, Nitrile 90 C, EPDM 120 C, Viton higher.\n" +
  "When several apply, the most demanding one governs. Explain the deciding reasons in the summary's Key Design Drivers.";

const HORIZONTAL_WETTABLE_COMP = ["Pump Housing", "Rotor", "Shaft"];
const horizontalNonWettableComp = (driveEnd: string) => [
  driveEnd,
  "Base Plate",
  "Tie Rod",
  "Nut & Bolt",
  "Stator Sleeve",
];

const VERTICAL_WETTABLE_COMP = [
  "Pump Housing",
  "Rotor",
  "Shaft",
  "Stator Sleeve",
  "Tie Rod",
  "Nut & Bolt",
];
const verticalNonWettableComp = (driveEnd: string) => [driveEnd, "Mounting Plate"];





function schemaPropertiesFor(pumpType: string | null, pumpSupport: string | null = null) {
  const vertical = pumpType === "Vertical";
 
  const plateField = activePlateField(pumpType);
  // Tie rods and fasteners sit in the media on a VERTICAL pump (see the
  // groups in buildPrompt), so their status follows the pump type.
  const fastenerStatus = vertical ? WETTED : DRY;
  // In the liquid (vertical) an SS grade comes first and Mild Steel is the
  // exception; dry (horizontal) the other way round.
  const structural = vertical ? [...SS_GRADES, "Mild Steel"] : ["Mild Steel", ...SS_GRADES];
  const wettedMsNote = vertical ? " Mild Steel only if the media is non-corrosive (neutral water-based, no chlorides or oxidisers)." : "";
  const fastenerNote = " It may also follow the pump housing's MOC - then write that material itself." + wettedMsNote;
  return {
    // FIRST on purpose: the AI works out the chemistry before choosing any
    // material, so the picks follow from it. Not shown or saved.
    mediaAssessment: {
      type: "string",
      description:
        "Write this FIRST. 3-6 short lines: what the liquid is (say if assumed from a duty name), pH, chlorides/salts, oxidisers, reducing/sulphur compounds, oils/solvents, abrasive solids, temperature, food/hygienic - and which of the material rules these trigger. Then choose every material from it.",
    },
    bearingHousing: {
      type: "string",
      description: `${choose(DRY, MOC_COMPONENT_OPTIONS.bearingHousing)} This is the ${pumpSupportComponentName(pumpSupport)}.`,
    },
    [plateField]: { type: "string", description: choose(DRY, MOC_COMPONENT_OPTIONS.plate) },
    tieRod: { type: "string", description: choose(fastenerStatus, structural, fastenerNote) },
    nutBolt: { type: "string", description: choose(fastenerStatus, structural, fastenerNote) },
    pumpHousing: { type: "string", description: choose(WETTED, MOC_COMPONENT_OPTIONS.pumpHousing) },
    rotor: {
      type: "string",
      description: choose(WETTED, MOC_COMPONENT_OPTIONS.rotor, " SS410 HT HCP = SS410 heat treated, hard-chrome plated."),
    },
    shaft: {
      type: "string",
      description: choose(WETTED, MOC_COMPONENT_OPTIONS.shaft, " SS410 HT = SS410 heat treated."),
    },
    statorRubber: {
      type: "string",
    
      description:
        "Stator elastomer. " + WETTED +
        " Answer an elastomer, not a metal. Preferred (not mandatory): " +
        MOC_AI_ELASTOMERS.join(", ") +
        " - another elastomer is fine when the media calls for it; say so explicitly.",
    },
    statorSleeve: {
      type: "string",
      description: vertical
        ? "On this VERTICAL pump the stator sleeve is " + choose(WETTED, structural, wettedMsNote)
        : "On this HORIZONTAL pump the stator sleeve is " + choose(DRY, MOC_COMPONENT_OPTIONS.statorSleeve),
    },
    sealRecommendation: { type: "string", enum: [...MOC_AI_SEAL_TYPES] },
    sealMoc: {
      type: "string",
      description:
        "Material of construction of the recommended seal, matched to the media chemistry/abrasion. " +
        "For a Mechanical Seal: state the build - metal/body grade (e.g. SS316), face pair (e.g. SiC/SiC or Carbon/SiC) and O-ring elastomer. " +
        "For Gland Packing: the packing material type(eg - GAGP or Teflon or PTFE or Carbon Fiber or Asbestos-Free or any other you recommend).",
    },
    sealRationale: { type: "string" },
    summary: {
      type: "string",
      description:
        "Concise markdown: Key Design Drivers bullets + ONE Component/Material/Why | pipe table |. " +
        "Do NOT include an operating-parameters table, a seal comparison table, or an alternatives table - those are separate report sections.",
    },
    alternatives: {
      type: "string",
      description:
        "Markdown with ONE | pipe table | of alternative materials and trade-offs. Do not restate the primary selection or the summary.",
    },
  };
}


/** A process value the user actually gave. Unfilled numeric fields are often
 *  saved as "0" ("pH 0, 0 C, 0 cP" on many tags) - for pH, temperature,
 *  viscosity and SG a bare 0 means "not entered", and "pH: 0" would read as
 *  concentrated acid. */
function given(v: string | null): string | null {
  const s = (v ?? "").trim();
  if (!s) return null;
  return Number(s) === 0 ? null : s;
}

function buildPrompt(context: MocAiContext, processData: string): string {
  const head = context.head ? `${context.head} ${context.headUnit || "MWC"}` : "n/a";
  const capacity = context.capacity
    ? `${context.capacity} ${context.capacityUnit ?? ""}`.trim()
    : "n/a";

  const missing: string[] = [];
  if (!given(context.ph)) missing.push("pH");
  if (!given(context.temperatureC)) missing.push("Temperature");
  if (!given(context.viscosityCp)) missing.push("Viscosity");
  const missingClause =
    missing.length > 0
      ? `Not provided: ${missing.join(", ")}. In the summary, note the typical value you assumed for each, labeled (estimated), in one line - do not reprint the other parameters. `
      : "";
  const pumpType = context.pumpType ? context.pumpType : "not specified";
  const vertical = context.pumpType === "Vertical";

  const wettable = vertical ? VERTICAL_WETTABLE_COMP : HORIZONTAL_WETTABLE_COMP;

  const driveEnd = pumpSupportComponentName(context.pumpSupport);
  const nonWettable = vertical
    ? verticalNonWettableComp(driveEnd)
    : horizontalNonWettableComp(driveEnd);
  const sleeveClause = context.pumpType
    ? `This is a ${vertical ? "VERTICAL" : "HORIZONTAL"} pump.\n` +
      `WETTABLE (media contact - spec metal for media resistance): ${wettable.join(", ")}.\n` +
      `NON-WETTABLE (structural, no media contact - spec metal for strength/cost, do not over-alloy): ${nonWettable.join(", ")}.\n` +
      `ELASTOMER (answer a rubber, not a metal): Stator Rubber. Preferred (not mandatory): ${MOC_AI_ELASTOMERS.join(", ")}.\n`
    : "";
  return (
    `You are a PCP pump selection engineer. Media: ${context.media}. Pump type: ${pumpType}. Head: ${head}. Capacity: ${capacity}.\n` +
    sleeveClause +
    `METALS: each component's field lists its own choices - pick from them.
` +
    `Recommend reliable cost optimised MOC (per component), stator elastomer, the shaft seal type AND the seal's own MOC (mechanical seal: body/face/O-ring; gland packing: packing material).\n` +
    `${missingClause}` +
    `summary: concise markdown engineering note. The report already prints the input parameters, the seal recommendation, and the alternatives separately, so DO NOT repeat any of those here (no operating-parameters table, no seal comparison table, no alternatives table). Cover only: a short Key Design Drivers list (bullets) and ONE Component / Material / Why | pipe table | for the wetted metals, stator elastomer and structural parts. Use ## headers and **bold**. Keep it tight. ` +
    `alternatives: markdown with ONE | pipe table | of alternative materials and their trade-offs - do not restate the primary selection or the summary. ` +
    `IMPORTANT: use plain ASCII only. No emoji, no unicode symbols (avoid these: check-mark, cross, warning-triangle, approx-symbol, arrow, bullet-dot). Use "OK" / "X" / "!" / "~" / "->" / "-" instead.` +
    (processData ? `\nOther data:\n${processData}` : "") +
    (context.clientRequirementsFile
      ? `\nClient requirements: SEE THE ATTACHED ${context.clientRequirementsFile.mediaType.startsWith("image/") ? "IMAGE" : "PDF"} in this message. Read it and factor its contents into the recommendation, the same as any other process data - the customer supplied it as part of the enquiry.`
      : "") +
    "\nAssess the media first (mediaAssessment), then choose the materials from the rules."
  );
}

function line(label: string, value: string | null, unit = ""): string {
  return value && value.trim() !== "" ? `${label}: ${value}${unit}\n` : "";
}

function buildProcessData(context: MocAiContext): string {
  return (
    line("pH", given(context.ph)) +
    line("Temperature", given(context.temperatureC), " °C") +
    line("Viscosity", given(context.viscosityCp), " cP") +
    line("SG", given(context.sg)) +
    line("Solids", context.solidPct, "%") +
    line(
      "Particle size",
      context.solidSize,
      context.solidType ? ` mm (${context.solidType})` : " mm",
    )
  );
}

function coerceSuggestions(
  parsed: Partial<Record<string, unknown>>,
  pumpType: string | null,
): MocComponentSuggestions | null {

  if (requiredFieldsFor(pumpType).some((k) => typeof parsed[k] !== "string")) {
    return null;
  }
  const get = (k: keyof MocComponentSuggestions) => {
    const v = parsed[k];
    return typeof v === "string" ? v.trim() : "";
  };
  const out: MocComponentSuggestions = {
    bearingHousing: get("bearingHousing"),
    basePlate: get("basePlate"),
    mountingPlate: get("mountingPlate"),
    tieRod: get("tieRod"),
    nutBolt: get("nutBolt"),
    pumpHousing: get("pumpHousing"),
    rotor: get("rotor"),
    shaft: get("shaft"),
    statorRubber: get("statorRubber"),
    statorSleeve: get("statorSleeve"),
    sealRecommendation: get("sealRecommendation"),
    sealMoc: get("sealMoc"),
    sealRationale: get("sealRationale"),
    summary: get("summary"),
    alternatives: get("alternatives"),
  };

  return out;
}


function buildUserContent(context: MocAiContext, prompt: string):
  | string
  | Array<
      | { type: "text"; text: string }
      | {
          type: "image";
          source: {
            type: "base64";
            media_type: "image/png" | "image/jpeg" | "image/gif" | "image/webp";
            data: string;
          };
        }
      | {
          type: "document";
          source: { type: "base64"; media_type: "application/pdf"; data: string };
        }
    > {
  const file = context.clientRequirementsFile;
  if (!file) return prompt;
  if (file.mediaType.startsWith("image/")) {

    return [
      {
        type: "image",
        source: {
          type: "base64",
          media_type: file.mediaType as
            | "image/png"
            | "image/jpeg"
            | "image/gif"
            | "image/webp",
          data: file.base64,
        },
      },
      { type: "text", text: prompt },
    ];
  }
  return [
    {
      type: "document",
      source: { type: "base64", media_type: "application/pdf", data: file.base64 },
    },
    { type: "text", text: prompt },
  ];
}

// --- Anthropic provider (Claude Haiku 4.5) ------------------------------

const ANTHROPIC_MODEL = "claude-haiku-4-5-20251001";
const MOC_TOOL_NAME = "moc_recommendation";

async function getMocAiSuggestionAnthropic(
  context: MocAiContext,
): Promise<MocComponentSuggestions | null> {
  const apiKey = (process.env.ANTHROPIC_API_KEY ?? "").trim();
  if (!apiKey || apiKey.startsWith("REPLACE_")) {
    return null;
  }

  let Anthropic: typeof import("@anthropic-ai/sdk").default;
  try {
    Anthropic = (await import("@anthropic-ai/sdk")).default;
  } catch {
    console.warn("@anthropic-ai/sdk not installed; skipping Anthropic MOC suggestion");
    return null;
  }

  const prompt = buildPrompt(context, buildProcessData(context));

  try {
    const client = new Anthropic({ apiKey });
    const response = await client.messages.create({
      model: ANTHROPIC_MODEL,
      max_tokens: 4000,
      system: MOC_RULES_PROMPT,
      tools: [
        {
          name: MOC_TOOL_NAME,
          description:
            "Records the per-component MOC/elastomer/seal recommendation for a progressive cavity pump.",
          input_schema: {
            type: "object",
            properties: schemaPropertiesFor(context.pumpType, context.pumpSupport),
            required: ["mediaAssessment", ...requiredFieldsFor(context.pumpType)],
          },
        },
      ],
    
      tool_choice: { type: "tool", name: MOC_TOOL_NAME },
      messages: [{ role: "user", content: buildUserContent(context, prompt) }],
    });

    if (response.stop_reason === "refusal") {
      console.warn("Anthropic MOC-suggestion request was refused");
      return null;
    }

    const toolUse = response.content.find((b) => b.type === "tool_use");
    if (!toolUse || toolUse.type !== "tool_use") return null;

    return coerceSuggestions(toolUse.input as Partial<Record<string, unknown>>, context.pumpType);
  } catch (err) {
    console.error("Anthropic MOC-suggestion request failed:", err instanceof Error ? err.message : err);
    return null;
  }
}

export function isMocAiProviderConfigured(_provider: MocAiProvider): boolean {
  const key = (process.env.ANTHROPIC_API_KEY ?? "").trim();
  return key !== "" && !key.startsWith("REPLACE_");
}

export async function getMocAiSuggestion(
  context: MocAiContext,
  _provider: MocAiProvider = "anthropic",
): Promise<MocComponentSuggestions | null> {
  return getMocAiSuggestionAnthropic(context);
}
