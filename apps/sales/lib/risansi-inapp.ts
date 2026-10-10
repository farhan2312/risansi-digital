// In-app notification writes — the feed behind the bell.
//
// A thin, additive layer over the notifications table (migration 0047). It is
// deliberately separate from the email path in risansi-notify.ts: an in-app
// write must NEVER affect whether an email goes out, so every function here
// swallows its own errors, exactly like the email senders do.
//
// The senders in risansi-notify.ts resolve recipients they already email; they
// pass the in-system ones (those with a users.id) here so the same person who
// gets the email also gets a bell row. External recipients — name + email only,
// no account — get email alone, since they have no feed to read.

import risansiPool from '@/lib/db-risansi';

export interface InAppCard {
  kind: string;                  // machine tag, e.g. 'opp_won'
  section: string;               // display group, e.g. 'Pipeline'
  title: string;
  body?: string | null;
  link?: string | null;          // in-portal path
  actor?: string | null;         // who caused it (email)
  entityType?: string | null;
  entityId?: string | null;
}

/**
 * Drop one notification row for each distinct user id. No-ops on an empty list.
 * Never throws — a failed insert must not break the action or the email that
 * triggered it.
 */
export async function pushInApp(userIds: (number | null | undefined)[], card: InAppCard): Promise<void> {
  const ids = [...new Set(userIds.filter((n): n is number => typeof n === 'number' && Number.isInteger(n)))];
  if (!ids.length) return;
  try {
    // One multi-row insert rather than a loop — cheaper, and atomic per event.
    await risansiPool.query(
      `INSERT INTO notifications (user_id, kind, section, title, body, link, actor, entity_type, entity_id)
       SELECT uid, $2, $3, $4, $5, $6, $7, $8, $9 FROM unnest($1::int[]) AS uid`,
      [ids, card.kind, card.section, card.title, card.body ?? null, card.link ?? null,
       card.actor ?? null, card.entityType ?? null, card.entityId ?? null],
    );
  } catch (e) {
    console.error('[inapp] push failed', card.kind, e);
  }
}
