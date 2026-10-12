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
import { eq } from "drizzle-orm";

import { mayOpen } from "@risansi/identity";

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
