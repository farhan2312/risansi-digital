'use server';

/**
 * Asking for an application, and deciding who gets it.
 *
 * Four functions: one anybody signed in may call, three only an approver may.
 * Each of the three calls `requireApprover()` itself. The header link to
 * /requests is not rendered for a member and the page 404s for them, but
 * neither of those is a permission check — a Server Function is reachable by
 * direct POST, so the check belongs in the function.
 *
 * Each of the four also sends an email, and none of them depends on it. The
 * notify package returns a result rather than throwing, and nothing here reads
 * `result.ok`: a grant that saved and whose notification did not go out is an
 * inconvenience, while a grant rolled back because Resend was down would be a
 * system that is less reliable for having notifications than without them.
 */

import { requestAccess } from '@risansi/identity';
import {
  notifyAccessDecided,
  notifyAccessRequested,
  notifyAccessRevoked,
  notifyRoleChanged,
} from '@risansi/notify';
import db from '@/lib/db';
import { logAuthEvent } from '@/lib/audit';
import { requireApprover, requireViewer } from '@/lib/viewer';

export interface ActionState {
  error?: string;
  notice?: string;
}

function text(formData: FormData, field: string): string {
  const v = formData.get(field);
  return typeof v === 'string' ? v : '';
}

/** Keep a free-text field from becoming an essay in the database. */
function trimmedOrNull(value: string, max: number): string | null {
  const t = value.trim();
  if (!t) return null;
  return t.length > max ? t.slice(0, max) : t;
}

// ── Asking ─────────────────────────────────────────────────────────

export async function requestAccessAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const viewer = await requireViewer();
  const slug = text(formData, 'slug').trim();
  const reason = trimmedOrNull(text(formData, 'reason'), 1000);

  if (!slug) return { error: 'Nothing was selected.' };

  // The slug arrives from a form field, so confirm it is a live application
  // that actually gates itself rather than taking the client's word for it.
  const { rows } = await db.query<{ name: string; needs_grant: boolean }>(
    `SELECT name, needs_grant FROM identity.apps WHERE slug = $1 AND is_live`,
    [slug],
  );
  const app = rows[0];
  if (!app) return { error: 'That application is not available.' };
  if (!app.needs_grant) return { error: `${app.name} is open to everyone — no request needed.` };

  // Upserts. Asking again after a refusal reopens the same row; asking for
  // something already approved or pending leaves it exactly as it was, so a
  // double-click cannot knock somebody out of a portal they were just using.
  const { state } = await requestAccess(db, viewer.id, slug, reason);

  if (state === 'unchanged') {
    return { notice: `Your request for ${app.name} is already on the list.` };
  }

  await logAuthEvent({
    event: 'access_requested',
    email: viewer.email,
    userId: viewer.id,
    appSlug: slug,
    detail: state === 'reopened' ? 'asked again after a refusal' : null,
  });

  // Tells the approvers. Awaited so a failure is logged inside this request
  // rather than after the response, but the result is deliberately not read:
  // the grant is the thing that matters and it is already saved.
  await notifyAccessRequested(db, {
    requesterName: viewer.name,
    requesterEmail: viewer.email,
    appName: app.name,
    reason,
  });

  return { notice: `Asked for ${app.name}. An approver will decide.` };
}

// ── Deciding ───────────────────────────────────────────────────────

interface Settled {
  email: string;
  name: string;
  appSlug: string;
  appName: string;
  appUrl: string;
}

/**
 * Settle one grant, and return who it was about.
 *
 * The status in the WHERE clause is what makes two approvers clicking at once
 * safe: the second update matches nothing and is reported as already decided,
 * rather than overwriting the first decision.
 *
 * The person and the application come back with it, because the notification
 * needs their name and the portal's URL and asking again afterwards would be
 * two more round trips to say one thing.
 */
