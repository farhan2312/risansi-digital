/**
 * Live account check behind every signed-in request (see middleware.ts).
 *
 * The session JWT records who signed in and what they could do at that
 * moment, and it stays valid for 12 hours. On its own that means a user who
 * is deactivated, has their role changed, or has their password reset by an
 * admin carries on with their old access until the token expires. This
 * re-reads the account so any of those ends the session on the next request.
 */
import { cachedAccess } from "@/lib/effective-role";

/** The token fields the check compares against the account. */
export interface SessionClaims {
  sub?: unknown;
  role?: unknown;
  mustChangePassword?: unknown;
  iat?: unknown;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The account comes from cachedAccess (lib/effective-role): reused for up to
// 10 seconds - which bounds how late a deactivation or role change takes
// effect - and the same answer sharedSessionPayload read for this request, so
// the role compared below always comes from the same place as the token's.
// (This file used to keep its own cache, keyed on the token's iat; a shared
// session's iat is always "now", so it never hit and every request asked the
// databases again.)
const loadAccount = (userId: string) => cachedAccess(userId);

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
  const account = await loadAccount(userId);
  if (!account || account.status !== "active") return "ended";
  // decodeToken (lib/auth) reads a missing role as "user", so compare the same way.
  if ((account.role ?? "user") !== claims.role) return "ended";
  // Reset by an admin after this token was issued. (The reverse, a token
  // still flagged while the account is not, is the normal moment right after
  // change-password, which re-issues the cookie itself.)
  if (account.mustChangePassword && claims.mustChangePassword !== true) return "ended";
  return "active";
}
