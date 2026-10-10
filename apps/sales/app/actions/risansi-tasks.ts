'use server';

import { getServerSession } from 'next-auth/next';
import { revalidatePath } from 'next/cache';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import risansiPool from '@/lib/db-risansi';
import { getCurrentUser, canViewClient, hasRole, canEditVisitReport } from '@/lib/risansi-auth';
import { notifyActionAssigned } from '@/lib/risansi-email';
import { pushInApp } from '@/lib/risansi-inapp';

async function requireEmail(): Promise<string> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) throw new Error('Unauthorized');
  return session.user.email;
}

/**
 * May the current user change/delete this task? A session alone was the whole
 * check before, so any rep could complete or delete any team's tasks by id.
 * Allowed if: admin+, the task's creator, its assigned rep, or someone who can
 * see the task's client.
 *
 * Returns the refusal rather than throwing it. Every action here returns its
 * own, and a guard that throws undoes that for all of them: the sentence goes
 * back through Next, which redacts it, and the rep is told "an error occurred"
 * when they could have been told to ask the task's owner.
 */
async function guardCanManageTask(taskId: number): Promise<SaveResult> {
  const user = await getCurrentUser();
  const { rows } = await risansiPool.query<{ client_id: number | null; created_by: string | null; assigned_to_rep: number | null }>(
    'SELECT client_id, created_by, assigned_to_rep FROM tasks WHERE id = $1', [taskId],
  );
  const t = rows[0];
  if (!t) throw new Error('Task not found.');
  if (hasRole(user.role, 'admin')) return { ok: true };
  if (user.email && t.created_by && t.created_by.toLowerCase() === user.email.toLowerCase()) return { ok: true };
  if (user.id != null && t.assigned_to_rep != null && Number(t.assigned_to_rep) === Number(user.id)) return { ok: true };
  if (t.client_id != null && await canViewClient(user, Number(t.client_id))) return { ok: true };
  return fail('You do not have permission to change this task. Ask whoever raised it, or an admin.');
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

// Email whoever a new action was assigned to — the in-system rep (looked up by
// id) or an external person at the address captured with them. Best-effort: any
// failure is logged and swallowed so it can never break task creation.
async function notifyActionRecipient(opts: {
  creatorEmail: string; clientId: number;
  assignedToRep?: number | null; assignedToExternal?: string | null; assignedToExternalEmail?: string | null;
  title: string; description?: string | null; dueDate?: string | null; priority?: string | null;
}) {
  try {
    let to: string | null = null;
    let toName: string | null = null;

    if (opts.assignedToRep) {
      const rep = (await risansiPool.query<{ name: string | null; email: string | null }>(
        'SELECT name, email FROM users WHERE id = $1', [opts.assignedToRep],
      )).rows[0];
      if (!rep?.email) return;
      if (rep.email.toLowerCase() === opts.creatorEmail.toLowerCase()) return;  // don't self-notify
      to = rep.email; toName = rep.name;
    } else if (opts.assignedToExternal && opts.assignedToExternalEmail) {
      to = opts.assignedToExternalEmail; toName = opts.assignedToExternal;
    }
    if (!to) return;

    const [creatorRes, clientRes] = await Promise.all([
      risansiPool.query<{ name: string | null }>('SELECT name FROM users WHERE email = $1', [opts.creatorEmail]),
      risansiPool.query<{ legal_name: string | null }>('SELECT legal_name FROM clients WHERE id = $1', [opts.clientId]),
    ]);

    await notifyActionAssigned({
      to, toName,
      assignedBy: creatorRes.rows[0]?.name || opts.creatorEmail,
      title: opts.title,
      description: opts.description,
      clientName: clientRes.rows[0]?.legal_name,
      dueDate: opts.dueDate,
      priority: opts.priority,
    });
    // In-app row for an in-system assignee (external handlers get email only).
    if (opts.assignedToRep) {
      await pushInApp([opts.assignedToRep], {
        kind: 'action_assigned', section: 'Action Registry', actor: opts.creatorEmail,
        title: `New action: ${opts.title}`, body: opts.description ?? null,
        link: '/risansi/registry', entityType: 'client', entityId: String(opts.clientId),
      });
    }
  } catch (e) {
    console.error('[addTask] assignee notification failed', e);
  }
}

export async function addTask({
  visitId,
  clientId,
  title,
  description,
  dueDate,
  priority,
  assignedToRep,
  assignedToExternal,
  assignedToExternalEmail,
}: {
  visitId?: number | null;   // null when recorded standalone (e.g. from the Client 360 page)
  clientId: number;
  title: string;
  description?: string;
  dueDate?: string | null;
  priority?: string;
  assignedToRep?: number | null;
  assignedToExternal?: string | null;
  assignedToExternalEmail?: string | null;
}): Promise<SaveResult> {
  // Authorise: the caller must be able to see this client (admins/sysadmins always
  // can; reps only for clients they work). This also gates the outbound
  // external-assignee email so it can't be used to send from an arbitrary client.
  const user = await getCurrentUser();
  if (!user.email) throw new Error('Unauthorized');

  // Tour membership is the usual test but not the only legitimate route in. Reps
  // routinely file visits for clients they do not own, and 1,279
  // clients carry no tour at all — for those, canViewClient is false for every
  // non-admin, so the rep filling in the report could not raise an action on it.
  // Whoever may fill in a visit report may also raise an action against it, so
  // fall back to the visit's own edit rule. The visit must actually belong to the
  // client being filed against, otherwise a caller could pair their own visit id
  // with somebody else's client id and write a task outside their scope.
  let allowed = await canViewClient(user, clientId);
  if (!allowed && visitId) {
    const { rows } = await risansiPool.query<{ rep_id: number | null; client_id: number | null }>(
      'SELECT rep_id, client_id FROM visits WHERE id = $1', [visitId],
    );
    const v = rows[0];
    if (v && v.client_id != null && Number(v.client_id) === Number(clientId)) {
      allowed = await canEditVisitReport({ role: user.role, repId: user.id }, v.rep_id, v.client_id);
    }
  }
  if (!allowed) {
    // Log it: Next redacts server-action error messages in production, so without
    // this a denial reaches the rep as an opaque "unexpected response" and leaves
    // no trace anywhere to diagnose it from.
    console.error('[addTask] denied', { user: user.email, role: user.role, clientId, visitId });
    return fail('You do not have access to this client.');
  }
  const email = user.email;

  if (!title.trim()) return fail('Give the action a title.');

  const external      = assignedToExternal?.trim() || null;
  const externalEmail = assignedToExternalEmail?.trim() || null;

  // Somebody has to be doing it. Enforced here and not only in the form: the
  // form is one caller, and an action with nobody on it is invisible in the one
  // list people actually read — their own.
  if (!assignedToRep && !external) {
    return fail('Choose who is doing this — a rep in the system, or a named person outside it.');
  }

  // An external assignee (not in the system) must come with a valid email.
  if (external && !assignedToRep) {
    if (!externalEmail) return fail('An email is required for a person outside the system.');
    if (!EMAIL_RE.test(externalEmail)) return fail('Please enter a valid email for the external person.');
  }

  await risansiPool.query(
    `INSERT INTO tasks (
       visit_id, client_id, assigned_to_rep, assigned_to_external, assigned_to_external_email,
       title, description, due_date, priority, status,
       created_by, created_at, updated_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'open', $10, NOW(), NOW())`,
    [
      visitId ?? null,
      clientId,
      assignedToRep ?? null,
      external,
      external ? externalEmail : null,
      title.trim(),
      description?.trim() || null,
      dueDate || null,
      priority ?? 'Medium',
      email,
    ],
  );

  if (visitId) revalidatePath(`/risansi/visits/${visitId}`);
  revalidatePath('/risansi');
  revalidatePath('/risansi/field');
  revalidatePath(`/risansi/clients/${clientId}`);

  // Notify the assignee by email — in-system rep or external person (best-effort).
  await notifyActionRecipient({
    creatorEmail: email,
    clientId,
    assignedToRep: assignedToRep ?? null,
    assignedToExternal: external,
    assignedToExternalEmail: external ? externalEmail : null,
    title: title.trim(),
    description: description?.trim() || null,
    dueDate: dueDate || null,
    priority: priority ?? 'Medium',
  });
  return { ok: true };
}

/**
 * Open or close an action.
 *
 * Closing requires a resolution note — what was actually done — and the note is
 * written once. If the action already carries one (it was closed, reopened and
 * is being closed again) the original stands and any note passed here is
 * ignored, so the record cannot be quietly rewritten after the fact.
 *
 * Reopening leaves the note alone rather than clearing it: it is the account of
 * a closure that genuinely happened, and erasing it would lose that history.
 */
export async function updateTaskStatus(
  taskId: number, status: 'open' | 'completed', resolutionNote?: string,
): Promise<SaveResult> {
  // Returns its refusals rather than throwing them. The note requirement below
  // is the user being asked to do something, and a thrown server-action message
  // is redacted in production — so the one person who needs to read it is the
  // one person who cannot.
  const email = await requireEmail();
  const g = await guardCanManageTask(taskId);
  if (!g.ok) return g;
  if (status !== 'open' && status !== 'completed') return fail('Invalid status.');

  const { rows } = await risansiPool.query<{ resolution_note: string | null; status: string }>(
    'SELECT resolution_note, status FROM tasks WHERE id = $1', [taskId],
  );
  if (!rows[0]) return fail('That action no longer exists.');
  const existing = rows[0].resolution_note;

  const note = (resolutionNote ?? '').trim();
  if (status === 'completed' && !existing && !note) {
    return fail('Add a resolution note describing what was done before closing this action.');
  }

  const client = await risansiPool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE tasks
         SET status          = $1,
             completed_at    = $2,
             completed_by    = $3,
             -- COALESCE, so the first note written is the one that survives.
             resolution_note = COALESCE(resolution_note, $5),
             updated_at      = NOW()
       WHERE id = $4`,
      [
        status,
        status === 'completed' ? new Date() : null,
        status === 'completed' ? email : null,
        taskId,
        status === 'completed' && note ? note.slice(0, 2000) : null,
      ],
    );
    // The history gets the event whichever door it came through.
    if (status !== rows[0].status) {
      await client.query(
        `INSERT INTO task_updates (task_id, kind, comment, actor_email) VALUES ($1, $2, $3, $4)`,
        [taskId, status === 'completed' ? 'completed' : 'reopened', note ? note.slice(0, 2000) : null, email],
      );
    }
    await client.query('COMMIT');
  } catch (e) { await client.query('ROLLBACK'); throw e; }
  finally { client.release(); }

  revalidatePath('/risansi');
  revalidatePath('/risansi/field');
  revalidatePath('/risansi/registry');
  return { ok: true };
}

// ── Update an action: comment, move the date, mark it done ─────
//
// One dialog, three things a person might be doing, and the words are required
// exactly when they carry meaning: a comment on its own is optional (it IS the
// update), moving the due date needs a reason, and closing needs to say what was
// done. Everything lands in task_updates so the next person to open the action
// sees how it got here. Refusals are returned, not thrown — a thrown message is
// redacted in production and the dialog would show nothing useful.

export type SaveResult = { ok: true } | { ok: false; error: string };
const fail = (error: string): SaveResult => ({ ok: false, error });

export interface ActionUpdateInput {
  comment?: string;
  /** YYYY-MM-DD, '' or null to clear. Omit to leave the date alone. */
  dueDate?: string | null;
  markDone?: boolean;
}

export async function updateAction(taskId: number, input: ActionUpdateInput): Promise<SaveResult> {
  const email = await requireEmail();
  const g = await guardCanManageTask(taskId);
  if (!g.ok) return g;

  const { rows } = await risansiPool.query<{ status: string; due_date: string | null; resolution_note: string | null }>(
    'SELECT status, due_date::text AS due_date, resolution_note FROM tasks WHERE id = $1', [taskId],
  );
  const t = rows[0];
  if (!t) return fail('This action no longer exists.');

  const comment = (input.comment ?? '').trim().slice(0, 2000);
  const markDone = !!input.markDone;

  let newDue: string | null | undefined = undefined;
  if (input.dueDate !== undefined) {
    const v = (input.dueDate ?? '').trim();
    if (v && !/^\d{4}-\d{2}-\d{2}$/.test(v)) return fail('The date is not in a form I can read.');
    newDue = v || null;
  }
  const dateChanged = newDue !== undefined && newDue !== t.due_date;

  if (t.status === 'completed' && (markDone || dateChanged)) {
    return fail('This action is already closed. Reopen it first if there is more to do.');
  }
  if (!comment && !dateChanged && !markDone) {
    return fail('Nothing to save yet — add a comment, move the date, or mark it done.');
  }
  if (dateChanged && !comment) {
    return fail(newDue ? 'Say why the date is moving.' : 'Say why the date is being cleared.');
  }
  if (markDone && !comment) return fail('Say what was done before closing this.');

  const client = await risansiPool.connect();
  try {
    await client.query('BEGIN');
    if (dateChanged) {
      await client.query('UPDATE tasks SET due_date = $2, updated_at = NOW() WHERE id = $1', [taskId, newDue]);
      await client.query(
        `INSERT INTO task_updates (task_id, kind, comment, old_due_date, new_due_date, actor_email)
         VALUES ($1, 'due_date', $2, $3, $4, $5)`,
        [taskId, comment, t.due_date, newDue, email],
      );
    } else if (comment && !markDone) {
      await client.query(
        `INSERT INTO task_updates (task_id, kind, comment, actor_email) VALUES ($1, 'comment', $2, $3)`,
        [taskId, comment, email],
      );
    }
    if (markDone) {
      await client.query(
        `UPDATE tasks
            SET status = 'completed', completed_at = NOW(), completed_by = $2,
                -- the first closure's words are the ones tasks.resolution_note keeps;
                -- every closure's words are in task_updates.
                resolution_note = COALESCE(resolution_note, $3),
                updated_at = NOW()
          WHERE id = $1`,
        [taskId, email, comment],
      );
      await client.query(
        `INSERT INTO task_updates (task_id, kind, comment, actor_email) VALUES ($1, 'completed', $2, $3)`,
        [taskId, comment, email],
      );
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('[updateAction] failed', e);
    return fail('The update could not be saved — please try again.');
  } finally { client.release(); }

  revalidatePath('/risansi');
  revalidatePath('/risansi/field');
  revalidatePath('/risansi/registry');
  return { ok: true };
}

export interface ActionHistoryItem {
  id: number;
  kind: 'raised' | 'comment' | 'due_date' | 'completed' | 'reopened';
  comment: string | null;
  oldDue: string | null;
  newDue: string | null;
  actor: string;
  /** ISO timestamp. */
  at: string;
}

export interface ActionHistory {
  title: string;
  status: string;
  dueDate: string | null;
  clientName: string | null;
  assignee: string;
  items: ActionHistoryItem[];
}

export type Result<T> = { ok: true; data: T } | { ok: false; error: string };

/** Everything that has happened to an action, newest first, ending with the day it was raised. */
export async function listActionHistory(taskId: number): Promise<Result<ActionHistory>> {
  await requireEmail();
  const g = await guardCanManageTask(taskId);
  if (!g.ok) return g;
  const { rows: [t] } = await risansiPool.query<{
    title: string; status: string; due_date: string | null; created_at: string; created_by: string | null;
    creator: string | null; client_name: string | null; assignee: string | null; external: string | null;
  }>(
    `SELECT t.title, t.status, t.due_date::text AS due_date, t.created_at::text AS created_at, t.created_by,
            (SELECT u.name FROM users u WHERE lower(u.email) = lower(t.created_by) LIMIT 1) AS creator,
            c.legal_name AS client_name,
            (SELECT u.name FROM users u WHERE u.id = t.assigned_to_rep) AS assignee,
            t.assigned_to_external AS external
       FROM tasks t LEFT JOIN clients c ON c.id = t.client_id
      WHERE t.id = $1`, [taskId]);
  if (!t) return { ok: false, error: 'This action no longer exists.' };

  const { rows } = await risansiPool.query<{
    id: number; kind: ActionHistoryItem['kind']; comment: string | null; old_due: string | null; new_due: string | null;
    actor: string | null; at: string;
  }>(
    `SELECT u.id, u.kind, u.comment, u.old_due_date::text AS old_due, u.new_due_date::text AS new_due,
            COALESCE((SELECT x.name FROM users x WHERE lower(x.email) = lower(u.actor_email) LIMIT 1), u.actor_email) AS actor,
            u.created_at::text AS at
       FROM task_updates u WHERE u.task_id = $1
      ORDER BY u.created_at DESC, u.id DESC`, [taskId]);

  const items: ActionHistoryItem[] = rows.map(r => ({
    id: r.id, kind: r.kind, comment: r.comment, oldDue: r.old_due, newDue: r.new_due,
    actor: r.actor ?? 'someone', at: r.at,
  }));
  items.push({
    id: 0, kind: 'raised', comment: null, oldDue: null, newDue: t.due_date,
    actor: t.creator ?? t.created_by ?? 'someone', at: t.created_at,
  });

  return {
    ok: true,
    data: {
      title: t.title, status: t.status, dueDate: t.due_date, clientName: t.client_name,
      assignee: t.assignee ?? t.external ?? 'Unassigned', items,
    },
  };
}

export async function deleteTask(taskId: number): Promise<SaveResult> {
  await requireEmail();
  const g = await guardCanManageTask(taskId);
  if (!g.ok) return g;

  const taskRes = await risansiPool.query<{ visit_id: number | null }>(
    'SELECT visit_id FROM tasks WHERE id = $1',
    [taskId],
  );
  const visitId = taskRes.rows[0]?.visit_id;

  await risansiPool.query('DELETE FROM tasks WHERE id = $1', [taskId]);

  if (visitId) revalidatePath(`/risansi/visits/${visitId}`);
  revalidatePath('/risansi');
  revalidatePath('/risansi/field');
  return { ok: true };
}
