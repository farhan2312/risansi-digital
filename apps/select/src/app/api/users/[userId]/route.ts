import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";

import { error, json, userToDict } from "@/lib/api";
import { AuthError, requireSystemAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { users } from "@/lib/db/schema";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VALID_ROLES = new Set(["user", "selection_head", "pulley_owner", "admin", "system_admin"]);
// "pending" is deliberately not settable via PATCH — a request only ever
// reaches "pending" through signup/resubmission (POST /api/access-requests).
const VALID_STATUSES = new Set(["active", "rejected", "deactivated"]);

// System-admin only, everything here — reviewing/editing users is explicitly
// excluded from the plain "admin" role per the 3-role spec.
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ userId: string }> },
) {
  let claims;
  try {
    claims = requireSystemAdmin(req);
  } catch (e) {
    if (e instanceof AuthError) return error(e.message, e.statusCode);
    throw e;
  }

  const { userId } = await params;
  if (!UUID_RE.test(userId)) {
    return error("Invalid user id", 400);
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return error("Request body must be JSON", 400);
  }

  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user) {
    return error("User not found", 404);
  }

  const patch: Partial<typeof users.$inferInsert> = {};

  if ("name" in body) {
    const n = String(body.name ?? "").trim();
    if (!n) return error("'name' can't be empty", 400);
    patch.name = n;
  }

  if ("role" in body) {
    const role = String(body.role ?? "");
    if (!VALID_ROLES.has(role)) {
      return error("'role' must be one of: user, selection_head, pulley_owner, admin, system_admin", 400);
    }
    // A system admin can't demote themselves — that could leave the app
    // with zero system admins able to undo the change.
    if (user.id === claims.sub && role !== "system_admin") {
      return error("You can't change your own role away from system_admin.", 400);
    }
    patch.role = role;
  }

  if ("status" in body) {
    const status = String(body.status ?? "");
    if (!VALID_STATUSES.has(status)) {
      return error("'status' must be one of: active, rejected, deactivated", 400);
    }
    if (user.id === claims.sub && status !== "active") {
      return error("You can't deactivate or reject your own account.", 400);
    }
    patch.status = status;
    // Reviewing a still-pending request (the original approve/reject flow)
    // stamps who reviewed it; editing an already-decided user's status
    // later (e.g. deactivating an active account) doesn't overwrite that
    // original review record.
    if (user.status === "pending") {
      patch.reviewedBy = claims.sub;
      patch.reviewedAt = new Date();
    }
  }

  // Admin password reset. Deliberately does NOT require the current password —
  // the point is to restore access for a user who has lost it. The user is
  // forced to pick their own on next login, so the admin-issued one is never
  // a password the admin keeps knowing. Resetting your own password here is
  // blocked: use Change Password, which verifies the current one first.
  if ("password" in body) {
    if (user.id === claims.sub) {
      return error("Use Change Password to change your own password.", 400);
    }
    const password = String(body.password ?? "");
    if (password.length < 6) {
      return error("'password' must be at least 6 characters", 400);
    }
    patch.passwordHash = await bcrypt.hash(password, 12);
    patch.mustChangePassword = true;
  }

  if (Object.keys(patch).length === 0) {
    return error("No editable fields provided", 400);
  }

  const [updated] = await db
    .update(users)
    .set(patch)
    .where(eq(users.id, user.id))
    .returning();

  // Access changes are the highest-signal rows in the trail - spell out what
  // actually changed rather than just "updated".
  const changes: string[] = [];
  if (patch.role !== undefined && patch.role !== user.role) changes.push(`role ${user.role} -> ${patch.role}`);
  if (patch.status !== undefined && patch.status !== user.status) changes.push(`status ${user.status} -> ${patch.status}`);
  if (patch.passwordHash !== undefined) changes.push("password reset");
  // Deciding a pending access request gets its own action, so the trail
  // reads "Approved request" / "Rejected request" rather than a generic update.
  const decided = user.status === "pending" && (patch.status === "active" || patch.status === "rejected");
  const otherChanges = changes.filter((c) => !c.startsWith("status "));
  await logAudit(req, {
    action: decided
      ? patch.status === "active"
        ? "user.approve"
        : "user.reject"
      : changes.some((c) => c.startsWith("role"))
        ? "user.role_change"
        : "user.update",
    entity: "users_pump",
    entityId: user.id,
    detail: decided
      ? `${patch.status === "active" ? "Approved" : "Rejected"} access request for ${user.email} as ${updated?.role ?? user.role}${
          otherChanges.length ? ` (${otherChanges.join(", ")})` : ""
        }`
      : `${user.email}: ${changes.length ? changes.join(", ") : "updated"}`,
  });

  return json(userToDict(updated));
}

// System-admin only. Permanently removes a user row — used for cleaning up
// rejected requests or accounts created by mistake. A system admin can't
// delete their own account (would risk locking everyone out if they were
// the only one).
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ userId: string }> },
) {
  let claims;
  try {
    claims = requireSystemAdmin(req);
  } catch (e) {
    if (e instanceof AuthError) return error(e.message, e.statusCode);
    throw e;
  }

  const { userId } = await params;
  if (!UUID_RE.test(userId)) {
    return error("Invalid user id", 400);
  }
  if (userId === claims.sub) {
    return error("You can't delete your own account.", 400);
  }

  const [deleted] = await db.delete(users).where(eq(users.id, userId)).returning();
  if (!deleted) {
    return error("User not found", 404);
  }

  await logAudit(req, {
    action: "user.delete",
    entity: "users_pump",
    entityId: deleted.id,
    detail: `Deleted user ${deleted.email}`,
  });

  return json({ id: deleted.id, deleted: true });
}
