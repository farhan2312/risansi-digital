'use server';

import { revalidatePath } from 'next/cache';
import risansiPool from '@/lib/db-risansi';
import { getCurrentUser, hasRole, canViewClient, complaintVisibilitySql, type CurrentUser } from '@/lib/risansi-auth';
import { recordAudit } from '@/lib/audit';
import { pushInApp } from '@/lib/risansi-inapp';
import { sendNotification } from '@/lib/risansi-email';
import {
  pageById, STATUSES, NEXT, canEditPage, canMove, gateFor, severityOf, holderFor, isFieldShown,
  cascadeParent, costImpactForced, isImmediateResponse, statusAfterSavingPage,
  ADD_ON_LOOKUP_KINDS, CASCADING_LOOKUP_KINDS,
  responsibleDepartmentFor, routingOwner, IMMEDIATE_RISK_FIELDS,
  type ComplaintStatus, type ComplaintValues, type ComplaintField,
} from '@/lib/risansi-complaint-flow';

// The complaint workflow's writes. Every refusal is returned, never thrown —
// a thrown message is redacted in production and the form would show nothing
// useful. The rules live in lib/risansi-complaint-flow; this file applies them
// to rows.

export type SaveResult = { ok: true } | { ok: false; error: string };
export type Result<T> = { ok: true; data: T } | { ok: false; error: string };
const fail = (error: string) => ({ ok: false as const, error });

// ── Loading with access ────────────────────────────────────────────────────

interface AccessRow {
  id: number; complaint_no: string; status: string; schema_version: number; client_id: number | null;
  complaint_type: string | null; investigation_assigned_to: number | null; action_assigned_to: number | null;
  returnable_owner: number | null; rep_user_id: number | null; reported_by_user: number | null; created_by: string | null;
  assigned_to_user: number | null;
}

async function loadAccess(id: number): Promise<{ user: CurrentUser; row: AccessRow; worksClient: boolean; canSee: boolean } | null> {
  const user = await getCurrentUser();
  const { rows } = await risansiPool.query<AccessRow>(
    `SELECT id, complaint_no, status, schema_version, client_id, complaint_type, investigation_assigned_to,
            action_assigned_to, returnable_owner, rep_user_id, reported_by_user, created_by, assigned_to_user
       FROM complaints WHERE id = $1`, [id]);
  const row = rows[0];
  if (!row) return null;
  // Ownership only — owner, cover, or a manager of either — which is what
  // canViewClient answers for a non-admin.
  const worksClient = row.client_id != null && !hasRole(user.role, 'admin') && !user.departments.length
    ? await canViewClient(user, row.client_id) : false;
  const canSee = hasRole(user.role, 'admin') || user.role === 'staff' || user.departments.length > 0
    || worksClient || (user.id != null && [row.assigned_to_user, row.investigation_assigned_to, row.action_assigned_to, row.returnable_owner, row.reported_by_user].includes(user.id))
    || (!!user.email && !!row.created_by && row.created_by.toLowerCase() === user.email.toLowerCase());
  return { user, row, worksClient, canSee };
}

const editor = (u: CurrentUser) => ({ id: u.id, role: u.role, departments: u.departments });

// ── Value coercion ─────────────────────────────────────────────────────────

function coerce(f: ComplaintField, raw: unknown): unknown {
  if (raw === undefined) return undefined;
  if (raw === null || raw === '') return null;
  switch (f.type) {
    case 'bool': return raw === true || raw === 'true' || raw === 'yes' ? true : raw === false || raw === 'false' || raw === 'no' ? false : null;
    case 'number': { const n = Number(raw); return Number.isFinite(n) ? Math.round(n) : null; }
    case 'money': { const n = Number(String(raw).replace(/[₹,\s]/g, '')); return Number.isFinite(n) ? n : null; }
    case 'user':
    case 'oem': { const n = Number(raw); return Number.isInteger(n) && n > 0 ? n : null; }
    case 'date': { const s = String(raw).slice(0, 10); return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null; }
    // Several answers from one list, stored as a text[]. An empty tick-list is
    // null rather than '{}' so "nobody has answered yet" and "answered, nobody"
    // stay the same thing they are everywhere else on the form.
    case 'multi': {
      const list = Array.isArray(raw) ? raw : String(raw).split(',');
      const allowed = f.options ? new Set(f.options) : null;
      const out = [...new Set(list.map(v => String(v).trim()).filter(Boolean))].filter(v => !allowed || allowed.has(v));
      return out.length ? out : null;
    }
    case 'complaint': { const n = Number(raw); return Number.isInteger(n) && n > 0 ? n : null; }
    default: return String(raw).trim().slice(0, f.type === 'long' ? 8000 : 500) || null;
  }
}

/**
 * One list out of `complaint_lookups`, by kind and by the parent it hangs under.
 *
 * `parent_value` made the kind alone an ambiguous question: `part_name` holds
 * Shaft under External and Shaft again under Child Parts of Joints, so a read
 * that ignores the parent returns the same word twice and validates a part
 * against the wrong list. `parent === null` means the flat list — the rows that
 * hang under nothing — not "every row of this kind".
 */
async function lookupValues(kind: string, parent: string | null = null): Promise<Set<string>> {
  const { rows } = await risansiPool.query<{ value: string }>(
    parent == null
      ? 'SELECT value FROM complaint_lookups WHERE kind = $1 AND is_active AND parent_value IS NULL'
      : 'SELECT value FROM complaint_lookups WHERE kind = $1 AND is_active AND parent_value = $2',
    parent == null ? [kind] : [kind, parent]);
  return new Set(rows.map(r => r.value));
}

/**
 * What this field may legally hold, or null when anything typed is acceptable.
 *
 * Null covers the two cases the cascading contract keeps apart. The parent is
 * unanswered, so there is no list to check against and the value is about to be
 * cleared anyway; or the parent is answered and nothing is seeded under it —
 * Client Related has no sub-categories until the Complaint team sends them — in
 * which case refusing a typed answer would make the field unfillable.
 */
async function allowedFor(f: ComplaintField, values: ComplaintValues): Promise<Set<string> | null> {
  if (f.options) return new Set(f.options);
  if (!f.lookup) return null;
  if (!f.parentField) return lookupValues(f.lookup, null);
  const parent = cascadeParent(f, values);
  if (parent == null) return null;
  const set = await lookupValues(f.lookup, parent);
  return set.size ? set : null;
}

