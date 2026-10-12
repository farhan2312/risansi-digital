import { asc, getTableName } from "drizzle-orm";

import { error, json } from "@/lib/api";
import { AuthError, requireAdmin } from "@/lib/auth";
import { parseVfdBody, vfdLabel } from "@/lib/boi-vfd";
import { db } from "@/lib/db";
import { boiVfd } from "@/lib/db/schema";
import { auditMasterChange } from "@/lib/master-audit";
import { forgetBoiMasters } from "@/lib/commercial-server";

export const dynamic = "force-dynamic";

// GET  /api/boi-master/vfd — every VFD row (BOI Master, VFD tab), smallest first.
// POST /api/boi-master/vfd — add a row. Admin only.

function guardAdmin(req: Request): Response | null {
  try {
    requireAdmin(req);
    return null;
  } catch (e) {
    if (e instanceof AuthError) return error(e.message, e.statusCode);
    throw e;
  }
}

export async function GET(req: Request) {
  const denied = guardAdmin(req);
  if (denied) return denied;
  const rows = await db.select().from(boiVfd).orderBy(asc(boiVfd.pnKw), asc(boiVfd.listPrice), asc(boiVfd.driveDescription));
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
  const parsed = parseVfdBody(body, true);
  if ("error" in parsed) return error(parsed.error, 400);

  try {
    const [created] = await db
      .insert(boiVfd)
      .values(parsed.values as typeof boiVfd.$inferInsert)
      .returning();
    forgetBoiMasters();
    await auditMasterChange(req, {
      master: "BOI Master",
      table: getTableName(boiVfd),
      op: "create",
      id: created.id,
      label: vfdLabel(created),
    });
    return json(created, 201);
  } catch (e) {
    if ((e as { code?: string })?.code === "23505") return error("A VFD with this drive description already exists.", 409);
    throw e;
  }
}
