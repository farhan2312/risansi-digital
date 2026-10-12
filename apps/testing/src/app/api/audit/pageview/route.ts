import { and, desc, eq, isNull, sql } from "drizzle-orm";

import { error, json } from "@/lib/api";
import { AuthError, decodeToken } from "@/lib/auth";
import { db } from "@/lib/db";
import { pageViews, userSessions, users } from "@/lib/db/schema";

export const dynamic = "force-dynamic";

/** Lightweight page-view beat, called client-side on every route change (see
 * DashboardLayout's usePathname effect) -- attaches to the caller's most
 * recent open session, or opens one on the fly if none exists (a token
 * minted before this feature shipped, or a session that got closed some
 * other way). Never blocks navigation on failure -- this is telemetry, not
 * a real action. */
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
  const path = String(body.path ?? "").slice(0, 255);
  if (!path) return error("'path' is required", 400);

  let [session] = await db
    .select()
    .from(userSessions)
    .where(and(eq(userSessions.userId, claims.sub), isNull(userSessions.logoutAt)))
    .orderBy(desc(userSessions.loginAt))
    .limit(1);

  if (!session) {
    const [user] = await db.select().from(users).where(eq(users.id, claims.sub)).limit(1);
    [session] = await db
      .insert(userSessions)
      .values({ userId: claims.sub, userName: user?.name ?? null, userEmail: claims.email })
      .returning();
  }

  await db
    .update(userSessions)
    .set({ lastSeenAt: new Date(), pageViewCount: sql`${userSessions.pageViewCount} + 1` })
    .where(eq(userSessions.id, session.id));

  await db.insert(pageViews).values({ sessionId: session.id, userId: claims.sub, path });

  return json({ success: true });
}
