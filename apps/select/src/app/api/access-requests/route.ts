import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";

import { error, json, userToDict } from "@/lib/api";
import { db } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { users } from "@/lib/db/schema";

export const dynamic = "force-dynamic";

// The requester picks what level of access they're asking for, but never
// "system_admin" — that tier is only ever granted by an existing system
// admin, never self-requested. An invalid/omitted value falls back to the
// least-privileged "user" rather than erroring, so a tampered or missing
// field can't accidentally request more access than intended.
const REQUESTABLE_ROLES = new Set(["user", "admin"]);
function requestedRole(v: unknown): "user" | "admin" {
  return typeof v === "string" && REQUESTABLE_ROLES.has(v) ? (v as "user" | "admin") : "user";
}

export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return error("Request body must be JSON", 400);
  }

  const name = String(body.name ?? "").trim();
  const email = String(body.email ?? "").trim().toLowerCase();
  const password = String(body.password ?? "");
  if (!name || !email || !password) {
    return error("'name', 'email', and 'password' are required", 400);
  }
  const role = requestedRole(body.role);

  const passwordHash = await bcrypt.hash(password, 12);

  const [existing] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (!existing) {
    const [user] = await db
      .insert(users)
      .values({ name, email, passwordHash, role, status: "pending" })
      .returning();
    // Not signed in yet, so the requester is named explicitly.
    await logAudit(req, {
      action: "user.request",
      entity: "users_pump",
      entityId: user.id,
      detail: `Access requested by ${email} (${name}) as ${role}`,
      actor: { id: user.id, email, role },
    });
    return json(userToDict(user), 201);
  }

  if (existing.status === "pending") {
    return error("An access request for this email is already pending.", 409);
  }
  if (existing.status === "active") {
    return error("An account already exists for this email. Please log in.", 409);
  }

  // status == "rejected" or "deactivated" — allow resubmission
  const [updated] = await db
    .update(users)
    .set({
      name,
      passwordHash,
      role,
      status: "pending",
      reviewedBy: null,
      reviewedAt: null,
    })
    .where(eq(users.id, existing.id))
    .returning();
  await logAudit(req, {
    action: "user.request",
    entity: "users_pump",
    entityId: updated.id,
    detail: `Access requested again by ${email} (${name}) as ${role} - previously ${existing.status}`,
    actor: { id: updated.id, email, role },
  });
  return json(userToDict(updated));
}