async function decide(
  grantId: string,
  from: 'Pending' | 'Approved' | 'Rejected' | 'Revoked',
  to: 'Approved' | 'Rejected' | 'Revoked',
  deciderId: string,
  appRole: string | null,
  note: string | null,
): Promise<Settled | null> {
  const { rows } = await db.query<{
    app_slug: string; email: string; name: string; app_name: string; app_url: string;
  }>(
    `UPDATE identity.app_grants g
        SET status       = $3,
            app_role     = CASE WHEN $3 = 'Approved' THEN $5 ELSE g.app_role END,
            decided_by   = $4,
            decided_at   = now(),
            decided_note = $6,
            updated_at   = now()
      WHERE g.id = $1 AND g.status = $2
      RETURNING g.app_slug,
                (SELECT u.email FROM identity.users u WHERE u.id = g.user_id) AS email,
                (SELECT u.name  FROM identity.users u WHERE u.id = g.user_id) AS name,
                (SELECT a.name  FROM identity.apps  a WHERE a.slug = g.app_slug) AS app_name,
                (SELECT a.url   FROM identity.apps  a WHERE a.slug = g.app_slug) AS app_url`,
    [grantId, from, to, deciderId, appRole, note],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    email: row.email,
    name: row.name,
    appSlug: row.app_slug,
    appName: row.app_name,
    appUrl: row.app_url,
  };
}

function grantIdFrom(formData: FormData): string | null {
  const raw = text(formData, 'grantId').trim();
  // bigserial. Keep it to digits so nothing else reaches the query.
  return /^\d+$/.test(raw) ? raw : null;
}

export async function approveGrantAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const approver = await requireApprover();
  const grantId = grantIdFrom(formData);
  if (!grantId) return { error: 'That request could not be found.' };

  // Each portal has its own role vocabulary and there is no global one, so the
  // role is per-application and comes from identity.app_roles. The approver
  // sets it at the moment of approval — the old sales sign-up let the requester
  // pick their own role, which is a claim rather than a decision.
  const role = trimmedOrNull(text(formData, 'role'), 60);

  // `app_grants` carries a composite foreign key on (app_slug, app_role), so a
  // role that does not exist cannot be stored. But MATCH SIMPLE means a NULL
  // role satisfies it — that is what lets a Pending grant exist before anyone
  // has decided — so nothing in the database stops an *approved* grant with no
  // role at all. The form has to, and so does this.
  if (!role) {
    return { error: 'Choose the role this person gets inside that portal.' };
  }

  const { rows: grantRows } = await db.query<{ app_slug: string; status: string }>(
    `SELECT app_slug, status FROM identity.app_grants WHERE id = $1`,
    [grantId],
  );
  const grant = grantRows[0];
  if (!grant) return { error: 'That request could not be found.' };
  if (grant.status !== 'Pending') return { error: 'That request has already been decided.' };

  // Checked here as well as by the constraint, so a bad value reads as a
  // sentence on the form rather than as a 500 from a foreign key violation.
  // The label comes back with it, for the email: "Billing & Operations" tells
  // somebody what they were given, `operations` does not.
  const { rows: roleRows } = await db.query<{ label: string }>(
    `SELECT label FROM identity.app_roles WHERE app_slug = $1 AND role = $2`,
    [grant.app_slug, role],
  );
  const roleRow = roleRows[0];
  if (!roleRow) {
    return { error: `${role} is not a role that application has.` };
  }

  const settled = await decide(grantId, 'Pending', 'Approved', approver.id, role, null);
  if (!settled) return { error: 'That request has already been decided.' };

  await logAuthEvent({
    event: 'grant_approved',
    email: settled.email,
    appSlug: settled.appSlug,
    detail: `role ${role}, approved by ${approver.email}`,
  });

  await notifyAccessDecided({
    requesterName: settled.name,
    requesterEmail: settled.email,
    appName: settled.appName,
    appUrl: settled.appUrl,
    approved: true,
    appRole: role,
    roleLabel: roleRow.label,
    decidedByName: approver.name,
  });

  return { notice: `${settled.email} can open ${settled.appName} as ${roleRow.label}.` };
}

