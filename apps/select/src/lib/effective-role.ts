/**
 * What this account may do, resolved from Risansi Digital.
 *
 * Phase 4b. `identity.app_grants` decides whether somebody may open Pump
 * Selection and in which role. `users_pump.role` and `users_pump.status` stay
 * in the table and are still written by the admin screens, but they are no
 * longer what the answer is read from — for anybody who has been linked.
 *
 * ── Why both callers need the same function ─────────────────────
 *
 * This portal does not re-read the role on every request the way the Testing
 * portal does. It mints the role into the token at login and then has
 * `sessionVerdict()` end the session the moment the account's role stops
 * matching the token — which is why `middleware.ts` can gate on
 * `payload.role` at all, and says so.
 *
 * That design only holds while login and the verdict agree about where the
 * role comes from. Change one and not the other and every signed-in person is
 * thrown out on their next request, for ever, because the mismatch can never
 * resolve. So both import this.
 *
 * ── Unlinked accounts keep the old behaviour, deliberately ──────
 *
 * `admin@risansi.com` was left out of the Phase 4 seed and has no identity
 * row. Refusing it here would retire it today, weeks before the cutover that
 * is supposed to do that, and before the conversation about replacing it.
 * It falls through to the local columns and stops working on the day.
 */
import { randomUUID } from "node:crypto";

import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";

import { COOKIE_NAME as SHARED_COOKIE, mayOpen, readToken } from "@risansi/identity";

import { db } from "@/lib/db";
import { identityDb } from "@/lib/db-identity";
// Exported as `users`; the table it maps to is `users_pump`.
import { users } from "@/lib/db/schema";

/** This portal, as `identity.apps.slug` spells it. */
const APP_SLUG = "select";

export interface Access {
  /** "active" means they may act. Anything else, including null, does not. */
  status: string | null;
  role: string | null;
  mustChangePassword: boolean;
  /** Identity's own wording when it is the one refusing. */
  reason: string | null;
}

/**
 * One read, no cache. Callers cache: `session-guard.ts` holds the answer for
 * ten seconds, and the login route asks exactly once.
 */
export async function resolveAccess(userId: string): Promise<Access | null> {
  const [row] = await db
    .select({
      status: users.status,
      role: users.role,
      mustChangePassword: users.mustChangePassword,
      identityUserId: users.identityUserId,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!row) return null;

  // `must_change_password` stays local. Identity has its own flag, but this
  // portal's change-password screen clears this column, and two flags that
  // mean the same thing and are cleared in different places is how somebody
  // ends up prompted for ever. One source until the session swap moves the
  // whole credential.
  if (!row.identityUserId) {
    return {
      status: row.status,
      role: row.role,
      mustChangePassword: row.mustChangePassword,
      reason: null,
    };
  }

  const verdict = await mayOpen(identityDb, row.identityUserId, APP_SLUG);
  return verdict.allowed
    ? {
        status: "active",
        // An Approved grant with no role is a fault, not a default — the
        // foreign key on (app_slug, app_role) is MATCH SIMPLE, so null
        // satisfies it. Fall back rather than hand somebody an empty role.
        role: verdict.appRole ?? row.role,
        mustChangePassword: row.mustChangePassword,
        reason: null,
      }
    : {
        status: "refused",
        role: null,
        mustChangePassword: row.mustChangePassword,
        reason: verdict.reason,
      };
}

/** The local `users_pump.id` behind a Risansi Digital identity, or null. */
export async function localUserIdFor(identityUserId: string): Promise<string | null> {
  const [row] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.identityUserId, identityUserId))
    .limit(1);
  return row?.id ?? null;
}

/**
 * Give somebody a row here the first time they arrive with a grant.
 *
 * Without this a grant cannot do anything on its own: `users_pump.id` is
 * still the foreign key on projects, quotations and audit rows, so a person
 * approved in the hub with no row here resolves to nothing and is sent back
 * to the login page. Two of the six grants set on 12 Oct were inert for
 * exactly this reason.
 *
 * The gate is the grant. Nothing is created for anybody a human has not
 * approved for this application on the hub's approvals screen.
 *
 * `password_hash` is NOT NULL and these accounts have no local password —
 * the credential lives in identity — so it holds a bcrypt hash of a random
 * uuid that is immediately discarded: right shape, impossible to match, no
 * special case anywhere else. Matching on email rather than failing means a
 * row the Phase 4 seed missed gets linked instead, and two simultaneous
 * first requests settle as one row.
 */
async function provisionFromIdentity(
  identityUserId: string,
  email: string,
  name: string,
): Promise<string | null> {
  const verdict = await mayOpen(identityDb, identityUserId, APP_SLUG);
  if (!verdict.allowed) return null;

  const [row] = await db
    .insert(users)
    .values({
      email,
      name,
      passwordHash: await bcrypt.hash(randomUUID(), 10),
      role: verdict.appRole ?? "user",
      status: "active",
      mustChangePassword: false,
      identityUserId,
    })
    .onConflictDoUpdate({ target: users.email, set: { identityUserId } })
    .returning({ id: users.id });

  return row?.id ?? null;
}

/** What `verifyToken` returns for a local cookie, built from a shared one. */
export interface SharedPayload {
  sub: string;
  email: string;
  name: string | null;
  role: string | null;
  mustChangePassword: boolean;
  iat: number;
}

/**
 * A Risansi Digital session, as this app's own session payload.
 *
 * Middleware and `lib/auth.ts` both need this and must agree, for the same
 * reason login and sessionVerdict must: the middleware gates pages on
 * `payload.role`, so a role resolved one way there and another way in the
 * route handler is a door that opens on one side and not the other.
 *
 * Null for every ordinary "no shared session" case — including a missing
 * RISANSI_SESSION_SECRET, which `readToken` throws on. Thrown here it would
 * reject every request, including the ones carrying a perfectly good local
 * cookie that does not need that variable at all.
 */
export async function sharedSessionPayload(
  rawCookie: string | undefined | null,
): Promise<SharedPayload | null> {
  let session;
  try {
    session = await readToken(rawCookie);
  } catch {
    return null;
  }
  if (!session) return null;

  // No row here yet. If Risansi Digital says they may open this portal, make
  // one; otherwise they are simply not a user here.
  const localId =
    (await localUserIdFor(session.userId)) ??
    (await provisionFromIdentity(session.userId, session.email, session.name));
  if (!localId) return null;

  const access = await resolveAccess(localId);
  if (!access || access.status !== "active") return null;

  return {
    sub: localId,
    email: session.email,
    name: session.name,
    role: access.role,
    // From the token, not from users_pump. The password lives at Risansi
    // Digital now and this app's change-password form has gone, so the local
    // column can no longer be cleared from here — trusting it would pin
    // somebody to a screen that no longer exists. The hub forces the change
    // and reissues the session with the flag off.
    mustChangePassword: session.mustChangePassword,
    // "now" is always safe here: sessionVerdict compares its cached read
    // against iat and a later iat can only force a fresh read.
    iat: Math.floor(Date.now() / 1000),
  };
}

export { SHARED_COOKIE };
