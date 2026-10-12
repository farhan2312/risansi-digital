import { eq } from "drizzle-orm";

import { error, json, userToDict } from "@/lib/api";
import { getClientIp, logAudit } from "@/lib/audit";
import { AuthError, forgetCachedUser, requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { testRequisitions, users } from "@/lib/db/schema";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ userId: string }> },
) {
  let claims;
  try {
    claims = await requireAdmin(req);
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

  // Combined details edit -- name / email / role, any subset, used by the
  // Edit User modal. Kept as its own branch (rather than folding into the
  // role-only branch below) so the existing role-only callers (the inline
  // role <select> on the table) keep working unchanged.
  if (body.name !== undefined || body.email !== undefined || body.role !== undefined) {
    const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!user) {
      return error("User not found", 404);
    }

    const changes: string[] = [];
    const updates: Partial<typeof users.$inferInsert> = {};

    if (body.role !== undefined) {
      const newRole = body.role;
      if (newRole !== "source" && newRole !== "testing" && newRole !== "central-admin" && newRole !== "admin") {
        return error("'role' must be 'source', 'testing', 'central-admin', or 'admin'", 400);
      }
      if (newRole !== user.role) {
        updates.role = newRole;
        changes.push(`Role changed from ${user.role} to ${newRole}`);
      }
    }

    if (body.name !== undefined) {
      const newName = String(body.name).trim();
      if (!newName) return error("'name' cannot be empty", 400);
      if (newName !== user.name) {
        updates.name = newName;
        changes.push(`Name changed to ${newName}`);
      }
    }

    if (body.email !== undefined) {
      const newEmail = String(body.email).trim().toLowerCase();
      if (!newEmail) return error("'email' cannot be empty", 400);
      if (newEmail !== user.email) {
        const [emailTaken] = await db
          .select()
          .from(users)
          .where(eq(users.email, newEmail))
          .limit(1);
        if (emailTaken && emailTaken.id !== user.id) {
          return error("Another account already uses this email.", 409);
        }
        updates.email = newEmail;
        changes.push(`Email changed to ${newEmail}`);
      }
    }

    if (Object.keys(updates).length === 0) {
      return json(userToDict(user));
    }

    const [updated] = await db
      .update(users)
      .set(updates)
      .where(eq(users.id, user.id))
      .returning();

    await logAudit({
      ipAddress: getClientIp(req),
      userId: claims.sub,
      userEmail: claims.email,
      eventType: "update",
      entityType: "user",
      entityId: updated.id,
      entityLabel: updated.email,
      details: changes.join("; "),
    });

    // A demotion (or promotion) applies to this account's next request, not after the cache expires.
    forgetCachedUser(updated.id);
    return json(userToDict(updated));
  }

  const newStatus = body.status;
  if (newStatus !== "active" && newStatus !== "rejected" && newStatus !== "inactive") {
    return error("'status' or 'role' is required", 400);
  }

  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user) {
    return error("User not found", 404);
  }

  // Two different transitions share this one status field:
  //  - Reviewing a pending signup (pending -> active/rejected).
  //  - Suspending/restoring an existing account (active <-> inactive),
  //    which doesn't touch role/password, just blocks login -- see
  //    POST /api/auth/login's status check.
  let details: string;
  if (newStatus === "active" || newStatus === "rejected") {
    if (user.status === "pending") {
      details = `Access request ${newStatus}`;
    } else if (user.status === "inactive" && newStatus === "active") {
      details = "Reactivated";
    } else {
      return error("This request has already been reviewed.", 409);
    }
  } else {
    // newStatus === "inactive"
    if (user.status !== "active") {
      return error("Only an active account can be deactivated.", 409);
    }
    if (userId === claims.sub) {
      return error("You cannot deactivate your own account.", 400);
    }
    details = "Deactivated";
  }

  const [updated] = await db
    .update(users)
    .set({ status: newStatus, reviewedBy: claims.sub, reviewedAt: new Date() })
    .where(eq(users.id, user.id))
    .returning();

  await logAudit({
    ipAddress: getClientIp(req),
    userId: claims.sub,
    userEmail: claims.email,
    eventType: "update",
    entityType: "user",
    entityId: updated.id,
    entityLabel: updated.email,
    details,
  });

  // Deactivating/rejecting cuts the account off on its very next request.
  forgetCachedUser(updated.id);
  return json(userToDict(updated));
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ userId: string }> },
) {
  let claims;
  try {
    claims = await requireAdmin(req);
  } catch (e) {
    if (e instanceof AuthError) return error(e.message, e.statusCode);
    throw e;
  }

  const { userId } = await params;
  if (!UUID_RE.test(userId)) {
    return error("Invalid user id", 400);
  }
  if (userId === claims.sub) {
    return error("You cannot delete your own account.", 400);
  }

  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user) {
    return error("User not found", 404);
  }

  // test_requisitions.created_by and users.reviewed_by both have a foreign
  // key to users.id at the DB level (not modeled in schema.ts, since this
  // app doesn't own that constraint) -- deleting a user who's ever raised a
  // requisition or reviewed an access request would otherwise fail with a
  // FK violation. Clear those references first; the human-readable trail
  // survives independently (test_requisitions.submitted_by is a separate
  // name snapshot, and status/reviewed_at stay on the reviewed account).
  await db.transaction(async (tx) => {
    await tx
      .update(testRequisitions)
      .set({ createdBy: null })
      .where(eq(testRequisitions.createdBy, userId));
    await tx.update(users).set({ reviewedBy: null }).where(eq(users.reviewedBy, userId));
    await tx.delete(users).where(eq(users.id, userId));
  });

  await logAudit({
    ipAddress: getClientIp(req),
    userId: claims.sub,
    userEmail: claims.email,
    eventType: "delete",
    entityType: "user",
    entityId: user.id,
    entityLabel: user.email,
  });

  forgetCachedUser(user.id);
  return json({ success: true });
}
