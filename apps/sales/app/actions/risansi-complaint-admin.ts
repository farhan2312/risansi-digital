'use server';

import { revalidatePath } from 'next/cache';
import risansiPool from '@/lib/db-risansi';
import { DEPARTMENTS, getCurrentUser, hasRole } from '@/lib/risansi-auth';
import { SEVERITIES, type Severity } from '@/lib/risansi-complaint-flow';
import { LOOKUP_KINDS, parentKindOf, type AssigneeKind } from '@/lib/risansi-complaint-admin';

// The three things the Complaint Team may change without a developer: the
// dropdown lists, who an Action Taken assigns to, and how many days each
// severity gets before it is late.
//
// Every action here refuses rather than throws. A thrown error is redacted in
// production, and almost every refusal these can produce is something the
// person typing can fix — a duplicate value, a parent that no longer exists, a
// severity set to zero — so the message has to reach them.
//
// None of them deletes. A lookup value is the label the complaints filed under
// it read back through, so retiring one means setting is_active = FALSE and
// nothing else; the Add On control sets is_user_added = TRUE, which is what
// keeps a later seed migration from rewording or reordering the team's own
// entries (every seed's ON CONFLICT carries WHERE is_user_added = FALSE).

export type SaveResult = { ok: true; note?: string } | { ok: false; error: string };
const fail = (error: string): SaveResult => ({ ok: false, error });

const ADMIN_PATH = '/risansi/admin/complaints';

/** Admin or sysadmin, matching the gate on every other page under /risansi/admin. */
async function requireAdmin(): Promise<string | null> {
  const me = await getCurrentUser();
  if (!hasRole(me.role, 'admin')) return 'Admin access required.';
  return null;
}

function refresh() {
  revalidatePath(ADMIN_PATH);
  // Every complaint page renders these lists, and the dashboard filters are
  // built from them, so a value added here has to show up there without a
  // reload of the whole app.
  revalidatePath('/risansi/complaints');
}

// ── Lists ──────────────────────────────────────────────────────────────────

const MAX_VALUE_LEN = 120;

/** A kind the editor is allowed to touch: one the module knows by name. */
const knownKind = (kind: string) => Object.prototype.hasOwnProperty.call(LOOKUP_KINDS, kind);

export interface AddLookupInput {
  kind: string;
  value: string;
  /** Required for a cascading kind, forbidden otherwise. */
  parentValue?: string | null;
}

/**
 * The Add On control. Appends a value to a list, at the end of it.
 *
 * A value that is already on the list inactive is reactivated rather than
 * refused: that is the same intention, and refusing it would leave the person
 * with a list they cannot restore and no idea why their value will not go in.
 */
export async function addComplaintLookup(input: AddLookupInput): Promise<SaveResult> {
  const denied = await requireAdmin();
  if (denied) return fail(denied);

  const kind = String(input?.kind ?? '').trim();
  if (!knownKind(kind)) return fail('That is not a list this screen manages.');
  if (LOOKUP_KINDS[kind].retired) return fail(`${LOOKUP_KINDS[kind].label} is retired — the form no longer asks for it, so a new value would never be offered.`);

  const value = String(input?.value ?? '').trim().replace(/\s+/g, ' ');
  if (value === '') return fail('Type the value to add.');
  if (value.length > MAX_VALUE_LEN) return fail(`That is ${value.length} characters — keep a dropdown value under ${MAX_VALUE_LEN}.`);

  const parentKind = parentKindOf(kind);
  const parentRaw = input?.parentValue == null ? '' : String(input.parentValue).trim();

  if (parentKind && parentRaw === '') {
    return fail(`${LOOKUP_KINDS[kind].label} hangs under ${LOOKUP_KINDS[parentKind]?.label ?? parentKind} — choose which one first.`);
  }
  if (!parentKind && parentRaw !== '') {
    return fail(`${LOOKUP_KINDS[kind].label} is a single list and takes no parent.`);
  }
  const parent = parentKind ? parentRaw : null;

  if (parentKind && parent) {
    const { rows } = await risansiPool.query(
      'SELECT 1 FROM complaint_lookups WHERE kind = $1 AND value = $2', [parentKind, parent]);
    if (rows.length === 0) return fail(`"${parent}" is no longer on the ${LOOKUP_KINDS[parentKind]?.label ?? parentKind} list — reload the page.`);
  }

  // Existing row? The key is (kind, value, COALESCE(parent_value, '')), so the
  // comparison has to be written the same way or Shaft under one parent would
  // look like a duplicate of Shaft under another.
  const { rows: existing } = await risansiPool.query<{ is_active: boolean }>(
    `SELECT is_active FROM complaint_lookups
      WHERE kind = $1 AND value = $2 AND COALESCE(parent_value, '') = COALESCE($3::text, '')`,
    [kind, value, parent]);

  if (existing.length > 0) {
    if (existing[0].is_active) {
      return fail(`"${value}" is already on that list${parent ? ` under ${parent}` : ''}.`);
    }
    await risansiPool.query(
      `UPDATE complaint_lookups SET is_active = TRUE
        WHERE kind = $1 AND value = $2 AND COALESCE(parent_value, '') = COALESCE($3::text, '')`,
      [kind, value, parent]);
    refresh();
    return { ok: true, note: `"${value}" was on the list already, retired — put back.` };
  }

  await risansiPool.query(
    `INSERT INTO complaint_lookups (kind, value, parent_value, sort_order, is_active, is_user_added)
     SELECT $1::text, $2::text, $3::text,
            COALESCE((SELECT max(sort_order) FROM complaint_lookups
                       WHERE kind = $1 AND COALESCE(parent_value, '') = COALESCE($3::text, '')), 0) + 1,
            TRUE, TRUE`,
    [kind, value, parent]);

  refresh();
  return { ok: true };
}

