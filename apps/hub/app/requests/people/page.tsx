/**
 * /requests/people — everybody, and the three things you do to an account.
 *
 * Creating somebody, resetting a password and switching an account off used
 * to live in each portal's own admin screens, four times over. They are here
 * now, once, and the portals' versions are being removed.
 *
 * Inactive accounts are listed rather than hidden. Half the point of this
 * screen is answering "is so-and-so still switched off", and a list that
 * silently omits them cannot.
 */

import type { Metadata } from 'next';
import { allRoles } from '@risansi/identity';
import db from '@/lib/db';
import { SiteHeader } from '@/components/site-header';
import { SiteFooter } from '@/components/site-footer';
import { RequestsTabs } from '@/components/requests-tabs';
import { NewUserForm, PersonActions, type GrantableApp } from '@/components/people-forms';
import { requireApprover } from '@/lib/viewer';

export const metadata: Metadata = {
  title: 'People — Risansi Digital',
};

interface PersonRow {
  id: string;
  name: string;
  email: string;
  role: string;
  is_active: boolean;
  must_change_password: boolean;
  has_password: boolean;
  access: string | null;
}

export default async function PeoplePage() {
  const viewer = await requireApprover();
  const roles = await allRoles(db);

  // Only what can actually be granted today. An application that is not open
  // yet would offer a role leading to a greyed tile.
  const apps = await db.query<{ slug: string; name: string }>(
    `SELECT slug, name FROM identity.apps
      WHERE is_live AND needs_grant AND NOT coming_soon
      ORDER BY sort_order`,
  );
  const grantable: GrantableApp[] = apps.rows.map(a => ({
    slug: a.slug,
    name: a.name,
    roles: roles[a.slug] ?? [],
  }));

  // One row per person, with their approved access folded into a single
  // string. Done in the query rather than in a loop: forty people times four
  // applications is a lot of round trips to render one table.
  const people = await db.query<PersonRow>(
    `SELECT u.id::text AS id, u.name, u.email, u.role, u.is_active,
            u.must_change_password,
            (u.password_hash IS NOT NULL) AS has_password,
            (SELECT string_agg(a.name || ' · ' || coalesce(r.label, g.app_role, '?'),
                               ', ' ORDER BY a.sort_order)
               FROM identity.app_grants g
               JOIN identity.apps a ON a.slug = g.app_slug
               LEFT JOIN identity.app_roles r
                      ON r.app_slug = g.app_slug AND r.role = g.app_role
              WHERE g.user_id = u.id AND g.status = 'Approved') AS access
       FROM identity.users u
      ORDER BY u.is_active DESC, u.name`,
  );

  const active = people.rows.filter(p => p.is_active).length;

  return (
    <>
      <SiteHeader />
      <RequestsTabs active="people" />

      <div className="page-head">
        <h1>People</h1>
        <p>
          Create an account with its access already decided, reset a password,
          or switch somebody off. All three used to live in each portal
          separately; doing them here reaches every portal at once.
        </p>
      </div>

      <div className="section-label">Add someone</div>
      <p className="section-note">
        For a new joiner whose access is already known. They sign in with a
        password you give them, are made to choose their own, and find their
        portals open — no request, no approval, no waiting.
      </p>
      <NewUserForm apps={grantable} />

      <div className="section-label">
        Everybody · {String(people.rows.length).padStart(2, '0')}
      </div>
      <p className="section-note">
        {active} active
        {people.rows.length > active ? `, ${people.rows.length - active} deactivated` : ''}.
        Deactivating locks every portal on that person&rsquo;s next click, not
        when their session expires, and leaves their grants alone so bringing
        them back is one switch.
      </p>

      <div className="matrix-scroll">
        <table className="matrix">
          <thead>
            <tr>
              <th scope="col">Person</th>
              <th scope="col">Can open</th>
              <th scope="col">State</th>
              <th scope="col">&nbsp;</th>
            </tr>
          </thead>
          <tbody>
            {people.rows.map(p => (
              <tr key={p.id}>
                <th scope="row">
                  <span className="matrix-who">
                    {p.name}
                    {p.role === 'approver' && <span className="pill">Approver</span>}
                  </span>
                  <span className="matrix-mail">{p.email}</span>
                </th>
                <td>
                  {p.access
                    ? <span className="cell-yes">{p.access}</span>
                    : <span className="cell-no">Nothing yet</span>}
                </td>
                <td>
                  {!p.is_active && <span className="cell-no">Deactivated</span>}
                  {p.is_active && !p.has_password && <span className="cell-no">No password set</span>}
                  {p.is_active && p.has_password && p.must_change_password && (
                    <span className="cell-pending">Must choose a password</span>
                  )}
                  {p.is_active && p.has_password && !p.must_change_password && (
                    <span className="cell-yes">Active</span>
                  )}
                </td>
                <td>
                  <PersonActions
                    email={p.email}
                    name={p.name}
                    isActive={p.is_active}
                    isSelf={p.id === viewer.id}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <SiteFooter signedIn />
    </>
  );
}
