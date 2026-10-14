import { COOKIE_NAME as SHARED_COOKIE, readToken } from "@risansi/identity";
import { query } from "@/lib/db";
import { identityDb } from "@/lib/db-identity";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Why am I not being let in by Risansi Digital?
 *
 * Deliberately unauthenticated. The shared-session path fails silently by
 * design — no cookie, a cookie signed with a different secret and a missing
 * secret all resolve to "not signed in" and fall back to this portal's own
 * login — so a misconfiguration and a signed-out browser look identical.
 * This tells them apart.
 *
 * Reports the shape of a failure and never its content: whether a variable
 * is set and how long it is, whether the cookie verified, whether identity
 * answers. No secret, no token, no password, no connection string. The only
 * personal detail it shows is the caller's own, from their own cookie.
 * Same endpoint as apps/testing; remove it once the cutover is done.
 */
export async function GET(req: Request) {
  const out: Record<string, unknown> = { app: "so2dispatch" };

  // 1. The shared secret — its length only.
  const secret = process.env.RISANSI_SESSION_SECRET;
  out.sessionSecretSet = Boolean(secret);
  out.sessionSecretLongEnough = (secret?.length ?? 0) >= 32;

  // 2. The identity database variables, named one by one.
  const identityVars = ["IDENTITY_DB_HOST", "IDENTITY_DB_NAME", "IDENTITY_DB_USER", "IDENTITY_DB_PASSWORD"] as const;
  const missing = identityVars.filter((v) => !process.env[v]);
  out.identityDbConfigured = missing.length === 0;
  out.identityDbMissing = missing;
  out.hubUrl = process.env.HUB_URL ?? null;

  // 3. Does identity actually answer?
  try {
    const { rows } = await identityDb.query<{ n: number }>("SELECT count(*)::int AS n FROM identity.users");
    out.identityDbReachable = true;
    out.identityUserCount = rows[0]?.n ?? null;
  } catch (e) {
    out.identityDbReachable = false;
    out.identityDbError = e instanceof Error ? e.message : String(e);
  }

  // 4. Has the bridge column been applied here yet?
  try {
    const { rows } = await query<{ n: number }>(
      `SELECT count(*)::int AS n FROM users WHERE identity_user_id IS NOT NULL`
    );
    out.bridgeColumnApplied = true;
    out.linkedAccounts = rows[0]?.n ?? 0;
  } catch {
    out.bridgeColumnApplied = false;
  }

  // 5. Did a shared cookie arrive, and does it verify with OUR secret?
  const raw = cookieValue(req, SHARED_COOKIE);
  out.sharedCookiePresent = Boolean(raw);
  if (!raw) {
    out.likelyCause = "No risansi_session cookie reached this app. Sign in at the hub first, in the same browser.";
  } else {
    try {
      const session = await readToken(raw);
      out.sharedCookieVerifies = Boolean(session);
      if (session) {
        out.identityUserId = session.userId;
        out.email = session.email;
        try {
          const { rows } = await query<{ role: string; status: string }>(
            `SELECT role, status FROM users WHERE identity_user_id = $1`,
            [session.userId]
          );
          out.localAccountLinked = Boolean(rows[0]);
          out.localRole = rows[0]?.role ?? null;
          out.localStatus = rows[0]?.status ?? null;
        } catch {
          out.localAccountLinked = false;
        }
        try {
          const { rows } = await identityDb.query<{ status: string | null; app_role: string | null }>(
            `SELECT g.status, g.app_role FROM identity.app_grants g WHERE g.user_id = $1 AND g.app_slug = 'so2dispatch'`,
            [session.userId]
          );
          out.grantStatus = rows[0]?.status ?? "none";
          out.grantRole = rows[0]?.app_role ?? null;
        } catch (e) {
          out.grantLookupError = e instanceof Error ? e.message : String(e);
        }
      } else {
        out.likelyCause =
          "A shared cookie arrived but did not verify. Most often RISANSI_SESSION_SECRET here differs from the hub's.";
      }
    } catch (e) {
      out.sharedCookieVerifies = false;
      out.readTokenThrew = e instanceof Error ? e.message : String(e);
    }
  }

  return Response.json(out, { headers: { "cache-control": "no-store" } });
}

function cookieValue(req: Request, name: string): string | null {
  const header = req.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const at = part.indexOf("=");
    if (at !== -1 && part.slice(0, at).trim() === name) return decodeURIComponent(part.slice(at + 1).trim());
  }
  return null;
}
