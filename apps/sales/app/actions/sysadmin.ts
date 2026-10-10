'use server';

import { getServerSession } from 'next-auth/next';
import { revalidatePath } from 'next/cache';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import risansiPool from '@/lib/db-risansi';

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
  const session = await getServerSession(authOptions);
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

export async function deleteUser(formData: FormData): Promise<SaveResult> {
  const actor = await requireSysadmin();
  const id = parseInt(formData.get('id') as string, 10);
  const force = formData.get('force') === 'true';

  if (!Number.isInteger(id) || id <= 0) throw new Error('Invalid user id');

  // Snapshot for audit + ownership guard.
  const { rows: userRows } = await risansiPool.query<{ email: string; name: string; role: string }>(
    'SELECT email, name, role FROM users WHERE id = $1',
    [id],
  );
  if (!userRows[0]) throw new Error('User not found');

  if (!force) {
    const { rows } = await risansiPool.query<{
      clients: string; visits: string; opps: string;
    }>(
      `SELECT
         (SELECT COUNT(*) FROM clients WHERE primary_rep_id = $1 AND deleted_at IS NULL)::text AS clients,
         (SELECT COUNT(*) FROM visits        WHERE rep_id = $1)::text       AS visits,
         (SELECT COUNT(*) FROM opportunities WHERE rep_id = $1)::text       AS opps`,
      [id],
    );
    const clients = Number(rows[0]?.clients ?? 0);
    const visits  = Number(rows[0]?.visits ?? 0);
    const opps    = Number(rows[0]?.opps ?? 0);
    if (clients > 0 || visits > 0 || opps > 0) {
      const parts: string[] = [];
      if (clients) parts.push(`${clients} client${clients !== 1 ? 's' : ''}`);
      if (visits)  parts.push(`${visits} visit${visits !== 1 ? 's' : ''}`);
      if (opps)    parts.push(`${opps} opportunit${opps !== 1 ? 'ies' : 'y'}`);
      return fail(
        `Cannot delete — this user still owns ${parts.join(', ')}. Hand their book to someone `
        + `else with Move clients on Reps & Managers, or use force delete.`,
      );
    }
  }

  // Everything that pointed at this user either cascades or nulls out via its
  // own FK: client_assignments, client_secondary_reps and manager_reps cascade,
  // clients.primary_rep_id sets null. The one row that needed deleting by hand
  // was the route assignment, and that table is gone.
  await risansiPool.query('DELETE FROM users WHERE id = $1', [id]);

  await audit('user', id, 'delete', userRows[0], null, actor);

  revalidatePath('/admin');
  revalidatePath('/risansi/admin/reps');
  return { ok: true };
}

// The four tour actions that used to live here — setUserTours, assignUserToTour,
// removeUserFromTour and mapClients — went out with the tours tab they served.
// Ownership is a property of the client now, so it is written by
// app/actions/risansi-ownership.ts, which is admin-gated and returns its
// failures instead of throwing them.
