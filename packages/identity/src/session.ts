/**
 * One session, shared by every Risansi portal.
 *
 * Four portals arrived here with four different login systems — NextAuth in
 * sales, a hand-rolled `jose` token in Testing and Pump Selection, something
 * else again in SO to Dispatch, with three secrets and two cookie names
 * between them. They are all the same SHAPE though: a signed JWT in an
 * httpOnly cookie. So this replaces four implementations rather than four
 * frameworks, and each portal swaps its own verify for `readSession` below.
 *
 * ── What the token does NOT carry ────────────────────────────────
 *
 * Not the grants. The token says who you are; which portals you may open is
 * read from the database on the request that needs it.
 *
 * That is not an oversight, it is the whole point. The sales portal's NextAuth
 * callback re-reads `users` on every single request, which is why revoking
 * somebody takes effect on their next click rather than whenever their 8-hour
 * session happens to expire. Baking grants into the token would trade that for
 * a few saved queries and leave a revoked person working for the rest of the
 * day. Keep the property.
 *
 * ── The cookie is domain-wide, and that has a cost ───────────────
 *
 * Scoped to `.risansi.com` so sales.risansi.com, rndtesting.risansi.com and
 * the rest all see it — that is what makes one sign-in work everywhere, and it
 * is the consequence of deciding the hub is the only door while each portal
 * keeps its own subdomain.
 *
 * It also means any subdomain of risansi.com can read it. Nothing untrusted
 * should ever be hosted on one.
 */

import { SignJWT, jwtVerify, type JWTPayload } from 'jose';

/** Who the bearer is. Deliberately small: no roles, no grants, no profile. */
export interface Session {
  /** identity.users.id */
  userId: string;
  email: string;
  name: string;
  /** True while a password was issued rather than chosen. */
  mustChangePassword: boolean;
}

export const COOKIE_NAME = 'risansi_session';

/** Fifteen hours: a full working day and more on one sign-in. */
export const SESSION_SECONDS = 15 * 60 * 60;

/**
 * No fallback value on purpose.
 *
 * The sales portal's NextAuth config carries `?? 'risansi-dev-secret-2026'`,
 * which means a deploy that forgets the variable still boots and signs tokens
 * with a secret that is in the public repository. Every portal shares this
 * secret now, so the same slip would hand out valid sessions for all of them.
 * Better to fail at the first request than to run wrong.
 */
function secret(): Uint8Array {
  const s = process.env.RISANSI_SESSION_SECRET;
  if (!s || s.length < 32) {
    throw new Error(
      'RISANSI_SESSION_SECRET is missing or shorter than 32 characters. '
      + 'Every portal verifies sessions with it, so there is no safe default.',
    );
  }
  return new TextEncoder().encode(s);
}

/** Issued by the hub, and only by the hub. */
export async function issueToken(s: Session): Promise<string> {
  return new SignJWT({
    email: s.email,
    name: s.name,
    mcp: s.mustChangePassword,
  } satisfies JWTPayload)
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(s.userId)
    .setIssuedAt()
    .setIssuer('risansi-digital')
    .setExpirationTime(`${SESSION_SECONDS}s`)
    .sign(secret());
}

/**
 * Verify a token and return who it belongs to, or null.
 *
 * Returns null rather than throwing for every expected failure — absent,
 * expired, tampered, wrong issuer — because a caller's job is then simply "no
 * session, send them to the hub", with no try/catch around it. A missing
 * secret still throws, because that is a deployment fault and must not read as
 * "nobody is signed in".
 */
export async function readToken(token: string | undefined | null): Promise<Session | null> {
  if (!token) return null;
  const key = secret();
  try {
    const { payload } = await jwtVerify(token, key, { issuer: 'risansi-digital' });
    if (!payload.sub || typeof payload.email !== 'string') return null;
    return {
      userId: payload.sub,
      email: payload.email,
      name: typeof payload.name === 'string' ? payload.name : payload.email,
      mustChangePassword: payload.mcp === true,
    };
  } catch {
    return null;
  }
}

/**
 * Cookie options.
 *
 * `domain` is read from the environment rather than hardcoded so a preview
 * deployment on vercel.app, where a `.risansi.com` cookie would simply never
 * be sent, can leave it unset and still work on its own host.
 */
export function cookieOptions(): {
  httpOnly: true; secure: boolean; sameSite: 'lax'; path: string; maxAge: number; domain?: string;
} {
  const domain = process.env.RISANSI_COOKIE_DOMAIN || undefined;
  return {
    httpOnly: true,
    // Off only outside production, so a plain-http localhost can hold a session.
    secure: process.env.NODE_ENV === 'production',
    // Lax, not Strict: arriving at a portal by following a link out of the hub
    // is a cross-site navigation, and Strict would drop the cookie on exactly
    // the journey this system is built around. Lax still withholds it from
    // cross-site POSTs, which is the case that matters.
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_SECONDS,
    ...(domain ? { domain } : {}),
  };
}

/** What to send to clear it. Matching attributes, or the browser keeps it. */
export function clearedCookieOptions(): ReturnType<typeof cookieOptions> {
  return { ...cookieOptions(), maxAge: 0 };
}
