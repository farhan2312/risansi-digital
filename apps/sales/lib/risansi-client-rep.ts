// Who owns a client's work?
//
// The client names one primary rep and any number of secondaries covering it.
// Before that, ownership was inferred from the client's tour: six call sites
// asked the question in six different shapes, all of them landing on
// `role='rep' ORDER BY assigned_at, rep_id LIMIT 1`, which on a two-rep tour
// handed every client to whoever was assigned first. That was an artefact of
// insertion order rather than a statement about ownership, and it is the reason
// this module exists — one answer, in one place.
//
// Tours survive as an attribute of the client. They no longer decide anything.

import risansiPool from '@/lib/db-risansi';

/**
 * The people who work a client, as SQL — for use as a subquery.
 *
 * Six call sites asked this question in six different shapes, all through
 * a route roster, which is the same duplication this module was written to end
 * for the single-owner case. `clientExpr` is whatever identifies the client in
 * the surrounding query, usually `c.id` or a literal placeholder.
 *
 * Primary first, then secondaries alphabetically — so a caller that renders the
 * first name it gets shows the owner rather than whoever happens to sort first.
 * Managers are excluded on purpose: they can see the client, but they do not
 * work it, and a list captioned "owners" should not imply otherwise.
 */
export function clientRepIdsSql(clientExpr: string): string {
  return `SELECT c2.primary_rep_id AS user_id, 0 AS rank, NULL::timestamptz AS ord
            FROM clients c2 WHERE c2.id = ${clientExpr} AND c2.primary_rep_id IS NOT NULL
           UNION ALL
          SELECT s.rep_id, 1, s.added_at
            FROM client_secondary_reps s WHERE s.client_id = ${clientExpr}`;
}

/**
 * The one rep who owns a client, as a scalar subquery.
 *
 * Four call sites used to reproduce the old precedence inline — designated tour
 * owner, else first rep by assignment order, else the manager on a one-person
 * team — which is exactly the guessing this replaced. The answer is a column
 * now, and `is_active` still matters because deactivating someone leaves their
 * rows behind.
 */
export function clientPrimaryRepSql(clientExpr: string): string {
  return `(SELECT u.id FROM clients c9 JOIN users u ON u.id = c9.primary_rep_id AND u.is_active
            WHERE c9.id = ${clientExpr})`;
}

/** The same people as a comma-separated name list, for a table cell. */
export function clientRepNamesSql(clientExpr: string): string {
  return `(SELECT string_agg(u.name, ', ' ORDER BY r.rank, u.name)
             FROM (${clientRepIdsSql(clientExpr)}) r
             JOIN users u ON u.id = r.user_id)`;
}

/**
 * The people covering a client alongside its owner, as a name list.
 *
 * Deliberately separate from clientRepNamesSql: a rep asked to tell their own
 * accounts from the ones they merely back up cannot do it from a single joined
 * string, and running the two together is what made "Reps" on the client header
 * read as a list of equals when it never was one.
 */
export function clientSecondaryNamesSql(clientExpr: string): string {
  return `(SELECT string_agg(u.name, ', ' ORDER BY u.name)
             FROM client_secondary_reps s
             JOIN users u ON u.id = s.rep_id AND u.is_active
            WHERE s.client_id = ${clientExpr})`;
}

/**
 * The managers who can see a client, as a name list.
 *
 * Whoever sits above the people who work it — the same question the visibility
 * rule answers, so the header cannot claim a manager the access rule would deny.
 */
export function clientManagerNamesSql(clientExpr: string): string {
  return `(SELECT string_agg(DISTINCT u.name, ', ')
             FROM manager_reps mr
             JOIN users u ON u.id = mr.manager_id AND u.is_active
            WHERE mr.rep_id IN (SELECT r.user_id FROM (${clientRepIdsSql(clientExpr)}) r))`;
}

/** How the owner was arrived at — surfaced so callers can explain themselves. */
export type RepBasis =
  | 'primary-rep'    // the client says so, which is the normal answer
  | 'secondary-rep'  // no primary yet, but the person filing already covers it
  | 'none';

export interface ResolvedRep {
  repId: number | null;
  basis: RepBasis;
  /**
   * Kept at false. Under tours the owner could be genuinely ambiguous — several
   * reps on a route, none designated — and callers warned about it. The client
   * names one owner now, so there is nothing to be unsure about; the field
   * stays so those callers keep compiling and keep reading correctly.
   */
  ambiguous: boolean;
}

/**
 * Resolve the rep who should own new work for a client.
 *
 * There is nothing to resolve any more: the client names its owner. `is_active`
 * still matters — deactivating someone is a flag flip, not a delete, so their
 * primary_rep_id rows outlive them and new work would otherwise be parked on a
 * person who has left.
 *
 * The one fallback left is for the clients deliberately parked without an owner.
 * If whoever is filing already covers such a client as a secondary, they own
 * what they file, rather than the record being refused outright.
 */
export async function resolveClientPrimaryRep(
  clientId: number | string,
  creatorRepId?: number | null,
): Promise<ResolvedRep> {
  const { rows } = await risansiPool.query<{ primary_rep: number | null; covering: number | null }>(
    `SELECT (SELECT u.id FROM users u WHERE u.id = c.primary_rep_id AND u.is_active) AS primary_rep,
            (SELECT s.rep_id FROM client_secondary_reps s
               JOIN users su ON su.id = s.rep_id AND su.is_active
              WHERE s.client_id = c.id AND s.rep_id = $2 LIMIT 1) AS covering
       FROM clients c WHERE c.id = $1`,
    [clientId, creatorRepId ?? null],
  );
  const r = rows[0];
  if (!r) return { repId: null, basis: 'none', ambiguous: false };
  if (r.primary_rep != null) return { repId: r.primary_rep, basis: 'primary-rep', ambiguous: false };
  if (r.covering != null) return { repId: r.covering, basis: 'secondary-rep', ambiguous: false };
  return { repId: null, basis: 'none', ambiguous: false };
}
