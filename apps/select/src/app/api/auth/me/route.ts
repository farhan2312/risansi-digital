import { db } from "@/lib/db";
import { error, json } from "@/lib/api";
import { AuthError, decodeToken } from "@/lib/auth";
import { users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

/** Returns the current user for the httpOnly session cookie — the client's
 * only way to know who's logged in, since it can no longer read that out of
 * localStorage. Looks the row up fresh so a role change takes effect
 * immediately instead of waiting for the JWT to expire. */
export async function GET(req: Request) {
  let claims;
  try {
    claims = decodeToken(req);
  } catch (err) {
    if (err instanceof AuthError) return error(err.message, err.statusCode);
    return error("Unauthorized", 401);
  }

  const [user] = await db.select().from(users).where(eq(users.id, claims.sub)).limit(1);
  if (!user) {
    return error("User not found", 401);
  }
  // middleware.ts already turns away inactive accounts; repeated here because
  // this is the one route the client asks "am I still signed in?".
  if (user.status !== "active") {
    return error("Your session has ended. Please sign in again.", 401);
  }

  return json({
    id: String(user.id),
    name: user.name,
    email: user.email,
    role: user.role,
  });
}
