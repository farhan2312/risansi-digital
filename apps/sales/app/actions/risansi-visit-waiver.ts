'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import risansiPool from '@/lib/db-risansi';
import { getCurrentUser, getSession, whyCannotWorkClient } from '@/lib/risansi-auth';
import { recordAudit } from '@/lib/audit';
import { isWaiverCode, waiverReason } from '@/lib/risansi-visit-waiver';

export type WaiverResult = { ok: true } | { ok: false; error: string };
const fail = (error: string) => ({ ok: false as const, error });

/**
 * Mark a client as one a visit is not expected for, or clear that mark.
 *
 * Same permission as editing a contact: the account's own rep or manager, and
 * admins. This takes a client out of the coverage gap, so it is not something
 * a read-only Client 360 viewer gets to do.
 *
 * Pass `code: null` to put the client back in the count.
 */
export async function setVisitWaiver(
  clientId: number,
  code: string | null,
  note: string | null,
  until: string | null,
): Promise<WaiverResult> {
  const session = await getSession();
  if (!session?.user?.email) redirect('/api/auth/signin');

  const denied = await whyCannotWorkClient(await getCurrentUser(), clientId);
  if (denied) return fail(denied);

  if (code !== null && !isWaiverCode(code)) {
    return fail('Pick one of the listed reasons.');
  }

  // A date is only meaningful alongside a reason, and only in the future.
  // A waiver that expired before it was written would do nothing at all and
  // would look to the rep like it had been saved.
  let untilDate: string | null = null;
  if (code !== null && until) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(until)) return fail('Review date must be a real date.');
    const d = new Date(until + 'T00:00:00');
    if (Number.isNaN(d.getTime())) return fail('Review date must be a real date.');
    const today = new Date(); today.setHours(0, 0, 0, 0);
    if (d < today) return fail('Review date is in the past — the waiver would expire the moment it was saved.');
    untilDate = until;
  }

  const trimmed = code === null ? null : (note?.trim() || null);

  const { rowCount } = await risansiPool.query(
    `UPDATE clients
        SET visit_waiver       = $1,
            visit_waiver_note  = $2,
            visit_waiver_until = $3,
            visit_waiver_by    = CASE WHEN $1::text IS NULL THEN NULL ELSE $4::bigint END,
            visit_waiver_at    = CASE WHEN $1::text IS NULL THEN NULL ELSE NOW() END
      WHERE id = $5 AND deleted_at IS NULL`,
    [code, trimmed, untilDate, session.user.repId ?? null, clientId],
  );
  if (!rowCount) return fail('This client no longer exists.');

  const label = code === null ? 'cleared' : waiverReason(code)?.label ?? code;
  await recordAudit({
    entityType: 'client', entityId: String(clientId),
    action: code === null ? 'Visit waiver cleared' : `Visit waiver: ${label}`,
    actorEmail: session.user.email,
  });

  revalidatePath(`/risansi/clients/${clientId}`);
  revalidatePath('/risansi/clients');
  revalidatePath('/risansi/field');
  revalidatePath('/risansi/executive-review');
  return { ok: true };
}
