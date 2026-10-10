/**
 * What a person may open.
 *
 * Read from the database on the request that needs it, never from the session
 * token — see the note in session.ts. That is what makes revoking somebody take
 * effect on their next click.
 *
 * These functions take a client rather than opening one, so this package holds
 * no connection details and can be imported by the hub and by any portal
 * without each of them agreeing on how the pool is built.
 */

export type GrantStatus = 'Pending' | 'Approved' | 'Rejected' | 'Revoked';

/** The least a caller has to provide. `pg`'s Client and Pool both satisfy it. */
export interface Queryable {
  query<R = Record<string, unknown>>(
    sql: string, params?: unknown[],
  ): Promise<{ rows: R[]; rowCount: number | null }>;
}

export interface AppTile {
  slug: string;
  name: string;
  url: string;
  blurb: string | null;
  sortOrder: number;
  needsGrant: boolean;
  /** Null when they have never asked. */
  status: GrantStatus | null;
  /** The portal's own role, set by the approver. Null until approved. */
  appRole: string | null;
  requestedReason: string | null;
  decidedNote: string | null;
}

/**
 * What the tile should offer.
 *
 *   open       go straight in
 *   request    never asked, and it needs asking
 *   requested  asked, nobody has decided
 *   refused    rejected, or revoked
 *
 * `refused` folds Rejected and Revoked together for the UI while the two stay
 * distinct in the database, because a person asking why deserves the real
 * answer and the two are different conversations.
 */
export type TileState = 'open' | 'request' | 'requested' | 'refused';

export function tileState(t: Pick<AppTile, 'needsGrant' | 'status'>): TileState {
  if (!t.needsGrant) return 'open';
  switch (t.status) {
    case 'Approved': return 'open';
    case 'Pending':  return 'requested';
    case 'Rejected':
    case 'Revoked':  return 'refused';
    default:         return 'request';
  }
}

/** One role a portal offers, as the approval form should present it. */
export interface AppRole {
  role: string;
  label: string;
  description: string;
}

/**
 * The roles an application actually has, in the order to offer them.
 *
 * For the approval form: an approver picks from these rather than typing, and
 * `app_grants` carries a composite foreign key onto the same table, so a role
 * that does not exist cannot be stored even if the form is bypassed. The
 * dropdown is the convenience; the constraint is the rule.
 *
 * `description` is not decoration. `operations` and `central_visibility` mean
 * nothing to somebody outside that department, and an approver guessing between
 * them is how the wrong access gets granted to the right person.
 */
export async function rolesFor(db: Queryable, appSlug: string): Promise<AppRole[]> {
  const { rows } = await db.query<AppRole>(
    `SELECT role, label, description FROM identity.app_roles
      WHERE app_slug = $1 ORDER BY sort_order, label`,
    [appSlug],
  );
  return rows;
}

/** Every application's roles at once, keyed by slug — for the approval queue. */
export async function allRoles(db: Queryable): Promise<Record<string, AppRole[]>> {
  const { rows } = await db.query<AppRole & { app_slug: string }>(
    `SELECT app_slug, role, label, description FROM identity.app_roles
      ORDER BY app_slug, sort_order, label`,
  );
  const out: Record<string, AppRole[]> = {};
  for (const r of rows) {
    (out[r.app_slug] ??= []).push({ role: r.role, label: r.label, description: r.description });
  }
  return out;
}

/** Every live application, with this person's standing against each. */
export async function tilesFor(db: Queryable, userId: string): Promise<AppTile[]> {
  const { rows } = await db.query<{
    slug: string; name: string; url: string; blurb: string | null;
    sort_order: number; needs_grant: boolean;
    status: GrantStatus | null; app_role: string | null;
    requested_reason: string | null; decided_note: string | null;
  }>(
    `SELECT a.slug, a.name, a.url, a.blurb, a.sort_order, a.needs_grant,
            g.status, g.app_role, g.requested_reason, g.decided_note
       FROM identity.apps a
       LEFT JOIN identity.app_grants g
              ON g.app_slug = a.slug AND g.user_id = $1
      WHERE a.is_live
      ORDER BY a.sort_order, a.name`,
    [userId],
  );
  return rows.map(r => ({
    slug: r.slug, name: r.name, url: r.url, blurb: r.blurb,
    sortOrder: r.sort_order, needsGrant: r.needs_grant,
    status: r.status, appRole: r.app_role,
    requestedReason: r.requested_reason, decidedNote: r.decided_note,
  }));
}

