/**
 * AI-assisted suggestions for the handful of report fields with no charted
 * master data anywhere in the project's source tables (Stator Sleeve, Sleeve
 * Ring, Seal Ring, Boot Seal MOC, Gear Box Type). Ported from
 * azure-functions/shared/ai_suggestions.py.
 *
 * These are advisory suggestions from Claude, not verified specifications —
 * kept structurally separate from tested/calculated/standard-default fields via
 * the `aiSuggestion` key, which the frontend renders as a distinct "AI
 * Suggestion" badge rather than folding it into the System Recommendation
 * column. `available` on these fields stays false; the AI value is a bonus hint
 * on top, not a substitute for real master data.
 *
 * Requires ANTHROPIC_API_KEY. If it's unset, still the placeholder, or the
 * request fails for any reason, suggestions are skipped entirely and the caller
 * falls back to the existing "Not available" state — never throws.
 */
import type { ReportSection } from "./report-types";

const GAP_KEYS = [
  "stator_sleeve",
  "sleeve_ring",
  "seal_ring",
  "boot_seal",
  "gear_box_type",
] as const;

const LABEL_TO_KEY: Record<string, string> = {
  "Stator Sleeve": "stator_sleeve",
  "Sleeve Ring": "sleeve_ring",
  "Seal Ring": "seal_ring",
  "Boot Seal": "boot_seal",
  "Gear Box Type": "gear_box_type",
};

export interface GapContext {
  model: string | null;
  media: string | null;
  casing_category: string;
  moc_code: string;
  viscosity_cp: number;
  solid_pct: number;
  drive_system: string;
  uses_gearbox: boolean;
}

export type GapSuggestions = Record<string, string>;

export async function getAiGapSuggestions(
  context: GapContext,
): Promise<GapSuggestions | null> {
  const apiKey = (process.env.ANTHROPIC_API_KEY ?? "").trim();
  if (!apiKey || apiKey.startsWith("REPLACE_")) {
    return null;
  }

  let Anthropic: typeof import("@anthropic-ai/sdk").default;
  try {
    Anthropic = (await import("@anthropic-ai/sdk")).default;
  } catch {
    console.warn("@anthropic-ai/sdk not installed; skipping AI gap suggestions");
    return null;
  }

  const prompt =
    "You are assisting a progressive cavity pump (PCP) engineering team. " +
    "The fields below have no charted master data in our internal system, " +
    "so we need a plausible, standard-PCP-engineering-practice suggestion " +
    "for each one — not a verified specification, just an informed estimate " +
    "grounded in the duty context given.\n\n" +
    `Pump model: ${context.model}\n` +
    `Media / application: ${context.media}\n` +
    `Service classification: ${context.casing_category}\n` +
    `MOC code already resolved for the wetted parts: ${context.moc_code}\n` +
    `Viscosity: ${context.viscosity_cp} cP\n` +
    `Solids: ${context.solid_pct}%\n` +
    `Drive system: ${context.drive_system}\n` +
    `Uses gearbox: ${context.uses_gearbox}\n\n` +
    "Suggest a Stator Sleeve MOC, Sleeve Ring MOC, Seal Ring MOC, and Boot " +
    "Seal elastomer consistent with the resolved MOC code above, plus a " +
    "Gear Box Type (Helical / Worm / Bevel-Helical / etc). For gear_box_type, " +
    "reply 'Not applicable' if the drive system does not use a gearbox. " +
    "Respond with ONLY a JSON object with exactly these string keys: " +
    `${GAP_KEYS.join(", ")}. No prose, no markdown fences.`;

  try {
    const client = new Anthropic({ apiKey });
    const response = await client.messages.create({
      model: "claude-opus-4-8",
      max_tokens: 1024,
      messages: [{ role: "user", content: prompt }],
    });
    if (response.stop_reason === "refusal") {
      console.warn("AI gap-suggestion request was refused");
      return null;
    }
    const textBlock = response.content.find((b) => b.type === "text");
    const text = textBlock && "text" in textBlock ? textBlock.text : null;
    if (!text) return null;
    return JSON.parse(extractJson(text)) as GapSuggestions;
  } catch (err) {
    console.error("AI gap-suggestion request failed", err);
    return null;
  }
}

/** Pull the first {...} block out of the model's reply, tolerating stray prose
 * or ```json fences that the schema-less prompt can't fully prevent. */
function extractJson(text: string): string {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start !== -1 && end !== -1 && end > start) {
    return text.slice(start, end + 1);
  }
  return text;
}

export function applyAiGapSuggestions(
  sections: ReportSection[],
  suggestions: GapSuggestions | null,
): void {
  if (!suggestions) return;
  for (const section of sections) {
    for (const field of section.fields) {
      const key = LABEL_TO_KEY[field.label];
      if (key === undefined || field.available) continue;
      const value = suggestions[key];
      if (!value || value.trim().toLowerCase() === "not applicable") continue;
      field.aiSuggestion = value.trim();
    }
  }
}