/**
 * Change the role on a grant somebody already holds.
 *
 * Separate from approving, because it answers a different question. Approving
 * decides whether a person gets in at all; this decides what they can do once
 * they are, and it is the one that gets revisited — somebody changes team, or
 * was given more than they needed on a busy day. Doing it by revoking and
 * re-granting would work and would also mail them twice, log a withdrawal
 * that never happened, and lose who first let them in.
 *
 * `status = 'Approved'` in the WHERE clause rather than a read-then-write, so
 * a role cannot be set on a grant another approver is revoking at the same
 * moment.
 */
/**
 * Put back access that was refused or withdrawn.
 *
 * The screen could approve a request, refuse one, change a role and revoke —
 * and then had nothing to say to a `Rejected` or `Revoked` row ever again.
 * That is the wrong shape for what this actually is. A refusal is usually
 * "not yet": somebody asks before they need it, is told no, and asks again
 * three weeks later. Without this the only way back was a second request
 * from the person, or psql.
 *
 * It is not a second `approve`. Approve moves Pending → Approved and is the
 * first decision on a request; this one knowingly overturns a decision that
 * was already made, which is why it logs `grant_reinstated` with the status
 * it came from rather than pretending the refusal never happened.
 *
 * The person is told, using the same mail an approval sends — from where they
 * stand that is exactly what has happened.
 */
export async function reinstateGrantAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const approver = await requireApprover();
  const grantId = grantIdFrom(formData);
  if (!grantId) return { error: 'That grant could not be found.' };

  const role = trimmedOrNull(text(formData, 'role'), 60);
  if (!role) return { error: 'Choose the role they should have.' };

  const { rows: grantRows } = await db.query<{ app_slug: string; status: string }>(
    `SELECT app_slug, status FROM identity.app_grants WHERE id = $1`,
    [grantId],
  );
  const grant = grantRows[0];
  if (!grant) return { error: 'That grant could not be found.' };
  if (grant.status === 'Approved') return { notice: 'They already have that access.' };
  if (grant.status === 'Pending') {
    return { error: 'That one is still waiting on a decision — approve it instead.' };
  }

  const { rows: roleRows } = await db.query<{ label: string }>(
    `SELECT label FROM identity.app_roles WHERE app_slug = $1 AND role = $2`,
    [grant.app_slug, role],
  );
  const roleRow = roleRows[0];
  if (!roleRow) return { error: `${role} is not a role that application has.` };

  // The old status is in the WHERE clause for the same reason every other
  // decision here puts it there: two approvers acting at once settle it once.
  const settled = await decide(
    grantId, grant.status as 'Rejected' | 'Revoked', 'Approved', approver.id, role, null);
  if (!settled) return { error: 'That grant changed while you were looking at it.' };

  await logAuthEvent({
    event: 'grant_reinstated',
    email: settled.email,
    appSlug: settled.appSlug,
    detail: `${grant.status} to Approved as ${role}, by ${approver.email}`,
  });

  await notifyAccessDecided({
    requesterName: settled.name,
    requesterEmail: settled.email,
    appName: settled.appName,
    appUrl: settled.appUrl,
    approved: true,
    appRole: role,
    roleLabel: roleRow.label,
    decidedByName: approver.name,
  });

  return { notice: `${settled.email} can open ${settled.appName} as ${roleRow.label}.` };
}

