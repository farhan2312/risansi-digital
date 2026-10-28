'use server';

import { getServerSession } from 'next-auth/next';
import { revalidatePath } from 'next/cache';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import risansiPool from '@/lib/db-risansi';
import { COMPLAINT_EDIT_OVERRIDE_KEY } from '@/lib/risansi-settings';
import { getSession } from '@/lib/risansi-auth';

// Refusals come back rather than being thrown: Next redacts a thrown
// server-action message in production, so the sentence telling somebody how to
// fix what they typed never reaches them. A guard still throws — it is not
// advice, and it reads the same in every action.
export type SaveResult = { ok: true } | { ok: false; error: string };
const fail = (error: string): SaveResult => ({ ok: false, error });

// ── Gate ───────────────────────────────────────────────────────
// Every action in this file is sysadmin-only. requireSysadmin throws on
// anything below the sysadmin tier, and returns the acting user's email
// (lowercased) for audit attribution.

async function requireSysadmin(): Promise<string> {
  const session = await getSession();
  const role = session?.user?.role ?? '';
  if (role !== 'sysadmin') {
    throw new Error('Sysadmin access required');
  }
  return (session!.user.email ?? 'system').toLowerCase();
}

// ── Audit helper ───────────────────────────────────────────────
// Best-effort: a failed audit write must never break the actual mutation.

async function audit(
  entityType: string,
  entityId: string | number,
  action: string,
  oldValue: unknown,
  newValue: unknown,
  changedBy: string,
): Promise<void> {
  try {
    await risansiPool.query(
      `INSERT INTO assignment_audit
         (entity_type, entity_id, action, old_value, new_value, changed_by)
       VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6)`,
      [
        entityType,
        String(entityId),
        action,
        oldValue == null ? null : JSON.stringify(oldValue),
        newValue == null ? null : JSON.stringify(newValue),
        changedBy,
      ],
    );
  } catch {
    /* audit is non-critical */
  }
}

// ── App settings ───────────────────────────────────────────────

// Company-wide annual revenue target (in Crores), shown on the dashboard.
export async function setAnnualTarget(formData: FormData): Promise<SaveResult> {
  const email = await requireSysadmin();
  const raw = (formData.get('annual_target_cr') as string | null)?.trim() ?? '';
  const val = parseFloat(raw);
  if (!Number.isFinite(val) || val <= 0) {
    return fail('Enter a valid annual target in Crores (e.g. 32).');
  }
  const { rows: before } = await risansiPool.query<{ value: string }>(
    `SELECT value FROM app_settings WHERE key = 'annual_target_cr'`);
  await risansiPool.query(
    `INSERT INTO app_settings (key, value, updated_by, updated_at)
     VALUES ('annual_target_cr', $1, $2, NOW())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
    [String(val), email]);
  await audit('setting', 'annual_target_cr', 'update', before[0]?.value ?? null, String(val), email);
  revalidatePath('/risansi');
  revalidatePath('/risansi/admin/settings');
  return { ok: true };
}

// USD→INR conversion rate, used to show quoted values in USD alongside ₹.
export async function setUsdRate(formData: FormData): Promise<SaveResult> {
  const email = await requireSysadmin();
  const raw = (formData.get('usd_inr_rate') as string | null)?.trim() ?? '';
  const val = parseFloat(raw);
  if (!Number.isFinite(val) || val <= 0) {
    return fail('Enter a valid USD→INR rate (e.g. 86).');
  }
  const { rows: before } = await risansiPool.query<{ value: string }>(
    `SELECT value FROM app_settings WHERE key = 'usd_inr_rate'`);
  await risansiPool.query(
    `INSERT INTO app_settings (key, value, updated_by, updated_at)
     VALUES ('usd_inr_rate', $1, $2, NOW())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
    [String(val), email]);
  await audit('setting', 'usd_inr_rate', 'update', before[0]?.value ?? null, String(val), email);
  revalidatePath('/risansi');
  revalidatePath('/risansi/admin/settings');
  revalidatePath('/risansi/pipeline');
  return { ok: true };
}

// ── deleteUser ─────────────────────────────────────────────────
// Removes a user. Guards against deleting someone who still owns clients,
// visits, or opportunities unless `force` is set.
//
// A forced delete does not orphan anything: clients.primary_rep_id is ON DELETE
// SET NULL, so their book surfaces in the Unassigned tab rather than vanishing,
// and their secondary and team rows cascade away.

// Deleting an account moved to Risansi Digital. Deactivating there locks
// every portal on that person's next click and keeps their history intact,
// which is what this was nearly always used for. Refused rather than removed:
// a Server Function is reachable by direct POST with or without a button.
export async function deleteUser(_formData: FormData): Promise<SaveResult> {
  return { ok: false, error: 'Accounts are managed at Risansi Digital — digital.risansi.com/requests/people.' };
}

// The four tour actions that used to live here — setUserTours, assignUserToTour,
// removeUserFromTour and mapClients — went out with the tours tab they served.
// Ownership is a property of the client now, so it is written by
// app/actions/risansi-ownership.ts, which is admin-gated and returns its
// failures instead of throwing them.

// ── setComplaintEditOverride ───────────────────────────────────
//
// The complaint edit rules relaxed company-wide, from a switch rather than a
// code change — see lib/risansi-settings for why it exists and what it does
// not do. Sysadmin only, and both directions are audited, because "who opened
// this and when" is the first question anybody will ask of an edit made while
// it was on.
export async function setComplaintEditOverride(on: boolean): Promise<SaveResult> {
  const email = await requireSysadmin();
  const { rows: before } = await risansiPool.query<{ value: string }>(
    `SELECT value FROM app_settings WHERE key = $1`, [COMPLAINT_EDIT_OVERRIDE_KEY]);
  const next = on ? 'on' : 'off';
  await risansiPool.query(
    `INSERT INTO app_settings (key, value, updated_by, updated_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
    [COMPLAINT_EDIT_OVERRIDE_KEY, next, email]);
  await audit('setting', COMPLAINT_EDIT_OVERRIDE_KEY, 'update', before[0]?.value ?? 'off', next, email);
  revalidatePath('/risansi/admin/settings');
  revalidatePath('/risansi/complaints');
  return { ok: true };
}
