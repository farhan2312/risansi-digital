'use server';

import { getServerSession } from 'next-auth/next';
import { revalidatePath } from 'next/cache';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import risansiPool from '@/lib/db-risansi';
import { isDepartment } from '@/lib/risansi-auth';

// Refusals come back rather than being thrown: Next redacts a thrown
// server-action message in production, so the sentence telling somebody how to
// fix what they typed never reaches them. A guard still throws — it is not
// advice, and it reads the same in every action.
export type SaveResult = { ok: true } | { ok: false; error: string };
const fail = (error: string): SaveResult => ({ ok: false, error });

// Reps & Tours management is a System Admin (sysadmin) capability.
async function requireSysadmin() {
  const session = await getServerSession(authOptions);
  if (session?.user?.role !== 'sysadmin') {
    throw new Error('System admin access required');
  }
  return session!;
}

/** The department checkboxes, validated. Unknown values are refused rather than
 *  dropped: silently ignoring one would leave an admin certain they had granted
 *  a stage that nobody actually holds. */
function readDepartments(formData: FormData): string[] {
  const picked = formData.getAll('departments').map(v => String(v).trim()).filter(Boolean);
  const bad = picked.filter(d => !isDepartment(d));
  if (bad.length) throw new Error(`Not a department: ${bad.join(', ')}.`);
  return [...new Set(picked)];
}

/** Replace somebody's departments with exactly this set. */
async function setDepartments(userId: number, departments: string[], addedBy: string | null) {
  const client = await risansiPool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM user_departments WHERE user_id = $1', [userId]);
    for (const d of departments) {
      await client.query(
        `INSERT INTO user_departments (user_id, department, added_by) VALUES ($1, $2, $3)`,
        [userId, d, addedBy],
      );
    }
    await client.query('COMMIT');
  } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
}

function deriveInitials(name: string): string {
  return name.split(/\s+/).map(w => w[0]?.toUpperCase() ?? '').join('').slice(0, 3) || 'R';
}

export async function createRep(formData: FormData): Promise<SaveResult> {
  const session = await requireSysadmin();

  const name     = (formData.get('name')     as string | null)?.trim() ?? '';
  const repCode  = (formData.get('rep_code') as string | null)?.trim() || null;
  const email    = (formData.get('email')    as string | null)?.trim().toLowerCase() || null;
  const zone     = (formData.get('zone')     as string | null)?.trim() || null;
  const route    = (formData.get('route')    as string | null)?.trim() || null;
  const role     = (formData.get('role')     as string | null)?.trim() || 'rep';
  const departments = readDepartments(formData);
  const targetCr = formData.get('target_cr') ? parseFloat(formData.get('target_cr') as string) : null;
  const initials = (formData.get('initials') as string | null)?.trim() || deriveInitials(name);

  if (!name)  return fail('Enter the person’s name.');
  if (!email) return fail('Enter an email address — it is how they sign in.');

  const existing = await risansiPool.query('SELECT id FROM users WHERE lower(email) = lower($1)', [email]);
  if (existing.rows.length > 0) {
    return fail(`${email} is already registered. Edit that account instead of creating a second one.`);
  }

  const { rows } = await risansiPool.query<{ id: number }>(
    `INSERT INTO users
       (rep_code, name, initials, email, zone, route, target_cr, role, status,
        is_active, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'Approved',TRUE,NOW(),NOW())
     RETURNING id`,
    [repCode, name, initials, email, zone, route, targetCr, role],
  );
  const newUserId = rows[0].id;
  await setDepartments(newUserId, departments, session.user?.email ?? null);

  // Optionally put them under a manager in the same step. This replaced an
  // "assign tours" picker, which by then granted nothing: a route stopped being
  // the thing that decides who sees what, so offering it here told the admin
  // they were setting up access when they were setting up a label.
  const managerId = parseInt((formData.get('manager_id') as string | null) ?? '', 10);
  if ((role === 'rep' || role === 'manager') && Number.isInteger(managerId) && managerId !== newUserId) {
    await risansiPool.query(
      `INSERT INTO manager_reps (manager_id, rep_id, added_by)
       VALUES ($1, $2, (SELECT id FROM users WHERE lower(email) = lower($3)))
       ON CONFLICT DO NOTHING`,
      [managerId, newUserId, session.user?.email ?? ''],
    );
  }

  revalidatePath('/risansi/admin/reps');
  return { ok: true };
}

