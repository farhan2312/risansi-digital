
import { error, json } from "@/lib/api";
import { db } from "@/lib/db";
import { asc, eq } from "drizzle-orm";
import { enquiryTags, mocSealingInput } from "@/lib/db/schema";
import {
  getMocAiSuggestion,
  isMocAiProviderConfigured,
  MOC_AI_PROVIDERS,
  type MocAiProvider,
} from "@/lib/moc-ai-suggestion";

export const dynamic = "force-dynamic";

const str = (v: unknown): string | null =>
  typeof v === "string" && v.trim() ? v.trim() : null;

const isProvider = (v: unknown): v is MocAiProvider =>
  typeof v === "string" && (MOC_AI_PROVIDERS as readonly string[]).includes(v);

// MIME strings the model can actually consume as an inline attachment. We do
// not attempt any conversion here — anything else is silently skipped so the
// AI still runs on the text context alone.
const CLAUDE_IMAGE_MIMES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
const CLAUDE_DOC_MIME = "application/pdf";

// AI-assisted, per-component MOC/elastomer/sealing suggestion — advisory
// only, scoped to whatever process data the wizard has actually collected so
// far. Always 200; the body is either the suggestion, or an
// { unavailable } discriminator so the UI can distinguish a missing key
// ("not_configured") from an upstream failure ("failed") instead of showing
// one misleading message for both.
export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return error("Request body must be JSON", 400);
  }

  const media = str(body.media);
  if (!media) return error("'media' is required", 400);

  const provider = isProvider(body.provider) ? body.provider : "anthropic";

  // No usable key for this provider — report that distinctly from a call that
  // was attempted and failed, so the UI shows the right message.
  if (!isMocAiProviderConfigured(provider)) {
    return json({ unavailable: "not_configured" });
  }

  // Pull the client-requirements file (if any) from the DB so the model gets
  // it as a first-class attachment. Also carries the legacy free-text field
  // through, so drafts saved before the field became a file still contribute
  // their text to the prompt. Fetched here (not passed by the client) because
  // the browser never holds the bytes — only the server owns them.
  const tagIdRaw = str(body.tagId);
  const projectIdRaw = str(body.projectId);
  // Resolve to a concrete tag_id: explicit tagId wins, else project's
  // oldest tag (its backfilled Default). Every wizard row is keyed by tag,
  // so the DB read below must match on that.
  let resolvedTagId: string | null = null;
  if (tagIdRaw) {
    resolvedTagId = tagIdRaw;
  } else if (projectIdRaw) {
    const [t] = await db
      .select({ id: enquiryTags.id })
      .from(enquiryTags)
      .where(eq(enquiryTags.projectId, projectIdRaw))
      .orderBy(asc(enquiryTags.createdAt))
      .limit(1);
    resolvedTagId = t?.id ?? null;
  }
  let clientRequirementsFile: { mediaType: string; base64: string } | null = null;
  let clientRequirementsLegacyText: string | null = null;
  if (resolvedTagId) {
    const [row] = await db
      .select({
        file: mocSealingInput.clientRequirementsFile,
        mime: mocSealingInput.clientRequirementsMime,
        text: mocSealingInput.clientRequirements,
      })
      .from(mocSealingInput)
      .where(eq(mocSealingInput.tagId, resolvedTagId))
      .limit(1);
    if (row?.file && row.mime) {
      const isImage = CLAUDE_IMAGE_MIMES.has(row.mime);
      const isPdf = row.mime === CLAUDE_DOC_MIME;
      if (isImage || isPdf) {
        clientRequirementsFile = {
          mediaType: row.mime,
          base64: Buffer.from(row.file).toString("base64"),
        };
      }
    }
    clientRequirementsLegacyText = str(row?.text ?? null);
  }

  const suggestion = await getMocAiSuggestion(
    {
      media,
      pumpType: str(body.pumpType),
      pumpSupport: str(body.pumpSupport),
      head: str(body.head),
      headUnit: str(body.headUnit),
      ph: str(body.ph),
      temperatureC: str(body.temperatureC),
      viscosityCp: str(body.viscosityCp),
      sg: str(body.sg),
      capacity: str(body.capacity),
      capacityUnit: str(body.capacityUnit),
      solidPct: str(body.solidPct),
      solidSize: str(body.solidSize),
      solidType: str(body.solidType),
      clientRequirements: clientRequirementsLegacyText,
      clientRequirementsFile,
    },
    provider,
  );

  // Key is configured but the upstream call returned nothing — errored,
  // blocked, or overloaded. That's a transient/request failure, not a
  // configuration problem.
  if (!suggestion) {
    return json({ unavailable: "failed" });
  }
  return json(suggestion);
}
