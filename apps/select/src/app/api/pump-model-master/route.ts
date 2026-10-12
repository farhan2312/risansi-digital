import { asc } from "drizzle-orm";

import { error, json } from "@/lib/api";
import { AuthError, requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { pumpModelMaster } from "@/lib/db/schema";
import { auditMasterChange, rowLabel } from "@/lib/master-audit";

export const dynamic = "force-dynamic";

/** "H15 stage 2 · 12 MWC" — names the row in audit entries. */
const labelOf = (r: typeof pumpModelMaster.$inferSelect) =>
  rowLabel(r.model, r.stage != null && `stage ${r.stage}`, r.headMwc && `· ${Number(r.headMwc)} MWC`);

// Optional numeric columns (pg NUMERIC — stored/returned as strings). Mirrors
// the same list in /pump-model-master/[id]/route.ts to keep PATCH and POST
// in sync — any drift between the two would let users create rows with
// fields they can't edit later, or vice versa.
const NUMERIC_FIELDS = [
  "voleMin",
  "voleMax",
  "mechEff",
  "qth",
  "minKwExisting",
  "minStartingKwAt1Kg",
  "minKwTested",
  "minKwToBeTested",
  "hardSolidMm",
  "softSolidMm",
  "sizeVisc0To1000In",
  "sizeVisc1000To3000In",
  "sizeVisc3000To5000In",
  "sizeVisc5000To10000In",
  "sizeViscGt10000In",
] as const;

function numOrNull(v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return Number.isNaN(n) ? null : String(n);
}

function intOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : parseInt(String(v), 10);
  return Number.isNaN(n) ? null : n;
}

function guardAdmin(req: Request): Response | null {
  try {
    requireAdmin(req);
    return null;
  } catch (e) {
    if (e instanceof AuthError) return error(e.message, e.statusCode);
    throw e;
  }
}

// Admin-only master-data listing. The page lives under /admin/* (gated by
// middleware), but this API route isn't, so it self-gates with requireAdmin.
export async function GET(req: Request) {
  const denied = guardAdmin(req);
  if (denied) return denied;

  const rows = await db
    .select()
    .from(pumpModelMaster)
    .orderBy(asc(pumpModelMaster.model), asc(pumpModelMaster.headMwc));

  return json(rows);
}

export async function POST(req: Request) {
  const denied = guardAdmin(req);
  if (denied) return denied;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return error("Request body must be JSON", 400);
  }

  const model = String(body.model ?? "").trim();
  if (!model) return error("'model' is required", 400);

  const headMwc = numOrNull(body.headMwc);
  if (headMwc === null) return error("'headMwc' is required and must be a number", 400);

  const values: Partial<typeof pumpModelMaster.$inferInsert> & {
    model: string;
    headMwc: string;
  } = { model, headMwc };
  for (const f of NUMERIC_FIELDS) {
    if (f in body) values[f] = numOrNull(body[f]);
  }
  if ("stage" in body) values.stage = intOrNull(body.stage);
  if ("testingRemarks" in body) {
    const t = body.testingRemarks;
    values.testingRemarks =
      t === null || t === undefined || String(t).trim() === "" ? null : String(t);
  }

  const [created] = await db.insert(pumpModelMaster).values(values).returning();
  await auditMasterChange(req, {
    master: "Pump Model Master",
    table: "pump_model_master",
    op: "create",
    id: created.id,
    label: labelOf(created),
  });
  return json(created, 201);
}
