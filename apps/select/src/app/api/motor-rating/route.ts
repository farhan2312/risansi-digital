import { error, json, toFloat } from "@/lib/api";
import { db } from "@/lib/db";
import { computeMotorRating, toM3PerHr, toMwc } from "@/lib/recommendation-engine";

export const dynamic = "force-dynamic";

// Motor Rating KW calculation for the confirmed pump model at the duty point.
// See computeMotorRating in recommendation-engine.ts for the formula.
export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return error("Request body must be JSON", 400);
  }

  const model = typeof body.model === "string" ? body.model.trim() : "";
  if (!model) return error("'model' is required", 400);

  const sg = toFloat(body.sg, 1.0) || 1.0;
  const capacityRaw = toFloat(body.capacity);
  const headRaw = toFloat(body.head);
  if (capacityRaw <= 0 || headRaw <= 0) {
    return error("'capacity' and 'head' are required and must be > 0", 400);
  }

  const capacityM3hr = toM3PerHr(capacityRaw, (body.capacityUnit as string) ?? null, sg);
  const headMwc = toMwc(headRaw, (body.headUnit as string) ?? null, sg);

  // The head picked for this model on the recommendation card. Already a
  // charted head in MWC (that's where the card's options come from), so it is
  // NOT run through toMwc again.
  const selectedHeadRaw = toFloat(body.selectedHead);
  const selectedHeadMwc = selectedHeadRaw > 0 ? selectedHeadRaw : null;

  const rating = await computeMotorRating(
    db,
    model,
    capacityM3hr,
    headMwc,
    selectedHeadMwc,
  );
  if (!rating) return error("No pump model found for this selection", 404);

  return json(rating);
}
