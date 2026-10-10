import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import risansiPool from '@/lib/db-risansi';
import { hasRole } from '@/lib/risansi-auth';
import { Topbar } from '@/components/risansi';
import { UsersManager, type UserRow } from '@/components/risansi/UsersManager';

export const dynamic = 'force-dynamic';

async function q<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try { return await fn(); } catch (err) { console.error('[admin/users]', err); return fallback; }
}

// Users & Access — the single home for account management: approve/reject
// access requests, create/edit users (name, email, role), reset passwords,
// activate/deactivate, and delete. Tour assignment lives on Tours & Reps.
export default async function AdminPage() {
  const session = await getServerSession(authOptions);
  const role    = session?.user?.role ?? '';

  // Sysadmin-only (mirrors the /admin proxy guard).
  if (!session?.user?.email || !hasRole(role, 'sysadmin')) {
    redirect('/risansi');
  }

  const users = await q<UserRow[]>(async () => {
    const { rows } = await risansiPool.query<UserRow>(`
      SELECT
        u.id::int                                   AS id,
        u.name,
        u.email,
        u.role,
        -- Zero or more per person, so an array rather than a column.
        ARRAY(SELECT d.department FROM user_departments d
               WHERE d.user_id = u.id ORDER BY d.department) AS departments,
        u.status,
        u.is_active,
        u.zone,
        u.route,
        u.rep_code,
        u.target_cr::float                          AS target_cr,
        (SELECT COUNT(*)::int FROM manager_reps mr WHERE mr.manager_id = u.id) AS team_count,
        COUNT(DISTINCT c.id)::int                   AS clients_count
      FROM users u
      -- Clients this person actually works, rather than everything on a route
      -- they happen to share. The route count this replaced reported on a
      -- structure that no longer decides anything.
      LEFT JOIN clients c ON c.deleted_at IS NULL
                         AND (c.primary_rep_id = u.id
                              OR c.id IN (SELECT client_id FROM client_secondary_reps WHERE rep_id = u.id))
      GROUP BY u.id
      ORDER BY
        CASE u.status WHEN 'Pending' THEN 0 ELSE 1 END,
        u.is_active DESC,
        u.name ASC
    `);
    return rows;
  }, []);

  const total   = users.length;
  const active  = users.filter(u => u.is_active).length;
  const pending = users.filter(u => u.status === 'Pending').length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ position: 'sticky', top: 0, zIndex: 10 }}>
        <Topbar crumbs={['System Admin', 'Users & Access']} />
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '22px 24px 40px', background: 'var(--bg)' }}>
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 22, fontWeight: 500, letterSpacing: '-0.02em', color: 'var(--fg)' }}>
            Users &amp; Access
          </div>
          <div style={{ fontSize: 12, color: 'var(--fg-3)', marginTop: 3 }}>
            {total} user{total !== 1 ? 's' : ''} · {active} active
            {pending > 0 ? ` · ${pending} pending` : ''}
          </div>
        </div>

        {pending > 0 && (
          <div style={{
            padding: '10px 16px', marginBottom: 16,
            background: '#FEF3C7', border: '1px solid rgba(217,119,6,0.25)',
            borderRadius: 6, fontSize: 13, color: '#92400E', fontWeight: 500,
          }}>
            {pending} access request{pending !== 1 ? 's' : ''} pending approval — approve or reject below.
          </div>
        )}

        <UsersManager users={users} />
      </div>
    </div>
  );
}
