import { cache } from "react";
import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";
import { getUserById, type User } from "@/lib/users";

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

/** True when the request carries a valid session for an approved user. */
export async function isAuthenticated(): Promise<boolean> {
  return (await getCurrentUser()) !== null;
}
