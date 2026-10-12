import { eq } from "drizzle-orm";

import { error, json } from "@/lib/api";
import { AuthError, requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { pumpModelMaster } from "@/lib/db/schema";
import { auditMasterChange, rowLabel } from "@/lib/master-audit";

export const dynamic = "force-dynamic";

/** "H15 stage 2 · 12 MWC" — names the row in audit entries. */
const labelOf = (r: typeof pumpModelMaster.$inferSelect) =>
  rowLabel(r.model, r.stage != null && `stage ${r.stage}`, r.headMwc && `· ${Number(r.headMwc)} MWC`);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Optional numeric columns (pg NUMERIC — stored/returned as strings).
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

// `stage` is an integer column — Drizzle wants a real number here, not the
// numeric-as-string convention numOrNull() uses for the NUMERIC columns above.
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

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = guardAdmin(req);
  if (denied) return denied;

  const { id } = await params;
  if (!UUID_RE.test(id)) return error("Invalid row id", 400);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return error("Request body must be JSON", 400);
  }

  const patch: Partial<typeof pumpModelMaster.$inferInsert> = {};

  // model + headMwc are NOT NULL — reject blanks rather than nulling them.
  if ("model" in body) {
    const m = String(body.model ?? "").trim();
    if (!m) return error("'model' can't be empty", 400);
    patch.model = m;
  }
  if ("headMwc" in body) {
    const h = numOrNull(body.headMwc);
    if (h === null) return error("'headMwc' is required and must be a number", 400);
    patch.headMwc = h;
  }
  for (const f of NUMERIC_FIELDS) {
    if (f in body) patch[f] = numOrNull(body[f]);
  }
  if ("stage" in body) {
    patch.stage = intOrNull(body.stage);
  }
  if ("testingRemarks" in body) {
    const t = body.testingRemarks;
    patch.testingRemarks =
      t === null || t === undefined || String(t).trim() === "" ? null : String(t);
  }

  if (Object.keys(patch).length === 0) {
    return error("No editable fields provided", 400);
  }

  // Read first so the audit entry can say what changed.
  const [before] = await db.select().from(pumpModelMaster).where(eq(pumpModelMaster.id, id)).limit(1);
  if (!before) return error("Row not found", 404);

  const [updated] = await db
    .update(pumpModelMaster)
    .set(patch)
    .where(eq(pumpModelMaster.id, id))
    .returning();
  if (!updated) return error("Row not found", 404);
  await auditMasterChange(req, {
    master: "Pump Model Master",
    table: "pump_model_master",
    op: "update",
    id,
    label: labelOf(updated),
    before,
    after: updated,
  });

  return json(updated);
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = guardAdmin(req);
  if (denied) return denied;

  const { id } = await params;
  if (!UUID_RE.test(id)) return error("Invalid row id", 400);

  const [deleted] = await db
    .delete(pumpModelMaster)
    .where(eq(pumpModelMaster.id, id))
    .returning();
  if (!deleted) return error("Row not found", 404);
  await auditMasterChange(req, {
    master: "Pump Model Master",
    table: "pump_model_master",
    op: "delete",
    id,
    label: labelOf(deleted),
  });

  return json({ id: deleted.id, deleted: true });
}
