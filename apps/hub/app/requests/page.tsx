/**
 * /requests — the approver's queue.
 *
 * `requireApprover()` is the boundary: a member who types this URL gets a 404,
 * and the header link to it is not rendered for them at all. Both of the
 * actions behind each row check the role again themselves, because a hidden
 * button is not a permission check.
 *
 * Two lists. What is waiting to be decided, and what has already been granted
 * and could be taken back. Revoking is here rather than on a separate screen
 * because it is the same question asked later, and the person deciding is the
 * same person.
 *
 * "Approver" is the role in the schema and in the code. It is called that
 * because deciding access requests is the only thing it grants — the hub gives
 * nobody power over a portal's internals. One approver covers every
 * application (MIGRATION_PLAN.md §2.5), so there is no per-app routing.
 */

import type { Metadata } from 'next';
import { allRoles } from '@risansi/identity';
import db from '@/lib/db';
import { SiteHeader } from '@/components/site-header';
import { SiteFooter } from '@/components/site-footer';
import { ApproveForm, RejectForm, RevokeForm } from '@/components/decision-forms';
import {
  GrantApproverForm,
  RevokeApproverForm,
  type Candidate,
} from '@/components/approver-forms';
import { requireApprover } from '@/lib/viewer';

export const metadata: Metadata = {
  title: 'Access requests — Risansi Digital',
};

interface PendingRow {
  id: string;
  app_slug: string;
  app_name: string;
  user_name: string;
  email: string;
  requested_at: Date;
  requested_reason: string | null;
}

interface ApprovedRow {
  id: string;
  app_slug: string;
  app_name: string;
  user_name: string;
  email: string;
  app_role: string | null;
  decided_at: Date | null;
  decided_by_email: string | null;
}

/**
 * Dates are formatted in Asia/Kolkata explicitly rather than with the server's
 * locale. Vercel runs in UTC, so "yesterday evening" would otherwise read as
 * the wrong day to everyone looking at this screen.
 */
const WHEN = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Kolkata',
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

function when(value: Date | null): string {
  return value ? WHEN.format(value) : '—';
}

export default async function RequestsPage() {
  const viewer = await requireApprover();

  // All four portals' roles in one query, since the queue lists requests for
  // several applications at once.
  const roles = await allRoles(db);

  const pending = await db.query<PendingRow>(
    `SELECT g.id::text AS id, g.app_slug, a.name AS app_name,
            u.name AS user_name, u.email,
            g.requested_at, g.requested_reason
       FROM identity.app_grants g
       JOIN identity.users u ON u.id = g.user_id
       JOIN identity.apps  a ON a.slug = g.app_slug
      WHERE g.status = 'Pending'
      ORDER BY g.requested_at`,
  );

  const approved = await db.query<ApprovedRow>(
    `SELECT g.id::text AS id, g.app_slug, a.name AS app_name,
            u.name AS user_name, u.email, g.app_role, g.decided_at,
            d.email AS decided_by_email
       FROM identity.app_grants g
       JOIN identity.users u ON u.id = g.user_id
       JOIN identity.apps  a ON a.slug = g.app_slug
       LEFT JOIN identity.users d ON d.id = g.decided_by
      WHERE g.status = 'Approved'
      ORDER BY a.sort_order, u.name`,
  );

  // Who decides, and who could. Active accounts only: an approver who cannot
  // sign in is a name on a list that quietly decides nothing.
  const approvers = await db.query<{ id: string; name: string; email: string }>(
    `SELECT id::text AS id, name, email
       FROM identity.users
      WHERE role = 'approver' AND is_active
      ORDER BY name`,
  );

  const candidates = await db.query<Candidate>(
    `SELECT id::text AS id, name, email
       FROM identity.users
      WHERE role <> 'approver' AND is_active
      ORDER BY name`,
  );

  /** The label from identity.app_roles, so the list does not show raw slugs. */
  function roleLabel(appSlug: string, role: string | null): string {
    if (!role) return 'no role set';
    return roles[appSlug]?.find(r => r.role === role)?.label ?? role;
  }

  return (
    <>
      <SiteHeader />

      <div className="page-head">
        <h1>Access requests</h1>
        <p>
          Approving sets the role the person gets inside that portal. Each portal
          keeps its own vocabulary, so the roles on offer change with the
          application — read what one carries before granting it.
        </p>
      </div>

      <div className="section-label">
        Waiting · {String(pending.rows.length).padStart(2, '0')}
      </div>

      {pending.rows.length === 0
        ? <p className="empty">Nothing waiting. Everything asked for has been decided.</p>
        : (
          <div className="queue">
            {pending.rows.map(row => (
              <article className="queue-item" key={row.id}>
                <div className="queue-head">
                  <div>
                    <div className="queue-who">{row.user_name}</div>
                    <div className="queue-meta">{row.email}</div>
                  </div>
                  <div>
                    <div className="queue-app">{row.app_name}</div>
                    <div className="queue-meta">asked {when(row.requested_at)}</div>
                  </div>
                </div>

                {row.requested_reason
                  ? <p className="queue-reason">{row.requested_reason}</p>
                  : <p className="queue-reason muted">No reason given.</p>}

                <div className="queue-forms">
                  <ApproveForm
                    grantId={row.id}
                    appSlug={row.app_slug}
                    roles={roles[row.app_slug] ?? []}
                  />
                  <RejectForm grantId={row.id} />
                </div>
              </article>
            ))}
          </div>
        )}

      <div className="section-label">
        Granted · {String(approved.rows.length).padStart(2, '0')}
      </div>

      {approved.rows.length === 0
        ? <p className="empty">Nobody holds access to anything yet.</p>
        : (
          <div className="queue">
            {approved.rows.map(row => (
              <article className="queue-item" key={row.id}>
                <div className="queue-head">
                  <div>
                    <div className="queue-who">{row.user_name}</div>
                    <div className="queue-meta">{row.email}</div>
                  </div>
                  <div>
                    <div className="queue-app">
                      {row.app_name} · {roleLabel(row.app_slug, row.app_role)}
                    </div>
                    <div className="queue-meta">
                      {`granted ${when(row.decided_at)}`}
                      {row.decided_by_email ? ` by ${row.decided_by_email}` : ''}
                    </div>
                  </div>
                </div>

                <div className="queue-forms">
                  <RevokeForm grantId={row.id} />
                </div>
              </article>
            ))}
          </div>
        )}

      <div className="section-label">
        Approvers · {String(approvers.rows.length).padStart(2, '0')}
      </div>

      <p className="section-note">
        An approver decides access for every portal, not one. Keep at least two,
        so a request does not wait on one person being at their desk.
      </p>

      <div className="queue">
        {approvers.rows.map(row => (
          <article className="queue-item" key={row.id}>
            <div className="queue-head">
              <div>
                <div className="queue-who">{row.name}</div>
                <div className="queue-meta">{row.email}</div>
              </div>
            </div>
            <div className="queue-forms">
              <RevokeApproverForm
                userId={row.id}
                name={row.name}
                isSelf={row.id === viewer.id}
              />
            </div>
          </article>
        ))}

        <article className="queue-item">
          <div className="queue-forms">
            <GrantApproverForm candidates={candidates.rows} />
          </div>
        </article>
      </div>

      <SiteFooter signedIn />
    </>
  );
}
