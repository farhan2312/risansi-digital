import { asc } from "drizzle-orm";

import { error, json } from "@/lib/api";
import { AuthError, decodeToken } from "@/lib/auth";
import { db } from "@/lib/db";
import { pumpModels } from "@/lib/db/schema";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    await decodeToken(req);
  } catch (e) {
    if (e instanceof AuthError) return error(e.message, e.statusCode);
    throw e;
  }

  const rows = await db.select({ model: pumpModels.model }).from(pumpModels).orderBy(asc(pumpModels.model));
  return json(rows.map((r) => r.model));
}
