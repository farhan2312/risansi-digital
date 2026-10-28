import { cache } from "react";
import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";
import { COOKIE_NAME as SHARED_COOKIE, mayOpen, readToken, type Session } from "@risansi/identity";
import { createLinkedUser, getUserById, getUserByIdentityId, getIdentityLink, type User } from "@/lib/users";
import { identityDb } from "@/lib/db-identity";
import { query } from "@/lib/db";
import { ALL_ROLES, isRep, type Role } from "@/lib/roles";
import { getTeamRepNames } from "@/lib/market-intell";
import { ACTIVE_ROLE_COOKIE, extraRolesFor } from "@/lib/user-roles";

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

/** This portal, as Risansi Digital's `identity.apps.slug` spells it. */
const APP_SLUG = "so2dispatch";

type Access = {
  user: User | null;
  /** Why Risansi Digital refused this person, to show on the sign-in page. */
  refusal: string | null;
};

/**
 * Returns the currently logged-in user, or null if there is no valid session.
 *
 * Re-read on every request: a token stays valid for days, so without this an
 * account disabled or revoked would keep its access until the token expired.
 * The same goes for a password reset, which ends any local session issued
 * before it.
 */
export const getCurrentUser = cache(async (): Promise<User | null> => (await readAccess()).user);

/** Why the person was refused by Risansi Digital on this request, if they were. */
export const getAccessRefusal = cache(async (): Promise<string | null> => (await readAccess()).refusal);

/**
 * The lookup behind both. Wrapped in React's per-request cache, so the layout
 * and the page share one read; the next request reads everything afresh, so a
 * revoked grant lands on the next click.
 *
 * Who: Risansi Digital's shared session first, this portal's own cookie if
 * that does not settle it (Phase 5, step 3).
 *
 * What they may do (step 4): for an account linked to Risansi Digital
 * (`users.identity_user_id`), the hub's grant decides — `mayOpen` — and its
 * role replaces `users.role` on the User handed to the rest of the app, so
 * every existing role check now reads the grant without being touched. Only
 * an Approved grant on an active identity lets them in. An account not linked
 * keeps the old rule, `users.status` and `users.role`, deliberately: the
 * shared mailboxes and anyone left out of the seed keep working until the
 * local login is retired, not before.
 */
const readAccess = cache(async (): Promise<Access> => {
  const access = await resolveAccess();
  return access.user ? { ...access, user: await withRepScope(await withActiveRole(access.user)) } : access;
});

/**
 * The role they are working as: one of their extra departments when they have
 * switched to it (and it is still theirs), else their main role. Everything
 * downstream reads `role` as before. Fails to the main role.
 */
async function withActiveRole(user: User): Promise<User> {
  let extra: Role[] = [];
  try {
    extra = await extraRolesFor(user.id);
  } catch (error) {
    logOnce("extra-roles", `Could not read extra departments: ${error instanceof Error ? error.message : String(error)}`);
  }
  const roles = [user.role, ...extra.filter((r) => r !== user.role)];
  const wanted = (await cookies()).get(ACTIVE_ROLE_COOKIE)?.value;
  const role = roles.find((r) => r === wanted) ?? user.role;
  return { ...user, role, roles, primary_role: user.role };
}

async function resolveAccess(): Promise<Access> {
  const cookieStore = await cookies();

  const shared = await readSharedAccount(cookieStore.get(SHARED_COOKIE)?.value);
  // Step 7: whether they still owe a password change comes from the shared
  // session, never from users.must_change_password. The local column can no
  // longer be cleared here — the set-password form went with the login — so
  // a stale true would pin somebody to a screen with no way out.
  if (shared) {
    return applyGrant({ ...shared.user, must_change_password: shared.mustChangePassword }, shared.identityUserId);
  }

  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) return { user: null, refusal: null };
  const claims = await verifySessionClaims(token);
  if (!claims) return { user: null, refusal: null };
  const user = await getUserById(claims.userId);
  if (!user) return { user: null, refusal: null };
  // An admin password reset ends every local session issued before it.
  if (
    user.sessions_valid_after &&
    claims.issuedAt * 1000 < new Date(user.sessions_valid_after).getTime()
  ) {
    return { user: null, refusal: null };
  }
  // Signed in with this portal's own password, but linked: the grant still decides.
  const identityUserId = await getIdentityLink(user.id);
  if (identityUserId) return applyGrant(user, identityUserId);
  return user.status === "approved" ? { user, refusal: null } : { user: null, refusal: null };
}

/**
 * Risansi Digital's verdict on a linked account: in with the grant's role, or
 * out with the hub's own sentence for why.
 *
 * Fails closed. If identity cannot be asked, a linked person is refused with
 * a reason rather than let in on the local role — falling back would let a
 * revoked person keep working whenever the hub is slow, which is the one
 * thing reading the grant per request exists to prevent.
 */
async function applyGrant(user: User, identityUserId: string): Promise<Access> {
  try {
    const verdict = await mayOpen(identityDb, identityUserId, APP_SLUG);
    if (!verdict.allowed) {
      return { user: null, refusal: verdict.reason ?? "You do not have access to SO to Dispatch." };
    }
    // An Approved grant with no role is a fault at the hub (the role foreign
    // key lets a null through), not a default: keep the local role rather
    // than hand them an unassigned one.
    if (!verdict.appRole) return { user, refusal: null };
    // A role this portal does not know cannot be acted on safely: refuse
    // rather than guess what it should be allowed to do.
    if (!(ALL_ROLES as string[]).includes(verdict.appRole)) {
      logOnce("role:" + verdict.appRole, `Grant role "${verdict.appRole}" is not a role in this portal`);
      return { user: null, refusal: "Your role in Risansi Digital is not one SO to Dispatch recognises. Ask for it to be corrected." };
    }
    const role = verdict.appRole as Role;
    // Keep the local copy in step with the grant. It decides nothing any
    // more, but lists built from it — Users & Access, the SO member picker,
    // who a role notification reaches — should still say what is true.
    if (role !== user.role) await syncLocalRole(user.id, role);
    return { user: { ...user, role }, refusal: null };
  } catch (error) {
    logOnce("grant", error instanceof Error ? error.message : String(error));
    return {
      user: null,
      refusal: "Risansi Digital could not be reached to check your access. Try again in a moment.",
    };
  }
}