// ── Create ─────────────────────────────────────────────────────────────────

async function nextComplaintNo(): Promise<string> {
  const { rows } = await risansiPool.query<{ next: number }>(
    `SELECT COALESCE(MAX(n), 165) + 1 AS next
       FROM (SELECT NULLIF(regexp_replace(complaint_no, '[^0-9]', '', 'g'), '')::int AS n FROM complaints) t
      WHERE n < 10000`);
  return `CMP-${String(rows[0]?.next ?? 166).padStart(4, '0')}`;
}

/**
 * Register a complaint — page 1, plus whatever of page 2 is already known.
 * Anyone who works the client (rep, manager), the Complaint Team, or an admin.
 * It opens at Open, held by the Complaint Team, and the team is told.
 */
export async function createComplaintV2(input: { client_id: number; values: Record<string, unknown> }): Promise<Result<{ id: number; complaint_no: string }>> {
  const user = await getCurrentUser();
  if (!user.email) return fail('Sign in again.');
  const clientId = Number(input.client_id);
  if (!Number.isInteger(clientId)) return fail('Pick a client.');
  // Anyone signed in may lodge. A complaint arrives wherever the phone rings —
  // Marketing, a rep standing in someone else's mill, whoever picked up — and
  // the old rule, which allowed it only for a client you personally work, meant
  // the person holding the complaint often could not record it. Lodging asks
  // for almost nothing and commits nothing: the Complaint Team registers it
  // properly afterwards, and a wrongly filed one costs a correction, which is
  // cheaper than a complaint nobody wrote down.

  const page1 = pageById(1)!, page2 = pageById(2)!;
  const values: ComplaintValues = {};
  for (const f of [...page1.fields, ...page2.fields]) {
    const v = coerce(f, input.values[f.name]);
    if (v !== undefined) values[f.name] = v;
  }
  // Lodging is not registering. The page-1 answers — source, category,
  // description — are what the Complaint Team fills in once they have looked at
  // it, so demanding them here is demanding an analysis from whoever answered
  // the phone. They are still required: gateFor holds the complaint at Open
  // until Registration is complete, which is the right place for that wall.
  //
  // What a complaint cannot be without is a client, and, when it came through
  // an OEM, both ends of that — who raised it and whose pump it is.
  if (String(values.client_type ?? '') === 'OEM' && !values.oem_client_id) {
    return fail('Name the OEM the complaint came through.');
  }
  // Dated today unless somebody says otherwise. A lodged complaint with no date
  // would age from its created_at anyway; writing it down makes that visible
  // and leaves Registration free to correct it to the day the client rang.
  if (values.complaint_date == null || values.complaint_date === '') {
    values.complaint_date = new Date().toISOString().slice(0, 10);
  }
  // A cascading answer is checked against the slice under its parent, not the
  // whole kind: Vibration is a real sub-category and still wrong under Supply
  // Related. A parent with nothing seeded under it accepts what was typed.
  for (const f of page1.fields) {
    if (f.type !== 'select' || values[f.name] == null || values[f.name] === '') continue;
    const allowed = await allowedFor(f, values);
    if (allowed && !allowed.has(String(values[f.name]))) {
      return fail(`${f.label}: "${values[f.name]}" is not on the list${f.parentField ? ` for ${String(values[f.parentField] ?? 'that choice')}` : ''}.`);
    }
  }

  const { rows: [c] } = await risansiPool.query<{ code: string; legal_name: string; primary_rep_id: number | null }>(
    'SELECT code, legal_name, primary_rep_id FROM clients WHERE id = $1 AND deleted_at IS NULL', [clientId]);
  if (!c) return fail('That client no longer exists, or has been archived.');

  const cols = Object.keys(values);
  let savedId = 0, savedNo = '';
  for (let attempt = 0; attempt < 4; attempt++) {
    const no = await nextComplaintNo();
    try {
      const { rows } = await risansiPool.query<{ id: number }>(
        `INSERT INTO complaints (complaint_no, client_id, client_code, status, schema_version, priority, source,
                                 rep_user_id, reported_by_user, created_by, created_at, updated_at
                                 ${cols.length ? ', ' + cols.join(', ') : ''})
         VALUES ($1, $2, $3, 'Open', 2, 'Medium', 'app', $4, $5, $6, now(), now()
                 ${cols.length ? ', ' + cols.map((_, i) => `$${7 + i}`).join(', ') : ''})
         RETURNING id`,
        [no, clientId, c.code, c.primary_rep_id ?? (user.role === 'rep' ? user.id : null), user.id, user.email, ...cols.map(k => values[k])]);
      savedId = rows[0].id; savedNo = no;
      break;
    } catch (e) {
      if (attempt === 3 || !(e instanceof Error) || !/complaints_complaint_no_key|duplicate key/i.test(e.message)) {
        // The real reason is redacted from the reply on purpose, but telling
        // somebody to try again is only honest when trying again might work.
        // A constraint the form cannot satisfy fails identically every time,
        // and the first report of this one was a screenshot of a user retrying.
        console.error('[createComplaintV2]', e);
        return fail('The complaint could not be saved. If it fails again, report a bug rather than retrying — the reason is in the server log and somebody has to look at it.');
      }
    }
  }

  await risansiPool.query(
    `INSERT INTO complaint_stage_log (complaint_id, from_status, to_status, holder_department, actor_email) VALUES ($1, NULL, 'Open', 'Complaint Team', $2)`,
    [savedId, user.email]);
  // Category and sub-category, not Complaint Type and Defect Category. Page 1
  // stopped asking for those two, so the line they built read " · " and told
  // the Complaint Team nothing about the complaint they were being paged for.
  const kind = [values.complaint_category, values.complaint_subcategory].filter(Boolean).join(' · ');
  await recordAudit({ action: 'create', entityType: 'complaint', entityId: savedId, entityLabel: `${savedNo} · ${c.legal_name}`,
    summary: `Complaint registered: ${kind || 'no category'} — ${String(values.details ?? '').slice(0, 80)}`, actorEmail: user.email });
  await notifyDepartment('Complaint Team', user.email ?? '', {
    kind: 'complaint_raised', title: `New complaint ${savedNo} · ${c.legal_name}`,
    body: `${kind}${kind ? '\n' : ''}${String(values.details ?? '').slice(0, 200)}`,
    link: `/risansi/complaints/${savedId}`, subject: `New complaint ${savedNo}: ${c.legal_name}`,
  });

  revalidatePath('/risansi/complaints'); revalidatePath(`/risansi/clients/${clientId}`);
  return { ok: true, data: { id: savedId, complaint_no: savedNo } };
}

