'use server';

/**
 * Who is allowed to decide access requests.
 *
 * Until now the approver role was set by hand against the database, which was
 * fine while there was exactly one and is not fine the moment there are two:
 * the person who can grant it is the person who should be able to take it
 * back, and neither should need a psql prompt.
 *
 * Both functions call `requireApprover()` themselves. The section is not
 * rendered for a member and the page 404s for them, but a Server Function is
 * reachable by direct POST, so the check belongs in the function. Same rule as
 * the grant decisions next door.
 *
 * No email goes out. Every other action here tells somebody something about
 * their own access; this one changes what a person can do to *other* people's,
 * and the people who need to know are the approvers who can already see the
 * list. The one real consequence to a new approver — the daily digest of
 * waiting requests starts arriving — is worth mentioning to them in person.
 */

import db from '@/lib/db';
import { logAuthEvent } from '@/lib/audit';
import { requireApprover } from '@/lib/viewer';
import type { ActionState } from '@/app/actions/grants';

/** Postgres raises 22P02 on a malformed uuid, so check before asking it to. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function userId(formData: FormData): string | null {
  const v = formData.get('userId');
  return typeof v === 'string' && UUID.test(v) ? v : null;
}

export async function grantApproverAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const actor = await requireApprover();
  const id = userId(formData);
  if (!id) return { error: 'Choose somebody from the list.' };

  // Deactivated accounts are excluded. An approver who cannot sign in is a
  // name on the list that quietly decides nothing, and the daily digest would
  // be mailed to an address nobody reads.
  const { rows } = await db.query<{ email: string; name: string; role: string }>(
    `UPDATE identity.users
        SET role = 'approver'
      WHERE id = $1 AND is_active AND role <> 'approver'
      RETURNING email, name, role`,
    [id],
  );

  const row = rows[0];
  if (!row) {
    // Nothing updated: already an approver, deactivated, or gone. Say which,
    // because "that didn't work" on a permission screen is worth a sentence.
    const { rows: check } = await db.query<{ email: string; role: string; is_active: boolean }>(
      `SELECT email, role, is_active FROM identity.users WHERE id = $1`,
      [id],
    );
    const who = check[0];
    if (!who) return { error: 'That account no longer exists.' };
    if (!who.is_active) return { error: `${who.email} is deactivated.` };
    return { notice: `${who.email} is already an approver.` };
  }

  await logAuthEvent({
    event: 'approver_granted',
    email: row.email,
    userId: id,
    detail: `made approver by ${actor.email}`,
  });

  return { notice: `${row.name} can now decide access requests.` };
}

export async function revokeApproverAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const actor = await requireApprover();
  const id = userId(formData);
  if (!id) return { error: 'That account could not be found.' };

  // Not yourself.
  //
  // Partly so nobody removes their own access to this screen by misreading a
  // row, and partly because it is what guarantees the list never empties: the
  // caller is an approver, and cannot be the one being removed, so at least
  // one is always left standing. No count query needed to know that.
  if (id === actor.id) {
    return { error: 'You cannot remove your own approver access. Ask the other approver.' };
  }

  const { rows } = await db.query<{ email: string; name: string }>(
    `UPDATE identity.users
        SET role = 'member'
      WHERE id = $1 AND role = 'approver'
      RETURNING email, name`,
    [id],
  );

  const row = rows[0];
  if (!row) return { error: 'They are not an approver.' };

  await logAuthEvent({
    event: 'approver_revoked',
    email: row.email,
    userId: id,
    detail: `approver removed by ${actor.email}`,
  });

  return { notice: `${row.name} can no longer decide access requests.` };
}
