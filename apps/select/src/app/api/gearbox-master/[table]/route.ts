import { asc, getTableName } from "drizzle-orm";

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

// All three gearbox tables share an identical column shape (built from the
// same gearboxColumns() factory in schema.ts) — one generic route family
// handles all three, keyed by the [table] URL segment, instead of tripling
// near-identical CRUD code.
const TABLES = {
  pbl: pblGearbox,
  ptl: ptlGearbox,
  "top-gear": topGearGearbox,
} as const;

type TableKey = keyof typeof TABLES;

function resolveTable(key: string) {
  return Object.prototype.hasOwnProperty.call(TABLES, key) ? TABLES[key as TableKey] : null;
}

// Numeric columns (pg NUMERIC — stored/returned as strings). power_rating_raw
// is intentionally NOT exposed here — the admin UI hides it (per spec) and
// it's derived server-side from power_rating_kw instead (see POST/PATCH).
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

export async function GET(
  req: Request,
  { params }: { params: Promise<{ table: string }> },
) {
  const denied = guardAdmin(req);
  if (denied) return denied;

  const { table: tableKey } = await params;
  const table = resolveTable(tableKey);
  if (!table) return error(`Unknown gearbox table "${tableKey}"`, 400);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = await db.select().from(table as any).orderBy(asc(table.model), asc(table.outputRpm));
  return json(rows);
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ table: string }> },
) {
  const denied = guardAdmin(req);
  if (denied) return denied;

  const { table: tableKey } = await params;
  const table = resolveTable(tableKey);
  if (!table) return error(`Unknown gearbox table "${tableKey}"`, 400);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return error("Request body must be JSON", 400);
  }

  const model = String(body.model ?? "").trim();
  if (!model) return error("'model' is required", 400);

  const outputRpm = numOrNull(body.outputRpm);
  if (outputRpm === null) return error("'outputRpm' is required and must be a number", 400);

  const powerRatingKw = numOrNull(body.powerRatingKw);

  const values: Record<string, unknown> = {
    model,
    outputRpm,
    // Not shown/collected in the UI — derived from the KW value so the
    // NOT NULL column is always satisfied.
    powerRatingRaw: powerRatingKw ?? "",
  };
  for (const f of NUMERIC_FIELDS) {
    if (f in body) values[f] = numOrNull(body[f]);
  }
  if ("gearBoxType" in body) {
    const g = body.gearBoxType;
    values.gearBoxType =
      g === null || g === undefined || String(g).trim() === "" ? null : String(g).trim();
  }

  const insertResult = await db
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .insert(table as any)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .values(values as any)
    .returning();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [created] = insertResult as any[];
  await auditMasterChange(req, {
    master: "Gearbox Master",
    table: getTableName(table),
    op: "create",
    id: created.id,
    label: labelOf(tableKey, created),
  });
  return json(created, 201);
}