// ── Save one page ──────────────────────────────────────────────────────────

export async function saveComplaintPage(id: number, pageId: number, input: Record<string, unknown>): Promise<SaveResult> {
  const page = pageById(pageId);
  if (!page) return fail('No such page.');
  const a = await loadAccess(id);
  if (!a || !a.canSee) return fail('This complaint is not one you can see.');
  const { user, row } = a;
  if (!canEditPage(editor(user), { ...row, worksClient: a.worksClient }, page)) {
    return fail(row.schema_version < 2
      ? 'This is a legacy complaint, shown as it was recorded. It cannot be edited.'
      : row.status === 'Closed'
        ? 'This complaint is closed. Reopen it from Closure & Review if there is more to do.'
        : `${page.title} is edited by ${page.owner}${page.id === 4 || page.id === 5 || page.id === 7 ? ', or whoever it is assigned to' : ''}. Ask the Complaint Team.`);
  }

  // The full current record, so showWhen and the severity can be judged.
  const { rows: [cur] } = await risansiPool.query<ComplaintValues>('SELECT * FROM complaints WHERE id = $1', [id]);
  const values: ComplaintValues = { ...cur };
  const changed: Record<string, unknown> = {};
  // Coerced first, validated second. A cascading child is judged against the
  // slice under its parent, and when parent and child arrive in the same save
  // the parent has to be in `values` before the child is looked at.
  for (const f of page.fields) {
    if (!(f.name in input)) continue;
    const v = coerce(f, input[f.name]);
    if (v === undefined) continue;
    values[f.name] = v; changed[f.name] = v;
  }
  for (const f of page.fields) {
    const v = changed[f.name];
    if (v === undefined) continue;
    if (f.type === 'select' && v != null) {
      const allowed = await allowedFor(f, values);
      if (allowed && !allowed.has(String(v))) {
        return fail(`${f.label}: "${v}" is not on the list${f.parentField ? ` for ${String(values[f.parentField] ?? 'that choice')}` : ''}.`);
      }
    }
    if (f.type === 'complaint' && v != null) {
      if (Number(v) === id) return fail(`${f.label}: a complaint cannot be a repeat of itself.`);
      const { rows } = await risansiPool.query('SELECT 1 FROM complaints WHERE id = $1', [v]);
      if (!rows.length) return fail(`${f.label}: that complaint no longer exists.`);
    }
    if (f.type === 'oem' && v != null) {
      const { rows } = await risansiPool.query(
        `SELECT 1 FROM clients WHERE id = $1 AND client_type = 'OEM' AND deleted_at IS NULL`, [v]);
      if (!rows.length) return fail(`${f.label}: that is not an OEM on the client master.`);
    }
    if (f.type === 'user' && v != null) {
      const { rows } = await risansiPool.query('SELECT 1 FROM users WHERE id = $1 AND is_active', [v]);
      if (!rows.length) return fail(`${f.label}: that person is not an active user.`);
    }
  }
  // A conditional field whose condition no longer holds is cleared, not kept.
  for (const f of page.fields) if (f.showWhen && !isFieldShown(f, values) && values[f.name] != null) { values[f.name] = null; changed[f.name] = null; }
  // The parent of a cascade moved, so the child it was holding is orphaned —
  // nothing may sit holding Vibration under Supply Related. Only when the
  // parent itself was part of this save: a historical row whose answer predates
  // the list is left as it was recorded.
  for (const f of page.fields) {
    if (!f.parentField || !(f.parentField in changed) || values[f.name] == null) continue;
    const allowed = await allowedFor(f, values);
    if (allowed && !allowed.has(String(values[f.name]))) { values[f.name] = null; changed[f.name] = null; }
  }

  if (page.id === 3) {
    changed.severity = severityOf(values as Parameters<typeof severityOf>[0]);
  }
  if (page.id === 8 && changed.repeat_complaint === undefined && cur.repeat_complaint == null) {
    changed.repeat_complaint = await isRepeat(id);
  }
  // Cost impact decides itself, here and not only in the form. The UI shows it
  // locked, but a save posted around the UI — an older tab, a script, a page
  // saved before the action was chosen — must not be able to file a free
  // replacement as costing nothing.
  if (costImpactForced(values) && values.cost_impact !== true) { values.cost_impact = true; changed.cost_impact = true; }
  // Responsible department follows the root cause (decision 8). Filled only
  // when nobody has answered it: the mapping suggests, the investigation
  // decides. A null from the mapping means the pairing has no owner yet — leave
  // it for a human rather than writing a default nobody chose.
  if (page.id === 4 && (values.responsible_department == null || values.responsible_department === '')) {
    const dept = responsibleDepartmentFor(values.root_cause_category as string | null, values.root_cause_sub as string | null);
    if (dept) { values.responsible_department = dept; changed.responsible_department = dept; }
  }
  if (!Object.keys(changed).length) return { ok: true };

  const keys = Object.keys(changed);
  await risansiPool.query(
    `UPDATE complaints SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')}, updated_at = now() WHERE id = $1`,
    [id, ...keys.map(k => changed[k])]);

  // Assigning a page's owner puts the complaint in their inbox.
  for (const k of ['investigation_assigned_to', 'action_assigned_to', 'returnable_owner'] as const) {
    if (changed[k] && changed[k] !== cur[k]) {
      await pushInApp([changed[k] as number], {
        kind: 'complaint_assigned', section: 'Complaints', actor: user.email,
        title: `${row.complaint_no}: ${k === 'investigation_assigned_to' ? 'investigation' : k === 'action_assigned_to' ? 'corrective action' : 'returnable material'} assigned to you`,
        link: `/risansi/complaints/${id}`, entityType: 'complaint', entityId: String(id),
      });
    }
  }
  await recordAudit({ action: 'update', entityType: 'complaint', entityId: id, entityLabel: row.complaint_no,
    summary: `${page.title}: ${keys.filter(k => k !== 'severity').join(', ')}${changed.severity ? ` · severity ${changed.severity}` : ''}`,
    metadata: changed, actorEmail: user.email });

  // Severe / Immediate Response, the moment it becomes true. Told once, on the
  // crossing, so re-saving page 3 does not page the department again.
  if (page.id === 3 && isImmediateResponse(values as Parameters<typeof isImmediateResponse>[0])
      && !isImmediateResponse(cur as Parameters<typeof isImmediateResponse>[0])) {
    await notifySevere(id, row, values, user.email ?? '');
  }
  // Page 2 is where the pump and the order get identified, which is the work of
  // starting on a complaint — so an Open complaint moves itself on.
  await advanceAfterPageSave(page.id, id, row, user, values);

  revalidatePath(`/risansi/complaints/${id}`); revalidatePath('/risansi/complaints');
  return { ok: true };
}

