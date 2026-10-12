/**
 * JWT auth — payload shape and JWT_SECRET stay identical to
 * sales-portal-next/src/lib/auth.ts (a token minted by either app's login is
 * still valid in both, and either app can independently verify the other's
 * token). The TRANSPORT differs here: this app carries the token in an
 * httpOnly/Secure/SameSite=Lax cookie rather than a header, so update
 * sales-portal-next separately if it should also move off Authorization
 * headers -- this file only controls testing-portal's own cookie.
 */
import { mayOpen } from "@risansi/identity";
import { eq } from "drizzle-orm";
import jwt from "jsonwebtoken";

import { db } from "./db";
import { identityDb } from "./db-identity";
import { users } from "./db/schema";

/** This portal, as `identity.apps.slug` spells it. */
const APP_SLUG = "testing";

const JWT_ALGORITHM = "HS256" as const;
const JWT_EXPIRY_SECONDS = 60 * 60 * 12; // 12 hours

export const AUTH_COOKIE_NAME = "auth_token";

/** Passed to NextResponse.cookies.set(...) on login, and reused (with
 * maxAge: 0) to clear the cookie on logout -- Set-Cookie deletion only takes
 * effect in every browser when the attributes match the cookie that was set. */
export function authCookieOptions() {
  return {
    httpOnly: true,
    secure: true,
    sameSite: "lax" as const,
    path: "/",
    maxAge: JWT_EXPIRY_SECONDS,
  };
}

function getSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("Missing required environment variable: JWT_SECRET");
  }
  return secret;
}

/** Reads the auth cookie straight off the Cookie request header rather than
 * via next/headers' cookies() -- keeps decodeToken a plain sync function of
 * `req: Request`, matching every route handler's existing call shape. */
function readAuthCookie(req: Request): string | null {
  const header = req.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === AUTH_COOKIE_NAME) {
      return decodeURIComponent(part.slice(eq + 1).trim());
    }
  }
  return null;
}

export interface TokenClaims {
  sub: string;
  email: string;
  role: string;
  iat: number;
  exp: number;
}

export class AuthError extends Error {
  statusCode: number;
  constructor(message: string, statusCode = 401) {
    super(message);
    this.statusCode = statusCode;
    this.name = "AuthError";
  }
}

export interface TokenUser {
  id: string;
  email: string;
  role: string | null;
}

export function createToken(user: TokenUser): string {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    sub: String(user.id),
    email: user.email,
    role: user.role ?? "testing",
    iat: now,
    exp: now + JWT_EXPIRY_SECONDS,
  };
  return jwt.sign(payload, getSecret(), { algorithm: JWT_ALGORITHM });
}

/** A valid signature only proves the token was minted for someone at login --
 * not that they may still act. Every request therefore re-reads the account:
 * a deactivated, rejected or deleted user is cut off immediately instead of
 * riding out the rest of their 12h token, and the role comes from the
 * database, so a demotion applies straight away too.
 *
 * Cached for a few seconds per user so a page firing a dozen API calls costs
 * one lookup, not twelve. forgetCachedUser() drops an entry the moment an
 * admin changes that account (same server instance; others catch up within
 * the TTL). */
const LIVE_USER_TTL_MS = 10_000;

interface LiveUser {
  /** "active" or anything else; only "active" may act. */
  status: string | null;
  role: string | null;
  /** Why they were refused, when identity is the one refusing. */
  reason: string | null;
}

const liveUserCache = new Map<string, { at: number } & LiveUser>();

export function forgetCachedUser(userId: string): void {
  liveUserCache.delete(userId);
}

/**
 * Phase 4b: the role comes from Risansi Digital, not from this database.
 *
 * `identity.app_grants` is the source of truth for whether somebody may open
 * this portal and in which role. `users.role` and `users.status` stay in the
 * table and are still written by the admin screens, but they are no longer
 * what the answer is read from — for anybody who has been linked.
 *
 * **Unlinked accounts keep the old behaviour, deliberately.** Seven rows were
 * left out of the Phase 4 seed on purpose: the shared mailboxes, the test
 * logins, and Narendra's duplicate. They have no identity row, so there is no
 * grant to read, and refusing them here would lock them out weeks before the
 * cutover that is supposed to do that. They fall through to `status` and
 * `role` below and stop working on the day, as agreed — not today.
 *
 * The fallback is what makes this change safe to deploy on its own. If the
 * identity link is wrong for somebody, they are refused and we hear about it
 * from one person; if the whole thing is wrong, the fallback is already
 * carrying everyone who matters.
 */
async function loadLiveUser(userId: string): Promise<LiveUser> {
  const hit = liveUserCache.get(userId);
  if (hit && Date.now() - hit.at < LIVE_USER_TTL_MS) return hit;

  let row: { status: string | null; role: string | null; identityUserId: string | null } | undefined;
  try {
    [row] = await db
      .select({ status: users.status, role: users.role, identityUserId: users.identityUserId })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
  } catch (err) {
    // A signed token whose subject isn't even a uuid can't belong to anyone.
    if (String(err).includes("invalid input syntax")) {
      return { status: null, role: null, reason: null };
    }
    throw err;
  }

  let live: LiveUser;
  if (row?.identityUserId) {
    const verdict = await mayOpen(identityDb, row.identityUserId, APP_SLUG);
    live = verdict.allowed
      // An Approved grant with no role is a fault, not a default: the foreign
      // key on (app_slug, app_role) is MATCH SIMPLE, so null satisfies it.
      // Falling back to the local role keeps somebody working rather than
      // handing them an unassigned one.
      ? { status: "active", role: verdict.appRole ?? row.role, reason: null }
      : { status: "refused", role: null, reason: verdict.reason };
  } else {
    live = { status: row?.status ?? null, role: row?.role ?? null, reason: null };
  }

  liveUserCache.set(userId, { at: Date.now(), ...live });
  return live;
}

export async function decodeToken(req: Request): Promise<TokenClaims> {
  const token = readAuthCookie(req);
  if (!token) {
    throw new AuthError("Not authenticated", 401);
  }

  let claims: TokenClaims;
  try {
    claims = jwt.verify(token, getSecret(), {
      algorithms: [JWT_ALGORITHM],
    }) as TokenClaims;
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      throw new AuthError("Token expired", 401);
    }
    throw new AuthError("Invalid token", 401);
  }

  const live = await loadLiveUser(claims.sub);
  if (live.status !== "active") {
    // Identity's own wording when it is the one refusing — "waiting to be
    // approved" and "was withdrawn" are different problems with different
    // next steps, and collapsing both into "not active" sends people to the
    // wrong person.
    throw new AuthError(live.reason ?? "This account is not active.", 401);
  }
  return { ...claims, role: live.role ?? claims.role };
}

export async function requireAdmin(req: Request): Promise<TokenClaims> {
  const claims = await decodeToken(req);
  if (claims.role !== "admin") {
    throw new AuthError("Admin access required", 403);
  }
  return claims;
}
