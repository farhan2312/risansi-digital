import { error } from "@/lib/api";

export const dynamic = "force-dynamic";

// pump_recommendations / pump_selections / moc_master don't exist in the DB
// yet, and buildSelectionReport (which needed them) was removed from
// recommendation-engine.ts for the same reason. The "Confirm Pump Selection"
// button that would lead here is already disabled in the wizard. Re-enable
// once those tables are built.
export async function GET() {
  return error(
    "Selection reports aren't available yet — pump_selections/pump_recommendations haven't been built.",
    501,
  );
}
