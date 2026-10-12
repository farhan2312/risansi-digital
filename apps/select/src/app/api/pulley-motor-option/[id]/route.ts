import { eq } from "drizzle-orm";

import { error, json } from "@/lib/api";
import { AuthError, requirePulleyMasterAccess } from "@/lib/auth";
import { db } from "@/lib/db";
import { pulleyBeltOption, pulleyMotorOption } from "@/lib/db/schema";
import { auditMasterChange, rowLabel } from "@/lib/master-audit";
import { parseBeltRows, type BeltInsert } from "../belts-shape";

export const dynamic = "force-dynamic";

/** "H15 · 1440 RPM" — names the row in audit entries. */
const labelOf = (r: typeof pulleyMotorOption.$inferSelect) =>
  rowLabel(r.model, r.motorRpm != null && `· ${r.motorRpm} RPM`);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const NUMERIC_FIELDS = [
  "motorHp",
  "motorKw",
  "maxCapAt60Mwc",
  "pumpShaftDia",
  "pumpShaftLength",
  "motorShaftDia",
  "motorShaftLength",
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
    requirePulleyMasterAccess(req);
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

  const patch: Partial<typeof pulleyMotorOption.$inferInsert> = {};

  // model, motorRpm are NOT NULL — reject blanks rather than nulling them.
  if ("model" in body) {
    const m = String(body.model ?? "").trim();
    if (!m) return error("'model' can't be empty", 400);
    patch.model = m;
  }
  if ("motorRpm" in body) {
    const n = intOrNull(body.motorRpm);
    if (n === null) return error("'motorRpm' is required and must be an integer", 400);
    patch.motorRpm = n;
  }
  for (const f of NUMERIC_FIELDS) {
    if (f in body) patch[f] = numOrNull(body[f]);
  }
  if ("grooves" in body) {
    const g = body.grooves;
    patch.grooves =
      g === null || g === undefined || String(g).trim() === "" ? null : String(g).trim();
  }

  // Optional nested belt children: presence of the `belts` key means
  // "replace-all" — every existing child of this parent is dropped and the
  // provided rows are inserted. Omit the key to leave the belt table untouched.
  const hasBelts = "belts" in body;
  let belts: BeltInsert[] = [];
  if (hasBelts) {
    const parsed = parseBeltRows(body.belts);
    if ("error" in parsed) return error(parsed.error, 400);
    belts = parsed.belts;
  }

  if (Object.keys(patch).length === 0 && !hasBelts) {
    return error("No editable fields provided", 400);
  }

  // Read first so the audit entry can say what changed.
  const [before] = await db.select().from(pulleyMotorOption).where(eq(pulleyMotorOption.id, id)).limit(1);
  if (!before) return error("Row not found", 404);

  const updated = await db.transaction(async (tx) => {
    let row: typeof pulleyMotorOption.$inferSelect | undefined;
    if (Object.keys(patch).length > 0) {
      const [r] = await tx
        .update(pulleyMotorOption)
        .set(patch)
        .where(eq(pulleyMotorOption.id, id))
        .returning();
      row = r;
    } else {
      const [r] = await tx
        .select()
        .from(pulleyMotorOption)
        .where(eq(pulleyMotorOption.id, id))
        .limit(1);
      row = r;
    }
    if (!row) return null;

    if (hasBelts) {
      await tx
        .delete(pulleyBeltOption)
        .where(eq(pulleyBeltOption.pulleyMotorOptionId, id));
      if (belts.length > 0) {
        await tx
          .insert(pulleyBeltOption)
          .values(belts.map((b) => ({ ...b, pulleyMotorOptionId: id })));
      }
    }
    return row;
  });
  if (!updated) return error("Row not found", 404);
  await auditMasterChange(req, {
    master: "Pulley Master",
    table: "pulley_motor_option",
    op: "update",
    id,
    label: labelOf(updated),
    before,
    after: updated,
    notes: hasBelts
      ? [`belt options replaced (${belts.length} row${belts.length === 1 ? "" : "s"})`]
      : undefined,
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

  // pulley_belt_option children cascade-delete via their FK to this row.
  const [deleted] = await db
    .delete(pulleyMotorOption)
    .where(eq(pulleyMotorOption.id, id))
    .returning();
  if (!deleted) return error("Row not found", 404);
  await auditMasterChange(req, {
    master: "Pulley Master",
    table: "pulley_motor_option",
    op: "delete",
    id,
    label: labelOf(deleted),
  });

  return json({ id: deleted.id, deleted: true });
}
