import { asc } from "drizzle-orm";

import { error, json } from "@/lib/api";
import { AuthError, requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { motorMaster } from "@/lib/db/schema";
import { auditMasterChange, rowLabel } from "@/lib/master-audit";

export const dynamic = "force-dynamic";

/** "CGL 0.55 kW 1440 RPM IE2 ND80" — names the row in audit entries. */
const labelOf = (r: typeof motorMaster.$inferSelect) =>
  rowLabel(r.brand, r.motorKw && `${Number(r.motorKw)} kW`, r.motorRpm && `${r.motorRpm} RPM`, r.motorType, r.frameSize);

// Optional numeric columns (pg NUMERIC — stored/returned as strings). Kept in
// sync with the same list in /motor-master/[id]/route.ts so POST and PATCH
// accept the exact same fields.
const NUMERIC_FIELDS = ["motorKw", "motorHp", "lpPrice", "finalPrice"] as const;
// Free-text columns.
const TEXT_FIELDS = ["motorType", "mounting", "frameSize"] as const;

function numOrNull(v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return Number.isNaN(n) ? null : String(n);
}

// motor_rpm is an integer column — Drizzle wants a real number, not the
// numeric-as-string convention numOrNull() uses.
function intOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : parseInt(String(v), 10);
  return Number.isNaN(n) ? null : n;
}

function textOrNull(v: unknown): string | null {
  if (v === null || v === undefined || String(v).trim() === "") return null;
  return String(v).trim();
}

// effective_date is a DATE column: accept "YYYY-MM-DD" (what <input
// type="date"> sends), NULL on blank. Anything else is rejected rather than
// silently stored as NULL.
function dateOrNull(v: unknown): string | null | undefined {
  if (v === null || v === undefined || String(v).trim() === "") return null;
  const s = String(v).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(`${s}T00:00:00Z`))) {
    return undefined;
  }
  return s;
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
    .from(motorMaster)
    .orderBy(asc(motorMaster.motorKw), asc(motorMaster.brand));

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

  const brand = String(body.brand ?? "").trim();
  if (!brand) return error("'brand' is required", 400);

  const motorKw = numOrNull(body.motorKw);
  if (motorKw === null) return error("'motorKw' is required and must be a number", 400);

  const values: Partial<typeof motorMaster.$inferInsert> & {
    brand: string;
    motorKw: string;
  } = { brand, motorKw };
  for (const f of NUMERIC_FIELDS) {
    if (f !== "motorKw" && f in body) values[f] = numOrNull(body[f]);
  }
  if ("motorRpm" in body) values.motorRpm = intOrNull(body.motorRpm);
  for (const f of TEXT_FIELDS) {
    if (f in body) values[f] = textOrNull(body[f]);
  }
  if ("effectiveDate" in body) {
    const d = dateOrNull(body.effectiveDate);
    if (d === undefined) return error("'effectiveDate' must be a date (YYYY-MM-DD)", 400);
    values.effectiveDate = d;
  }

  const [created] = await db.insert(motorMaster).values(values).returning();
  await auditMasterChange(req, {
    master: "Motor Master",
    table: "motor_master",
    op: "create",
    id: created.id,
    label: labelOf(created),
  });
  return json(created, 201);
}