/**
 * The status a saved page drags the complaint to, applied.
 *
 * Guarded on the status it read, so two people saving page 2 at once log one
 * move and not two; the status line is written and the stage log entry with it,
 * in one transaction, because a status without its log entry is a complaint
 * whose lifecycle has a hole in it. A failure here is logged and swallowed: the
 * page's own save already succeeded and reporting it as failed would have the
 * user type the page again.
 */
async function advanceAfterPageSave(pageId: number, id: number, row: AccessRow, user: CurrentUser, values: ComplaintValues): Promise<void> {
  const to = statusAfterSavingPage(pageId, row.status);
  if (!to) return;
  const holder = holderFor(to, values);
  const conn = await risansiPool.connect();
  try {
    await conn.query('BEGIN');
    const { rowCount } = await conn.query(
      'UPDATE complaints SET status = $2, updated_at = now() WHERE id = $1 AND status = $3', [id, to, row.status]);
    if (!rowCount) { await conn.query('ROLLBACK'); return; }
    await conn.query(
      `INSERT INTO complaint_stage_log (complaint_id, from_status, to_status, holder_department, holder_user_id, note, actor_email)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [id, row.status, to, holder.department, holder.userId, 'Order & pump details saved.', user.email]);
    await conn.query('COMMIT');
  } catch (e) {
    await conn.query('ROLLBACK').catch(() => {});
    console.error('[complaints] page-2 auto-advance failed', e);
    return;
  } finally { conn.release(); }
  await recordAudit({ action: 'status', entityType: 'complaint', entityId: id, entityLabel: row.complaint_no,
    summary: `${row.status} → ${to} — order & pump details saved`, actorEmail: user.email });
}

/**
 * One Yes among Safety, Shutdown, Penalty or Repeat and the complaint needs
 * looking at today, so the people who would act on it are told rather than
 * finding out on their next visit to the list. The department that owns the
 * category gets it, and the Complaint Team always, because they hold the
 * complaint whoever else is investigating it.
 */
async function notifySevere(id: number, row: AccessRow, values: ComplaintValues, actorEmail: string): Promise<void> {
  const reasons = IMMEDIATE_RISK_FIELDS.filter(f => values[f.key] === true).map(f => f.label);
  const card = {
    kind: 'complaint_severe',
    title: `Severe · ${row.complaint_no} needs an immediate response`,
    body: `${reasons.join(', ') || 'Immediate response'}\n${String(values.details ?? '').slice(0, 200)}`,
    link: `/risansi/complaints/${id}`,
    subject: `Immediate response: complaint ${row.complaint_no}`,
  };
  const departments = new Set<string>([routingOwner(values as Parameters<typeof routingOwner>[0]), 'Complaint Team']);
  for (const d of departments) await notifyDepartment(d, actorEmail, card);
  const people = [row.rep_user_id, row.reported_by_user, row.investigation_assigned_to, row.action_assigned_to]
    .filter((x): x is number => x != null);
  if (people.length) {
    await pushInApp([...new Set(people)], { ...card, section: 'Complaints', actor: actorEmail, entityType: 'complaint', entityId: String(id) }).catch(() => {});
  }
}

/** Same client, same pump model or serial, same defect category, within twelve months. */
async function isRepeat(id: number): Promise<boolean> {
  const { rows } = await risansiPool.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM complaints o, complaints c
      WHERE c.id = $1 AND o.id <> c.id AND o.client_id = c.client_id
        AND o.defect_category IS NOT DISTINCT FROM c.defect_category
        AND (o.pump_model IS NOT DISTINCT FROM c.pump_model OR (o.pump_serial_no IS NOT NULL AND o.pump_serial_no = c.pump_serial_no))
        AND COALESCE(o.complaint_date, o.created_at::date) >= COALESCE(c.complaint_date, c.created_at::date) - INTERVAL '12 months'
        AND COALESCE(o.complaint_date, o.created_at::date) <= COALESCE(c.complaint_date, c.created_at::date)`, [id]);
  return (rows[0]?.n ?? 0) > 0;
}

// ── Move ───────────────────────────────────────────────────────────────────

export async function moveComplaint(id: number, to: ComplaintStatus, note?: string): Promise<SaveResult> {
  if (!(STATUSES as readonly string[]).includes(to)) return fail('No such status.');
  const a = await loadAccess(id);
  if (!a || !a.canSee) return fail('This complaint is not one you can see.');
  const { user, row } = a;
  if (!canMove(editor(user), { ...row, worksClient: a.worksClient })) {
    return fail(row.schema_version < 2 ? 'Legacy complaints do not move; they are shown as they were recorded.'
      : 'Only the Complaint Team, QC, or the person a stage is assigned to can move a complaint.');
  }
  const from = row.status as ComplaintStatus;
  if (!(NEXT[from] ?? []).includes(to)) return fail(`A complaint at ${from} cannot go straight to ${to}.`);
  const reopening = (from === 'Resolved' || from === 'Closed') && to === 'Under Investigation';
  if (reopening && !note?.trim()) return fail('Say why it is being reopened.');

  const { rows: [cur] } = await risansiPool.query<ComplaintValues>('SELECT * FROM complaints WHERE id = $1', [id]);
  const { rows: [capa] } = await risansiPool.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM complaint_attachments WHERE complaint_id = $1 AND category = 'capa'`, [id]);
  const need = gateFor(from, to, { values: cur, severity: (cur.severity as never) ?? null, hasCapaDocument: capa.n > 0 });
  if (need.length && !reopening) return fail(`Before ${to}: ${need.join(' · ')}.`);

  const holder = holderFor(to, cur);
  const sets: string[] = ['status = $2', 'updated_at = now()'];
  const vals: unknown[] = [id, to];
  if (to === 'Resolved') { sets.push(`resolved_at = now()`, `resolved_by = $${vals.push(user.email)}`); }
  if (to === 'Closed')   { sets.push(`closed_at = now()`,   `closed_by = $${vals.push(user.email)}`); }
  if (reopening) {
    sets.push('resolved_at = NULL', 'resolved_by = NULL', 'closed_at = NULL', 'closed_by = NULL',
      'reopen_count = reopen_count + 1', `reopen_reason = $${vals.push(note!.trim())}`, 'customer_confirmed = NULL');
  }
  const c = await risansiPool.connect();
  try {
    await c.query('BEGIN');
    await c.query(`UPDATE complaints SET ${sets.join(', ')} WHERE id = $1`, vals);
    await c.query(
      `INSERT INTO complaint_stage_log (complaint_id, from_status, to_status, holder_department, holder_user_id, note, actor_email)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [id, from, to, holder.department, holder.userId, note?.trim() || null, user.email]);
    await c.query('COMMIT');
  } catch (e) { await c.query('ROLLBACK'); console.error('[moveComplaint]', e); return fail('The move could not be saved — please try again.'); }
  finally { c.release(); }

  await recordAudit({ action: reopening ? 'reopen' : 'status', entityType: 'complaint', entityId: id, entityLabel: row.complaint_no,
    summary: `${from} → ${to}${note ? ` — ${note.trim().slice(0, 120)}` : ''}`, actorEmail: user.email });

  // Whoever holds it next is told; the raiser hears about resolution and closure.
  const label = `${row.complaint_no} is now ${to}`;
  if (holder.userId) {
    await pushInApp([holder.userId], { kind: 'complaint_moved', section: 'Complaints', actor: user.email, title: label,
      body: note?.trim() || null, link: `/risansi/complaints/${id}`, entityType: 'complaint', entityId: String(id) });
  } else if (holder.department !== 'Customer') {
    await notifyDepartment(holder.department, user.email ?? '', { kind: 'complaint_moved', title: label, body: note?.trim() || null,
      link: `/risansi/complaints/${id}`, subject: label });
  }
  if ((to === 'Resolved' || to === 'Closed' || reopening) && row.reported_by_user && row.reported_by_user !== user.id) {
    await pushInApp([row.reported_by_user], { kind: 'complaint_moved', section: 'Complaints', actor: user.email, title: label,
      body: note?.trim() || null, link: `/risansi/complaints/${id}`, entityType: 'complaint', entityId: String(id) });
  }

  revalidatePath(`/risansi/complaints/${id}`); revalidatePath('/risansi/complaints');
  if (row.client_id) revalidatePath(`/risansi/clients/${row.client_id}`);
  return { ok: true };
}

