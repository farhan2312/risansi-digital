import "server-only";
// Risansi Digital's grant decides each person's main role here, read on every
// request they make (lib/session.ts applyGrant), which also copies it into
// users.role. That copy only moved when the person next opened the portal, so
// a role changed at the hub left Users & Access, the 360° View pages list and
// who a role notification reaches saying the old one until then. This copies
// every Approved grant's role across at once.

import { identityDb } from "@/lib/db-identity";
import { query } from "@/lib/db";
import { ALL_ROLES } from "@/lib/roles";

const APP_SLUG = "so2dispatch";
/** At most once a minute per server process, unless asked to force it. */
const EVERY_MS = 60_000;
let last = 0;
let running: Promise<number> | null = null;

/**
 * Copy each linked account's hub role into users.role where it differs.
 * Returns how many changed. Roles this portal does not know are left alone,
 * as applyGrant refuses them. Never throws: a hub that cannot be read leaves
 * the copies as they were.
 */
export async function syncRolesFromHub(opts: { force?: boolean } = {}): Promise<number> {
  if (running) return running;
  if (!opts.force && Date.now() - last < EVERY_MS) return 0;
  last = Date.now();
  running = (async () => {
    try {
      const { rows } = await identityDb.query<{ user_id: string; app_role: string }>(
        `SELECT g.user_id::text AS user_id, g.app_role
           FROM identity.app_grants g
          WHERE g.app_slug = $1 AND g.status = 'Approved' AND g.app_role IS NOT NULL`,
        [APP_SLUG]
      );
      const known = rows.filter((r) => (ALL_ROLES as string[]).includes(r.app_role));
      if (known.length === 0) return 0;
      const r = await query(
        `UPDATE users u SET role = g.role, updated_at = now()
           FROM unnest($1::text[], $2::text[]) AS g(identity_user_id, role)
          WHERE u.identity_user_id = g.identity_user_id::uuid AND u.role IS DISTINCT FROM g.role`,
        [known.map((x) => x.user_id), known.map((x) => x.app_role)]
      );
      return r.rowCount ?? 0;
    } catch (error) {
      console.warn(`[hub role sync] ${error instanceof Error ? error.message : String(error)}`);
      return 0;
    } finally {
      running = null;
    }
  })();
  return running;
}
