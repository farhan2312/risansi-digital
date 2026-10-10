import { cache } from 'react';
import { getServerSession } from 'next-auth/next';
import type { Session } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import risansiPool from '@/lib/db-risansi';

export type RisansiRole = 'staff' | 'rep' | 'manager' | 'admin' | 'sysadmin';

/** The complaint-module functions a person can work in, as the specification
 *  names them (migration 0075). Flat: none of these outranks another, and a
 *  person holds ZERO OR MORE of them. Independent of `role`: a rep who also
 *  sits on the Complaint Team keeps every bit of their rep access and gains the
 *  complaint pages that team owns. */
export const DEPARTMENTS = [
  'Complaint Team', 'QC', 'Quotation Team', 'Billing Team', 'Purchase',
] as const;
export type Department = typeof DEPARTMENTS[number];
export const isDepartment = (v: unknown): v is Department =>
  typeof v === 'string' && (DEPARTMENTS as readonly string[]).includes(v);

// Role hierarchy: higher level = more access. Anything unknown is level 0.
//
// 'staff' is level 0 ON PURPOSE, and that is the whole point of it. The ladder
// below is a ranking and every test is `level >= required`, so there is no rung
// that means "works complaints, touches nothing else": above rep inherits a
// rep's clients and pipeline, below rep sees nothing at all. Level 0 means
// staff satisfies NO rung — hasRole(staff, 'rep') is false — and every door
// they can open is opened by an explicit allowance further down this file
// rather than by outranking somebody.
const ROLE_LEVEL: Record<RisansiRole, number> = {
  staff:    0,
  rep:      1,
  manager:  2,
  admin:    3,
  sysadmin: 4,
};

/**
 * Someone whose access is functional rather than positional.
 *
 * Checked by identity, never by level: `hasRole(role, 'staff')` would be true
 * for absolutely everybody, including a signed-out caller, because level 0 is
 * also what an unrecognised role scores. Nothing may gate on that.
 */
export function isStaff(role: string | null | undefined): boolean {
  return role === 'staff';
}

/**
 * True when `userRole` meets or exceeds `requiredRole` in the hierarchy.
 *   hasRole(role, 'admin')    → admin AND sysadmin
 *   hasRole(role, 'sysadmin') → sysadmin only
 */
export function hasRole(userRole: string | null | undefined, requiredRole: RisansiRole): boolean {
  return (ROLE_LEVEL[userRole as RisansiRole] ?? 0) >= ROLE_LEVEL[requiredRole];
}

/** Return the current session or throw. Use inside server actions / route handlers. */
// One session read per request, shared. getServerSession re-runs next-auth's jwt
// callback — which queries the users table — every call, and a single page render
// calls getCurrentUser/requireSession many times (per gated component). React's
// cache() dedupes them to one lookup for the lifetime of the request.
const getSession = cache(async () => getServerSession(authOptions));

/**
 * Is this session still entitled to the portal?
 *
 * Holding a valid cookie is not the same as still being allowed in. An admin
 * can revoke someone at any moment, and the session they are already holding
 * stays cryptographically valid for the rest of its 8 hours. The jwt callback
 * re-reads `users` on every request, so `risansiAccess` is always current — the
 * bug was that nothing outside proxy.ts ever looked at it.
 *
 * proxy.ts applies this rule to pages, but its matcher is /risansi/* and
 * /admin/* only, so nothing under /api/** ever passes through it. Enforcing it
 * here instead puts the check on the path EVERY caller shares: route handlers,
 * server actions, and server components alike.
 *
 * Anything that is not exactly 'Approved' — Pending, Rejected (which is what a
 * revoke writes), or a status this code has never heard of — is refused.
 */
function isApproved(session: Session | null): boolean {
  return session?.user?.risansiAccess === 'Approved';
}

