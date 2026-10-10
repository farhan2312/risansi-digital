// Whose number is it? One answer, in one place.
//
// A client has one owner, their primary rep, and everything attached to that
// client is attributed to that owner regardless of who raised it or worked it.
// Chosen 1 Oct 2026, after 422 of 2,086 opportunities turned out to name a rep
// other than the client's owner — 267 of them Won, worth 4.69 Cr — so the same
// deal was credited to one person on the Opportunities board and to another on
// the Executive Review, purely because the two pages read different columns.
//
// Two questions that sound alike and are not, and this file answers only the
// first. Keeping them apart is the whole point:
//
//   ATTRIBUTION — whose figure is this? The client's owner. Always, for
//     everything client-linked, including history. Built here.
//   VISIBILITY and SCOPE — whose screen does it appear on? The owner, anyone
//     covering the client, and their managers. Built in lib/risansi-auth.ts
//     (clientScopeSql, clientVisibilitySql) and unchanged by any of this.
//
// A covering rep therefore still sees and edits the owner's opportunities —
// covering has to keep meaning what it means — and the value still counts for
// the owner. The two answers are both true at once.
//
// What this file deliberately does NOT touch:
//
//   opportunities.rep_id — who raised the enquiry, or who was assigned it. Kept
//     and still written; it simply no longer drives a figure or labels an owner.
//   visits.rep_id — who physically travelled. Field activity follows the person
//     who did it, not the person who owns the account, or a rep covering for a
//     colleague would hand their mileage to someone sitting at a desk.
//   tasks.assigned_to_rep — who has to do the thing. An action queue is a work
//     list; re-pointing it at the owner would put one person's job on another
//     person's screen.

import { OPEN_STAGES } from './risansi-exec-review';

/** The stages an opportunity is finished in. Everything else is still in play. */
export const CLOSED_STAGES = ['Won', 'Lost', 'Dropped'] as const;

const quoted = (vs: readonly string[]) => vs.map(v => `'${v.replace(/'/g, "''")}'`).join(',');

/** SQL list of the closed stages, for an IN (…). */
export const CLOSED_STAGES_SQL = quoted(CLOSED_STAGES);
/** SQL list of the open stages — the same set OPEN_STAGES names, spelled for SQL. */
export const OPEN_STAGES_SQL = quoted(OPEN_STAGES);

/**
 * The rep an opportunity's value counts for, as SQL.
 *
 * Normally the client's owner, read live. `credited_rep_id` overrides it only
 * where a handover has frozen the credit of an opportunity that had already
 * closed (see setPrimaryRep and migration 0102), so that a rep's Won history
 * does not follow the account out of the door.
 *
 * Needs both an `opportunities` alias and the `clients` alias it is joined to.
 * Every caller already joins clients — the visibility rules require it — so
 * this adds no join of its own.
 */
export const creditedRepSql = (o = 'o', c = 'c') =>
  `COALESCE(${o}.credited_rep_id, ${c}.primary_rep_id)`;

/**
 * The name to print for that rep, or 'Unassigned'.
 *
 * `usersAlias` must be joined on creditedRepSql — see CREDITED_REP_JOIN, which
 * spells that join so no caller has to get it right twice.
 */
export const creditedRepNameSql = (u = 'cred') => `COALESCE(${u}.name, 'Unassigned')`;

/** The join creditedRepNameSql needs. Left, because a client may have no owner. */
export const CREDITED_REP_JOIN = (o = 'o', c = 'c', u = 'cred') =>
  `LEFT JOIN users ${u} ON ${u}.id = ${creditedRepSql(o, c)}`;

// ── Handover ──────────────────────────────────────────────────
//
// Four places change who owns a client: setPrimaryRep and setClientWorkers on
// Reps & Managers, moveClients when a whole book is handed over, and
// saveClientOwnership behind the client form. All four call in here rather than
// writing the UPDATE themselves, because a handover that forgets to freeze is
// indistinguishable from one that worked until somebody opens last year's
// numbers and finds them on the wrong person.

/** A pool or a client inside a transaction — whichever the caller has. */
export interface Queryable {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  query(sql: string, params?: any[]): Promise<{ rowCount: number | null; rows: any[] }>;
}

const FREEZE = `
  UPDATE opportunities o
     SET credited_rep_id = $2, updated_at = NOW()
   WHERE o.stage IN (${CLOSED_STAGES_SQL})
     AND o.credited_rep_id IS NULL`;

/**
 * Freeze the credit of one client's already-closed opportunities on the owner
 * it is about to lose. **Call this BEFORE writing the new owner** — afterwards
 * there is nowhere left to read the old one from.
 *
 * A no-op when the owner is not actually changing, which matters more than it
 * sounds: the client form posts primary_rep_id on every save, so without the
 * guard an unrelated edit to a phone number would freeze the whole account's
 * history and stop it following the owner ever again.
 *
 * Also a no-op when the outgoing owner is null. An unowned client has no credit
 * to freeze, and stamping NULL means "follow the owner" anyway.
 *
 * Returns how many rows were frozen, for the message the admin screen shows.
 */
export async function freezeCreditForClient(
  q: Queryable, clientId: number, incomingRepId: number | null,
): Promise<number> {
  // deleted_at IS NULL so this no-ops on an archived or missing client. Every
  // caller freezes BEFORE its UPDATE and some of them then bail out because
  // that UPDATE matched nothing; without the guard the freeze would have
  // already fired on a handover that never happened.
  const cur = await q.query(
    'SELECT primary_rep_id FROM clients WHERE id = $1 AND deleted_at IS NULL', [clientId]);
  const outgoing = (cur.rows[0]?.primary_rep_id ?? null) as number | null;
  if (outgoing == null || outgoing === incomingRepId) return 0;
  const r = await q.query(`${FREEZE} AND o.client_id = $1`, [clientId, outgoing]);
  return r.rowCount ?? 0;
}

/**
 * The same freeze across a whole book, for moveClients. Everything `fromRepId`
 * currently owns and has already closed is stamped with them, so handing the
 * book over does not hand the history over with it.
 */
export async function freezeCreditForRepBook(q: Queryable, fromRepId: number): Promise<number> {
  const r = await q.query(
    `${FREEZE} AND o.client_id IN
       (SELECT id FROM clients WHERE primary_rep_id = $1 AND deleted_at IS NULL)`,
    [fromRepId, fromRepId],
  );
  return r.rowCount ?? 0;
}

/**
 * Clear the stamp from any OPEN opportunity still carrying one.
 *
 * Covers the single sequence the freeze cannot: an opportunity frozen by an
 * earlier handover and since reopened. It is live work again, so it belongs to
 * whoever owns the account now, and leaving the old stamp on it would quietly
 * credit a third party. Cheap, and it keeps the column self-healing.
 *
 * `clientId` null means every client — used by the bulk move, which does not
 * enumerate the accounts it touched.
 */
export async function thawOpenCredit(q: Queryable, clientId: number | null): Promise<number> {
  const r = await q.query(
    `UPDATE opportunities o
        SET credited_rep_id = NULL, updated_at = NOW()
      WHERE o.stage NOT IN (${CLOSED_STAGES_SQL})
        AND o.credited_rep_id IS NOT NULL
        AND ($1::int IS NULL OR o.client_id = $1)`,
    [clientId],
  );
  return r.rowCount ?? 0;
}
