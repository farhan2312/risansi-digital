import { query } from "@/lib/db";

/**
 * Reps: which account is which rep on the orders.
 *
 * Accounts themselves are managed at Risansi Digital since Phase 5. What
 * stays here is this portal's own fact: `orders.reps` holds a rep's name as
 * the sales portal spells it, and a Rep account sees the SOs whose rep
 * matches its `users.rep_name` (trimmed, case-insensitive — repMatches in
 * lib/dept-view.ts). rep_name is filled from the sales portal by email on a
 * Rep's first arrival (lib/session.ts); the Reps page shows the result and
 * lets an admin correct it.
 */

export type RepAccount = {
  id: string;
  full_name: string;
  email: string;
  rep_name: string | null;
  /** Linked to Risansi Digital — signs in there. */
  linked: boolean;
  /** SOs whose rep is this rep_name. */
  orders: number;
  /** Latest thing this account did here (audit log), or null. */
  last_active: string | null;
};

/** A rep name on orders that no Rep account is linked to. */
export type UnclaimedRep = { rep_name: string; orders: number };

export async function listReps(): Promise<{ accounts: RepAccount[]; unclaimed: UnclaimedRep[] }> {
  const [accounts, onOrders] = await Promise.all([
    query<RepAccount>(
      `SELECT u.id, u.full_name, u.email, u.rep_name,
              (u.identity_user_id IS NOT NULL) AS linked,
              (SELECT count(*)::int FROM orders o
                WHERE lower(trim(o.reps)) = lower(trim(u.rep_name))) AS orders,
              (SELECT max(a.created_at) FROM audit_log a WHERE a.user_id = u.id) AS last_active
         FROM users u
        WHERE u.role = 'rep'
        ORDER BY lower(coalesce(nullif(trim(u.rep_name), ''), u.full_name))`
    ),
    query<UnclaimedRep>(
      `SELECT trim(reps) AS rep_name, count(*)::int AS orders
         FROM orders
        WHERE trim(coalesce(reps, '')) <> ''
        GROUP BY trim(reps)`
    ),
  ]);
  const claimed = new Set(
    accounts.rows.map((a) => (a.rep_name ?? "").trim().toLowerCase()).filter(Boolean)
  );
  // Grouped case-insensitively, keeping the first spelling seen.
  const unclaimed = new Map<string, UnclaimedRep>();
  for (const r of onOrders.rows) {
    const key = r.rep_name.toLowerCase();
    if (claimed.has(key)) continue;
    const prev = unclaimed.get(key);
    unclaimed.set(key, prev ? { ...prev, orders: prev.orders + r.orders } : r);
  }
  return {
    accounts: accounts.rows,
    unclaimed: [...unclaimed.values()].sort((a, b) => a.rep_name.localeCompare(b.rep_name)),
  };
}

/** Set (or clear, with "") which rep on the orders a Rep account is. Returns the account and its previous value, or null if no such Rep. */
export async function setRepName(
  userId: string,
  repName: string
): Promise<{ email: string; prev: string | null } | null> {
  const result = await query<{ email: string; prev: string | null }>(
    `UPDATE users u SET rep_name = NULLIF($2, ''), updated_at = now()
       FROM (SELECT rep_name AS prev FROM users WHERE id = $1) p
      WHERE u.id = $1 AND u.role = 'rep'
      RETURNING u.email, p.prev`,
    [userId, repName.trim()]
  );
  return result.rows[0] ?? null;
}