// ── Attachments ────────────────────────────────────────────────────────────

export async function deleteComplaintAttachment(attachmentId: number): Promise<SaveResult> {
  const { rows: [att] } = await risansiPool.query<{ id: number; complaint_id: number; category: string; file_name: string }>(
    'SELECT id, complaint_id, category, file_name FROM complaint_attachments WHERE id = $1', [attachmentId]);
  if (!att) return fail('That file is already gone.');
  const a = await loadAccess(att.complaint_id);
  if (!a || !a.canSee) return fail('This complaint is not one you can see.');
  const page = pageById(att.category === 'capa' ? 6 : 1)!;
  if (!canEditPage(editor(a.user), { ...a.row, worksClient: a.worksClient }, page) && !canEditPage(editor(a.user), { ...a.row, worksClient: a.worksClient }, pageById(6)!)) {
    return fail('Only somebody who can edit this complaint can remove its files.');
  }
  await risansiPool.query('DELETE FROM complaint_attachments WHERE id = $1', [attachmentId]);
  await recordAudit({ action: 'delete', entityType: 'complaint', entityId: att.complaint_id, entityLabel: a.row.complaint_no,
    summary: `Removed ${att.category} file ${att.file_name}`, actorEmail: a.user.email });
  revalidatePath(`/risansi/complaints/${att.complaint_id}`);
  return { ok: true };
}

// ── Notes ──────────────────────────────────────────────────────────────────

/** A note on the complaint, from anyone who can see it. Goes to whoever holds it now, and the raiser. */
export async function addComplaintNote(id: number, body: string): Promise<SaveResult> {
  const text = String(body ?? '').trim();
  if (!text) return fail('Write something first.');
  const a = await loadAccess(id);
  if (!a || !a.canSee) return fail('This complaint is not one you can see.');
  await risansiPool.query('INSERT INTO complaint_updates (complaint_id, body, created_by) VALUES ($1, $2, $3)', [id, text, a.user.email ?? 'system']);
  await risansiPool.query('UPDATE complaints SET updated_at = now() WHERE id = $1', [id]);
  const { rows: [h] } = await risansiPool.query<{ holder_user_id: number | null; holder_department: string | null }>(
    'SELECT holder_user_id, holder_department FROM complaint_stage_log WHERE complaint_id = $1 ORDER BY created_at DESC, id DESC LIMIT 1', [id]);
  const me = a.user.id;
  const card = { kind: 'complaint_update', title: `Note on ${a.row.complaint_no}`, body: text.slice(0, 300), link: `/risansi/complaints/${id}`, subject: `Note on complaint ${a.row.complaint_no}` };
  const people = [h?.holder_user_id, a.row.reported_by_user, a.row.rep_user_id].filter((x): x is number => x != null && x !== me);
  if (people.length) await pushInApp([...new Set(people)], { ...card, section: 'Complaints', actor: a.user.email ?? '', entityType: 'complaint' }).catch(() => {});
  if (h?.holder_department && h.holder_user_id == null && h.holder_department !== 'Customer') await notifyDepartment(h.holder_department, a.user.email ?? '', card);
  revalidatePath(`/risansi/complaints/${id}`);
  return { ok: true };
}

