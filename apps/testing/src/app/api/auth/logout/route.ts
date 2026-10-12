import { and, desc, eq, isNull } from "drizzle-orm";

import { error, json } from "@/lib/api";
import { getClientIp, getUserAgent, logAudit } from "@/lib/audit";
import { authCookieOptions, AUTH_COOKIE_NAME, AuthError, decodeToken } from "@/lib/auth";
import { db } from "@/lib/db";
import { userSessions } from "@/lib/db/schema";

export const dynamic = "force-dynamic";

/** Closes the caller's most recent open session (logout_at IS NULL) and logs
 * the event. Called client-side right before the token is cleared -- the
 * token is still valid at that point, so this still authenticates fine. */
export async function POST(req: Request) {
  let claims;
  try {
    claims = await decodeToken(req);
  } catch (e) {
    if (e instanceof AuthError) return error(e.message, e.statusCode);
    throw e;
  }

  const [session] = await db
    .select()
    .from(userSessions)
    .where(and(eq(userSessions.userId, claims.sub), isNull(userSessions.logoutAt)))
    .orderBy(desc(userSessions.loginAt))
    .limit(1);

  if (session) {
    const now = new Date();
    await db.update(userSessions).set({ logoutAt: now, lastSeenAt: now }).where(eq(userSessions.id, session.id));
  }

  await logAudit({ ipAddress: getClientIp(req), userAgent: getUserAgent(req), userId: claims.sub, userEmail: claims.email, eventType: "logout" });

  const response = json({ success: true });
  response.cookies.set(AUTH_COOKIE_NAME, "", { ...authCookieOptions(), maxAge: 0 });
  return response;
}
