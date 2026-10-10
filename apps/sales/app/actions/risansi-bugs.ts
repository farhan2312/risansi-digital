'use server';

import { revalidatePath } from 'next/cache';
import risansiPool from '@/lib/db-risansi';
import { getCurrentUser, hasRole } from '@/lib/risansi-auth';
import { isBugStatus } from '@/lib/risansi-bugs';

// Resolve (and authorise) the acting system admin, returning their display name
// for the recorded_by / resolved_by stamps. Throws if the caller isn't a sysadmin.
async function requireSysadminName(): Promise<string> {
  const user = await getCurrentUser();
  if (!hasRole(user.role, 'sysadmin')) throw new Error('Only the system admin can manage bugs.');
  const u = (await risansiPool.query<{ name: string | null; email: string | null }>(
    'SELECT name, email FROM users WHERE id = $1', [user.id],
  )).rows[0];
  return u?.name || user.email || 'System Admin';
}

// Move a bug along the pipeline. Stamps recorded_* the first time it leaves
// "reported", testing_at when the fix is first handed over, and resolved_* when
// it reaches "fixed". Both of the later two are cleared if the bug moves back
// behind them, so neither a turnaround nor a fix date can survive a reopen.
export async function updateBugStatus(bugId: number, status: string) {
  if (!Number.isInteger(bugId)) throw new Error('Invalid bug.');
  if (!isBugStatus(status)) throw new Error('Invalid status.');
  const name = await requireSysadminName();

  const cur = (await risansiPool.query<{ status: string; recorded_at: string | null; testing_at: string | null; resolved_at: string | null }>(
    'SELECT status, recorded_at, testing_at, resolved_at FROM bugs WHERE id = $1', [bugId],
  )).rows[0];
  if (!cur) throw new Error('Bug not found.');

  const sets: string[] = ['status = $2', 'updated_at = now()'];
  const vals: (string | number)[] = [bugId, status];
  let idx = 3;

  if (status !== 'reported' && !cur.recorded_at) {
    sets.push(`recorded_by = $${idx++}`, 'recorded_at = now()');
    vals.push(name);
  }
  // Turnaround is measured to here: the work is done and it is the reporter's
  // to verify. 'fixed' stamps it too, so a bug closed without a testing round
  // still has a delivery time rather than falling out of the average.
  const DELIVERED: string[] = ['testing', 'fixed'];
  if (DELIVERED.includes(status) && !cur.testing_at) {
    sets.push('testing_at = now()');
  } else if (!DELIVERED.includes(status) && cur.testing_at) {
    sets.push('testing_at = NULL');
  }
  if (status === 'fixed' && !cur.resolved_at) {
    sets.push(`resolved_by = $${idx++}`, 'resolved_at = now()');
    vals.push(name);
  } else if (status !== 'fixed' && cur.resolved_at) {
    sets.push('resolved_by = NULL', 'resolved_at = NULL');
  }

  await risansiPool.query(`UPDATE bugs SET ${sets.join(', ')} WHERE id = $1`, vals);
  revalidatePath('/risansi/admin/bugs');
  return { ok: true };
}

// Save the sysadmin's resolution notes for a bug (what/why/how it was fixed).
// Empty text clears the field. Sysadmin only.
export async function updateBugResolutionNotes(bugId: number, notes: string) {
  if (!Number.isInteger(bugId)) throw new Error('Invalid bug.');
  await requireSysadminName();
  const clean = typeof notes === 'string' ? notes.trim().slice(0, 8000) : '';
  await risansiPool.query(
    'UPDATE bugs SET resolution_notes = $2, updated_at = now() WHERE id = $1',
    [bugId, clean || null],
  );
  revalidatePath('/risansi/admin/bugs');
  return { ok: true };
}

// Edit a bug's severity (triage) — sysadmin only.
export async function updateBugSeverity(bugId: number, severity: string) {
  if (!Number.isInteger(bugId)) throw new Error('Invalid bug.');
  if (!['low', 'medium', 'high'].includes(severity)) throw new Error('Invalid severity.');
  await requireSysadminName();
  await risansiPool.query('UPDATE bugs SET severity = $2, updated_at = now() WHERE id = $1', [bugId, severity]);
  revalidatePath('/risansi/admin/bugs');
  return { ok: true };
}

// Reclassify a bug as Bug ↔ Feature — sysadmin only.
export async function updateBugType(bugId: number, type: string) {
  if (!Number.isInteger(bugId)) throw new Error('Invalid bug.');
  if (!['bug', 'feature'].includes(type)) throw new Error('Invalid type.');
  await requireSysadminName();
  await risansiPool.query('UPDATE bugs SET type = $2, updated_at = now() WHERE id = $1', [bugId, type]);
  revalidatePath('/risansi/admin/bugs');
  return { ok: true };
}

// Delete a bug (and its screenshot, via ON DELETE CASCADE) — sysadmin only.
export async function deleteBug(bugId: number) {
  if (!Number.isInteger(bugId)) throw new Error('Invalid bug.');
  await requireSysadminName();
  await risansiPool.query('DELETE FROM bugs WHERE id = $1', [bugId]);
  revalidatePath('/risansi/admin/bugs');
  return { ok: true };
}