/** Admin only. Gone for good — the stage log and files go with it. */
export async function deleteComplaint(id: number): Promise<SaveResult> {
  const user = await getCurrentUser();
  if (!hasRole(user.role, 'admin')) return fail('Only an admin can delete a complaint.');
  const { rows: [c] } = await risansiPool.query<{ complaint_no: string; client_id: number | null }>('SELECT complaint_no, client_id FROM complaints WHERE id = $1', [id]);
  if (!c) return fail('Already gone.');
  await risansiPool.query('DELETE FROM complaints WHERE id = $1', [id]);
  await recordAudit({ action: 'delete', entityType: 'complaint', entityId: id, entityLabel: c.complaint_no, summary: `Complaint ${c.complaint_no} deleted`, actorEmail: user.email });
  revalidatePath('/risansi/complaints'); if (c.client_id) revalidatePath(`/risansi/clients/${c.client_id}`);
  return { ok: true };
}

// ── Lookups ────────────────────────────────────────────────────────────────

/**
 * The installed base, by SO number, EC number or pump serial — fills page 2,
 * every field still editable.
 *
 * SO is matched as well as EC and serial because the document asks that typing
 * an SO recommend the EC number and EC date that went out against it, and the
 * three are the same row of `client_pumps`. `ec_date` and `so_date` come back
 * cast to text: they are `date` columns, and a Date serialised to a client
 * component loses a day in IST.
 */
export async function lookupPump(query: string, clientId?: number | null): Promise<Result<{
  so_no: string | null; so_date: string | null; ec_no: string | null; ec_date: string | null;
  pump_serial_no: string | null; pump_model: string | null;
  liquid: string | null; head_pressure: string | null; capacity: string | null;
  quantity: number | null; client_name: string | null; matches: number;
} | null>> {
  const q = (query ?? '').trim();
  if (q.length < 3) return { ok: true, data: null };
  const { rows } = await risansiPool.query<{
    so_number: string | null; so_date: string | null; ec_number: string | null; ec_date: string | null;
    pump_sl_no: string | null; pump_model_plate: string | null;
    liquid: string | null; head: string | null; capacity: string | null; quantity: number | null; client_name: string | null;
  }>(
    `SELECT p.so_number, p.so_date::text AS so_date, p.ec_number, p.ec_date::text AS ec_date,
            p.pump_sl_no, p.pump_model_plate, p.liquid, p.head, p.capacity, p.quantity, c.legal_name AS client_name
       FROM client_pumps p LEFT JOIN clients c ON c.id = p.client_id
      WHERE (upper(btrim(p.ec_number)) = upper($1) OR upper(btrim(p.pump_sl_no)) = upper($1)
             OR upper(btrim(p.so_number)) = upper($1))
        ${clientId ? 'AND p.client_id = $2' : ''}
      ORDER BY (p.client_id = $2) DESC NULLS LAST, p.id DESC LIMIT 5`,
    [q, clientId ?? null]);
  if (!rows.length) return { ok: true, data: null };
  const r = rows[0];
  return { ok: true, data: {
    so_no: r.so_number, so_date: r.so_date, ec_no: r.ec_number, ec_date: r.ec_date,
    pump_serial_no: r.pump_sl_no, pump_model: r.pump_model_plate,
    liquid: r.liquid, head_pressure: r.head, capacity: r.capacity,
    quantity: r.quantity, client_name: r.client_name, matches: rows.length,
  } };
}

/**
 * Every pump this client has had from us, for the SO / EC / serial suggestion
 * lists on page 2.
 *
 * The document asks for SO, EC and serial to be picked from a list rather than
 * typed blind, and for an SO to recommend its EC number and date. One read of
 * the client's rows answers all of it: the form builds three suggestion lists
 * out of it and keeps the SO → EC pairing to hand.
 *
 * There is no Order Type (Pump / Spare) column on `client_pumps` — nothing in
 * the installed base records it — so that half of the document's request cannot
 * be answered from here.
 */
export interface ClientPumpOption {
  so_number: string | null; so_date: string | null; ec_number: string | null; ec_date: string | null;
  pump_sl_no: string | null; pump_model_plate: string | null;
  liquid: string | null; head: string | null; capacity: string | null; quantity: number | null;
}

export async function listClientPumps(clientId: number): Promise<Result<ClientPumpOption[]>> {
  const user = await getCurrentUser();
  if (!user.email) return fail('Sign in again.');
  const cid = Number(clientId);
  if (!Number.isInteger(cid) || cid <= 0) return { ok: true, data: [] };
  const may = hasRole(user.role, 'admin') || user.role === 'staff' || user.departments.length > 0
    || await canViewClient(user, cid);
  if (!may) return fail('That client is not one you work.');
  const { rows } = await risansiPool.query<ClientPumpOption>(
    `SELECT so_number, so_date::text AS so_date, ec_number, ec_date::text AS ec_date,
            pump_sl_no, pump_model_plate, liquid, head, capacity, quantity
       FROM client_pumps
      WHERE client_id = $1
      ORDER BY COALESCE(ec_date, so_date) DESC NULLS LAST, id DESC
      LIMIT 500`, [cid]);
  return { ok: true, data: rows };
}

// ── Linking a repeat to its original ──────────────────────────────────────

/** Enough of another complaint to recognise it in a picker. */
export interface ComplaintBrief {
  id: number; complaint_no: string; client_name: string | null; client_code: string | null;
  complaint_date: string | null; status: string; category: string | null;
}

/**
 * Complaints this person can see, by number or by client, for the Repeat Of
 * picker on page 8.
 *
 * A repeat is logged as its own complaint and pointed at the first one
 * (decision 4), which needs a way to find the first one. Scoped by
 * `complaintVisibilitySql`, so the picker never offers a complaint whose page
 * the same person would be refused.
 */
export async function searchComplaintsToLink(query: string, excludeId?: number | null): Promise<Result<ComplaintBrief[]>> {
  const user = await getCurrentUser();
  if (!user.email) return fail('Sign in again.');
  const q = (query ?? '').trim().slice(0, 100);
  const vis = complaintVisibilitySql(user, 'cm');
  const { rows } = await risansiPool.query<ComplaintBrief>(
    `SELECT cm.id, cm.complaint_no, cl.legal_name AS client_name, cl.code AS client_code,
            COALESCE(cm.complaint_date, cm.created_at::date)::text AS complaint_date,
            cm.status, COALESCE(cm.complaint_category, cm.defect_category) AS category
       FROM complaints cm
       LEFT JOIN clients cl ON cl.id = cm.client_id
      WHERE ($2::int IS NULL OR cm.id <> $2::int)
        ${vis ? `AND (${vis})` : ''}
        AND ($1 = '' OR cm.complaint_no ILIKE '%' || $1 || '%'
             OR cl.legal_name ILIKE '%' || $1 || '%' OR cl.code ILIKE '%' || $1 || '%')
      ORDER BY cm.id DESC
      LIMIT 25`, [q, excludeId ?? null]);
  return { ok: true, data: rows };
}

