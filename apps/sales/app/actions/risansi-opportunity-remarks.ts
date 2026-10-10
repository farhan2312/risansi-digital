'use server';

import { revalidatePath } from 'next/cache';
import risansiPool from '@/lib/db-risansi';
import { getCurrentUser, canViewClient, hasRole, type CurrentUser } from '@/lib/risansi-auth';

// Refusals come back rather than being thrown: a thrown server-action message
// is redacted in production, so the person who needs to read it cannot.
export type SaveResult = { ok: true } | { ok: false; error: string };
const fail = (error: string): SaveResult => ({ ok: false, error });

// A remark recorded each time an opportunity enters a stage.
//
// Kept as a log rather than a column because the same opportunity can be parked,
// revived, negotiated and parked again — a single `remark` field would keep
// overwriting the account of why, which is the part anyone reads later.

export interface OppRemark {
  id: number;
  stage: string;
  remark: string;
  created_by_name: string | null;
  created_at: string;
}

// Mirror of userCanEditOpp — a remark is an edit to the deal's record.
async function canEdit(user: CurrentUser, repId: number | null, clientId: number | null) {
  if (hasRole(user.role, 'admin')) return true;
  if (user.id != null && repId != null && Number(repId) === Number(user.id)) return true;
  if (clientId != null) return canViewClient(user, Number(clientId));
  return false;
}

export async function addOpportunityRemark(oppId: number, stage: string, remark: string): Promise<SaveResult> {
  const user = await getCurrentUser();
  if (!user.email) throw new Error('Unauthorized');
  const text = (remark ?? '').trim();
  // An empty remark is not a refusal, there is simply nothing to record.
  if (!text) return { ok: true };

  const { rows } = await risansiPool.query<{ rep_id: number | null; client_id: number | null }>(
    'SELECT rep_id, client_id FROM opportunities WHERE id = $1', [oppId],
  );
  if (!rows[0]) return fail('Opportunity not found.');
  if (!(await canEdit(user, rows[0].rep_id, rows[0].client_id))) {
    return fail('You do not have permission to edit this opportunity.');
  }

  await risansiPool.query(
    `INSERT INTO opportunity_remarks (opportunity_id, stage, remark, created_by, created_by_name)
     VALUES ($1, $2, $3, $4, (SELECT name FROM users WHERE id = $4))`,
    [oppId, stage, text.slice(0, 4000), user.id ?? null],
  );

  revalidatePath('/risansi/pipeline');
  return { ok: true };
}

export async function getOpportunityRemarks(oppId: number): Promise<OppRemark[]> {
  const user = await getCurrentUser();
  if (!user.email) return [];
  const { rows: own } = await risansiPool.query<{ client_id: number | null }>(
    'SELECT client_id FROM opportunities WHERE id = $1', [oppId],
  );
  if (!own[0]) return [];
  if (!(await canViewClient(user, Number(own[0].client_id)))) return [];

  const { rows } = await risansiPool.query<OppRemark>(
    `SELECT id, stage, remark, created_by_name, created_at::text AS created_at
       FROM opportunity_remarks WHERE opportunity_id = $1
      ORDER BY created_at DESC, id DESC`,
    [oppId],
  );
  return rows;
}
