/**
 * Live account check behind every signed-in request (see middleware.ts).
 *
 * The session JWT records who signed in and what they could do at that
 * moment, and it stays valid for 12 hours. On its own that means a user who
 * is deactivated, has their role changed, or has their password reset by an
 * admin carries on with their old access until the token expires. This
 * re-reads the account so any of those ends the session on the next request.
 */
import { eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";

/** The token fields the check compares against the account. */
export interface SessionClaims {
  sub?: unknown;
  role?: unknown;
  mustChangePassword?: unknown;
  iat?: unknown;
}

interface Account {
  status: string | null;
  role: string | null;
  mustChangePassword: boolean;
}

/** How long a looked-up account is reused before the database is asked
 * again. Bounds how late a deactivation can take effect: short enough not to
 * matter, long enough that the burst of API calls one screen makes costs a
 * single lookup. */
const ACCOUNT_CACHE_MS = 10_000;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// On globalThis so dev hot-reload keeps one cache rather than one per reload
// (same reason the DB pool lives there).
const globalForSession = globalThis as unknown as {
  __pumpSessionAccounts?: Map<string, { account: Account | null; at: number }>;
};
const accounts = (globalForSession.__pumpSessionAccounts ??= new Map());

async function loadAccount(userId: string, issuedAtMs: number): Promise<Account | null> {
  const cached = accounts.get(userId);
  // A cached read from before this token was issued can't be trusted for it:
  // someone reactivated or promoted a moment ago and then signing in must not
  // be judged against the account as it was before the change.
  if (cached && cached.at >= issuedAtMs && Date.now() - cached.at < ACCOUNT_CACHE_MS) {
    return cached.account;
  }
  const [row] = await db
    .select({
      status: users.status,
      role: users.role,
      mustChangePassword: users.mustChangePassword,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  const account = row ?? null;
  accounts.set(userId, { account, at: Date.now() });
  return account;
}

/**
 * "ended" when the account behind a valid token has since been deleted, is no
 * longer active, has a different role, or has had its password reset by an
 * admin. In each case the token no longer describes what this user may do,
 * so they sign in again. Throws when the database can't be reached; the
 * caller decides how to fail.
 */
export async function sessionVerdict(claims: SessionClaims): Promise<"active" | "ended"> {
  const userId = typeof claims.sub === "string" ? claims.sub : "";
  if (!UUID_RE.test(userId)) return "ended";
  const issuedAtMs = typeof claims.iat === "number" ? claims.iat * 1000 : 0;

  const account = await loadAccount(userId, issuedAtMs);
  if (!account || account.status !== "active") return "ended";
  // createToken writes a missing role as "user", so compare the same way.
  if ((account.role ?? "user") !== claims.role) return "ended";
  // Reset by an admin after this token was issued. (The reverse, a token
  // still flagged while the account is not, is the normal moment right after
  // change-password, which re-issues the cookie itself.)
  if (account.mustChangePassword && claims.mustChangePassword !== true) return "ended";
  return "active";
}
