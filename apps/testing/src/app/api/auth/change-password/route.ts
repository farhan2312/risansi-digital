import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";

import { error, json } from "@/lib/api";
import { AuthError, decodeToken } from "@/lib/auth";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let claims;
  try {
    claims = await decodeToken(req);
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

  const currentPassword = String(body.currentPassword ?? "");
  const newPassword = String(body.newPassword ?? "");
  if (!currentPassword || !newPassword) {
    return error("'currentPassword' and 'newPassword' are required", 400);
  }
  if (newPassword.length < 6) {
    return error("New password must be at least 6 characters.", 400);
  }

  const [user] = await db.select().from(users).where(eq(users.id, claims.sub)).limit(1);
  if (!user) {
    return error("User not found", 404);
  }
  if (!(await bcrypt.compare(currentPassword, user.passwordHash))) {
    return error("Current password is incorrect.", 401);
  }

  const newHash = await bcrypt.hash(newPassword, 12);
  await db
    .update(users)
    .set({ passwordHash: newHash, mustChangePassword: false })
    .where(eq(users.id, user.id));
  return json({ success: true });
}
