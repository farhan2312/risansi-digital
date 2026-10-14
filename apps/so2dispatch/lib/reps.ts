import { query } from "@/lib/db";
import { listTeams } from "@/lib/market-intell";

/**
 * Reps and Rep Managers, and which SOs each sees — for the admin's Reps page.
 * Read-only: nothing about it is kept or edited here.
 *
 * - Accounts are managed at Risansi Digital (role Rep or Rep Manager).
 * - A rep's own SOs are those whose orders.reps is their full name — the name
 *   the sales portal gives them.
 * - A Rep Manager's team is the sales portal's manager_reps, read live.
 */

export type RepAccount = {
  id: string;
  full_name: string;
  email: string;
  role: "rep" | "rep_manager";
  /** Linked to Risansi Digital — signs in there. */
  linked: boolean;
  /** SOs whose rep is this account's own name. */
  orders: number;
  /** Latest thing this account did here (audit log), or null. */
  last_active: string | null;
  /**
   * The reps under them in the sales portal, with their SO counts. Set for a
   * Rep Manager; set for a Rep too when the sales portal has them managing
   * somebody — they need the Rep Manager role at the hub to see those SOs.
   */
  team: { name: string; orders: number }[] | null;
};

/** A rep name on orders that is nobody's own name here. */
export type UnclaimedRep = { rep_name: string; orders: number };

export async function listReps(): Promise<{
  accounts: RepAccount[];
  unclaimed: UnclaimedRep[];
  /** False when the sales portal could not be read: teams are then unknown, not empty. */
  teamsRead: boolean;
}> {
  const [accounts, onOrders, teams] = await Promise.all([
    query<Omit<RepAccount, "team">>(
      `SELECT u.id, u.full_name, u.email, u.role,
              (u.identity_user_id IS NOT NULL) AS linked,
              (SELECT count(*)::int FROM orders o
                WHERE lower(trim(o.reps)) = lower(trim(u.full_name))) AS orders,
              (SELECT max(a.created_at) FROM audit_log a WHERE a.user_id = u.id) AS last_active
         FROM users u
        WHERE u.role IN ('rep', 'rep_manager')
        ORDER BY u.role DESC, lower(u.full_name)`
    ),
    query<UnclaimedRep>(
      `SELECT trim(reps) AS rep_name, count(*)::int AS orders
         FROM orders
        WHERE trim(coalesce(reps, '')) <> ''
        GROUP BY trim(reps)`
    ),
    listTeams().then(
      (t) => t,
      (error) => {
        console.error("listTeams failed:", error);
        return null;
      }
    ),
  ]);

  const ordersByRep = new Map<string, number>();
  for (const r of onOrders.rows) {
    const key = r.rep_name.toLowerCase();
    ordersByRep.set(key, (ordersByRep.get(key) ?? 0) + r.orders);
  }

  const withTeams: RepAccount[] = accounts.rows.map((a) => {
    const names = teams?.get(a.email.trim().toLowerCase());
    const team = names
      ? names.map((name) => ({ name, orders: ordersByRep.get(name.toLowerCase()) ?? 0 }))
      : a.role === "rep_manager"
        ? []
        : null;
    return { ...a, team };
  });

  const own = new Set(accounts.rows.map((a) => a.full_name.trim().toLowerCase()));
  const unclaimed = new Map<string, UnclaimedRep>();
  for (const r of onOrders.rows) {
    const key = r.rep_name.toLowerCase();
    if (own.has(key)) continue;
    const prev = unclaimed.get(key);
    unclaimed.set(key, prev ? { ...prev, orders: prev.orders + r.orders } : r);
  }

  return {
    accounts: withTeams,
    unclaimed: [...unclaimed.values()].sort((a, b) => a.rep_name.localeCompare(b.rep_name)),
    teamsRead: teams !== null,
  };
}