/**
 * May this person open this application right now?
 *
 * The one function a portal calls. Deliberately narrow: it answers for one
 * app and returns the app-specific role alongside, because a portal needs both
 * and asking twice would be two round trips to decide one page.
 *
 * An application with `needs_grant = false` is open to anyone signed in. An
 * inactive user is refused regardless of any grant they hold, so deactivating
 * somebody at the hub locks every portal at once without touching four tables.
 */
export async function mayOpen(
  db: Queryable, userId: string, appSlug: string,
): Promise<{ allowed: boolean; appRole: string | null; reason: string | null }> {
  const { rows } = await db.query<{
    is_active: boolean; needs_grant: boolean;
    status: GrantStatus | null; app_role: string | null;
  }>(
    `SELECT u.is_active, a.needs_grant, g.status, g.app_role
       FROM identity.users u
       CROSS JOIN identity.apps a
       LEFT JOIN identity.app_grants g ON g.user_id = u.id AND g.app_slug = a.slug
      WHERE u.id = $1 AND a.slug = $2 AND a.is_live`,
    [userId, appSlug],
  );
  const r = rows[0];
  if (!r) return { allowed: false, appRole: null, reason: 'That application is not available.' };
  if (!r.is_active) {
    return { allowed: false, appRole: null, reason: 'Your access to Risansi Digital has been withdrawn.' };
  }
  if (!r.needs_grant) return { allowed: true, appRole: null, reason: null };

  switch (r.status) {
    case 'Approved': return { allowed: true, appRole: r.app_role, reason: null };
    case 'Pending':  return { allowed: false, appRole: null, reason: 'Your request for access is waiting to be approved.' };
    case 'Rejected': return { allowed: false, appRole: null, reason: 'Your request for access to this application was not approved.' };
    case 'Revoked':  return { allowed: false, appRole: null, reason: 'Your access to this application was withdrawn.' };
    default:         return { allowed: false, appRole: null, reason: 'You do not have access to this application yet. Request it from Risansi Digital.' };
  }
}

/**
 * Ask for access, or ask again.
 *
 * Upserts, because the unique index allows one row per person per app: asking
 * again after a refusal reopens the same row rather than adding a second, so
 * the tile can never show two states at once and the history stays on one line.
 *
 * A row already Approved or Pending is left exactly as it is — re-requesting
 * something you already hold must not reset it to Pending and lock you out of
 * a portal you were using a moment ago.
 */
export async function requestAccess(
  db: Queryable, userId: string, appSlug: string, reason: string | null,
): Promise<{ ok: true; state: 'created' | 'reopened' | 'unchanged' }> {
  // `before` is read in the same statement, so it sees the row as it was prior
  // to the upsert. That is the only way to tell the three outcomes apart:
  // RETURNING can only see the NEW row, so a repeat request on something
  // already Pending looks identical to one that has just been reopened after a
  // refusal. Reporting that as "reopened" would have told somebody their
  // request was reinstated when in fact nothing happened.
  const { rows } = await db.query<{ state: string }>(
    `WITH before AS (
       SELECT status FROM identity.app_grants WHERE user_id = $1 AND app_slug = $2
     ), up AS (
       INSERT INTO identity.app_grants (user_id, app_slug, status, requested_reason)
       VALUES ($1, $2, 'Pending', $3)
       ON CONFLICT (user_id, app_slug) DO UPDATE
          SET status           = CASE WHEN identity.app_grants.status IN ('Rejected','Revoked')
                                      THEN 'Pending' ELSE identity.app_grants.status END,
              requested_reason = CASE WHEN identity.app_grants.status IN ('Rejected','Revoked')
                                      THEN EXCLUDED.requested_reason ELSE identity.app_grants.requested_reason END,
              requested_at     = CASE WHEN identity.app_grants.status IN ('Rejected','Revoked')
                                      THEN now() ELSE identity.app_grants.requested_at END,
              decided_by       = CASE WHEN identity.app_grants.status IN ('Rejected','Revoked')
                                      THEN NULL ELSE identity.app_grants.decided_by END,
              decided_at       = CASE WHEN identity.app_grants.status IN ('Rejected','Revoked')
                                      THEN NULL ELSE identity.app_grants.decided_at END,
              updated_at       = now()
       RETURNING id
     )
     SELECT CASE
              WHEN NOT EXISTS (SELECT 1 FROM before)                   THEN 'created'
              WHEN (SELECT status FROM before) IN ('Rejected','Revoked') THEN 'reopened'
              ELSE 'unchanged'
            END AS state
       FROM up`,
    [userId, appSlug, reason],
  );
  return { ok: true, state: (rows[0]?.state as 'created' | 'reopened' | 'unchanged') ?? 'unchanged' };
}
