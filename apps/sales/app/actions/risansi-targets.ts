'use server';

import { getServerSession } from 'next-auth/next';
import { revalidatePath } from 'next/cache';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import risansiPool from '@/lib/db-risansi';

export type SaveResult = { ok: true } | { ok: false; error: string };
const fail = (error: string): SaveResult => ({ ok: false, error });

/** One row off the Settings list. The target arrives as the raw string the
 *  input held, blank included, so "cleared" and "zero" stay distinguishable. */
export type RepTargetInput = { id: number; targetCr: string };

// A target above this is a typo, not a quota — somebody typing rupees into a
// field labelled Crores lands here. The company year is tens of Crores.
const MAX_TARGET_CR = 10_000;

/** Save every rep's annual target in one go.
 *
 *  Sysadmin-only, matching setAnnualTarget on the same page: the company figure
 *  and the per-rep split are the same decision and should not have two
 *  different gates. Unlike setAnnualTarget this returns its refusal rather than
 *  throwing it, because a thrown error is redacted in production and the caller
 *  would show "an error occurred" for what is almost always a typo in one row.
 *
 *  All rows are written in one transaction. A partial save would leave the sum
 *  shown against the company target describing a state nobody chose. */
export async function setRepTargets(rows: RepTargetInput[]): Promise<SaveResult> {
  const session = await getServerSession(authOptions);
  if (session?.user?.role !== 'sysadmin') return fail('Sysadmin access required.');
  const email = (session.user.email ?? 'system').toLowerCase();

  if (!Array.isArray(rows) || rows.length === 0) return fail('Nothing to save.');

  // Validate everything before writing anything, and name the offending rep:
  // "Enter a number" against a list of eighteen inputs is not a usable message.
  const { rows: known } = await risansiPool.query<{ id: number; name: string }>(
    `SELECT id, name FROM users WHERE is_active AND role IN ('rep','manager')`);
  const nameById = new Map(known.map(r => [r.id, r.name]));

  const clean: { id: number; value: string | null }[] = [];
  for (const row of rows) {
    const id = Number(row?.id);
    if (!Number.isInteger(id) || !nameById.has(id)) return fail('That rep is no longer on the list — reload the page.');
    const who = nameById.get(id)!;

    const raw = String(row?.targetCr ?? '').trim();
    if (raw === '') { clean.push({ id, value: null }); continue; }

    const n = Number(raw);
    if (!Number.isFinite(n)) return fail(`${who}: "${raw}" is not a number. Enter a target in Crores, or leave it blank.`);
    if (n < 0) return fail(`${who}: a target cannot be negative.`);
    if (n > MAX_TARGET_CR) return fail(`${who}: ${n} Cr looks like a typo — targets are in Crores, not rupees.`);

    // Rounded to paise-of-a-Crore and handed to pg as text, so the value that
    // reaches a numeric column is the one that was typed rather than whatever
    // a float round-trip makes of it.
    clean.push({ id, value: (Math.round(n * 100) / 100).toFixed(2) });
  }

  const client = await risansiPool.connect();
  try {
    await client.query('BEGIN');
    for (const c of clean) {
      await client.query(
        `UPDATE users SET target_cr = $1::numeric, updated_at = NOW() WHERE id = $2`,
        [c.value, c.id],
      );
    }
    // Best-effort audit, same as the company target: a failed audit write must
    // not roll back a save the sysadmin watched succeed.
    try {
      await client.query(
        `INSERT INTO assignment_audit (entity_type, entity_id, action, old_value, new_value, changed_by)
         VALUES ('setting', 'rep_target_cr', 'update', NULL, $1::jsonb, $2)`,
        [JSON.stringify(clean), email],
      );
    } catch { /* audit is non-critical */ }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    return fail(e instanceof Error ? e.message : 'Could not save the rep targets.');
  } finally {
    client.release();
  }

  revalidatePath('/risansi/admin/settings');
  revalidatePath('/risansi');
  revalidatePath('/risansi/pipeline');
  revalidatePath('/risansi/executive-review');
  return { ok: true };
}
