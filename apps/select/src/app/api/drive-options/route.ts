import { asc, sql } from "drizzle-orm";

import { error, json } from "@/lib/api";
import { AuthError, decodeToken } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { db } from "@/lib/db";
import { driveOptionMaster } from "@/lib/db/schema";
import {
  DRIVE_OPTION_KINDS,
  MAX_DRIVE_OPTION_LENGTH,
  emptyDriveOptions,
  isDriveOptionKind,
  type DriveOptions,
} from "@/lib/drive-options";

export const dynamic = "force-dynamic";

// Option lists behind the Drive step's rating-plate dropdowns.
//
//   GET                     all four lists at once (the step needs them all)
//   POST {kind, value}      add a value typed into "Other", then return the
//                           updated list. Adding an existing value (any case)
//                           just returns the list — it is not duplicated.
//
// Any signed-in user: adding a missing voltage is part of filling the wizard,
// not an admin job. The lists are small and shared, so a new value shows up
// for everyone — the audit trail records who added what.

async function listAll(): Promise<DriveOptions> {
  const rows = await db
    .select({ kind: driveOptionMaster.kind, value: driveOptionMaster.value })
    .from(driveOptionMaster)
    .orderBy(asc(driveOptionMaster.sortOrder), asc(driveOptionMaster.value));
  const out = emptyDriveOptions();
  for (const r of rows) {
    if (isDriveOptionKind(r.kind)) out[r.kind].push(r.value);
  }
  return out;
}

export async function GET(req: Request) {
  try {
    decodeToken(req);
  } catch (e) {
    if (e instanceof AuthError) return error(e.message, e.statusCode);
    throw e;
  }
  return json(await listAll());
}

export async function POST(req: Request) {
  let claims;
  try {
    claims = decodeToken(req);
  } catch (e) {
    if (e instanceof AuthError) return error(e.message, e.statusCode);
    throw e;
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return error("Request body must be JSON", 400);
  }

  const kind = String(body.kind ?? "");
  if (!isDriveOptionKind(kind)) {
    return error(`'kind' must be one of: ${DRIVE_OPTION_KINDS.join(", ")}`, 400);
  }
  const value = String(body.value ?? "").trim();
  if (!value) return error("'value' is required", 400);
  if (value.length > MAX_DRIVE_OPTION_LENGTH) {
    return error(`'value' must be ${MAX_DRIVE_OPTION_LENGTH} characters or fewer`, 400);
  }

  // Already on the list (in any case)? Return what's stored, so the dropdown
  // selects the existing spelling rather than adding a near-duplicate.
  const [existing] = await db
    .select({ value: driveOptionMaster.value })
    .from(driveOptionMaster)
    .where(sql`${driveOptionMaster.kind} = ${kind} and lower(${driveOptionMaster.value}) = lower(${value})`)
    .limit(1);

  if (!existing) {
    await db.insert(driveOptionMaster).values({
      kind,
      value,
      createdBy: claims.sub,
    });
    await logAudit(req, {
      action: "drive_option.add",
      entity: "drive_option_master",
      detail: `Added ${kind} option "${value}"`,
    });
  }

  return json({ value: existing?.value ?? value, options: await listAll() }, existing ? 200 : 201);
}

