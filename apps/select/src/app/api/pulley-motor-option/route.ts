import { asc } from "drizzle-orm";

import { error, json } from "@/lib/api";
import { AuthError, requirePulleyMasterAccess } from "@/lib/auth";
import { db } from "@/lib/db";
import { pulleyBeltOption, pulleyMotorOption } from "@/lib/db/schema";
import { auditMasterChange, rowLabel } from "@/lib/master-audit";
import { parseBeltRows, type BeltInsert } from "./belts-shape";

export const dynamic = "force-dynamic";

/** "H15 · 1440 RPM" — names the row in audit entries. */
const labelOf = (r: typeof pulleyMotorOption.$inferSelect) =>
  rowLabel(r.model, r.motorRpm != null && `· ${r.motorRpm} RPM`);

// Optional NUMERIC columns (pg returns them as strings). Same list is used
// by POST here and by PATCH in the [id] route so the shapes stay in sync.
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

// Admin-only pulley-motor-option listing. The parent side of the pulley
// master (belt children live in pulley_belt_option with a cascade-delete FK
// to this table, exposed read-only via /pulley-motor-option/[id]/belts).
export async function GET(req: Request) {
  const denied = guardAdmin(req);
  if (denied) return denied;

  const rows = await db
    .select()
    .from(pulleyMotorOption)
    .orderBy(
      asc(pulleyMotorOption.model),
      asc(pulleyMotorOption.motorRpm),
    );

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

  const motorRpm = intOrNull(body.motorRpm);
  if (motorRpm === null) return error("'motorRpm' is required and must be an integer", 400);

  const values: Partial<typeof pulleyMotorOption.$inferInsert> & {
    model: string;
    motorRpm: number;
  } = { model, motorRpm };
  for (const f of NUMERIC_FIELDS) {
    if (f in body) values[f] = numOrNull(body[f]);
  }
  if ("grooves" in body) {
    const g = body.grooves;
    values.grooves =
      g === null || g === undefined || String(g).trim() === "" ? null : String(g).trim();
  }

  // Optional nested belt children — inserted atomically with the parent.
  let belts: BeltInsert[] = [];
  if ("belts" in body) {
    const parsed = parseBeltRows(body.belts);
    if ("error" in parsed) return error(parsed.error, 400);
    belts = parsed.belts;
  }

  const created = await db.transaction(async (tx) => {
    const [parent] = await tx.insert(pulleyMotorOption).values(values).returning();
    if (belts.length > 0) {
      await tx
        .insert(pulleyBeltOption)
        .values(belts.map((b) => ({ ...b, pulleyMotorOptionId: parent.id })));
    }
    return parent;
  });
  await auditMasterChange(req, {
    master: "Pulley Master",
    table: "pulley_motor_option",
    op: "create",
    id: created.id,
    label: labelOf(created),
    notes: belts.length ? [`${belts.length} belt option${belts.length === 1 ? "" : "s"}`] : undefined,
  });
  return json(created, 201);
}
