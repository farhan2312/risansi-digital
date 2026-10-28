import "server-only";
// A person may work for more than one department here. Their main role is the
// one Risansi Digital's grant gives them (or users.role, unlinked); Admin adds
// the other departments here (user_extra_roles). They switch between them in
// the sidebar: the role they are working as is a cookie, honoured only while
// it is still one of theirs (lib/session.ts), and the rest of the app reads
// that one role exactly as it always has.

import { query } from "@/lib/db";
import { ALL_ROLES, type Role } from "@/lib/roles";

/** The cookie holding the role a person is working as. */
export const ACTIVE_ROLE_COOKIE = "so2d_active_role";

/** The roles Admin may add as a person's extra departments: every role but Admin itself. */
export const EXTRA_ROLE_CHOICES: Role[] = ALL_ROLES.filter((r) => r !== "admin");

/** A person's extra departments, oldest first. */
export async function extraRolesFor(userId: string): Promise<Role[]> {
  const r = await query<{ role: string }>(`SELECT role FROM user_extra_roles WHERE user_id = $1 ORDER BY created_at, role`, [userId]);
  return r.rows.map((x) => x.role).filter((x): x is Role => (EXTRA_ROLE_CHOICES as string[]).includes(x));
}

export type UserRoles = { id: string; full_name: string; email: string; role: Role; extra: Role[] };

/** Every approved account, with its main role and extra departments — for Admin's page. */
export async function listUserRoles(): Promise<UserRoles[]> {
  const r = await query<UserRoles>(
    `SELECT u.id, u.full_name, u.email, u.role,
            COALESCE((SELECT array_agg(x.role ORDER BY x.created_at, x.role) FROM user_extra_roles x WHERE x.user_id = u.id), '{}') AS extra
       FROM users u
      WHERE u.status = 'approved'
      ORDER BY lower(u.full_name)`
  );
  return r.rows;
}

/** Set a person's extra departments to exactly these (their main role is never one of them). */
export async function setExtraRoles(userId: string, roles: Role[], mainRole: Role, actorId: string): Promise<void> {
  const keep = [...new Set(roles)].filter((r) => EXTRA_ROLE_CHOICES.includes(r) && r !== mainRole);
  await query(`DELETE FROM user_extra_roles WHERE user_id = $1 AND NOT (role = ANY($2::text[]))`, [userId, keep]);
  for (const role of keep) {
    await query(
      `INSERT INTO user_extra_roles (user_id, role, created_by) VALUES ($1, $2, $3) ON CONFLICT (user_id, role) DO NOTHING`,
      [userId, role, actorId]
    );
  }
}