export async function updateRep(repId: number, formData: FormData) {
  await requireSysadmin();

  if (!Number.isInteger(repId) || repId <= 0) throw new Error('Invalid user id');

  // Only update the columns that were actually submitted. The Reps & Managers
  // inline editor submits a subset (name, zone, route, status) and must NOT
  // clobber account fields it doesn't show — email, role and target are owned
  // by Users & Access. (A form that omits `role` previously reset it to 'rep',
  // silently downgrading managers.)
  const sets: string[] = [];
  const vals: unknown[] = [];
  const set = (col: string, val: unknown) => { vals.push(val); sets.push(`${col} = $${vals.length}`); };

  if (formData.has('name')) {
    const name = (formData.get('name') as string).trim();
    if (!name) throw new Error('Name is required');
    set('name', name);
  }
  if (formData.has('zone'))     set('zone',     (formData.get('zone')     as string).trim() || null);
  if (formData.has('route'))    set('route',    (formData.get('route')    as string).trim() || null);
  if (formData.has('rep_code')) set('rep_code', (formData.get('rep_code') as string).trim() || null);
  if (formData.has('email'))    set('email',    (formData.get('email')    as string).trim().toLowerCase() || null);
  if (formData.has('role'))     set('role',     (formData.get('role')     as string).trim() || 'rep');

  if (formData.has('target_cr')) {
    const raw = (formData.get('target_cr') as string).trim();
    const n = parseFloat(raw);
    set('target_cr', raw && Number.isFinite(n) ? n : null);
  }
  if (formData.has('is_active')) {
    // Hidden 'false' + checkbox 'true' both submit when checked; the last wins.
    // A lone <select> or hidden input submits a single value.
    const all = formData.getAll('is_active');
    set('is_active', all[all.length - 1] === 'true');
  }

  // Departments live in their own table, so they are written separately and
  // only when the form actually carried the field. A form that never asks about
  // departments must not clear the ones somebody already has — the same rule
  // every other optional field on this action follows.
  if (formData.has('departments') || formData.has('departments_present')) {
    await setDepartments(repId, readDepartments(formData), null);
  }

  if (sets.length === 0) {
    revalidatePath('/risansi/admin/reps');
    revalidatePath('/admin');
    return;
  }

  vals.push(repId);
  await risansiPool.query(
    `UPDATE users SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $${vals.length}`,
    vals,
  );

  revalidatePath('/risansi/admin/reps');
  revalidatePath('/admin');
}

export async function createTour(formData: FormData): Promise<SaveResult> {
  await requireSysadmin();

  const name            = (formData.get('name') as string | null)?.trim() ?? '';
  const zone            = (formData.get('zone') as string | null)?.trim() ?? '';
  const visitFreqKey    = formData.get('visit_freq_key_days') ? parseInt(formData.get('visit_freq_key_days') as string, 10) : 90;
  const visitFreqStd    = formData.get('visit_freq_std_days') ? parseInt(formData.get('visit_freq_std_days') as string, 10) : 180;
  const alertKey        = formData.get('alert_key_days') ? parseInt(formData.get('alert_key_days') as string, 10) : 100;
  const alertStd        = formData.get('alert_std_days') ? parseInt(formData.get('alert_std_days') as string, 10) : 200;

  if (!name) return fail('Give the tour a name.');
  if (!zone) return fail('Choose a zone for the tour.');

  const existing = await risansiPool.query('SELECT id FROM tour_routes WHERE LOWER(name) = LOWER($1)', [name]);
  if (existing.rows.length > 0) {
    return fail(`A tour called "${name}" already exists. Pick another name, or edit that one.`);
  }

  await risansiPool.query(
    `INSERT INTO tour_routes
       (name, zone, visit_freq_key_days, visit_freq_std_days, alert_key_days, alert_std_days)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [name, zone, visitFreqKey, visitFreqStd, alertKey, alertStd],
  );

  revalidatePath('/risansi/admin/reps');
  return { ok: true };
}

// Delete a route. Its clients lose the route (tour_id → NULL) in the same
// transaction; nobody loses access, because a route has not granted any since
// the ownership migration.
export async function deleteTour(formData: FormData) {
  await requireSysadmin();

  const id = parseInt(formData.get('id') as string, 10);
  if (!Number.isInteger(id) || id <= 0) throw new Error('Invalid tour');

  const client = await risansiPool.connect();
  try {
    await client.query('BEGIN');
    await client.query('UPDATE clients SET tour_id = NULL, updated_at = NOW() WHERE tour_id = $1', [id]);
    await client.query('DELETE FROM tour_routes WHERE id = $1', [id]);
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }

  revalidatePath('/risansi/admin/reps');
  revalidatePath('/risansi/clients');
}
