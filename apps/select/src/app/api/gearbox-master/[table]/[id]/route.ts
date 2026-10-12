import { eq, getTableName } from "drizzle-orm";

import { error, json } from "@/lib/api";
import { AuthError, requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { pblGearbox, ptlGearbox, topGearGearbox } from "@/lib/db/schema";
import { auditMasterChange, rowLabel } from "@/lib/master-audit";

export const dynamic = "force-dynamic";

const GEARBOX_NAMES: Record<string, string> = { pbl: "PBL", ptl: "PTL", "top-gear": "Top Gear" };

/** "PBL 80 @ 60 RPM" — names the row in audit entries. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const labelOf = (tableKey: string, r: any) =>
  rowLabel(GEARBOX_NAMES[tableKey] ?? tableKey, r?.model, r?.outputRpm != null && `@ ${Number(r.outputRpm)} RPM`);

const TABLES = {
  pbl: pblGearbox,
  ptl: ptlGearbox,
  "top-gear": topGearGearbox,
} as const;

type TableKey = keyof typeof TABLES;

function resolveTable(key: string) {
  return Object.prototype.hasOwnProperty.call(TABLES, key) ? TABLES[key as TableKey] : null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const NUMERIC_FIELDS = ["powerRatingKw", "serviceFactor", "ratePerNos"] as const;

function numOrNull(v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return Number.isNaN(n) ? null : String(n);
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
  { params }: { params: Promise<{ table: string; id: string }> },
) {
  const denied = guardAdmin(req);
  if (denied) return denied;

  const { table: tableKey, id } = await params;
  const table = resolveTable(tableKey);
  if (!table) return error(`Unknown gearbox table "${tableKey}"`, 400);
  if (!UUID_RE.test(id)) return error("Invalid row id", 400);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return error("Request body must be JSON", 400);
  }

  const patch: Record<string, unknown> = {};

  // model + output_rpm are NOT NULL — reject blanks rather than nulling them.
  if ("model" in body) {
    const m = String(body.model ?? "").trim();
    if (!m) return error("'model' can't be empty", 400);
    patch.model = m;
  }
  if ("outputRpm" in body) {
    const n = numOrNull(body.outputRpm);
    if (n === null) return error("'outputRpm' is required and must be a number", 400);
    patch.outputRpm = n;
  }
  for (const f of NUMERIC_FIELDS) {
    if (f in body) patch[f] = numOrNull(body[f]);
  }
  if ("gearBoxType" in body) {
    const g = body.gearBoxType;
    patch.gearBoxType =
      g === null || g === undefined || String(g).trim() === "" ? null : String(g).trim();
  }
  // power_rating_raw isn't shown/collected in the UI — keep it in sync with
  // power_rating_kw whenever the KW changes, so the NOT NULL column never
  // goes stale relative to what's actually shown.
  if ("powerRatingKw" in body) {
    patch.powerRatingRaw = numOrNull(body.powerRatingKw) ?? "";
  }

  if (Object.keys(patch).length === 0) {
    return error("No editable fields provided", 400);
  }

  // Read first so the audit entry can say what changed.
  const beforeResult = await db
    .select()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .from(table as any)
    .where(eq(table.id, id))
    .limit(1);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [before] = beforeResult as any[];
  if (!before) return error("Row not found", 404);

  const updateResult = await db
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .update(table as any)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .set(patch as any)
    .where(eq(table.id, id))
    .returning();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [updated] = updateResult as any[];
  if (!updated) return error("Row not found", 404);
  await auditMasterChange(req, {
    master: "Gearbox Master",
    table: getTableName(table),
    op: "update",
    id,
    label: labelOf(tableKey, updated),
    before,
    after: updated,
  });

  return json(updated);
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ table: string; id: string }> },
) {
  const denied = guardAdmin(req);
  if (denied) return denied;

  const { table: tableKey, id } = await params;
  const table = resolveTable(tableKey);
  if (!table) return error(`Unknown gearbox table "${tableKey}"`, 400);
  if (!UUID_RE.test(id)) return error("Invalid row id", 400);

  const deleteResult = await db
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .delete(table as any)
    .where(eq(table.id, id))
    .returning();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [deleted] = deleteResult as any[];
  if (!deleted) return error("Row not found", 404);
  await auditMasterChange(req, {
    master: "Gearbox Master",
    table: getTableName(table),
    op: "delete",
    id,
    label: labelOf(tableKey, deleted),
  });

  return json({ id: deleted.id, deleted: true });
}
