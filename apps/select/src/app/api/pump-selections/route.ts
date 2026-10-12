import { error } from "@/lib/api";

export const dynamic = "force-dynamic";

// pump_selections doesn't exist in the DB yet. No frontend code currently
// calls this endpoint — /api/recommendations handles Step-3 model screening
// without persisting anything. Re-enable once pump_selections is built.
export async function POST() {
  return error(
    "Persisting a pump selection isn't available yet — the pump_selections table hasn't been built.",
    501,
  );
}
