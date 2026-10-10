'use server';

import { getServerSession } from 'next-auth/next';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import risansiPool from '@/lib/db-risansi';
import { recordAudit } from '@/lib/audit';

// Access-approval is now a System Admin (sysadmin) capability.
async function requireSysadmin() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) redirect('/api/auth/signin');
  const role = session.user.role ?? '';
  if (role !== 'sysadmin') redirect('/risansi');
  return session.user;
}

async function logActivity(entity: string, id: string, action: string, email: string) {
  const verb = /add|creat|approv/i.test(action) ? 'create'
    : /updat|edit|chang|rename/i.test(action) ? 'update'
    : /delet|remov|reject|revok/i.test(action) ? 'delete'
    : /assign/i.test(action) ? 'assign' : 'activity';
  await recordAudit({ action: verb, entityType: entity, entityId: id, summary: action, actorEmail: email });
}

// ── Approve a pending access request ──────────────────────────

export async function approveAccessRequest(formData: FormData) {
  const admin = await requireSysadmin();
  const email = (formData.get('email') as string | null)?.trim() ?? '';
  if (!email) return;

  await risansiPool.query(
    `UPDATE users
     SET status = 'Approved', updated_at = NOW()
     WHERE lower(email) = lower($1)`,
    [email],
  );

  await logActivity('access_request', email, 'approved', admin.email!);
  revalidatePath('/risansi/admin');
}

// ── Reject a pending access request ───────────────────────────

export async function rejectAccessRequest(formData: FormData) {
  const admin = await requireSysadmin();
  const email = (formData.get('email') as string | null)?.trim() ?? '';
  if (!email) return;

  await risansiPool.query(
    `UPDATE users
     SET status = 'Rejected', updated_at = NOW()
     WHERE lower(email) = lower($1)`,
    [email],
  );

  await logActivity('access_request', email, 'rejected', admin.email!);
  revalidatePath('/risansi/admin');
}

// ── Revoke an approved user's access ──────────────────────────

export async function revokeAccess(formData: FormData) {
  const admin = await requireSysadmin();
  const email = (formData.get('email') as string | null)?.trim() ?? '';
  if (!email) return;

  // No 'Revoked' status in the CHECK constraint — use 'Rejected'.
  await risansiPool.query(
    `UPDATE users
     SET status = 'Rejected', updated_at = NOW()
     WHERE lower(email) = lower($1)`,
    [email],
  );

  await logActivity('access_request', email, 'revoked', admin.email!);
  revalidatePath('/risansi/admin');
}
