import { error, json, toFloat } from "@/lib/api";
import { db } from "@/lib/db";
import { computeVBeltDrive, toM3PerHr, toMwc } from "@/lib/recommendation-engine";

export const dynamic = "force-dynamic";

// V-Belt drive recommendation for the confirmed model + chosen motor RPM/KW.
// See computeVBeltDrive in recommendation-engine.ts for the selection rule.
export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return error("Request body must be JSON", 400);
  }

  const model = typeof body.model === "string" ? body.model.trim() : "";
  if (!model) return error("'model' is required", 400);

  const motorRpm = toFloat(body.motorRpm);
  if (motorRpm <= 0) return error("'motorRpm' is required (e.g. 960 or 1440)", 400);

  const motorKw = toFloat(body.motorKw);
  if (motorKw <= 0) return error("'motorKw' is required (from the Motor Rating step)", 400);

  const sg = toFloat(body.sg, 1.0) || 1.0;
  const capacityRaw = toFloat(body.capacity);
  const headRaw = toFloat(body.head);
  if (capacityRaw <= 0 || headRaw <= 0) {
    return error("'capacity' and 'head' are required and must be > 0", 400);
  }

  const capacityM3hr = toM3PerHr(capacityRaw, (body.capacityUnit as string) ?? null, sg);
  const headMwc = toMwc(headRaw, (body.headUnit as string) ?? null, sg);

  // Charted head picked for this model in the Fluid step - already a MWC
  // value from the master, so NOT re-converted via toMwc.
  const selectedHeadRaw = toFloat(body.selectedHead);
  const selectedHeadMwc = selectedHeadRaw > 0 ? selectedHeadRaw : null;

  const drive = await computeVBeltDrive(
    db, model, capacityM3hr, headMwc, motorRpm, motorKw, selectedHeadMwc,
  );
  if (!drive) return error("No pump model found for this selection", 404);

  return json(drive);
}
