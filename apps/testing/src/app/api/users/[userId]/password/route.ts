import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";

import { error, json } from "@/lib/api";
import { getClientIp, logAudit } from "@/lib/audit";
import { AuthError, requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";

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

  const newPassword = String(body.newPassword ?? "");
  if (newPassword.length < 6) {
    return error("Password must be at least 6 characters.", 400);
  }

  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user) {
    return error("User not found", 404);
  }

  const newHash = await bcrypt.hash(newPassword, 12);
  await db.update(users).set({ passwordHash: newHash }).where(eq(users.id, user.id));

  await logAudit({
    ipAddress: getClientIp(req),
    userId: claims.sub,
    userEmail: claims.email,
    eventType: "update",
    entityType: "user",
    entityId: user.id,
    entityLabel: user.email,
    details: "Password reset by admin",
  });

  return json({ success: true });
}
