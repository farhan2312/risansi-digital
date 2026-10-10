import risansiPool from '@/lib/db-risansi';
import { getCurrentUser } from '@/lib/risansi-auth';
import { canManageExhibition } from '@/app/actions/risansi-exhibitions';

// Server-only. Deliberately NOT in risansi-exhibition-files: the picker in
// BusinessCards.tsx is a client component and imports CARD_ACCEPT from there,
// so anything in that file reaching db-risansi or a 'use server' module drags
// server code into the browser bundle and fails the build.

/**
 * Resolve a meeting's parent exhibition and defer to the module's own
 * permission rule. A meeting id alone must never be enough to reach a card,
 * and both card routes need the same answer.
 */
export async function guardMeeting(meetingId: number) {
  const { rows } = await risansiPool.query<{ exhibition_id: number }>(
    'SELECT exhibition_id FROM exhibition_meetings WHERE id = $1', [meetingId],
  );
  const exhibitionId = rows[0]?.exhibition_id;
  if (!exhibitionId) return { ok: false as const, status: 404 };
  const user = await getCurrentUser();
  if (!user.email) return { ok: false as const, status: 401 };
  if (!(await canManageExhibition(exhibitionId))) return { ok: false as const, status: 403 };
  return { ok: true as const, exhibitionId, user };
}