/** One complaint by id, so a stored link shows its number instead of "#412". */
export async function complaintBriefById(id: number): Promise<Result<ComplaintBrief | null>> {
  const user = await getCurrentUser();
  if (!user.email) return fail('Sign in again.');
  const cid = Number(id);
  if (!Number.isInteger(cid) || cid <= 0) return { ok: true, data: null };
  const vis = complaintVisibilitySql(user, 'cm');
  const { rows } = await risansiPool.query<ComplaintBrief>(
    `SELECT cm.id, cm.complaint_no, cl.legal_name AS client_name, cl.code AS client_code,
            COALESCE(cm.complaint_date, cm.created_at::date)::text AS complaint_date,
            cm.status, COALESCE(cm.complaint_category, cm.defect_category) AS category
       FROM complaints cm
       LEFT JOIN clients cl ON cl.id = cm.client_id
      WHERE cm.id = $1 ${vis ? `AND (${vis})` : ''}`, [cid]);
  return { ok: true, data: rows[0] ?? null };
}

// ── Notifying a department ─────────────────────────────────────────────────

async function notifyDepartment(department: string, actorEmail: string, card: { kind: string; title: string; body?: string | null; link: string; subject: string }) {
  try {
    const { rows } = await risansiPool.query<{ id: number; email: string; name: string }>(
      `SELECT u.id, u.email, u.name FROM user_departments d JOIN users u ON u.id = d.user_id AND u.is_active
        WHERE d.department = $1 AND lower(u.email) <> lower($2)`, [department, actorEmail]);
    if (!rows.length) return;
    await pushInApp(rows.map(r => r.id), { kind: card.kind, section: 'Complaints', actor: actorEmail, title: card.title, body: card.body ?? null, link: card.link, entityType: 'complaint' });
    await sendNotification({
      to: rows.map(r => r.email), subject: card.subject, section: 'Complaints',
      intro: `A complaint needs the ${department}.`, title: card.title, body: card.body ?? null,
      ctaLabel: 'Open the complaint', ctaPath: card.link,
    }).catch(() => {});
  } catch (e) { console.error('[complaints] department notification failed', e); }
}

// A plain read for the forms; kept here so the client never queries lookups
// itself. `parent_value IS NULL` is the whole point of the filter: without it
// `part_name` comes back with Shaft in it twice, once under External and once
// under Child Parts of Joints, and the flat map has no way to say which.
export async function listComplaintLookups(): Promise<Record<string, string[]>> {
  const { rows } = await risansiPool.query<{ kind: string; value: string }>(
    'SELECT kind, value FROM complaint_lookups WHERE is_active AND parent_value IS NULL ORDER BY kind, sort_order, value');
  const out: Record<string, string[]> = {};
  for (const r of rows) (out[r.kind] ??= []).push(r.value);
  return out;
}

/** The cascading half of the same table: `{ kind: { parent: [values] } }`. */
export async function listComplaintCascades(): Promise<Record<string, Record<string, string[]>>> {
  const { rows } = await risansiPool.query<{ kind: string; parent_value: string; value: string }>(
    `SELECT kind, parent_value, value FROM complaint_lookups
      WHERE is_active AND parent_value IS NOT NULL
      ORDER BY kind, parent_value, sort_order, value`);
  const out: Record<string, Record<string, string[]>> = {};
  for (const r of rows) ((out[r.kind] ??= {})[r.parent_value] ??= []).push(r.value);
  return out;
}

/**
 * Add a value to one of the lists the form is allowed to extend.
 *
 * The requirement asks for "+ Add On" beside the source, the sub-categories,
 * EC made by and the part names. The admin screen can already do this, but
 * that is the wrong moment: the person who knows the value is the one with the
 * complaint open, and sending them to find an admin is how a complaint ends up
 * filed under Other.
 *
 * Gated on the complaint's own page, not on being an admin: if you may fill in
 * this page, you may add the word this page is missing. Anything that steers
 * the module — category, status, action — stays in Admin, which is what
 * ADD_ON_LOOKUP_KINDS draws the line around.
 */
export async function addLookupFromForm(input: {
  complaintId: number; pageId: number; kind: string; value: string; parentValue?: string | null;
}): Promise<Result<{ value: string }>> {
  const kind = String(input?.kind ?? '').trim();
  if (!ADD_ON_LOOKUP_KINDS.includes(kind)) return fail('That list is managed in Admin.');

  const a = await loadAccess(Number(input?.complaintId));
  if (!a) return fail('That complaint no longer exists.');
  const page = pageById(Number(input?.pageId));
  if (!page) return fail('Unknown page.');
  const may = hasRole(a.user.role, 'admin')
    || canEditPage({ id: a.user.id, role: a.user.role, departments: a.user.departments },
                   { ...a.row, worksClient: a.worksClient }, page);
  if (!may) return fail(`Only somebody who can edit ${page.title} can add to this list.`);

  const value = String(input?.value ?? '').trim().replace(/\s+/g, ' ');
  if (!value) return fail('Type the value to add.');
  if (value.length > 80) return fail(`That is ${value.length} characters — keep a dropdown value under 80.`);

  // A cascading list hangs under a parent, and a value with the wrong parent —
  // or none — is a value nobody will ever be offered again.
  const parentKind = CASCADING_LOOKUP_KINDS[kind];
  const parent = input?.parentValue == null ? '' : String(input.parentValue).trim();
  if (parentKind && !parent) return fail('Choose the answer above first, so the new value hangs under it.');
  const parentValue = parentKind ? parent : null;

  try {
    await risansiPool.query(
      `INSERT INTO complaint_lookups (kind, value, parent_value, sort_order, is_active, is_user_added)
       VALUES ($1, $2, $3,
               COALESCE((SELECT max(sort_order) + 1 FROM complaint_lookups
                          WHERE kind = $1 AND COALESCE(parent_value,'') = COALESCE($3,'')), 1),
               TRUE, TRUE)
       ON CONFLICT (kind, value, (COALESCE(parent_value, ''))) DO UPDATE SET is_active = TRUE`,
      [kind, value, parentValue]);
  } catch (e) {
    console.error('[addLookupFromForm]', e);
    return fail('That value could not be added.');
  }
  return { ok: true, data: { value } };
}