/**
 * Both of these stay throws, deliberately.
 *
 * They read like messages somebody should see, and a thrown server-action
 * message is redacted in production — which is exactly the bug the rest of this
 * codebase spent a day removing. The difference is that neither is reachable.
 * proxy.ts stops an unsigned or withdrawn request before it arrives: a server
 * action POSTs to the page path it was rendered from, every such page sits under
 * the proxy's matcher, and scripts/proxy-coverage-check.mjs fails the build if a
 * route ever escapes it.
 *
 * So this is the layer underneath that, and reaching it means the proxy was
 * bypassed — which is a fault to read in the logs, not advice to put in front of
 * a user. Converting it would mean threading a result through twenty-odd
 * actions to describe a state none of them can be in.
 */
export const requireSession = cache(async () => {
  const session = await getSession();
  if (!session?.user) throw new Error('Unauthorized');
  if (!isApproved(session)) throw new Error('Your access to the portal has been withdrawn.');
  return session;
});

// ── Current user + visibility (post-unification on `users`) ───────

export interface CurrentUser {
  id:    number | null;   // users.id (same integer space as the old reps.id)
  email: string | null;
  role:  RisansiRole;
  /** Every function they work in. Empty for someone who works none, which is
   *  most of the sales team. Order is not meaningful. */
  departments: Department[];
}

/** A caller with no identity and no privileges. Every scope helper below turns
 *  this into 'FALSE', and every route that tests `user.email` returns 401. */
const SIGNED_OUT: CurrentUser = { id: null, email: null, role: 'rep', departments: [] };

/**
 * Resolve the signed-in user from the session. role defaults to 'rep'.
 *
 * A session whose access is no longer 'Approved' resolves to SIGNED_OUT rather
 * than to its old identity — see isApproved above. Returning the real id and
 * role here is what let a revoked rep keep calling /api/risansi/** with a
 * cookie they were no longer entitled to.
 */
export const getCurrentUser = cache(async (): Promise<CurrentUser> => {
  const session = await getSession();
  if (!isApproved(session)) return SIGNED_OUT;
  const raw = session?.user?.departments;
  return {
    id:    (session?.user?.repId as number | null) ?? null,
    email: session?.user?.email ?? null,
    role:  ((session?.user?.role as RisansiRole) ?? 'rep'),
    // Filtered rather than trusted: the list arrives through a JWT, and an
    // unrecognised value would otherwise reach a stage-permission check.
    departments: Array.isArray(raw) ? raw.filter(isDepartment) : [],
  };
});

/**
 * Does this person work in this function?
 *
 * The question every complaint stage will ask. Answered from the set, so
 * somebody who holds Stores and Dispatch passes for both — which is the whole
 * reason departments stopped being a single column.
 */
export function hasDepartment(user: CurrentUser, dept: Department): boolean {
  return user.departments.includes(dept);
}

/** Does this person work in any of these functions? For a stage owned jointly —
 *  Returnable Material is Stores and Accounts together. */
export function hasAnyDepartment(user: CurrentUser, depts: readonly Department[]): boolean {
  return depts.some(d => user.departments.includes(d));
}

