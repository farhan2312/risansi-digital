// Editing a closed complaint: the grant that allows it, and its reasons.
//
// Kept out of risansi-complaint-flow.ts because that module decides policy and
// never touches the database, and out of the actions file because a 'use
// server' module may export nothing but async functions.
import risansiPool from '@/lib/db-risansi';

/** How long an unlock lasts. Long enough to finish a correction, short enough to forget about. */
export const GRANT_HOURS = 2;

/** The shortest reason worth recording. A word is not a reason. */
export const MIN_REASON = 20;

export interface EditGrant {
  id:          number;
  reason:      string;
  status_then: string;
  granted_by:  string;
  /** The granter's name, where the email matches a user. */
  granted_by_name: string | null;
  granted_at:  string;
  expires_at:  string;
}

/**
 * The live grant on a complaint, or null.
 *
 * Expiry is judged here rather than by a sweep, so a window that has run out
 * stops working the moment it runs out and not whenever something next tidies
 * up. The row stays as it is — an expired grant is still the record that the
 * complaint was opened, by whom, and why.
 */
export async function activeGrant(complaintId: number): Promise<EditGrant | null> {
  try {
    const { rows } = await risansiPool.query<EditGrant>(
      `SELECT g.id, g.reason, g.status_then, g.granted_by,
              u.name AS granted_by_name,
              g.granted_at::text, g.expires_at::text
         FROM complaint_edit_grants g
         LEFT JOIN users u ON lower(u.email) = lower(g.granted_by)
        WHERE g.complaint_id = $1 AND g.ended_at IS NULL AND g.expires_at > now()
        LIMIT 1`,
      [complaintId]);
    return rows[0] ?? null;
  } catch {
    // The table arrives with migration 0130. Until it does, nothing is
    // unlocked — which is the behaviour that was there before it existed.
    return null;
  }
}
