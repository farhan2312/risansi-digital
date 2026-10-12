import { eq } from "drizzle-orm";

import { error, json } from "@/lib/api";
import { AuthError, decodeToken } from "@/lib/auth";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";

export const dynamic = "force-dynamic";

/** Verifies the real auth cookie server-side and returns the current user --
 * the only correct way for the client to answer "am I logged in", since the
 * JWT itself lives in an httpOnly cookie the client can't read or inspect.
 * Looks the user up fresh (rather than trusting the JWT's own role claim)
 * so a role change or must_change_password flip is reflected immediately,
 * not just after the 12h token expires and a fresh login re-mints it. */
export async function GET(req: Request) {
  let claims;
  try {
    claims = await decodeToken(req);
  } catch (e) {
    if (e instanceof AuthError) return error(e.message, e.statusCode);
    throw e;
  }

  const [user] = await db.select().from(users).where(eq(users.id, claims.sub)).limit(1);
  if (!user) {
    return error("User not found", 404);
  }
  // A still-valid 12h token doesn't stop mattering the instant an admin
  // deactivates the account -- AuthGuard calls this on every mount, so
  // treating "not active" as unauthenticated here revokes access on their
  // very next navigation, not just their next fresh login attempt.
  if (user.status !== "active") {
    return error("Account is not active", 401);
  }

  return json({
    id: String(user.id),
    name: user.name,
    email: user.email,
    role: user.role,
    must_change_password: user.mustChangePassword,
  });
}