/**
 * Retire a value, or put a retired one back.
 *
 * Never a delete. Historical complaints hold the value as text and read their
 * label through this table; removing the row would leave those records showing
 * a blank where an answer was given.
 */
export async function setComplaintLookupActive(
  kind: string, value: string, parentValue: string | null, active: boolean,
): Promise<SaveResult> {
  const denied = await requireAdmin();
  if (denied) return fail(denied);
  if (!knownKind(kind)) return fail('That is not a list this screen manages.');

  const parent = parentValue == null || parentValue === '' ? null : parentValue;

  // The last active value of a single list is not something to retire by
  // accident: the field becomes a dropdown with nothing in it, and on a
  // required field that is a page nobody can save. A cascading list is
  // different — a parent with no children is legitimate, Client Related being
  // exactly that today.
  if (!active && !parentKindOf(kind)) {
    const { rows } = await risansiPool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM complaint_lookups
        WHERE kind = $1 AND is_active AND NOT (value = $2 AND COALESCE(parent_value, '') = COALESCE($3::text, ''))`,
      [kind, value, parent]);
    if ((rows[0]?.n ?? 0) === 0) {
      return fail(`"${value}" is the last value on ${LOOKUP_KINDS[kind].label}. Add its replacement first, or the field becomes an empty dropdown.`);
    }
  }

  const { rowCount } = await risansiPool.query(
    `UPDATE complaint_lookups SET is_active = $4
      WHERE kind = $1 AND value = $2 AND COALESCE(parent_value, '') = COALESCE($3::text, '')`,
    [kind, value, parent, active]);
  if (!rowCount) return fail('That value is no longer on the list — reload the page.');

  refresh();
  return { ok: true };
}

/**
 * Move a value one place up or down its own list.
 *
 * The whole list is renumbered 1..n rather than two rows swapped, because the
 * seeds left gaps and duplicate sort_orders in a few lists and a swap between
 * two equal numbers moves nothing while looking like it worked.
 */
export async function moveComplaintLookup(
  kind: string, value: string, parentValue: string | null, direction: 'up' | 'down',
): Promise<SaveResult> {
  const denied = await requireAdmin();
  if (denied) return fail(denied);
  if (!knownKind(kind)) return fail('That is not a list this screen manages.');
  if (direction !== 'up' && direction !== 'down') return fail('Say up or down.');

  const parent = parentValue == null || parentValue === '' ? null : parentValue;
  const client = await risansiPool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query<{ value: string }>(
      `SELECT value FROM complaint_lookups
        WHERE kind = $1 AND COALESCE(parent_value, '') = COALESCE($2::text, '')
        ORDER BY sort_order, value
          FOR UPDATE`,
      [kind, parent]);

    const order = rows.map(r => r.value);
    const at = order.indexOf(value);
    if (at === -1) { await client.query('ROLLBACK'); return fail('That value is no longer on the list — reload the page.'); }

    const to = direction === 'up' ? at - 1 : at + 1;
    if (to < 0 || to >= order.length) { await client.query('ROLLBACK'); return fail(`"${value}" is already ${direction === 'up' ? 'first' : 'last'}.`); }

    order.splice(to, 0, ...order.splice(at, 1));
    for (let i = 0; i < order.length; i++) {
      await client.query(
        `UPDATE complaint_lookups SET sort_order = $4
          WHERE kind = $1 AND value = $2 AND COALESCE(parent_value, '') = COALESCE($3::text, '')`,
        [kind, order[i], parent, i + 1]);
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    return fail(e instanceof Error ? e.message : 'Could not reorder that list.');
  } finally {
    client.release();
  }

  refresh();
  return { ok: true };
}

// ── Action assignment ──────────────────────────────────────────────────────

const ASSIGNEE_KINDS: AssigneeKind[] = ['user', 'department', 'client_rep'];

export interface ActionAssignmentInput {
  action: string;
  assigneeKind: AssigneeKind;
  /** For 'user'. */
  userId?: number | null;
  /** For 'department'. */
  department?: string | null;
}

/**
 * Point one Action Taken at whoever picks it up.
 *
 * The table's CHECK insists each kind fills only its own column, so the other
 * one is written as NULL explicitly rather than left to whatever the form sent.
 * A kind sent with the wrong field filled is a refusal and not a silent
 * correction — it means the screen and the action disagree about something.
 */
export async function setComplaintActionAssignment(input: ActionAssignmentInput): Promise<SaveResult> {
  const denied = await requireAdmin();
  if (denied) return fail(denied);

  const action = String(input?.action ?? '').trim();
  if (action === '') return fail('Which action?');

  const { rows: known } = await risansiPool.query(
    `SELECT 1 FROM complaint_lookups WHERE kind = 'action_category' AND value = $1`, [action]);
  if (known.length === 0) return fail(`"${action}" is not on the Action taken list — add it above first.`);

  const kind = String(input?.assigneeKind ?? '') as AssigneeKind;
  if (!ASSIGNEE_KINDS.includes(kind)) return fail('Choose a person, a department, or the client’s own rep.');

  let userId: number | null = null;
  let department: string | null = null;

  if (kind === 'user') {
    userId = Number(input?.userId);
    if (!Number.isInteger(userId) || userId <= 0) return fail('Choose the person this action goes to.');
    const { rows } = await risansiPool.query<{ name: string; is_active: boolean }>(
      'SELECT name, is_active FROM users WHERE id = $1', [userId]);
    if (rows.length === 0) return fail('That person is not on the user list any more — reload the page.');
    if (!rows[0].is_active) return fail(`${rows[0].name}’s account is disabled, so the work would land nowhere. Pick someone else or a department.`);
  } else if (kind === 'department') {
    department = String(input?.department ?? '').trim();
    if (department === '') return fail('Choose the department this action goes to.');
    if (!(DEPARTMENTS as readonly string[]).includes(department)) return fail(`"${department}" is not one of the departments.`);
  }

  await risansiPool.query(
    `INSERT INTO complaint_action_assignment (action, assignee_kind, user_id, department)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (action) DO UPDATE
        SET assignee_kind = EXCLUDED.assignee_kind,
            user_id       = EXCLUDED.user_id,
            department    = EXCLUDED.department`,
    [action, kind, userId, department]);

  refresh();
  return { ok: true };
}

// ── SLA thresholds ─────────────────────────────────────────────────────────

/** A year is not a service level, and a complaint cannot be late before it is raised. */
const MAX_SLA_DAYS = 365;

export interface SlaThresholdInput { severity: string; days: string }

/**
 * Save all four thresholds together, in one transaction.
 *
 * Together because they are read as a set — the dashboard's overdue figure is
 * the sum over the four — and a half-saved set would make the page describe a
 * state nobody chose. Validated before anything is written, and the message
 * names the severity: "enter a number" against four inputs is not usable.
 */
export async function setComplaintSlaThresholds(rows: SlaThresholdInput[]): Promise<SaveResult> {
  const denied = await requireAdmin();
  if (denied) return fail(denied);
  if (!Array.isArray(rows) || rows.length === 0) return fail('Nothing to save.');

  const clean: { severity: Severity; days: number }[] = [];
  for (const row of rows) {
    const severity = String(row?.severity ?? '') as Severity;
    if (!(SEVERITIES as readonly string[]).includes(severity)) return fail(`"${row?.severity}" is not one of S1 to S4.`);
    if (clean.some(c => c.severity === severity)) return fail(`${severity} is in the list twice.`);

    const raw = String(row?.days ?? '').trim();
    if (raw === '') return fail(`${severity}: enter the number of days. A blank threshold would stop grading that severity altogether.`);
    const n = Number(raw);
    if (!Number.isFinite(n) || !Number.isInteger(n)) return fail(`${severity}: "${raw}" is not a whole number of days.`);
    if (n < 1) return fail(`${severity}: a complaint needs at least one day. Zero would make every complaint overdue the moment it is raised.`);
    if (n > MAX_SLA_DAYS) return fail(`${severity}: ${n} days is over a year — that is not a threshold anybody would chase.`);
    clean.push({ severity, days: n });
  }

  // S1 is the most severe and must not be given longer than S4. The table has
  // no constraint for it, and an order that runs backwards makes the dashboard
  // flag the mild complaints and spare the dangerous ones.
  const byLevel = SEVERITIES.map(s => clean.find(c => c.severity === s)).filter(Boolean) as { severity: Severity; days: number }[];
  for (let i = 1; i < byLevel.length; i++) {
    if (byLevel[i].days < byLevel[i - 1].days) {
      return fail(`${byLevel[i].severity} (${byLevel[i].days}d) cannot be shorter than ${byLevel[i - 1].severity} (${byLevel[i - 1].days}d) — the more severe level has to be the tighter one.`);
    }
  }

  const client = await risansiPool.connect();
  try {
    await client.query('BEGIN');
    for (const c of clean) {
      await client.query(
        `INSERT INTO complaint_sla_thresholds (severity, days) VALUES ($1, $2)
         ON CONFLICT (severity) DO UPDATE SET days = EXCLUDED.days`,
        [c.severity, c.days]);
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    return fail(e instanceof Error ? e.message : 'Could not save the thresholds.');
  } finally {
    client.release();
  }

  refresh();
  // Overdue is on the complaints list, the dashboard tiles and the Client 360
  // panel, and all three are now reading a different number.
  revalidatePath('/risansi/clients', 'layout');
  return { ok: true };
}
