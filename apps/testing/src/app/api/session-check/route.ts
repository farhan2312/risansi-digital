/**
 * Why am I not being let in by Risansi Digital?
 *
 * A deliberately unauthenticated diagnostic, added 12 Oct 2026 because the
 * shared-session path fails *silently* by design: every ordinary failure —
 * no cookie, a cookie signed with a different secret, a missing secret —
 * resolves to "not signed in" and falls back to this portal's own login.
 * That is right for users and useless for debugging, because a
 * misconfiguration and a signed-out browser look identical.
 *
 * Reports the shape of the failure and never its content. No secret, no
 * token, no password, no connection string: only whether a thing is set,
 * how long it is, and whether it verified. Safe to hit from a browser while
 * signed out, which is the whole point.
 *
 * The sales portal carried the same endpoint through its cutover. Remove
 * this one when Testing's is done.
 */

import { COOKIE_NAME as SHARED_COOKIE, readToken } from "@risansi/identity";
import { eq } from "drizzle-orm";

import { identityDb } from "@/lib/db-identity";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";

export const dynamic = "force-dynamic";

function cookieValue(req: Request, name: string): string | null {
  const header = req.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const eq2 = part.indexOf("=");
    if (eq2 === -1) continue;
    if (part.slice(0, eq2).trim() === name) {
      return decodeURIComponent(part.slice(eq2 + 1).trim());
    }
  }
  return null;
}

export async function GET(req: Request) {
  const out: Record<string, unknown> = { app: "testing" };

  // 1. Is the secret even configured? Length only — never the value.
  const secret = process.env.RISANSI_SESSION_SECRET;
  out.sessionSecretSet = Boolean(secret);
  out.sessionSecretLength = secret?.length ?? 0;
  out.sessionSecretLongEnough = (secret?.length ?? 0) >= 32;

  // 2. Are the identity database variables present?
  // Named individually, not as one boolean. The first version of this said
  // only "not configured", which left four variables to hunt through when
  // three of them were already right.
  const identityVars = [
    "IDENTITY_DB_HOST",
    "IDENTITY_DB_NAME",
    "IDENTITY_DB_USER",
    "IDENTITY_DB_PASSWORD",
  ] as const;
  const missing = identityVars.filter((v) => !process.env[v]);
  out.identityDbConfigured = missing.length === 0;
  out.identityDbMissing = missing;
  out.identityDbName = process.env.IDENTITY_DB_NAME ?? null;

  // 3. Can we actually reach it? This is the one that a wrong password or a
  //    login without rights on risansi_identity fails on, and it is the
  //    failure that otherwise surfaces as a 500 with nothing in the message.
  try {
    const { rows } = await identityDb.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM identity.users",
    );
    out.identityDbReachable = true;
    out.identityUserCount = rows[0]?.n ?? null;
  } catch (e) {
    out.identityDbReachable = false;
    out.identityDbError = e instanceof Error ? e.message : String(e);
  }

  // 4. Did a shared cookie arrive, and does it verify with OUR secret?
  const raw = cookieValue(req, SHARED_COOKIE);
  out.sharedCookiePresent = Boolean(raw);
  if (raw) {
    try {
      const session = await readToken(raw);
      out.sharedCookieVerifies = Boolean(session);
      if (session) {
        out.identityUserId = session.userId;
        out.email = session.email;

        const [row] = await db
          .select({ id: users.id, role: users.role, status: users.status })
          .from(users)
          .where(eq(users.identityUserId, session.userId))
          .limit(1);
        out.localRowExists = Boolean(row);
        out.localRole = row?.role ?? null;
        out.localStatus = row?.status ?? null;

        try {
          const { rows } = await identityDb.query<{ status: string | null; app_role: string | null }>(
            `SELECT g.status, g.app_role
               FROM identity.app_grants g
              WHERE g.user_id = $1 AND g.app_slug = 'testing'`,
            [session.userId],
          );
          out.grantStatus = rows[0]?.status ?? "none";
          out.grantRole = rows[0]?.app_role ?? null;
        } catch (e) {
          out.grantLookupError = e instanceof Error ? e.message : String(e);
        }
      } else {
        // Verified as "no", which with a cookie present almost always means
        // this app's secret differs from the hub's.
        out.likelyCause =
          "A shared cookie arrived but did not verify. The most common reason is " +
          "RISANSI_SESSION_SECRET differing from the hub's by even one character.";
      }
    } catch (e) {
      out.sharedCookieVerifies = false;
      out.readTokenThrew = e instanceof Error ? e.message : String(e);
    }
  } else {
    out.likelyCause =
      "No risansi_session cookie reached this app. Sign in at the hub first, " +
      "in the same browser.";
  }

  return Response.json(out, { headers: { "cache-control": "no-store" } });
}
