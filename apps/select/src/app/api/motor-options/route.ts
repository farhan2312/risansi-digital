import { and, eq, sql, type SQL } from "drizzle-orm";

import { error, json } from "@/lib/api";
import { AuthError, decodeToken } from "@/lib/auth";
import { db } from "@/lib/db";
import { motorMaster } from "@/lib/db/schema";

export const dynamic = "force-dynamic";

// Motor candidates for the Drive step's selection cards, screened out of
// motor_master by the motor rating the wizard has already fixed (KW) plus the
// drive inputs (RPM), and optionally narrowed by make. Separate from
// the admin-only /api/motor-master CRUD route: any authenticated user runs the
// wizard, so this one gates with decodeToken rather than requireAdmin, and is
// read-only.
export async function GET(req: Request) {
  try {
    decodeToken(req);
  } catch (e) {
    if (e instanceof AuthError) return error(e.message, e.statusCode);
    throw e;
  }

  const params = new URL(req.url).searchParams;
  const kwRaw = params.get("kw");
  if (!kwRaw || Number.isNaN(parseFloat(kwRaw))) {
    return error("'kw' query param is required and must be a number", 400);
  }

  const filters: SQL[] = [
    // Numeric compare, not string — "5.5" must match a stored "5.500".
    sql`${motorMaster.motorKw} = ${parseFloat(kwRaw)}`,
  ];

  const rpm = params.get("rpm");
  if (rpm && !Number.isNaN(parseInt(rpm, 10))) {
    filters.push(eq(motorMaster.motorRpm, parseInt(rpm, 10)));
  }

  // Mounting is deliberately NOT a filter for now (explicit product decision).
  // motor_master holds FOOT rows only, so screening on it left Flange and
  // Foot-cum-Flange selections with no candidates at all; until the other
  // mountings are loaded, every mounting sees the same list foot-mounted sees.
  //
  // To re-enable once that data lands, push this onto `filters`:
  //
  //   const { text, code } = mountingMatchTerms(mounting);
  //   const stored = sql`btrim(regexp_replace(upper(${motorMaster.mounting}), '[^A-Z0-9]+', ' ', 'g'))`;
  //   filters.push(code ? sql`(${stored} = ${text} OR ${stored} = ${code})` : sql`${stored} = ${text}`);
  //
  // The label carries its IEC code ("Foot B3", "Flange B5", "Foot cum Flange
  // B35") while the master stores the descriptive part alone ("FOOT"), so the
  // match is on the FULL descriptive text — not the first word, which made
  // "Foot cum Flange" silently return plain foot motors — with the code as an
  // alternative. mountingMatchTerms() in lib/motor-mounting.ts still does that
  // splitting and is covered by the Motor Master admin screen.

  const make = params.get("make");
  if (make && make.trim()) {
    filters.push(sql`upper(${motorMaster.brand}) = upper(${make.trim()})`);
  }

  // Efficiency (IE) class — the Drive step's Efficiency select maps onto
  // motor_type, so picking IE3 offers only IE3 motors.
  const motorType = params.get("motorType");
  if (motorType && motorType.trim()) {
    filters.push(sql`upper(${motorMaster.motorType}) = upper(${motorType.trim()})`);
  }

  const rows = await db
    .select()
    .from(motorMaster)
    .where(and(...filters))
    .orderBy(motorMaster.brand, motorMaster.frameSize);

  return json(rows);
}
