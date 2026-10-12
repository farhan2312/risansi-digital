import { error, json } from "@/lib/api";
import { loadCommercialSummary } from "@/lib/commercial-server";

export const dynamic = "force-dynamic";

// GET /api/commercial?projectId=… — the enquiry's Commercial Summary: every
// tag with its pump model, product code + quantity (from the wizard's Pump
// Model & Qty step), the wizard's motor / gearbox pick as a price reference,
// and the manually entered prices. Built in lib/commercial-server.ts.
export async function GET(req: Request) {
  const projectId = new URL(req.url).searchParams.get("projectId");
  if (!projectId || !/^[0-9a-f-]{36}$/i.test(projectId)) {
    return error("'projectId' query param is required", 400);
  }
  const summary = await loadCommercialSummary(projectId);
  if (!summary) return error("Enquiry not found", 404);
  return json(summary);
}