/** Best effort: a failed copy must not refuse somebody the grant has let in. */
async function syncLocalRole(userId: string, role: Role): Promise<void> {
  try {
    await query(`UPDATE users SET role = $2, updated_at = now() WHERE id = $1 AND role IS DISTINCT FROM $2`, [userId, role]);
  } catch (error) {
    logOnce("sync", `Could not copy the grant role locally: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * The rep names whose SOs a Rep or Rep Manager sees, as the orders carry them
 * (orders.reps): their own name — the account's full name, which is the name
 * the sales portal gives them — and, for a Rep Manager, the reps who report
 * to them in the sales portal (manager_reps), read live so a team change
 * there lands here on the next request.
 *
 * Fails narrow: if the sales portal cannot be read, a manager sees their own
 * SOs only until it can, never more than they should.
 */
async function withRepScope(user: User): Promise<User> {
  if (!isRep(user.role)) return user;
  const names = [user.full_name.trim()].filter(Boolean);
  if (user.role === "rep_manager") {
    try {
      names.push(...(await getTeamRepNames(user.email)));
    } catch (error) {
      logOnce("team", `Could not read the team from the sales portal: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  const seen = new Set<string>();
  const rep_names = names.filter((n) => {
    const k = n.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  return { ...user, rep_names };
}

/** Each reason the shared session was passed over, logged once per server process. */
const loggedOnce = new Set<string>();
function logOnce(key: string, message: string) {
  if (loggedOnce.has(key)) return;
  loggedOnce.add(key);
  console.warn(`[shared session] ${message}. See /api/session-check.`);
}

/**
 * The account a Risansi Digital session belongs to here, or null to let this
 * portal's own cookie decide (Phase 5, step 3 of the handover).
 *
 * The hub issues `risansi_session` on .risansi.com; this app only reads it.
 * Its `sub` is an identity uuid, translated to this portal's own account
 * through `users.identity_user_id` — so what comes back is the same `User`
 * the rest of the app has always had, keyed by its own `users.id`.
 *
 * Every failure is null, never a throw: no cookie, a bad signature, the wrong
 * issuer, an account not linked yet — and a missing RISANSI_SESSION_SECRET
 * too, which `readToken` throws on. Thrown here it would lock out everybody
 * holding a perfectly good local cookie over a variable their path does not
 * need. It is logged once instead, and reported by /api/session-check.
 */
async function readSharedAccount(
  token: string | undefined
): Promise<{ user: User; identityUserId: string; mustChangePassword: boolean } | null> {
  if (!token) return null;
  try {
    const session = await readToken(token);
    if (!session) return null;
    const user = (await getUserByIdentityId(session.userId)) ?? (await createOnFirstArrival(session));
    if (!user) return null;
    return { user, identityUserId: session.userId, mustChangePassword: session.mustChangePassword };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    // Before the identity_user_id migration is applied the column is not there.
    const key = /identity_user_id/.test(msg) ? "column" : /RISANSI_SESSION_SECRET/.test(msg) ? "secret" : "other";
    logOnce(key, `${msg} — falling back to this portal's own login`);
    return null;
  }
}

/**
 * No account here for this identity (Phase 5, step 5). A grant on its own
 * cannot let anybody in — users.id is the foreign key on every order and
 * audit row — so somebody Approved at the hub gets an account made now.
 *
 * Only on an Approved grant with a role this portal knows. Anything less is
 * null: no row is created, and this portal's own cookie decides as before.
 * The grant is asked again by applyGrant on this and every later request.
 */
async function createOnFirstArrival(session: Session): Promise<User | null> {
  const verdict = await mayOpen(identityDb, session.userId, APP_SLUG);
  if (!verdict.allowed) return null;
  if (!verdict.appRole || !(ALL_ROLES as string[]).includes(verdict.appRole)) {
    logOnce("create-role:" + verdict.appRole, `No account made for an Approved grant with role "${verdict.appRole}"`);
    return null;
  }
  const user = await createLinkedUser({
    identityUserId: session.userId,
    fullName: session.name,
    email: session.email,
    role: verdict.appRole as Role,
  });
  if (!user) logOnce("create-taken:" + session.userId, "An account with this email is linked to another identity; none made");
  return user;
}

/**
 * Who the Risansi Digital cookie says this is, checked by signature and
 * issuer only — or null. For the sign-in page, which must tell "signed in at
 * the hub but refused here" (say why; sending them back to the hub would
 * loop, since the hub returns anyone already signed in straight to `next`)
 * from "not signed in anywhere" (send them to the hub). Never throws.
 */
export const getSharedSession = cache(async (): Promise<{ email: string; name: string } | null> => {
  try {
    const session = await readToken((await cookies()).get(SHARED_COOKIE)?.value);
    return session ? { email: session.email, name: session.name } : null;
  } catch {
    return null;
  }
});

/** True when the request carries a valid session for an approved user. */
export async function isAuthenticated(): Promise<boolean> {
  return (await getCurrentUser()) !== null;
}
