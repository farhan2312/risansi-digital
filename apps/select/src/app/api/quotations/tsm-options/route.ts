import { error, json } from "@/lib/api";
import { listTsmOptions } from "@/lib/quotation-server";

export const dynamic = "force-dynamic";

// GET /api/quotations/tsm-options — active sales reps and managers (read from
// Market Intell, read-only) for the quotation's TSM dropdown.
export async function GET() {
  try {
    return json(await listTsmOptions());
  } catch (err) {
    console.error("TSM list failed:", err instanceof Error ? err.message : err);
    return error("The TSM list is unavailable right now", 502);
  }
}
