'use server';

import { getServerSession } from 'next-auth/next';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import bcrypt from 'bcryptjs';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import risansiPool from '@/lib/db-risansi';
import { recordAudit } from '@/lib/audit';
import { getSession } from '@/lib/risansi-auth';

// Refusals come back rather than being thrown: Next redacts a thrown
// server-action message in production, so the sentence telling somebody how to
// fix what they typed never reaches them. A guard still throws — it is not
// advice, and it reads the same in every action.
export type SaveResult = { ok: true } | { ok: false; error: string };
const fail = (error: string): SaveResult => ({ ok: false, error });

const VALID_ROLES = ['rep', 'manager', 'admin', 'sysadmin'];

// Access-approval / user creation is now a System Admin (sysadmin) capability.
async function requireSysadmin() {
  const session = await getSession();
  if (!session?.user?.email) redirect('/api/auth/signin');
  const role = session.user.role ?? '';
  if (role !== 'sysadmin') redirect('/api/auth/signin');
  return session.user;
}

// ── Account management moved to Risansi Digital ──────────────────
//
// Phase 4b. Approving, refusing, revoking, reinstating, creating a person and
// resetting a password all happen once at digital.risansi.com/requests/people
// now, instead of here and in two other portals. The same job had four
// implementations; which one got used depended on who you asked, and
// switching somebody off properly meant remembering all four.
//
// They are refused rather than deleted. A Server Function is reachable by
// direct POST whether or not anything renders a form for it, so removing the
// UI would have left five working write paths behind an unlinked door. Step 5
// deletes them with the rest of the local credential machinery.
//
// Refusing also happens to be the only correct answer. This portal cannot
// decide access any more: whether somebody may open it is read from
// identity.app_grants on every request, so a role written into `users` here
// is overwritten on the next page load, and a password set here signs nobody
// in because the credential lives in identity.

const MOVED = fail(
  'Accounts are managed at Risansi Digital — digital.risansi.com/requests/people. '
  + 'Changes made here would be overwritten on the next page load.',
);

export async function approveUser(_formData: FormData): Promise<SaveResult> {
  await requireSysadmin();
  return MOVED;
}

export async function rejectUser(_formData: FormData): Promise<SaveResult> {
  await requireSysadmin();
  return MOVED;
}

export async function revokeUser(_formData: FormData): Promise<SaveResult> {
  await requireSysadmin();
  return MOVED;
}

export async function reapproveUser(_formData: FormData): Promise<SaveResult> {
  await requireSysadmin();
  return MOVED;
}

export async function resetUserPassword(_formData: FormData): Promise<SaveResult> {
  await requireSysadmin();
  return MOVED;
}
