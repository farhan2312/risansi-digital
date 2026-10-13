import { cache } from "react";
import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";
import { COOKIE_NAME as SHARED_COOKIE, readToken } from "@risansi/identity";
import { getUserById, getUserByIdentityId, type User } from "@/lib/users";

export const SESSION_COOKIE = "session";

const ISSUER = "ectodispatch";
const AUDIENCE = "ectodispatch-app";
const MAX_AGE_SECONDS = 60 * 60 * 24 * 7; // 7 days

function secretKey(): Uint8Array {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error(
      "SESSION_SECRET is not set. Add it to .env.local (any long random string)."
    );
  }
  return new TextEncoder().encode(secret);
}

/**
 * Sign a session token for a user. The token carries only the user id (`sub`);
 * role/status are always re-read from the DB, so a signed-but-stale token can't
 * escalate privileges or outlive an account being disabled.
 */
export async function signSession(userId: string): Promise<string> {
  return new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE_SECONDS}s`)
    .sign(secretKey());
}

/**
 * Verify a session token, returning its user id (`sub`) and when it was
 * issued (`iat`, seconds), or null if invalid.
 */
async function verifySessionClaims(
  token: string
): Promise<{ userId: string; issuedAt: number } | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey(), {
      issuer: ISSUER,
      audience: AUDIENCE,
    });
    if (typeof payload.sub !== "string" || typeof payload.iat !== "number") {
      return null;
    }
    return { userId: payload.sub, issuedAt: payload.iat };
  } catch {
    return null;
  }
}

/** Verify a session token, returning the user id (`sub`) or null if invalid. */
export async function verifySession(token: string): Promise<string | null> {
  return (await verifySessionClaims(token))?.userId ?? null;
}

export const SESSION_MAX_AGE = MAX_AGE_SECONDS;

/**
 * Returns the currently logged-in user based on the signed session cookie,
 * or null if there is no valid session.
 *
 * Status is re-checked on every request: a token stays valid for 7 days, so
 * without this an account disabled/suspended by an admin would keep full
 * access until its token expired. The same goes for a password reset, which
 * ends any session issued before it.
 */
export const getCurrentUser = cache(readCurrentUser);

/**
 * The lookup behind getCurrentUser. Wrapped in React's per-request cache, so
 * the layout and the page it frames share one database read rather than each
 * making their own — a round trip saved on every page. The cache lasts one
 * request only; the next request reads the account afresh, so a disabled
 * account or a reset password still takes effect at once.
 */
async function readCurrentUser(): Promise<User | null> {
  const cookieStore = await cookies();
  // Risansi Digital's shared session first; this portal's own cookie if it
  // does not settle who this is (Phase 5, step 3).
  const shared = await readSharedUser(cookieStore.get(SHARED_COOKIE)?.value);
  if (shared) return shared;
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const claims = await verifySessionClaims(token);
  if (!claims) return null;
  const user = await getUserById(claims.userId);
  if (!user || user.status !== "approved") return null;
  // An admin password reset ends every session issued before it.
  if (
    user.sessions_valid_after &&
    claims.issuedAt * 1000 < new Date(user.sessions_valid_after).getTime()
  ) {
    return null;
  }
  return user;
}

/** Each reason the shared session was passed over, logged once per server process. */
const loggedOnce = new Set<string>();
function logOnce(key: string, message: string) {
  if (loggedOnce.has(key)) return;
  loggedOnce.add(key);
  console.warn(`[shared session] ${message} — falling back to this portal's own login. See /api/session-check.`);
}

/**
 * Who a Risansi Digital session belongs to here, or null to let this portal's
 * own cookie decide (Phase 5, step 3 of the handover).
 *
 * The hub issues `risansi_session` on .risansi.com; this app only reads it.
 * Its `sub` is an identity uuid, translated to this portal's own account
 * through `users.identity_user_id` — so what comes back is the same `User`
 * the rest of the app has always had, keyed by its own `users.id`, and
 * nothing downstream changes.
 *
 * Every failure is null, never a throw: no cookie, a bad signature, the wrong
 * issuer, an account not linked yet, a disabled account — and a missing
 * RISANSI_SESSION_SECRET too, which `readToken` throws on. Thrown here it
 * would lock out everybody holding a perfectly good local cookie over a
 * variable their path does not need. It is logged once instead, and reported
 * by /api/session-check.
 *
 * The role is still this app's `users.role` for now; step 4 reads it from the
 * hub's grant.
 */
async function readSharedUser(token: string | undefined): Promise<User | null> {
  if (!token) return null;
  try {
    const session = await readToken(token);
    if (!session) return null;
    const user = await getUserByIdentityId(session.userId);
    if (!user) {
      // Expected until the seed links everyone; step 5 creates the account.
      return null;
    }
    if (user.status !== "approved") return null;
    return user;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    // Before Farhan applies the identity_user_id migration the column is not there.
    const key = /identity_user_id/.test(msg) ? "column" : /RISANSI_SESSION_SECRET/.test(msg) ? "secret" : "other";
    logOnce(key, msg);
    return null;
  }
}

/** True when the request carries a valid session for an approved user. */
export async function isAuthenticated(): Promise<boolean> {
  return (await getCurrentUser()) !== null;
}
