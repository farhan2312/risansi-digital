import { json } from "@/lib/api";
import { db } from "@/lib/db";
import { pumpModelMaster } from "@/lib/db/schema";

export const dynamic = "force-dynamic";

// Convert Drizzle's camelCase row keys back to the snake_case column names the
// old _row_to_dict() returned, so this endpoint keeps the same JSON contract.
function snakeKeys<T extends Record<string, unknown>>(row: T): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    const snake = k.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`);
    out[snake] = v;
  }
  return out;
}

// pump_model_master is the only master table built so far — ve_correction,
// motor_master, suction_velocity, and mechanical_seal_chart don't exist in the
// DB yet, so those keys come back empty rather than erroring the whole
// endpoint. Fill them in once each table is built.
export async function GET() {
  const pumpModels = await db.select().from(pumpModelMaster);

  return json({
    pumpModels: pumpModels.map(snakeKeys),
    veCorrection: [],
    motors: [],
    suctionVelocity: [],
    mechanicalSeal: [],
  });
}
