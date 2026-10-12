import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";

import { error, json } from "@/lib/api";
import {
  AUTH_COOKIE_MAX_AGE,
  AUTH_COOKIE_NAME,
  AuthError,
  createToken,
  decodeToken,
} from "@/lib/auth";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";

export const dynamic = "force-dynamic";

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

  const currentPassword = String(body.currentPassword ?? "");
  const newPassword = String(body.newPassword ?? "");
  if (!currentPassword || !newPassword) {
    return error("'currentPassword' and 'newPassword' are required", 400);
  }

  const [user] = await db.select().from(users).where(eq(users.id, claims.sub)).limit(1);
  if (!user) {
    return error("User not found", 404);
  }
  if (!(await bcrypt.compare(currentPassword, user.passwordHash))) {
    return error("Current password is incorrect.", 401);
  }

  // Block re-setting the same password — otherwise a forced change can be
  // satisfied by re-entering the admin-issued one, defeating the point.
  if (await bcrypt.compare(newPassword, user.passwordHash)) {
    return error("New password must be different from your current password.", 400);
  }

  const newHash = await bcrypt.hash(newPassword, 12);
  await db
    .update(users)
    .set({ passwordHash: newHash, mustChangePassword: false })
    .where(eq(users.id, user.id));

  // Re-issue the session cookie so the cleared flag takes effect immediately —
  // the old token still carries mustChangePassword and middleware reads the
  // token, so without this the user would stay trapped on the change screen.
  const token = createToken({
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    mustChangePassword: false,
  });
  const response = json({ success: true });
  response.cookies.set(AUTH_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: AUTH_COOKIE_MAX_AGE,
  });
  return response;
}
