'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import risansiPool from '@/lib/db-risansi';
import { canViewClient, getCurrentUser, getSession } from '@/lib/risansi-auth';
import type { OppCommentRow, CommentResult } from '@/lib/risansi-opportunity-comment-types';

/**
 * Remarks on an opportunity.
 *
 * The same rules as the comments on a client (migration 0022, actions in
 * risansi.ts): anybody who can SEE the opportunity may add one, and only the
 * author may change or remove it — enforced here and again in the WHERE
 * clause, because a check that only runs in one of those is a check somebody
 * can skip by calling the action directly.
 *
 * A thread, not a field. See migration 0133 for why.
 */

const MAX = 5000;

// Postgres's "relation does not exist". The table arrives with migration 0133,
// and until that has been run the thread has to be absent rather than broken:
// an unhandled throw here takes the whole edit drawer down with it, which is
// how one unrun migration blanked the pipeline board on 20 Nov 2026.
const NO_TABLE = '42P01';
function tableMissing(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { code?: string }).code === NO_TABLE;
}
const NOT_YET = 'Remarks are not switched on yet — migration 0133 has not been run.';

/** Viewing follows the client, exactly as the opportunity's other sub-records do. */
async function assertCanView(oppId: number): Promise<number> {
  const user = await getCurrentUser();
  if (!user.email) redirect('/api/auth/signin');
  const { rows } = await risansiPool.query<{ client_id: number | null }>(
    'SELECT client_id FROM opportunities WHERE id = $1', [oppId]);
  const clientId = rows[0]?.client_id;
  if (clientId == null || !(await canViewClient(user, Number(clientId)))) {
    throw new Error('You do not have access to this opportunity.');
  }
  return clientId;
}

export async function listOpportunityComments(oppId: number): Promise<OppCommentRow[]> {
  if (!Number.isInteger(oppId)) return [];
  await assertCanView(oppId);
  // Oldest first: a thread is read in the order it was written.
  const user = await getCurrentUser();
  try {
    const { rows } = await risansiPool.query<OppCommentRow>(
      `SELECT id, body, author_email, author_name,
              created_at::text AS created_at, updated_at::text AS updated_at,
              (lower(author_email) = lower($2)) AS mine
         FROM opportunity_comments
        WHERE opportunity_id = $1
        ORDER BY created_at, id`, [oppId, user.email ?? '']);
    return rows;
  } catch (e) {
    if (tableMissing(e)) return [];
    throw e;
  }
}

export async function addOpportunityComment(oppId: number, body: string): Promise<CommentResult> {
  if (!Number.isInteger(oppId)) return { ok: false, error: 'Invalid opportunity.' };
  const clientId = await assertCanView(oppId);
  const user = await getCurrentUser();

  const text = (body ?? '').trim();
  if (!text) return { ok: false, error: 'A remark cannot be empty.' };
  if (text.length > MAX) return { ok: false, error: `A remark is ${MAX.toLocaleString('en-IN')} characters at most.` };

  const session = await getSession();
  try {
    await risansiPool.query(
      `INSERT INTO opportunity_comments (opportunity_id, author_email, author_name, body)
       VALUES ($1, $2, $3, $4)`,
      [oppId, user.email, session?.user?.name ?? user.email, text]);
  } catch (e) {
    // Say so plainly rather than losing what they typed to a generic failure.
    if (tableMissing(e)) return { ok: false, error: NOT_YET };
    throw e;
  }

  revalidatePath('/risansi/pipeline');
  revalidatePath(`/risansi/clients/${clientId}`);
  return { ok: true };
}

export async function updateOpportunityComment(commentId: number, body: string): Promise<CommentResult> {
  if (!Number.isInteger(commentId)) return { ok: false, error: 'Invalid remark.' };
  const user = await getCurrentUser();
  if (!user.email) redirect('/api/auth/signin');

  const text = (body ?? '').trim();
  if (!text) return { ok: false, error: 'A remark cannot be empty.' };
  if (text.length > MAX) return { ok: false, error: `A remark is ${MAX.toLocaleString('en-IN')} characters at most.` };

  const { rows } = await risansiPool.query<{ opportunity_id: number; author_email: string }>(
    'SELECT opportunity_id, author_email FROM opportunity_comments WHERE id = $1', [commentId]);
  const row = rows[0];
  if (!row) return { ok: false, error: 'That remark is gone.' };
  await assertCanView(row.opportunity_id);
  if (row.author_email.toLowerCase() !== (user.email ?? '').toLowerCase()) {
    return { ok: false, error: 'You can only edit your own remark.' };
  }

  const res = await risansiPool.query(
    `UPDATE opportunity_comments SET body = $1, updated_at = now()
      WHERE id = $2 AND lower(author_email) = lower($3)`,
    [text, commentId, user.email]);
  if (res.rowCount === 0) return { ok: false, error: 'That remark is gone.' };

  revalidatePath('/risansi/pipeline');
  return { ok: true };
}

export async function deleteOpportunityComment(commentId: number): Promise<CommentResult> {
  if (!Number.isInteger(commentId)) return { ok: false, error: 'Invalid remark.' };
  const user = await getCurrentUser();
  if (!user.email) redirect('/api/auth/signin');

  const { rows } = await risansiPool.query<{ opportunity_id: number; author_email: string }>(
    'SELECT opportunity_id, author_email FROM opportunity_comments WHERE id = $1', [commentId]);
  const row = rows[0];
  if (!row) return { ok: true };   // already gone is the outcome they wanted
  await assertCanView(row.opportunity_id);
  if (row.author_email.toLowerCase() !== (user.email ?? '').toLowerCase()) {
    return { ok: false, error: 'You can only remove your own remark.' };
  }

  await risansiPool.query(
    'DELETE FROM opportunity_comments WHERE id = $1 AND lower(author_email) = lower($2)',
    [commentId, user.email]);
  revalidatePath('/risansi/pipeline');
  return { ok: true };
}