export async function changeRoleAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const approver = await requireApprover();
  const grantId = grantIdFrom(formData);
  if (!grantId) return { error: 'That grant could not be found.' };

  const role = trimmedOrNull(text(formData, 'role'), 60);
  if (!role) return { error: 'Choose the role they should have.' };

  const { rows: grantRows } = await db.query<{
    app_slug: string; status: string; app_role: string | null;
  }>(
    `SELECT app_slug, status, app_role FROM identity.app_grants WHERE id = $1`,
    [grantId],
  );
  const grant = grantRows[0];
  if (!grant) return { error: 'That grant could not be found.' };
  if (grant.status !== 'Approved') return { error: 'That grant is not currently approved.' };
  if (grant.app_role === role) return { notice: 'That is already their role.' };

  // Both labels, in one query: the new one for the message and the old one for
  // the email, which is worth little if it cannot say what changed.
  const { rows: roleRows } = await db.query<{ role: string; label: string }>(
    `SELECT role, label FROM identity.app_roles WHERE app_slug = $1 AND role = ANY($2::text[])`,
    [grant.app_slug, [role, grant.app_role].filter(Boolean)],
  );
  const toRole = roleRows.find(r => r.role === role);
  if (!toRole) return { error: `${role} is not a role that application has.` };
  const fromLabel = roleRows.find(r => r.role === grant.app_role)?.label
    ?? grant.app_role
    ?? 'no role set';

  const { rows } = await db.query<{
    email: string; name: string; app_name: string; app_url: string;
  }>(
    `UPDATE identity.app_grants g
        SET app_role = $2, updated_at = now()
      WHERE g.id = $1 AND g.status = 'Approved'
      RETURNING (SELECT u.email FROM identity.users u WHERE u.id = g.user_id) AS email,
                (SELECT u.name  FROM identity.users u WHERE u.id = g.user_id) AS name,
                (SELECT a.name  FROM identity.apps  a WHERE a.slug = g.app_slug) AS app_name,
                (SELECT a.url   FROM identity.apps  a WHERE a.slug = g.app_slug) AS app_url`,
    [grantId, role],
  );
  const row = rows[0];
  if (!row) return { error: 'That grant is no longer approved.' };

  await logAuthEvent({
    event: 'grant_role_changed',
    email: row.email,
    appSlug: grant.app_slug,
    detail: `${grant.app_role ?? 'no role'} to ${role}, by ${approver.email}`,
  });

  await notifyRoleChanged({
    userName: row.name,
    userEmail: row.email,
    appName: row.app_name,
    appUrl: row.app_url,
    fromLabel,
    toLabel: toRole.label,
    changedByName: approver.name,
  });

  return { notice: `${row.email} is now ${toRole.label} in ${row.app_name}.` };
}

export async function rejectGrantAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const approver = await requireApprover();
  const grantId = grantIdFrom(formData);
  if (!grantId) return { error: 'That request could not be found.' };

  // Optional, and shown to the person both on their tile and in the email they
  // get. Worth writing: "Not granted" with no explanation is the worst version
  // of this screen.
  const note = trimmedOrNull(text(formData, 'note'), 500);

  const settled = await decide(grantId, 'Pending', 'Rejected', approver.id, null, note);
  if (!settled) return { error: 'That request has already been decided.' };

  await logAuthEvent({
    event: 'grant_rejected',
    email: settled.email,
    appSlug: settled.appSlug,
    detail: `rejected by ${approver.email}${note ? `: ${note}` : ''}`,
  });

  await notifyAccessDecided({
    requesterName: settled.name,
    requesterEmail: settled.email,
    appName: settled.appName,
    appUrl: settled.appUrl,
    approved: false,
    decidedByName: approver.name,
    note,
  });

  return { notice: `Refused ${settled.email} for ${settled.appName}.` };
}

export async function revokeGrantAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const approver = await requireApprover();
  const grantId = grantIdFrom(formData);
  if (!grantId) return { error: 'That grant could not be found.' };

  const note = trimmedOrNull(text(formData, 'note'), 500);

  // Revoked rather than Rejected. The two are kept apart because they are
  // different conversations: one is "you were never given this", the other is
  // "this was taken from you".
  const settled = await decide(grantId, 'Approved', 'Revoked', approver.id, null, note);
  if (!settled) return { error: 'That grant is no longer approved.' };

  await logAuthEvent({
    event: 'grant_revoked',
    email: settled.email,
    appSlug: settled.appSlug,
    detail: `revoked by ${approver.email}${note ? `: ${note}` : ''}`,
  });

  // Its own template, not the rejection card. "Your request was not approved"
  // reads as nonsense to somebody who has been using the portal for a month,
  // and losing access is the one event here a person did not initiate — so it
  // names who did it and offers nothing to click, because what they need is a
  // conversation rather than a button.
  await notifyAccessRevoked({
    personName: settled.name,
    personEmail: settled.email,
    appName: settled.appName,
    revokedByName: approver.name,
    note,
  });

  return { notice: `Withdrew ${settled.email}'s access to ${settled.appName}.` };
}
