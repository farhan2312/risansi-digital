import { asc, eq } from "drizzle-orm";

import { error, json } from "@/lib/api";
import { AuthError, requirePulleyMasterAccess } from "@/lib/auth";
import { db } from "@/lib/db";
import { pulleyBeltOption } from "@/lib/db/schema";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Read-only child listing for the Details modal — returns every belt option
// linked to a given pulley_motor_option row, ordered by target RPM. Admin-only.
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    requirePulleyMasterAccess(req);
  } catch (e) {
    if (e instanceof AuthError) return error(e.message, e.statusCode);
    throw e;
  }

  const { id } = await params;
  if (!UUID_RE.test(id)) return error("Invalid parent id", 400);

  const rows = await db
    .select()
    .from(pulleyBeltOption)
    .where(eq(pulleyBeltOption.pulleyMotorOptionId, id))
    .orderBy(asc(pulleyBeltOption.targetRpm));

  return json(rows);
}
