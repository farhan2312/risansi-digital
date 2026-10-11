/**
 * /requests/access — who can open what, in one grid.
 *
 * The queue next door answers "what is waiting". This answers the question
 * that actually gets asked out loud: who has access to what, and as what. It
 * was previously a query somebody ran by hand, which is why nobody ran it.
 *
 * One row per active person, one column per live application. Deactivated
 * accounts are left out on purpose — they can open nothing regardless of what
 * their grants say, and listing them turns a review of who has access into a
 * list that has to be mentally filtered first. The count of them is shown so
 * their absence is a fact rather than an omission.
 *
 * Read-only. Changing a role or withdrawing access happens on the Requests
 * tab, where the forms already are and where one screen owns the writing.
 */

import type { Metadata } from 'next';
import { allRoles } from '@risansi/identity';
import db from '@/lib/db';
import { SiteHeader } from '@/components/site-header';
import { SiteFooter } from '@/components/site-footer';
import { RequestsTabs } from '@/components/requests-tabs';
import { requireApprover } from '@/lib/viewer';

export const metadata: Metadata = {
  title: 'Who has what — Risansi Digital',
};

interface AppCol {
  slug: string;
  name: string;
  needs_grant: boolean;
}

interface UserRow {
  id: string;
  name: string;
  email: string;
  role: string;
}

interface GrantRow {
  user_id: string;
  app_slug: string;
  status: string;
  app_role: string | null;
}

export default async function AccessMatrixPage() {
  await requireApprover();

  const roles = await allRoles(db);

  const apps = await db.query<AppCol>(
    `SELECT slug, name, needs_grant FROM identity.apps WHERE is_live ORDER BY sort_order`,
  );

  const users = await db.query<UserRow>(
    `SELECT id::text AS id, name, email, role
       FROM identity.users
      WHERE is_active
      ORDER BY name`,
  );

  const inactive = await db.query<{ n: string }>(
    `SELECT count(*) AS n FROM identity.users WHERE NOT is_active`,
  );

  // Every grant in one query rather than one per cell. At four applications
  // and a few dozen people the whole table is smaller than the page around it.
  const grants = await db.query<GrantRow>(
    `SELECT user_id::text AS user_id, app_slug, status, app_role
       FROM identity.app_grants`,
  );

  const byUser = new Map<string, Map<string, GrantRow>>();
  for (const g of grants.rows) {
    let row = byUser.get(g.user_id);
    if (!row) { row = new Map(); byUser.set(g.user_id, row); }
    row.set(g.app_slug, g);
  }

  function roleLabel(appSlug: string, role: string | null): string {
    if (!role) return 'no role set';
    return roles[appSlug]?.find(r => r.role === role)?.label ?? role;
  }

  /** What one person's cell says for one application. */
  function cell(user: UserRow, app: AppCol) {
    if (!app.needs_grant) {
      return <span className="cell-open">Open to all</span>;
    }
    const g = byUser.get(user.id)?.get(app.slug);
    if (!g || g.status === 'Rejected' || g.status === 'Revoked') {
      // A refused or withdrawn grant is the same answer as never having asked
      // — no access — so it reads the same. The history is in the audit log,
      // and putting it here would make "no" look like four different answers.
      return <span className="cell-no" aria-label="No access">—</span>;
    }
    if (g.status === 'Pending') {
      return <span className="cell-pending">Waiting</span>;
    }
    return <span className="cell-yes">{roleLabel(app.slug, g.app_role)}</span>;
  }

  const withAnything = users.rows.filter(u =>
    apps.rows.some(a => !a.needs_grant || byUser.get(u.id)?.get(a.slug)?.status === 'Approved'),
  ).length;

  return (
    <>
      <SiteHeader />

      <RequestsTabs active="access" />

      <div className="page-head">
        <h1>Who has what</h1>
        <p>
          Every active account against every portal, with the role each person
          holds inside it. Refused and withdrawn read the same as never asked,
          because they amount to the same access. Change any of it on the
          Requests tab.
        </p>
      </div>

      <div className="section-label">
        People · {String(users.rows.length).padStart(2, '0')}
      </div>
      <p className="section-note">
        {withAnything} of {users.rows.length} can open at least one portal.
        {Number(inactive.rows[0]?.n ?? 0) > 0
          ? ` ${inactive.rows[0]!.n} deactivated ${Number(inactive.rows[0]!.n) === 1 ? 'account is' : 'accounts are'} not listed — they can open nothing whatever their grants say.`
          : ''}
      </p>

      <div className="matrix-scroll">
        <table className="matrix">
          <thead>
            <tr>
              <th scope="col">Person</th>
              {apps.rows.map(a => (
                <th scope="col" key={a.slug}>{a.name}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {users.rows.map(u => (
              <tr key={u.id}>
                <th scope="row">
                  <span className="matrix-who">
                    {u.name}
                    {u.role === 'approver' && <span className="pill">Approver</span>}
                  </span>
                  <span className="matrix-mail">{u.email}</span>
                </th>
                {apps.rows.map(a => (
                  <td key={a.slug}>{cell(u, a)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <SiteFooter signedIn />
    </>
  );
}
