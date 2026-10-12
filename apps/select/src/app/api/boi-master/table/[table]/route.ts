import { getTableName } from "drizzle-orm";

import { error, json } from "@/lib/api";
import { AuthError, requireAdmin } from "@/lib/auth";
import { parseBoiBody } from "@/lib/boi-master";
import { boiTable } from "@/lib/boi-tables";
import { BOI_DB, BOI_ORDER } from "@/lib/boi-tables-server";
import { db } from "@/lib/db";
import { auditMasterChange } from "@/lib/master-audit";
import { forgetBoiMasters } from "@/lib/commercial-server";

export const dynamic = "force-dynamic";

// GET  /api/boi-master/table/[table] — rows of one BOI Master table
//      (drp-probe | drp-panel | shaft-dia, see lib/boi-tables.ts).
// POST /api/boi-master/table/[table] — add a row. Admin only.

function guardAdmin(req: Request): Response | null {
  try {
    requireAdmin(req);
    return null;
  } catch (e) {
    if (e instanceof AuthError) return error(e.message, e.statusCode);
    throw e;
  }
}

export async function GET(req: Request, { params }: { params: Promise<{ table: string }> }) {
  const denied = guardAdmin(req);
  if (denied) return denied;
  const { table } = await params;
  const def = boiTable(table);
  if (!def) return error(`Unknown BOI table "${table}"`, 400);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return json(await db.select().from(BOI_DB[def.key] as any).orderBy(...BOI_ORDER[def.key]));
}

export async function POST(req: Request, { params }: { params: Promise<{ table: string }> }) {
  const denied = guardAdmin(req);
  if (denied) return denied;
  const { table } = await params;
  const def = boiTable(table);
  if (!def) return error(`Unknown BOI table "${table}"`, 400);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return error("Request body must be JSON", 400);
  }
  const parsed = parseBoiBody(def.fields, body, true);
  if ("error" in parsed) return error(parsed.error, 400);

  const t = BOI_DB[def.key];
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const [created] = (await db.insert(t as any).values(parsed.values as any).returning()) as any[];
    forgetBoiMasters();
    await auditMasterChange(req, {
      master: `BOI Master · ${def.title}`,
      table: getTableName(t),
      op: "create",
      id: created.id,
      label: def.label(created),
    });
    return json(created, 201);
  } catch (e) {
    if ((e as { code?: string })?.code === "23505") return error("That row already exists.", 409);
    throw e;
  }
}