// All ids below come from the trusted session (integers), so inlining them
// into SQL is injection-safe and keeps callers free of param-index juggling.
function intOrNull(v: unknown): number | null {
  // null, undefined and '' are all rejected explicitly, and the result must be
  // positive. Number(null) and Number('') are both 0, and Number.isInteger(0) is
  // true — so the obvious version hands back a user id of 0 for someone who has
  // no id at all. Every caller here turns that into a predicate like
  // `primary_rep_id = 0`, which matches nothing only because no row happens to
  // carry id 0. That is luck rather than a rule, and the callers all document
  // themselves as returning FALSE for an unlinked user, so make it true.
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * The clients a person may see, as SQL.
 *
 * I am the primary rep, I am a secondary rep, or I manage somebody who is
 * either. Managers reach clients through their team rather than through a route,
 * and one level only — a manager under a manager inherits nothing, because the
 * tours this replaced were never a hierarchy and inventing one would be a guess.
 *
 * There is no fourth limb. There used to be: client_rep_access held one-off
 * grants from an admin, which is the same access a secondary rep has but
 * recorded as an exception nobody could find or edit. Assigning a covering rep
 * says the same thing in the place people already look.
 *
 * Admins are unrestricted and get null, meaning no predicate at all. A signed-out
 * or unlinked user gets 'FALSE' rather than an empty string, so a missing id can
 * never widen a query instead of narrowing it.
 */
function clientRuleSql(uid: number, clientIdCol: string): string {
  return `(${clientIdCol} IN (
      SELECT c2.id FROM clients c2
       WHERE c2.primary_rep_id = ${uid}
          OR c2.primary_rep_id IN (SELECT rep_id FROM manager_reps WHERE manager_id = ${uid})
    )
    OR ${clientIdCol} IN (
      SELECT s.client_id FROM client_secondary_reps s
       WHERE s.rep_id = ${uid}
          OR s.rep_id IN (SELECT rep_id FROM manager_reps WHERE manager_id = ${uid})
    ))`;
}

/**
 * Work still in flight that this person owns, regardless of who owns the client.
 *
 * A rep keeps sight of their own record until it closes, and then it stops being
 * theirs: once an opportunity is Won, Lost or Dropped — or a visit completed, or
 * an action done — it is only reachable through the client, like everything else.
 * So a rep finishes what they started on an account that has moved to a colleague,
 * and does not keep a permanent window into it.
 *
 * This matters more than it sounds. Scoping records purely through the client
 * would have taken 403 open opportunities, 10 visits and 19 action items out of
 * the view of the very people working them on the day of the switch. The set
 * drains on its own as those records close.
 *
 * `ownOpen` is written by the caller because only the caller knows the table:
 * pass 'o.rep_id = :uid AND o.stage NOT IN (...)' from an opportunities query.
 * Use the :uid placeholder; it is replaced with the integer id.
 */
export function clientScopeSql(
  user: CurrentUser, clientIdCol: string, ownOpen?: string,
): string | null {
  if (hasRole(user.role, 'admin')) return null;
  // Staff have no sales records of their own and no business seeing anybody
  // else's. Their read of Client 360 is granted by clientVisibilitySql below;
  // this helper scopes VISITS, OPPORTUNITIES and ACTIONS, and for staff the
  // answer to all three is none. Refusing here rather than relying on the
  // pages: this is the predicate every record query shares.
  if (isStaff(user.role)) return 'FALSE';
  const uid = intOrNull(user.id);
  if (uid == null) return 'FALSE';
  const base = clientRuleSql(uid, clientIdCol);
  if (!ownOpen) return base;
  // split/join rather than a regex: the id is a verified integer, and a literal
  // replace cannot be broken by an escape going astray on the way into the file.
  return `(${base} OR (${ownOpen.split(':uid').join(String(uid))}))`;
}

/** The same rule against a `clients` query aliased `alias`. */
export function clientVisibilitySql(user: CurrentUser, alias = 'c'): string | null {
  if (hasRole(user.role, 'admin')) return null;
  // Staff read every client. A complaint arrives against any account in the
  // book, and a quality engineer who can only see the accounts they own — none —
  // could not open the client a complaint is about. Read-only: nothing in the
  // client write path accepts a caller who is not admin.
  if (isStaff(user.role)) return null;
  const uid = intOrNull(user.id);
  if (uid == null) return 'FALSE';
  return clientRuleSql(uid, `${alias}.id`);
}

/** Ready-made open-record predicates, so the three tables spell it the same way. */
export const OWN_OPEN = {
  opportunity: (alias = 'o') => `${alias}.rep_id = :uid AND ${alias}.stage NOT IN ('Won','Lost','Dropped')`,
  visit:       (alias = 'v') => `${alias}.rep_id = :uid AND ${alias}.status <> 'completed'`,
  task:        (alias = 't') => `${alias}.assigned_to_rep = :uid AND ${alias}.status <> 'completed'`,
} as const;

export async function canViewClient(user: CurrentUser, clientId: number): Promise<boolean> {
  if (hasRole(user.role, 'admin')) return true;
  const uid = intOrNull(user.id);
  if (uid == null) return false;
  // Client-level only, with no open-record limb: this answers "may I open this
  // account", and owning a live opportunity on someone else's client does not
  // make the account yours. The record stays reachable from the lists that scope
  // with clientScopeSql; the client page itself does not open.
  const { rows } = await risansiPool.query<{ ok: boolean }>(
    `SELECT (EXISTS (
       SELECT 1 FROM clients c
        WHERE c.id = $1
          AND (c.primary_rep_id = $2
               OR c.primary_rep_id IN (SELECT rep_id FROM manager_reps WHERE manager_id = $2))
     ) OR EXISTS (
       SELECT 1 FROM client_secondary_reps s
        WHERE s.client_id = $1
          AND (s.rep_id = $2
               OR s.rep_id IN (SELECT rep_id FROM manager_reps WHERE manager_id = $2))
     )) AS ok`,
    [clientId, uid],
  );
  return rows[0]?.ok ?? false;
}

/**
 * May this person write client-level records — contacts, pumps, comments —
 * from inside a visit to that client?
 *
 * canViewClient on its own is the wrong gate for the visit form, and it took a
 * field rep three failed saves to show why. A visit can be assigned to anyone;
 * the visit itself is visible to its rep through the in-flight rule; the form
 * then asks them for the client's contacts and installed pumps and refuses to
 * store the answer, because owning an open visit does not make the account
 * theirs. Eleven open visits were in exactly that state.
 *
 * So: the account's people, OR the rep on an open visit to it. The second limb
 * is OWN_OPEN.visit, the same rule that let them open the report — read and
 * write now agree. It closes with the visit: once completed, the client page
 * and its records are reachable only through ownership again, as before.
 *
 * Deliberately NOT folded into canViewClient. That one also gates the Client
 * 360 page, and the migration's decision that a visit does not open the whole
 * account stands. This is narrower: it is for writes the visit form makes.
 */
export async function canWorkClient(user: CurrentUser, clientId: number): Promise<boolean> {
  return (await whyCannotWorkClient(user, clientId)) === null;
}

/** The one line every blocked visit and opportunity shows. Decided 12 Sep 2026. */
export const BLOCKED_CLIENT = 'Blocked — this client is not assigned to you. Please contact an admin.';

/**
 * Why this person may not write to this client — or null when they may.
 *
 * One sentence per cause, because "You do not have access to this client" was
 * true and useless: the rep had access to the visit, which is how they got to
 * the form, and nothing told them the client was somebody else's. The causes
 * are different problems with different fixes, so they get different words.
 *
 * There is deliberately no in-flight allowance here. For a day there was one —
 * a rep with an open visit to a client could add to it — and it was withdrawn
 * the same day: a visit or an opportunity on a client that is not yours is
 * shown as Blocked, with the line above, until an admin assigns the client.
 * You can still SEE it (clientScopeSql keeps the in-flight limb for reading, so
 * the record does not vanish); you cannot work it.
 *
 * Returned, never thrown. Every caller is a server action, and a thrown message
 * is redacted in production.
 */
export async function whyCannotWorkClient(user: CurrentUser, clientId: number): Promise<string | null> {
  if (hasRole(user.role, 'admin')) return null;
  const uid = intOrNull(user.id);
  if (uid == null) {
    return 'Your account is not linked to a rep profile, so it cannot own or work any client. Ask a sysadmin to link it under Users & Access.';
  }

  const { rows } = await risansiPool.query<{
    exists: boolean; archived: boolean; owner_id: number | null; owner_name: string | null;
    owns: boolean; covers: boolean; via_team: boolean;
  }>(
    `SELECT
       c.id IS NOT NULL                                          AS exists,
       c.deleted_at IS NOT NULL                                  AS archived,
       c.primary_rep_id                                          AS owner_id,
       (SELECT u.name FROM users u WHERE u.id = c.primary_rep_id) AS owner_name,
       c.primary_rep_id = $2                                     AS owns,
       EXISTS (SELECT 1 FROM client_secondary_reps s
                WHERE s.client_id = c.id AND s.rep_id = $2)      AS covers,
       (c.primary_rep_id IN (SELECT rep_id FROM manager_reps WHERE manager_id = $2)
        OR EXISTS (SELECT 1 FROM client_secondary_reps s
                    WHERE s.client_id = c.id
                      AND s.rep_id IN (SELECT rep_id FROM manager_reps WHERE manager_id = $2))) AS via_team
     FROM (SELECT $1::int AS id) want
     LEFT JOIN clients c ON c.id = want.id`,
    [clientId, uid],
  );
  const r = rows[0];

  if (!r?.exists) return 'This client no longer exists.';
  if (r.archived) return 'This client has been archived. Restore it from Admin › Recoverable before adding to it.';
  if (r.owns || r.covers || r.via_team) return null;

  if (r.owner_id == null) {
    return `${BLOCKED_CLIENT} It has no rep at all yet; Admin › Reps & Managers › Unassigned lists it.`;
  }
  return `${BLOCKED_CLIENT} It is assigned to ${r.owner_name ?? 'another rep'}; ask them or an admin to add you as a covering rep.`;
}

/**
 * SQL: is the person in `repCol` a stranger to the client aliased `c` — neither
 * its owner, nor covering it, nor a manager of either, nor an admin? A visit or
 * an opportunity whose rep is a stranger is an orphan: it is shown as Blocked
 * and cannot be worked until an admin assigns the client. Used by the board and
 * the calendar so the badge and the refusal agree.
 */
export function orphanSql(repCol: string, c = 'c'): string {
  return `(${repCol} IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM users ua WHERE ua.id = ${repCol} AND ua.role IN ('admin','sysadmin'))
    AND ${c}.primary_rep_id IS DISTINCT FROM ${repCol}
    AND NOT EXISTS (SELECT 1 FROM client_secondary_reps s WHERE s.client_id = ${c}.id AND s.rep_id = ${repCol})
    AND NOT (${c}.primary_rep_id IN (SELECT rep_id FROM manager_reps WHERE manager_id = ${repCol}))
    AND NOT EXISTS (SELECT 1 FROM client_secondary_reps s WHERE s.client_id = ${c}.id
                     AND s.rep_id IN (SELECT rep_id FROM manager_reps WHERE manager_id = ${repCol})))`;
}

/**
 * Why this person may not be given a visit to this client — or null when they may.
 *
 * A visit belongs to somebody who works the client: its owner, a rep covering
 * it, or a manager of either. Nobody else — not by an admin's hand on Plan
 * Visit, not by the follow-up the system raises from a report's next-visit
 * date, and not from an exhibition meeting. That is the rule chosen on 11 Sep
 * 2026 over "warn and allow" and "make them a covering rep automatically":
 * being sent to a client is not how you come to cover it; being made to cover
 * it is, on Reps & Managers, where it can be seen and undone.
 *
 * Until now nothing checked, and fourteen open visits belonged to people with
 * no relation to the client — including the one that broke the visit form,
 * because its rep could reach the visit and not the client. The in-flight rule
 * still lets those finish; this stops new ones being made.
 *
 * Unlike whyCannotWorkClient this is about the TARGET, not the actor, so it
 * takes a user id rather than a session. An admin or sysadmin may be the target
 * of a visit anywhere, as they may do anything anywhere.
 *
 * Returned, never thrown: every caller is a server action.
 */
export async function whyCannotVisitClient(repId: number, clientId: number): Promise<string | null> {
  const { rows } = await risansiPool.query<{
    rep_name: string | null; rep_role: string | null; rep_active: boolean | null;
    exists: boolean; archived: boolean; client_name: string | null;
    owner_name: string | null; covering: string | null;
    owns: boolean; covers: boolean; via_team: boolean;
  }>(
    `SELECT
       u.name                                                     AS rep_name,
       u.role                                                     AS rep_role,
       u.is_active                                                AS rep_active,
       c.id IS NOT NULL                                           AS exists,
       c.deleted_at IS NOT NULL                                   AS archived,
       c.legal_name                                               AS client_name,
       (SELECT o.name FROM users o WHERE o.id = c.primary_rep_id) AS owner_name,
       (SELECT string_agg(s2.name, ', ' ORDER BY s2.name)
          FROM client_secondary_reps s JOIN users s2 ON s2.id = s.rep_id
         WHERE s.client_id = c.id)                                AS covering,
       c.primary_rep_id = $2                                      AS owns,
       EXISTS (SELECT 1 FROM client_secondary_reps s
                WHERE s.client_id = c.id AND s.rep_id = $2)       AS covers,
       (c.primary_rep_id IN (SELECT rep_id FROM manager_reps WHERE manager_id = $2)
        OR EXISTS (SELECT 1 FROM client_secondary_reps s
                    WHERE s.client_id = c.id
                      AND s.rep_id IN (SELECT rep_id FROM manager_reps WHERE manager_id = $2))) AS via_team
     FROM (SELECT $1::int AS client_id, $2::int AS rep_id) want
     LEFT JOIN clients c ON c.id = want.client_id
     LEFT JOIN users   u ON u.id = want.rep_id`,
    [clientId, repId],
  );
  const r = rows[0];

  if (!r?.rep_name)  return 'That person is not a user of this portal any more.';
  if (!r.rep_active) return `${r.rep_name}'s account is deactivated, so no visit can be planned for them.`;
  if (!r.exists)     return 'This client no longer exists.';
  if (r.archived)    return 'This client has been archived. Restore it from Admin › Recoverable before planning a visit to it.';
  if (hasRole(r.rep_role, 'admin')) return null;
  if (r.owns || r.covers || r.via_team) return null;

  const client = r.client_name ?? 'this client';
  if (!r.owner_name && !r.covering) {
    return `${client} has no rep assigned, so nobody can be given a visit to it yet. `
      + 'Assign an owner on Admin › Reps & Managers › Unassigned first.';
  }
  const who = [r.owner_name && `assigned to ${r.owner_name}`, r.covering && `covered by ${r.covering}`]
    .filter(Boolean).join(' and ');
  return `${r.rep_name} does not work ${client} — it is ${who}. `
    + 'A visit can only be planned for the owner, a covering rep, or their manager. '
    + `To send ${r.rep_name}, add them as a covering rep on Admin › Reps & Managers first.`;
}

/**
 * Can this user access a single complaint? admin/sysadmin always; otherwise
 * when they raised it, it's assigned to them, or they work its client.
 * Mirrors the complaints page visibility predicate.
 */
export async function canAccessComplaint(user: CurrentUser, complaintId: number): Promise<boolean> {
  if (hasRole(user.role, 'admin')) return true;
  // The module's staff, and anyone in a complaint department, see every
  // complaint — the workflow hands one record between them (matches
  // complaintVisibilitySql, which returns null for the same people).
  if (isStaff(user.role) || user.departments.length > 0) return true;
  const uid = intOrNull(user.id);
  const { rows } = await risansiPool.query<{
    client_id: number | null; assigned_to_user: number | null; created_by: string | null;
    investigation_assigned_to: number | null; action_assigned_to: number | null; returnable_owner: number | null; reported_by_user: number | null;
  }>(
    `SELECT client_id, assigned_to_user, created_by, investigation_assigned_to, action_assigned_to, returnable_owner, reported_by_user
       FROM complaints WHERE id = $1`, [complaintId],
  );
  const r = rows[0];
  if (!r) return false;
  if (uid != null && [r.assigned_to_user, r.investigation_assigned_to, r.action_assigned_to, r.returnable_owner, r.reported_by_user].includes(uid)) return true;
  if (user.email && r.created_by && r.created_by.toLowerCase() === user.email.toLowerCase()) return true;
  if (r.client_id != null) return canViewClient(user, r.client_id);
  return false;
}

/** SQL predicate scoping a `complaints` query (aliased `cm`) to what a user may see. */
export function complaintVisibilitySql(user: CurrentUser, alias = 'cm'): string | null {
  if (hasRole(user.role, 'admin')) return null;
  // The module staff exist to work. Every complaint, because the workflow hands
  // one record between departments and a stores clerk cannot be shown only the
  // complaints they happen to be named on before they are named on them. The
  // same for a rep or manager who also sits in a complaint department.
  if (isStaff(user.role) || user.departments.length > 0) return null;
  const uid = intOrNull(user.id);
  if (uid == null) return 'FALSE';
  const email = (user.email ?? '').replace(/'/g, "''").toLowerCase();
  // The client limb goes through clientRuleSql rather than spelling itself out,
  // which is how it came to be left behind on the route rule while everything
  // else moved: a complaint on a client you own was invisible unless you also
  // happened to share a route with it.
  return `(
    ${alias}.assigned_to_user = ${uid}
    OR ${alias}.investigation_assigned_to = ${uid}
    OR ${alias}.action_assigned_to = ${uid}
    OR ${alias}.returnable_owner = ${uid}
    OR ${alias}.reported_by_user = ${uid}
    OR lower(${alias}.created_by) = '${email}'
    OR ${clientRuleSql(uid, `${alias}.client_id`)}
  )`;
}

/**
 * The people a manager may act for: their team, plus themselves. Drives "who can
 * I assign to", the rep dropdown, the visit-report edit gate, the quotation-file
 * gate and the Executive Review scope.
 *
 * This used to mean "everybody who shares a route with me", which was symmetric
 * — so a peer manager on the same route counted as assignable, and a rep on a
 * busy shared route inherited a dozen colleagues nobody had put them under. The
 * hierarchy is explicit now, so the answer is exactly the reps beneath them.
 *
 * A manager with no team gets just themselves, which is right: several of them
 * own clients directly and have nobody underneath.
 */
export async function getManagerAssignableReps(managerRepId: number): Promise<number[]> {
  const res = await risansiPool.query<{ rep_id: number }>(
    `SELECT rep_id FROM manager_reps WHERE manager_id = $1`,
    [managerRepId],
  );

  const repIds = res.rows.map(r => r.rep_id);
  if (!repIds.includes(managerRepId)) repIds.push(managerRepId);
  return repIds;
}

/**
 * Whose Executive Review may this user open?
 *   admin / sysadmin → null (no restriction — every TSM)
 *   manager          → their team plus themselves (getManagerAssignableReps).
 *                      No longer symmetric: a peer manager is not on your team
 *                      merely because you both work the same territory.
 *   rep              → themselves only
 * Returns the allowed users.id list, or null meaning "no restriction". An empty
 * array means "nobody" (a user with no linked id), which callers must treat as
 * no access rather than as unrestricted.
 */
export async function getReviewableRepIds(user: CurrentUser): Promise<number[] | null> {
  if (hasRole(user.role, 'admin')) return null;
  const uid = intOrNull(user.id);
  if (uid == null) return [];
  if (user.role === 'manager') return getManagerAssignableReps(uid);
  return [uid];
}

/**
 * Who may fill or correct a visit report: the assigned rep, a manager that rep
 * reports to, or admin/sysadmin. Same shape as the
 * opportunity edit gate (userCanEditOpp) so record editing stays consistent
 * across the app. The 30-day re-open window is applied on top of this, not
 * inside it — this answers "is this person allowed at all?", the window answers
 * "is it still soon enough?".
 */
export async function canEditVisitReport(
  user: { role?: string | null; repId?: number | null },
  visitRepId: number | null,
  /** When given, being the visit's rep is not enough: the client must be theirs too (see whyCannotWorkClient). */
  clientId?: number | null,
): Promise<boolean> {
  const role = user.role ?? 'rep';
  if (hasRole(role, 'admin')) return true;                       // admin + sysadmin
  let mine = false;
  if (user.repId != null && visitRepId != null && Number(visitRepId) === Number(user.repId)) mine = true;
  else if (role === 'manager' && user.repId != null && visitRepId != null) {
    const assignable = await getManagerAssignableReps(user.repId);
    mine = assignable.includes(Number(visitRepId));
  }
  if (!mine) return false;
  if (clientId == null) return true;
  // The visit is theirs; is the client? An orphaned visit — assigned before
  // ownership existed, or by an admin to a stranger — is Blocked, not workable.
  const me: CurrentUser = { id: user.repId ?? null, email: null, role: role as RisansiRole, departments: [] };
  return (await whyCannotWorkClient(me, Number(clientId))) === null;
}