// ── The parts a complaint is about ────────────────────────────────────────

/**
 * One row of the parts editor as the form posts it.
 *
 * Everything optional and everything a string, because the control is a
 * spreadsheet-shaped thing the user fills in whatever order suits the complaint
 * in front of them, and a half-filled row is a normal intermediate state rather
 * than an error. Rows with nothing in them at all are dropped on save.
 */
export interface ComplaintPartInput {
  part_type?: string | null; part_name?: string | null; quantity?: string | number | null; moc?: string | null;
  vendor_name?: string | null; mfg_date?: string | null; part_code?: string | null;
  ec_no?: string | null; ec_date?: string | null;
  liquid?: string | null; head?: string | null; capacity?: string | null;
}

const PART_TEXT_COLS = ['part_type', 'part_name', 'moc', 'vendor_name', 'part_code', 'ec_no', 'liquid', 'head', 'capacity'] as const;
const PART_DATE_COLS = ['mfg_date', 'ec_date'] as const;

const partText = (v: unknown) => { const s = String(v ?? '').trim(); return s ? s.slice(0, 200) : null; };
const partDate = (v: unknown) => { const s = String(v ?? '').slice(0, 10); return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null; };
const partQty = (v: unknown) => {
  if (v == null || String(v).trim() === '') return null;
  const n = Number(String(v).replace(/[,\s]/g, ''));
  return Number.isFinite(n) && n >= 0 ? n : null;
};

/**
 * Replace the parts on a complaint with the rows the editor is holding.
 *
 * Delete-then-insert rather than a diff, in one transaction. The editor is a
 * list the user reorders and deletes from freely, and matching posted rows back
 * to stored ids to work out which three changed buys nothing here — the rows
 * carry no history of their own and nothing points at them. What it does buy is
 * that the saved list is exactly the list on screen, which is the one promise
 * a repeating-row control has to keep.
 *
 * Who may edit: page 2's rule, because this is page 2's content. Saving page 2
 * content moves an Open complaint to Under Investigation, same as saving the
 * fields does — "once Form 2 is filled and saved" does not distinguish.
 */
export async function saveComplaintParts(complaintId: number, rows: ComplaintPartInput[]): Promise<SaveResult> {
  const id = Number(complaintId);
  if (!Number.isInteger(id)) return fail('No such complaint.');
  const page = pageById(2)!;
  const a = await loadAccess(id);
  if (!a || !a.canSee) return fail('This complaint is not one you can see.');
  const { user, row } = a;
  if (!canEditPage(editor(user), { ...row, worksClient: a.worksClient }, page)) {
    return fail(row.schema_version < 2
      ? 'This is a legacy complaint, shown as it was recorded. Its parts cannot be edited.'
      : row.status === 'Closed'
        ? 'This complaint is closed. Reopen it from Closure & Review if there is more to do.'
        : `Part details are edited by ${page.owner}. Ask the Complaint Team.`);
  }
  const list = Array.isArray(rows) ? rows : [];
  if (list.length > 200) return fail('That is more than 200 parts on one complaint. Split it, or raise a second complaint.');

  // Cleaned, then the empty ones dropped: an editor always has a blank row at
  // the bottom waiting to be filled, and saving must not store it.
  const clean = list.map(r => {
    const out: Record<string, unknown> = {};
    for (const k of PART_TEXT_COLS) out[k] = partText(r[k]);
    for (const k of PART_DATE_COLS) out[k] = partDate(r[k]);
    out.quantity = partQty(r.quantity);
    return out;
  }).filter(r => Object.values(r).some(v => v != null));

  // Part Type off its own list; Part Name off the slice under that type, so
  // Shaft-under-External cannot be filed as Shaft-under-Joint. A type with
  // nothing seeded under it takes whatever was typed — the Add On case.
  const types = await lookupValues('part_type', null);
  const namesByType = new Map<string, Set<string>>();
  for (const [i, r] of clean.entries()) {
    const t = r.part_type as string | null;
    if (t && types.size && !types.has(t)) return fail(`Row ${i + 1}: "${t}" is not a part type.`);
    const n = r.part_name as string | null;
    if (!n || !t) continue;
    if (!namesByType.has(t)) namesByType.set(t, await lookupValues('part_name', t));
    const allowed = namesByType.get(t)!;
    if (allowed.size && !allowed.has(n)) return fail(`Row ${i + 1}: "${n}" is not a part under ${t}.`);
  }

  const conn = await risansiPool.connect();
  try {
    await conn.query('BEGIN');
    await conn.query('DELETE FROM complaint_parts WHERE complaint_id = $1', [id]);
    for (const [i, r] of clean.entries()) {
      await conn.query(
        `INSERT INTO complaint_parts (complaint_id, sort_order, part_type, part_name, quantity, moc,
                                      vendor_name, mfg_date, part_code, ec_no, ec_date, liquid, head, capacity)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
        [id, i, r.part_type, r.part_name, r.quantity, r.moc, r.vendor_name, r.mfg_date,
         r.part_code, r.ec_no, r.ec_date, r.liquid, r.head, r.capacity]);
    }
    await conn.query('UPDATE complaints SET updated_at = now() WHERE id = $1', [id]);
    await conn.query('COMMIT');
  } catch (e) {
    await conn.query('ROLLBACK').catch(() => {});
    console.error('[saveComplaintParts]', e);
    return fail('The part details could not be saved — please try again.');
  } finally { conn.release(); }

  await recordAudit({ action: 'update', entityType: 'complaint', entityId: id, entityLabel: row.complaint_no,
    summary: `Part details: ${clean.length} part${clean.length === 1 ? '' : 's'}${clean.length ? ` — ${clean.map(r => r.part_name ?? r.part_type ?? r.liquid ?? '?').join(', ').slice(0, 160)}` : ''}`,
    actorEmail: user.email });

  const { rows: [cur] } = await risansiPool.query<ComplaintValues>('SELECT * FROM complaints WHERE id = $1', [id]);
  await advanceAfterPageSave(2, id, row, user, cur ?? {});

  revalidatePath(`/risansi/complaints/${id}`); revalidatePath('/risansi/complaints');
  return { ok: true };
}

