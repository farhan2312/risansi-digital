'use server';

import { revalidatePath } from 'next/cache';
import risansiPool from '@/lib/db-risansi';
import { getCurrentUser, hasRole, whyCannotVisitClient } from '@/lib/risansi-auth';
import { recordAudit } from '@/lib/audit';
import { checkInvoice } from '@/lib/risansi-exhibition-files';
import { normalizeClientName, uniqueLeadCode } from '@/lib/risansi-lead-code';
import { pushInApp } from '@/lib/risansi-inapp';
import {
  isExhibitionStatus, isDecision, UNLOCKED_STATUSES,
  type Decision, type ExhibitionStatus,
} from '@/lib/risansi-exhibition-fields';

/**
 * Exhibition module server actions.
 *
 * Self-contained but for one thing: these only touch exhibition_* tables, read
 * `clients` to resolve a lookup id and `users` to name people — and, at the
 * post-event review, turn a meeting the rep marked as high potential into a
 * client and an opportunity. That conversion is the single deliberate write
 * outside the module (convertMeetingToLead), and only the reviewer may run it.
 */

type Me = { id: number | null; email: string | null; role: string };

async function requireUser(): Promise<Me & { email: string }> {
  const user = await getCurrentUser();
  if (!user.email) throw new Error('Unauthorized');
  return { ...user, email: user.email };
}

const str = (fd: FormData, k: string): string | null => {
  const v = fd.get(k);
  const s = typeof v === 'string' ? v.trim() : '';
  return s === '' ? null : s;
};

/** Rupee amount from a form field. Uses the comma-safe parser, never parseFloat —
 *  parseFloat('12,50,000') is 12, which is how five offers were once saved at ₹1. */
function inr(fd: FormData, k: string): number | null {
  const raw = str(fd, k);
  if (raw == null) return null;
  const cleaned = raw.replace(/[₹,\s]/g, '');
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** May this user act on this exhibition? Creator, team member, or admin+.
 *  Kept separate from the approval gate below — attending is not deciding. */
export async function canManageExhibition(exhibitionId: number): Promise<boolean> {
  const user = await getCurrentUser();
  if (!user.email) return false;
  if (hasRole(user.role, 'admin')) return true;
  if (user.id == null) return false;
  const { rows } = await risansiPool.query<{ ok: boolean }>(
    `SELECT (EXISTS (SELECT 1 FROM exhibitions e WHERE e.id = $1 AND e.created_by = $2)
          OR EXISTS (SELECT 1 FROM exhibition_team t WHERE t.exhibition_id = $1 AND t.user_id = $2)) AS ok`,
    [exhibitionId, user.id],
  );
  return rows[0]?.ok ?? false;
}

/**
 * May this user SEE the exhibition? Broader than managing it: the named approver
 * has to be able to open the one they are deciding on, without being able to
 * edit its meetings or expenses.
 */
export async function canViewExhibition(exhibitionId: number): Promise<boolean> {
  const user = await getCurrentUser();
  if (!user.email) return false;
  if (hasRole(user.role, 'admin')) return true;
  if (user.id == null) return false;
  const { rows } = await risansiPool.query<{ ok: boolean }>(
    `SELECT (EXISTS (SELECT 1 FROM exhibitions e
                      WHERE e.id = $1 AND (e.created_by = $2 OR e.approver_id = $2))
          OR EXISTS (SELECT 1 FROM exhibition_team t
                      WHERE t.exhibition_id = $1 AND t.user_id = $2)) AS ok`,
    [exhibitionId, user.id],
  );
  return rows[0]?.ok ?? false;
}

/** True when this user may create exhibitions — drives whether the button shows. */
export async function canCreateExhibition(): Promise<boolean> {
  const user = await getCurrentUser();
  return !!user.email && hasRole(user.role, 'admin');
}

/**
 * The guards below RETURN their refusal instead of throwing it, because every
 * sentence in them is advice the user has to read. Thrown, Next redacts it in
 * production and the rep gets "an error occurred" plus a digest. Inside an
 * action the pattern is `const g = await guardX(id); if (!g.ok) return g;`.
 *
 * 'Exhibition not found.' stays a throw: that is a guard against a bad request,
 * not advice to anybody.
 */
async function guardCanManage(exhibitionId: number): Promise<SaveResult> {
  if (!(await canManageExhibition(exhibitionId))) {
    return fail('You are not on this exhibition’s team.');
  }
  return { ok: true };
}

/** The one throwing wrapper left. meetingLeadPrefill hands back the form's
 *  opening values, not a result, so a refusal there is a load failure. */
async function assertCanManage(exhibitionId: number): Promise<void> {
  const g = await guardCanManage(exhibitionId);
  if (!g.ok) throw new Error(g.error);
}

/**
 * Meetings, expenses and the review only open once the exhibition has actually
 * been approved. Enforced here and not only in the UI: a disabled tab is a
 * convention, this is the rule. Without it, spend and captured leads could
 * accumulate against an event nobody agreed to attend.
 */
async function guardUnlocked(exhibitionId: number): Promise<SaveResult> {
  const { rows } = await risansiPool.query<{ status: string }>(
    "SELECT status FROM exhibitions WHERE id = $1", [exhibitionId],
  );
  const status = rows[0]?.status;
  if (!status) throw new Error("Exhibition not found.");
  // Closed is in UNLOCKED_STATUSES because the tabs stay VISIBLE once an
  // exhibition is closed — you can still read what happened. Writing is a
  // different question, and this helper only ever guards writes, so it has to
  // reject Closed explicitly. Without this, everything the close was supposed to
  // freeze — meetings, expenses, the review — stayed editable.
  const closed = guardNotClosed(status);
  if (!closed.ok) return closed;
  if (!UNLOCKED_STATUSES.includes(status as ExhibitionStatus)) {
    return fail("This exhibition has not been approved yet.");
  }
  return { ok: true };
}

/** Who may decide: the named approver for this exhibition, or a sysadmin as the
 *  standing fallback so an event is never stuck behind one absent person. */
async function guardCanApprove(exhibitionId: number, user: Me): Promise<SaveResult> {
  if (hasRole(user.role, 'sysadmin')) return { ok: true };
  const { rows } = await risansiPool.query<{ approver_id: number | null }>(
    'SELECT approver_id FROM exhibitions WHERE id = $1', [exhibitionId],
  );
  if (!rows[0]) throw new Error('Exhibition not found.');
  if (rows[0].approver_id != null && user.id != null && Number(rows[0].approver_id) === Number(user.id)) {
    return { ok: true };
  }
  return fail('Only the nominated approver can decide on this exhibition.');
}

function touch(id: number) {
  revalidatePath('/risansi/exhibitions');
  revalidatePath(`/risansi/exhibitions/${id}`);
}

// ── Exhibition ───────────────────────────────────────────────────

/**
 * The days Risansi will be at the stand, checked against the exhibition's own run.
 *
 * Defaults to the whole run when left blank, because that is what every
 * exhibition meant before the field existed and it is the common case. The
 * window can only ever narrow the run, never extend past it: attending a day
 * the exhibition is not open is not a thing.
 */
// Refusals come back rather than being thrown: these three sentences tell
// somebody which date to change, and thrown they reached them as a digest.
function attendWindow(fd: FormData, start: string | null, end: string | null):
  { ok: true; from: string | null; to: string | null } | { ok: false; error: string } {
  const from = str(fd, 'attend_from') ?? start;
  const to   = str(fd, 'attend_to')   ?? end ?? start;
  if (!from || !to) return { ok: true, from, to };
  if (to < from) return fail('Risansi cannot stop attending before it starts.');
  if (start && from < start) return fail(`Risansi cannot attend before the exhibition opens (${start}).`);
  const lastDay = end ?? start;
  if (lastDay && to > lastDay) return fail(`Risansi cannot attend after the exhibition closes (${lastDay}).`);
  return { ok: true, from, to };
}

export async function createExhibition(fd: FormData): Promise<CreateResult> {
  const user = await requireUser();
  // Proposing an exhibition is an admin act now. Everyone else contributes to
  // one they have been put on: meetings, expenses, the post-event review.
  if (!hasRole(user.role, 'admin')) {
    return fail('Only an admin can create an exhibition.');
  }
  const name = str(fd, 'name');
  if (!name) return fail('Exhibition name is required.');

  const start = str(fd, 'start_date');
  const end   = str(fd, 'end_date');
  if (start && end && end < start) return fail('End date cannot be before the start date.');

  const win = attendWindow(fd, start, end);
  if (!win.ok) return win;
  const { from: attendFrom, to: attendTo } = win;

  const { rows } = await risansiPool.query<{ id: number }>(
    `INSERT INTO exhibitions
       (name, organizer, website, venue, city, state, country, industry, source,
        start_date, end_date, attend_from, attend_to, suggested, estimated_cost_inr,
        recommendation, approver_id, created_by, created_by_name)
     VALUES ($1,$2,$3,$4,$5,$6,COALESCE($7,'India'),$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,
             (SELECT name FROM users WHERE id = $18))
     RETURNING id`,
    [
      name, str(fd, 'organizer'), str(fd, 'website'), str(fd, 'venue'),
      str(fd, 'city'), str(fd, 'state'), str(fd, 'country'), str(fd, 'industry'),
      str(fd, 'source'), start, end, attendFrom, attendTo, str(fd, 'suggested'),
      inr(fd, 'estimated_cost_inr'), str(fd, 'recommendation'),
      fd.get('approver_id') ? Number(fd.get('approver_id')) : null,
      user.id,
    ],
  );
  const id = rows[0].id;
  await recordAudit({
    action: 'exhibition_created', entityType: 'exhibition', entityId: String(id),
    entityLabel: name, summary: `created exhibition ${name}`, actorEmail: user.email,
  }).catch(() => {});
  touch(id);
  return { ok: true, id };
}

export async function updateExhibition(id: number, fd: FormData): Promise<SaveResult> {
  const user = await requireUser();
  const g = await guardCanManage(id);
  if (!g.ok) return g;

  // Closed means closed: read-only for everyone until a sysadmin reopens it.
  {
    const { rows: st } = await risansiPool.query<{ status: string }>(
      "SELECT status FROM exhibitions WHERE id = $1", [id],
    );
    if (st[0]) {
      const open = guardNotClosed(st[0].status);
      if (!open.ok) return open;
    }
  }

  const start = str(fd, 'start_date');
  const end   = str(fd, 'end_date');
  if (start && end && end < start) return fail('End date cannot be before the start date.');

  const status = str(fd, 'status');
  // A value the dropdown cannot produce: a bad request, not advice, so it stays
  // a throw like every other enum guard here.
  if (status != null && !isExhibitionStatus(status)) throw new Error('Unknown status.');
  // Submitted / Approved / Rejected are owned by the approval flow. Letting the
  // edit form set them would let a submitter approve their own exhibition.
  if (status && ['Submitted', 'Approved', 'Rejected'].includes(status)) {
    return fail('Use Submit or the approval decision to move to that status.');
  }

  const win = attendWindow(fd, start, end);
  if (!win.ok) return win;
  const { from: attendFrom, to: attendTo } = win;

  await risansiPool.query(
    `UPDATE exhibitions SET
       name = COALESCE($2, name), organizer = $3, website = $4, venue = $5,
       city = $6, state = $7, country = $8, industry = $9, source = $10,
       start_date = $11, end_date = $12, suggested = $13,
       estimated_cost_inr = $14, recommendation = $15,
       status = COALESCE($16, status),
       approver_id = COALESCE($17, approver_id),
       attend_from = $18, attend_to = $19,
       updated_at = NOW()
     WHERE id = $1`,
    [
      id, str(fd, 'name'), str(fd, 'organizer'), str(fd, 'website'), str(fd, 'venue'),
      str(fd, 'city'), str(fd, 'state'), str(fd, 'country'), str(fd, 'industry'),
      str(fd, 'source'), start, end, str(fd, 'suggested'),
      inr(fd, 'estimated_cost_inr'), str(fd, 'recommendation'),
      status as ExhibitionStatus | null,
      fd.get('approver_id') ? Number(fd.get('approver_id')) : null,
      attendFrom, attendTo,
    ],
  );

  // Narrowing the window strands any member day now outside it. Those days are
  // dropped rather than left to block a calendar for a date nobody is attending
  // — but silently dropping somebody's travel is not on, so say whose.
  let stranded: { name: string; n: number }[] = [];
  if (attendFrom && attendTo) {
    const { rows } = await risansiPool.query<{ name: string; n: number }>(
      `WITH gone AS (
         DELETE FROM exhibition_team_days d
          USING exhibition_team t
          WHERE d.team_id = t.id AND t.exhibition_id = $1
            AND (d.day < $2::date OR d.day > $3::date)
        RETURNING t.user_id)
       SELECT u.name, count(*)::int AS n FROM gone JOIN users u ON u.id = gone.user_id
        GROUP BY u.name ORDER BY u.name`,
      [id, attendFrom, attendTo]);
    stranded = rows;
  }

  await recordAudit({
    action: 'exhibition_updated', entityType: 'exhibition', entityId: String(id),
    summary: stranded.length
      ? `updated exhibition details; dropped attendance days outside the new window for ${stranded.map(r => `${r.name} (${r.n})`).join(', ')}`
      : 'updated exhibition details',
    actorEmail: user.email,
  }).catch(() => {});
  touch(id);
  // Carried on the ok branch so the form can say what happened. Dropping
  // somebody’s travel days silently is the one outcome this must never have.
  if (stranded.length) {
    return {
      ok: true,
      note: `Saved. Days outside the new window were removed for ${stranded.map(r => `${r.name} (${r.n} day${r.n === 1 ? '' : 's'})`).join(', ')}.`,
    };
  }
  return { ok: true };
}

export async function deleteExhibition(id: number): Promise<SaveResult> {
  const user = await requireUser();
  if (!hasRole(user.role, 'admin')) return fail('Only an admin can delete an exhibition.');
  // A closed exhibition is a settled record — meetings, expenses, invoices and a
  // signed-off review. Deleting it is the most destructive edit there is, so it
  // obeys the same freeze: a sysadmin has to reopen it first, which is logged.
  {
    const { rows } = await risansiPool.query<{ status: string }>(
      'SELECT status FROM exhibitions WHERE id = $1', [id],
    );
    if (rows[0]?.status === 'Closed') {
      return fail('This exhibition is closed and cannot be deleted. A sysadmin must reopen it first.');
    }
  }
  await risansiPool.query('DELETE FROM exhibitions WHERE id = $1', [id]);
  await recordAudit({
    action: 'exhibition_deleted', entityType: 'exhibition', entityId: String(id),
    summary: 'deleted exhibition', actorEmail: user.email,
  }).catch(() => {});
  revalidatePath('/risansi/exhibitions');
  return { ok: true };
}

// ── Approval ─────────────────────────────────────────────────────

export async function submitForApproval(id: number, note?: string): Promise<SaveResult> {
  const user = await requireUser();
  const g = await guardCanManage(id);
  if (!g.ok) return g;

  const { rows } = await risansiPool.query<{ status: string; approver_id: number | null }>(
    'SELECT status, approver_id FROM exhibitions WHERE id = $1', [id],
  );
  const ex = rows[0];
  if (!ex) throw new Error('Exhibition not found.');
  // Submitting is only meaningful while an exhibition is still a proposal. The
  // old rule was "anything except already-Submitted", which let a Closed,
  // Approved, Ongoing or Completed event be pushed back into the approval queue
  // — undoing a decision, and in the closed case undoing the lock entirely.
  const SUBMITTABLE = ['Draft', 'Shortlisted'];
  if (!SUBMITTABLE.includes(ex.status)) {
    return fail(
      ex.status === 'Submitted' ? 'This exhibition is already awaiting a decision.'
      : ex.status === 'Closed'  ? 'This exhibition is closed.'
      : `A ${ex.status.toLowerCase()} exhibition cannot be submitted for approval again.`,
    );
  }
  if (!ex.approver_id) return fail('Nominate an approver before submitting.');

  const client = await risansiPool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE exhibitions SET status='Submitted', submitted_by=$2, submitted_at=NOW(), updated_at=NOW()
        WHERE id=$1`, [id, user.id],
    );
    await client.query(
      `INSERT INTO exhibition_approvals (exhibition_id, decision, actor_id, actor_name, comments)
       VALUES ($1,'Submitted',$2,(SELECT name FROM users WHERE id=$2),$3)`,
      [id, user.id, note ?? null],
    );
    await client.query('COMMIT');
  } catch (e) { await client.query('ROLLBACK'); throw e; }
  finally { client.release(); }

  await recordAudit({
    action: 'exhibition_submitted', entityType: 'exhibition', entityId: String(id),
    summary: 'submitted exhibition for approval', actorEmail: user.email,
  }).catch(() => {});
  touch(id);
  return { ok: true };
}

export async function decideExhibition(
  id: number, decision: Decision, comments?: string,
): Promise<SaveResult> {
  const user = await requireUser();
  // Not one of the four decisions the UI offers: a bad request, so it stays a throw.
  if (!isDecision(decision)) throw new Error('Unknown decision.');
  const g = await guardCanApprove(id, user);
  if (!g.ok) return g;

  {
    const { rows } = await risansiPool.query<{ status: string }>(
      'SELECT status FROM exhibitions WHERE id = $1', [id],
    );
    const status = rows[0]?.status;
    if (!status) throw new Error('Exhibition not found.');
    if (status !== 'Submitted') {
      return fail(
        status === 'Closed'
          ? 'This exhibition is closed and can no longer be decided.'
          : `Only a submitted exhibition can be decided. This one is ${status.toLowerCase()}.`,
      );
    }
  }

  // 'More Info' returns it to the submitter rather than closing it out, so the
  // earlier approval rows stay as history and a resubmission appends to them.
  const nextStatus: ExhibitionStatus =
    decision === 'Reject' ? 'Rejected' : decision === 'More Info' ? 'Shortlisted' : 'Approved';
  const participation = decision === 'Exhibit' || decision === 'Visit' ? decision : null;

  const client = await risansiPool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE exhibitions
          SET status=$2, participation=COALESCE($3, participation),
              decided_by=$4, decided_at=NOW(), decision_notes=$5, updated_at=NOW()
        WHERE id=$1`,
      [id, nextStatus, participation, user.id, comments ?? null],
    );
    await client.query(
      `INSERT INTO exhibition_approvals (exhibition_id, decision, actor_id, actor_name, comments)
       VALUES ($1,$2,$3,(SELECT name FROM users WHERE id=$3),$4)`,
      [id, decision, user.id, comments ?? null],
    );
    await client.query('COMMIT');
  } catch (e) { await client.query('ROLLBACK'); throw e; }
  finally { client.release(); }

  await recordAudit({
    action: 'exhibition_decision', entityType: 'exhibition', entityId: String(id),
    summary: `decision: ${decision}`, actorEmail: user.email,
  }).catch(() => {});
  touch(id);
  return { ok: true };
}

// ── Team ─────────────────────────────────────────────────────────

export async function setExhibitionTeam(
  id: number,
  // `days` is 'YYYY-MM-DD' strings. Omitted means the whole attending window;
  // an empty array means on the team but attending nothing yet.
  members: { userId: number; role: string; days?: string[] }[],
): Promise<SaveResult> {
  const user = await requireUser();
  const g = await guardCanManage(id);
  if (!g.ok) return g;

  // Closed means closed: read-only for everyone until a sysadmin reopens it.
  {
    const { rows: st } = await risansiPool.query<{ status: string }>(
      "SELECT status FROM exhibitions WHERE id = $1", [id],
    );
    if (st[0]) {
      const open = guardNotClosed(st[0].status);
      if (!open.ok) return open;
    }
  }

  // The days Risansi is at the stand. A member can attend any subset of these
  // and nothing outside them — the window is the constraint, so it is read here
  // rather than trusted from the form.
  const { rows: exRows } = await risansiPool.query<{ from: string | null; to: string | null }>(
    `SELECT COALESCE(attend_from, start_date)::text AS from,
            COALESCE(attend_to, end_date, start_date)::text AS to
       FROM exhibitions WHERE id = $1`, [id]);
  const win = exRows[0];
  const windowDays = new Set<string>();
  if (win?.from && win?.to) {
    for (let d = new Date(win.from + 'T00:00:00'); d <= new Date(win.to + 'T00:00:00');
         d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) {
      windowDays.add(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
    }
  }

  const clean = members
    .filter(m => Number.isInteger(m.userId) && m.userId > 0)
    .map(m => ({
      userId: m.userId,
      role: m.role === 'Team Lead' ? 'Team Lead' : 'Member',
      // No days sent at all means "the whole window" — the old behaviour, and
      // the right default for someone just added. An explicitly empty list is a
      // different statement (on the team, days not yet decided) and is kept.
      days: m.days === undefined
        ? [...windowDays]
        : m.days.filter(d => windowDays.has(d)),
    }));
  if (clean.length && !clean.some(m => m.role === 'Team Lead')) {
    return fail('Nominate one team lead.');
  }
  if (clean.filter(m => m.role === 'Team Lead').length > 1) {
    return fail('Only one team lead per exhibition.');
  }

  const client = await risansiPool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM exhibition_team WHERE exhibition_id = $1', [id]);
    for (const m of clean) {
      const { rows } = await client.query<{ id: number }>(
        `INSERT INTO exhibition_team (exhibition_id, user_id, team_role, added_by)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT (exhibition_id, user_id) DO UPDATE SET team_role = EXCLUDED.team_role
         RETURNING id`,
        [id, m.userId, m.role, user.id],
      );
      const teamId = rows[0]?.id;
      if (!teamId) continue;
      for (const day of [...new Set(m.days)].sort()) {
        await client.query(
          'INSERT INTO exhibition_team_days (team_id, day) VALUES ($1,$2::date) ON CONFLICT DO NOTHING',
          [teamId, day]);
      }
    }
    await client.query('COMMIT');
  } catch (e) { await client.query('ROLLBACK'); throw e; }
  finally { client.release(); }

  await recordAudit({
    action: 'exhibition_team_set', entityType: 'exhibition', entityId: String(id),
    summary: `assigned ${clean.length} team member(s), ${clean.reduce((a, m) => a + m.days.length, 0)} attendance day(s)`,
    actorEmail: user.email,
  }).catch(() => {});
  touch(id);
  return { ok: true };
}

// ── Meetings (the lookup lives here) ─────────────────────────────

// Same shape as risansi.ts CreateResult, and deliberately the same name, so the
// build check (scripts/action-result-check.mjs) insists the caller reads it.
// The id is a number here because exhibition_meetings.id is.
export type CreateResult = { ok: true; id: number } | { ok: false; error: string };

/** How many people one stand meeting may record. Matched to the Client Master's
 *  own contact limit, so a meeting can never carry more people across to a lead
 *  than the client form would accept back. */
const MAX_MEETING_CONTACTS = 10;

export type MeetingContact = {
  name: string; designation: string | null; phone: string | null; email: string | null;
};

/**
 * Everybody met at one meeting, in the order they were entered.
 *
 * A stand meeting is normally two or three people — the engineer who asked the
 * question, the manager who decides, whoever handed over the card — and until
 * now only the first of them had anywhere to go. They arrive as `contacts_json`;
 * the four single fields are still read as a fallback so anything posting the
 * old shape keeps working.
 *
 * The FIRST row is what the contact_person / designation / phone / email columns
 * on exhibition_meetings are set to. Those columns stay because the exhibition
 * export and convertMeetingToLead both read them, and they have to keep showing
 * the person who would have been there before.
 */
function meetingContacts(fd: FormData): MeetingContact[] {
  const trim = (v: unknown): string | null => {
    const s = typeof v === 'string' ? v.trim() : '';
    return s === '' ? null : s;
  };
  let rows: MeetingContact[] = [];
  const raw = fd.get('contacts_json');
  if (typeof raw === 'string' && raw.trim() !== '') {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        rows = parsed.map(entry => {
          const o = (entry ?? {}) as Record<string, unknown>;
          return {
            name: trim(o.name) ?? '',
            designation: trim(o.designation),
            phone: trim(o.phone),
            email: trim(o.email),
          };
        });
      }
    } catch { rows = []; }      // malformed payload: fall through to the single fields
  }
  if (rows.length === 0) {
    rows = [{
      name: trim(fd.get('contact_person')) ?? '',
      designation: trim(fd.get('designation')),
      phone: trim(fd.get('phone')), email: trim(fd.get('email')),
    }];
  }
  // A nameless row is an empty one somebody added and never filled in.
  return rows.filter(r => r.name !== '').slice(0, MAX_MEETING_CONTACTS);
}

export async function saveExhibitionMeeting(
  exhibitionId: number, fd: FormData, meetingId?: number,
): Promise<CreateResult> {
  const user = await requireUser();
  const g = await guardCanManage(exhibitionId);
  if (!g.ok) return g;
  const u = await guardUnlocked(exhibitionId);
  if (!u.ok) return u;

  // A missing company name is the form being wrong, not the server failing, so
  // it comes back as a refusal the dialog can print. Thrown, it reached the rep
  // redacted as "Could not save the meeting."
  const company = str(fd, 'company_name');
  if (!company) return { ok: false, error: 'Company name is required.' };

  // The lookup: a client id only counts if the row really exists and is not
  // deleted. A stale or forged id degrades to NULL — an unlinked meeting — rather
  // than pointing at nothing or at a removed client.
  let clientId: number | null = null;
  const rawClientId = fd.get('client_id');
  if (rawClientId && Number.isInteger(Number(rawClientId))) {
    const { rows } = await risansiPool.query<{ id: number }>(
      'SELECT id FROM clients WHERE id = $1 AND deleted_at IS NULL', [Number(rawClientId)],
    );
    clientId = rows[0]?.id ?? null;
  }

  // The people met. The first of them is mirrored into the four columns that
  // were the whole contact until migration 0120 gave them a table of their own.
  const contacts = meetingContacts(fd);
  const first = contacts[0] ?? null;

  const vals = [
    exhibitionId, clientId, company, first?.name ?? null, first?.designation ?? null,
    first?.phone ?? null, first?.email ?? null, str(fd, 'city'), str(fd, 'discussion'),
    str(fd, 'requirement'), str(fd, 'outcome'), str(fd, 'next_action'),
    str(fd, 'follow_up_date'), str(fd, 'interest'), inr(fd, 'potential_value_inr'),
    fd.get('high_potential') === '1',
  ];

  // The id is returned so the caller can attach anything that needs one — a
  // business card photographed at the stand has nowhere to go until the meeting
  // it belongs to exists.
  let savedId = meetingId ?? 0;

  // One transaction: the meeting and its contact rows land together, so the
  // mirrored first-contact columns can never disagree with the rows.
  const db = await risansiPool.connect();
  try {
    await db.query('BEGIN');
    if (meetingId) {
      await db.query(
        `UPDATE exhibition_meetings SET
           client_id=$2, company_name=$3, contact_person=$4, designation=$5, phone=$6,
           email=$7, city=$8, discussion=$9, requirement=$10, outcome=$11,
           next_action=$12, follow_up_date=$13, interest=$14, potential_value_inr=$15,
           high_potential=$16, updated_at=NOW()
         WHERE id=$17 AND exhibition_id=$1`,
        [...vals, meetingId],
      );
    } else {
      const ins = await db.query<{ id: number }>(
        `INSERT INTO exhibition_meetings
           (exhibition_id, client_id, company_name, contact_person, designation, phone,
            email, city, discussion, requirement, outcome, next_action, follow_up_date,
            interest, potential_value_inr, high_potential, met_by, met_by_name, met_on)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,
                 (SELECT name FROM users WHERE id=$17), COALESCE($18::date, CURRENT_DATE))
         RETURNING id`,
        [...vals, user.id, str(fd, 'met_on')],
      );
      savedId = ins.rows[0].id;
    }

    // Rewritten whole rather than diffed. The form has no stable id to diff
    // against — a row can be inserted above another, renamed and removed in one
    // edit — and a meeting holds a handful of people, not a table's worth.
    if (savedId) {
      await db.query('DELETE FROM exhibition_meeting_contacts WHERE meeting_id = $1', [savedId]);
      for (const [i, c] of contacts.entries()) {
        await db.query(
          `INSERT INTO exhibition_meeting_contacts
             (meeting_id, sort_order, name, designation, phone, email)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [savedId, i, c.name, c.designation, c.phone, c.email],
        );
      }
    }
    await db.query('COMMIT');
  } catch (e) { await db.query('ROLLBACK'); throw e; }
  finally { db.release(); }

  await recordAudit({
    action: meetingId ? 'exhibition_meeting_updated' : 'exhibition_meeting_added',
    entityType: 'exhibition', entityId: String(exhibitionId),
    summary: `${meetingId ? 'updated' : 'captured'} meeting with ${company}`
      + `${clientId ? ' (existing client)' : ''}`
      + `${contacts.length > 1 ? ` · ${contacts.length} contacts` : ''}`,
    actorEmail: user.email,
  }).catch(() => {});
  touch(exhibitionId);
  return { ok: true, id: savedId };
}

export async function deleteExhibitionMeeting(
  exhibitionId: number, meetingId: number,
): Promise<SaveResult> {
  await requireUser();
  const g = await guardCanManage(exhibitionId);
  if (!g.ok) return g;
  const u = await guardUnlocked(exhibitionId);
  if (!u.ok) return u;
  await risansiPool.query(
    'DELETE FROM exhibition_meetings WHERE id = $1 AND exhibition_id = $2',
    [meetingId, exhibitionId],
  );
  touch(exhibitionId);
  return { ok: true };
}

// ── Expenses ─────────────────────────────────────────────────────

export async function saveExhibitionExpense(
  exhibitionId: number, fd: FormData, expenseId?: number,
): Promise<SaveResult> {
  const user = await requireUser();
  const g = await guardCanManage(exhibitionId);
  if (!g.ok) return g;
  const u = await guardUnlocked(exhibitionId);
  if (!u.ok) return u;

  const category = str(fd, 'category');
  if (!category) return fail('Pick an expense category.');

  const actual = inr(fd, 'actual_inr');
  const paid   = inr(fd, 'paid_inr') ?? 0;
  // Mirror the DB constraint so the user gets a sentence, not a Postgres error.
  if (actual != null && paid > actual) return fail('Paid amount cannot exceed the actual amount.');

  // The invoice travels with the form so it cannot be forgotten afterwards.
  const upload = fd.get('invoice');
  const file = upload instanceof File && upload.size > 0 ? upload : null;

  // Every expense line carries its supporting document — no exceptions. Editing a
  // line that already has one does not force a re-upload, but a line can never
  // exist without a document behind it.
  if (!file) {
    const existing = expenseId
      ? await risansiPool.query('SELECT 1 FROM exhibition_expense_files WHERE expense_id = $1', [expenseId])
      : { rowCount: 0 };
    if (!existing.rowCount) {
      return fail('Attach the invoice, quote or a photo of the bill for this expense.');
    }
  }

  let bytes: Buffer | null = null;
  let mime = '';
  if (file) {
    bytes = Buffer.from(await file.arrayBuffer());
    const check = checkInvoice(file.name, file.type || '', file.size, new Uint8Array(bytes.subarray(0, 8)));
    // checkInvoice's own sentence names the format or size limit that was
    // missed, which is exactly the kind of message Next used to redact.
    if (!check.ok) return fail(check.error ?? 'That file could not be accepted.');
    mime = check.mime!;
  }

  const vals = [
    exhibitionId, category, str(fd, 'description'), str(fd, 'vendor'),
    inr(fd, 'estimated_inr'), actual, paid, str(fd, 'paid_on'),
  ];

  // One transaction: the expense line and its invoice land together or not at all,
  // so an actual amount can never end up recorded without its receipt.
  const client = await risansiPool.connect();
  try {
    await client.query('BEGIN');
    let id = expenseId;
    if (expenseId) {
      await client.query(
        `UPDATE exhibition_expenses SET
           category=$2, description=$3, vendor=$4, estimated_inr=$5, actual_inr=$6,
           paid_inr=$7, paid_on=$8, updated_at=NOW()
         WHERE id=$9 AND exhibition_id=$1`,
        [...vals, expenseId],
      );
    } else {
      const { rows } = await client.query<{ id: number }>(
        `INSERT INTO exhibition_expenses
           (exhibition_id, category, description, vendor, estimated_inr, actual_inr,
            paid_inr, paid_on, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
        [...vals, user.id],
      );
      id = rows[0].id;
    }
    if (bytes && id) {
      await client.query(
        `INSERT INTO exhibition_expense_files (expense_id, file_name, mime_type, bytes, uploaded_by)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (expense_id) DO UPDATE
           SET file_name=EXCLUDED.file_name, mime_type=EXCLUDED.mime_type,
               bytes=EXCLUDED.bytes, uploaded_by=EXCLUDED.uploaded_by, uploaded_at=NOW()`,
        [id, (file as File).name.slice(0, 200), mime, bytes, user.id],
      );
    }
    await client.query('COMMIT');
  } catch (e) { await client.query('ROLLBACK'); throw e; }
  finally { client.release(); }

  touch(exhibitionId);
  return { ok: true };
}

export async function deleteExhibitionExpense(
  exhibitionId: number, expenseId: number,
): Promise<SaveResult> {
  await requireUser();
  const g = await guardCanManage(exhibitionId);
  if (!g.ok) return g;
  const u = await guardUnlocked(exhibitionId);
  if (!u.ok) return u;
  await risansiPool.query(
    'DELETE FROM exhibition_expenses WHERE id = $1 AND exhibition_id = $2',
    [expenseId, exhibitionId],
  );
  touch(exhibitionId);
  return { ok: true };
}

// ── Post-event review ────────────────────────────────────────────

/**
 * One review row per exhibition, upserted. Only judgement fields are stored —
 * companies met, existing-client hits and spend are derived from the meeting and
 * expense tables at read time so the review can never contradict them.
 */
export async function saveExhibitionReview(exhibitionId: number, fd: FormData): Promise<SaveResult> {
  const user = await requireUser();
  const g = await guardCanManage(exhibitionId);
  if (!g.ok) return g;
  const u = await guardUnlocked(exhibitionId);
  if (!u.ok) return u;

  const int = (k: string): number | null => {
    const raw = str(fd, k);
    if (raw == null) return null;
    const n = Number(raw.replace(/[,\s]/g, ''));
    return Number.isInteger(n) && n >= 0 ? n : null;
  };
  const attend = str(fd, 'attend_next_year');
  if (attend != null && !['Yes', 'No', 'Undecided'].includes(attend)) {
    return fail('Unknown answer for attending next year.');
  }

  await risansiPool.query(
    `INSERT INTO exhibition_reviews
       (exhibition_id, new_leads, opportunities, potential_value_inr, business_won_inr,
        footfall, what_worked, what_did_not, key_learnings, competitor_notes,
        attend_next_year, next_year_notes, reviewed_by, reviewed_by_name, reviewed_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,(SELECT name FROM users WHERE id=$13),NOW())
     ON CONFLICT (exhibition_id) DO UPDATE SET
       new_leads=EXCLUDED.new_leads, opportunities=EXCLUDED.opportunities,
       potential_value_inr=EXCLUDED.potential_value_inr, business_won_inr=EXCLUDED.business_won_inr,
       footfall=EXCLUDED.footfall, what_worked=EXCLUDED.what_worked,
       what_did_not=EXCLUDED.what_did_not, key_learnings=EXCLUDED.key_learnings,
       competitor_notes=EXCLUDED.competitor_notes, attend_next_year=EXCLUDED.attend_next_year,
       next_year_notes=EXCLUDED.next_year_notes, reviewed_by=EXCLUDED.reviewed_by,
       reviewed_by_name=EXCLUDED.reviewed_by_name, reviewed_at=NOW(), updated_at=NOW()`,
    [
      exhibitionId, int('new_leads'), int('opportunities'),
      inr(fd, 'potential_value_inr'), inr(fd, 'business_won_inr'), int('footfall'),
      str(fd, 'what_worked'), str(fd, 'what_did_not'), str(fd, 'key_learnings'),
      str(fd, 'competitor_notes'), attend, str(fd, 'next_year_notes'), user.id,
    ],
  );

  await recordAudit({
    action: 'exhibition_reviewed', entityType: 'exhibition', entityId: String(exhibitionId),
    summary: 'saved post-event review', actorEmail: user.email,
  }).catch(() => {});
  touch(exhibitionId);
  return { ok: true };
}

// ── Lifecycle ────────────────────────────────────────────────────

/**
 * Move an approved exhibition along its timeline: Approved → Ongoing →
 * Completed → Closed. Exposed as explicit buttons rather than buried in the edit
 * form's status dropdown, because reaching the post-event review depended on
 * finding that dropdown — which nobody would.
 *
 * Only forward moves along this one path are allowed. Anything that would skip
 * the approval flow, or reverse a decision, is rejected.
 */
export async function advanceExhibition(
  id: number, next: 'Ongoing' | 'Completed' | 'Closed',
): Promise<SaveResult> {
  const user = await requireUser();
  const g = await guardCanManage(id);
  if (!g.ok) return g;

  const { rows } = await risansiPool.query<{ status: string }>(
    'SELECT status FROM exhibitions WHERE id = $1', [id],
  );
  const current = rows[0]?.status;
  if (!current) throw new Error('Exhibition not found.');

  const ALLOWED: Record<string, string[]> = {
    Approved:  ['Ongoing', 'Completed'],   // a short event may be logged after the fact
    Ongoing:   ['Completed'],
    Completed: ['Closed'],
  };
  if (!ALLOWED[current]?.includes(next)) {
    return fail(`Cannot move from ${current} to ${next}.`);
  }

  await risansiPool.query(
    'UPDATE exhibitions SET status = $2, updated_at = NOW() WHERE id = $1', [id, next],
  );
  await recordAudit({
    action: 'exhibition_status', entityType: 'exhibition', entityId: String(id),
    summary: `moved from ${current} to ${next}`, actorEmail: user.email,
  }).catch(() => {});
  touch(id);
  return { ok: true };
}

// ── Post-event review: dispositions, sign-off, closing ───────────

/** The one guard that carries data: its callers all need the row it read, so
 *  passing the gate hands back the status and owner rather than re-querying. */
type OwnerResult =
  | { ok: true; ex: { status: string; created_by: number | null } }
  | { ok: false; error: string };

/**
 * The review is the owner's job — the person who proposed the exhibition and
 * carries it. Sysadmin is kept as the standing fallback so an event is never
 * stranded when someone leaves. Team membership is deliberately NOT enough here:
 * these actions create real CRM records and then close the event for good.
 */
async function guardOwner(exhibitionId: number, user: Me): Promise<OwnerResult> {
  const { rows } = await risansiPool.query<{ status: string; created_by: number | null }>(
    'SELECT status, created_by FROM exhibitions WHERE id = $1', [exhibitionId],
  );
  const ex = rows[0];
  if (!ex) throw new Error('Exhibition not found.');
  if (hasRole(user.role, 'sysadmin')) return { ok: true, ex };
  if (ex.created_by == null || user.id == null || Number(ex.created_by) !== Number(user.id)) {
    return fail('Only the person who proposed this exhibition can run its review.');
  }
  return { ok: true, ex };
}

/** Closed is final: nothing may be edited until a sysadmin reopens it. */
function guardNotClosed(status: string): SaveResult {
  if (status === 'Closed') {
    return fail('This exhibition is closed. A sysadmin has to reopen it before anything can change.');
  }
  return { ok: true };
}

/**
 * Correct the company on a meeting and re-point the lookup.
 *
 * Names get typed badly at a stand, and a wrong name is also a missed match — so
 * fixing it here is the moment a meeting can finally be linked to the client it
 * always belonged to. Passing clientId = null unlinks it again.
 */
export async function updateMeetingCompany(
  exhibitionId: number, meetingId: number, companyName: string, clientId: number | null,
): Promise<SaveResult> {
  const user = await requireUser();
  const g = await guardOwner(exhibitionId, user);
  if (!g.ok) return g;
  const open = guardNotClosed(g.ex.status);
  if (!open.ok) return open;

  const name = companyName.trim();
  if (!name) return fail('Company name cannot be blank.');

  // Only accept an id that resolves to a live client, so a stale or forged value
  // degrades to "unlinked" rather than pointing at nothing.
  let resolved: number | null = null;
  if (clientId != null && Number.isInteger(clientId)) {
    const { rows } = await risansiPool.query<{ id: number }>(
      'SELECT id FROM clients WHERE id = $1 AND deleted_at IS NULL', [clientId],
    );
    resolved = rows[0]?.id ?? null;
  }

  await risansiPool.query(
    `UPDATE exhibition_meetings SET company_name = $3, client_id = $4, updated_at = NOW()
      WHERE id = $2 AND exhibition_id = $1`,
    [exhibitionId, meetingId, name, resolved],
  );
  await recordAudit({
    action: 'exhibition_meeting_renamed', entityType: 'exhibition', entityId: String(exhibitionId),
    summary: `renamed meeting to ${name}${resolved ? ' (linked to client)' : ' (unlinked)'}`,
    actorEmail: user.email,
  }).catch(() => {});
  touch(exhibitionId);
  return { ok: true };
}

export type FollowUpType = 'None' | 'Visit' | 'Action' | 'Opportunity';

/**
 * Decide what a meeting becomes, and create the real record for it.
 *
 * Visit and Opportunity both need a client row (an opportunity needs an owning
 * rep as well), so they are refused for a company the lookup never matched.
 * An Action always works, because tasks.client_id is nullable — which is what
 * makes "we met someone new, chase them" expressible without inventing a client.
 *
 * Re-running a disposition replaces the previous one: the old linked record is
 * left alone (it may already have been worked on) but the meeting stops pointing
 * at it, so nothing is silently duplicated on a second pass.
 */
// Same shape as risansi.ts SaveResult, and the same name, so the build check
// (scripts/action-result-check.mjs) knows to insist the caller reads it.
//
// The ok branch carries an optional `note` — the same widening
// risansi-complaint-admin.ts made, and for the same reason: a save can succeed
// and still have something the user has to be told, like updateExhibition
// dropping attendance days that fell outside a narrowed window.
export type SaveResult = { ok: true; note?: string } | { ok: false; error: string };

/** A refusal, shaped so it satisfies SaveResult and CreateResult alike. */
const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });

export async function setMeetingFollowUp(exhibitionId: number, meetingId: number, opts: {
  type: FollowUpType;
  ownerId?: number | null;
  dueDate?: string | null;
  note?: string | null;
  product?: string | null;
  valueInr?: number | null;
}): Promise<SaveResult> {
  const user = await requireUser();
  const g = await guardOwner(exhibitionId, user);
  if (!g.ok) return g;
  const open = guardNotClosed(g.ex.status);
  if (!open.ok) return open;

  const { rows: mrows } = await risansiPool.query<{
    id: number; client_id: number | null; company_name: string;
    contact_person: string | null; outcome: string | null; next_action: string | null;
    potential_value_inr: string | null;
  }>(
    `SELECT id, client_id, company_name, contact_person, outcome, next_action, potential_value_inr
       FROM exhibition_meetings WHERE id = $1 AND exhibition_id = $2`, [meetingId, exhibitionId],
  );
  const m = mrows[0];
  if (!m) return { ok: false, error: 'Meeting not found.' };

  const needsClient = opts.type === 'Visit' || opts.type === 'Opportunity';
  if (needsClient && m.client_id == null) {
    return { ok: false, error: `${opts.type === 'Visit' ? 'A visit' : 'An opportunity'} needs a known client. Correct the company name so it matches one, or raise an action instead.` };
  }
  const ownerId = opts.ownerId != null && Number.isInteger(opts.ownerId) ? opts.ownerId : null;
  if (opts.type !== 'None' && ownerId == null) return { ok: false, error: 'Pick who this is assigned to.' };

  // A visit may only be planned for somebody who works the client — the same
  // rule as Plan Visit and the report follow-up. Refused with the reason, which
  // names the owner, rather than thrown and redacted.
  if (opts.type === 'Visit' && ownerId != null && m.client_id != null) {
    const refusal = await whyCannotVisitClient(ownerId, m.client_id);
    if (refusal) return { ok: false, error: refusal };
  }

  let visitId: number | null = null, taskId: number | null = null, oppId: number | null = null;

  const client = await risansiPool.connect();
  try {
    await client.query('BEGIN');

    if (opts.type === 'Visit') {
      // IST day, not the UTC one: before 05:30 local, toISOString would date a
      // plan to yesterday.
      const date = opts.dueDate || new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
      const { rows } = await client.query<{ id: number }>(
        `INSERT INTO visits (client_id, rep_id, visit_date, purpose, status, created_at)
         VALUES ($1,$2,$3,$4,'planned',NOW()) RETURNING id`,
        [m.client_id, ownerId, date, `Exhibition follow-up · ${m.company_name}`.slice(0, 200)],
      );
      visitId = rows[0].id;
    } else if (opts.type === 'Action') {
      const title = (opts.note || m.next_action || `Follow up with ${m.company_name}`).slice(0, 200);
      const { rows } = await client.query<{ id: number }>(
        `INSERT INTO tasks (visit_id, client_id, assigned_to_rep, title, description, due_date,
                            priority, status, created_by, created_at, updated_at)
         VALUES (NULL,$1,$2,$3,$4,$5,'Medium','open',$6,NOW(),NOW()) RETURNING id`,
        [
          m.client_id, ownerId, title,
          [m.company_name, m.contact_person, m.outcome].filter(Boolean).join(' · ') || null,
          opts.dueDate || null, user.email,
        ],
      );
      taskId = rows[0].id;
    } else if (opts.type === 'Opportunity') {
      // Created at Suspect on purpose. The pipeline's Quoted gateway forbids
      // jumping ahead, and a booth conversation is a lead, not a quotation.
      // value_cr is CRORES — the rupee figure is divided in SQL rather than in
      // JS, the way syncOfferRevisions already does it.
      const { rows } = await client.query<{ id: number }>(
        `INSERT INTO opportunities
           (client_id, rep_id, product, product_type, stage, value_cr, offer_value_inr,
            notes, auto_created, auto_source, created_by, created_at, updated_at)
         VALUES ($1,$2,$3,'PCP','Suspect',$4::numeric / 10000000,$4,$5,TRUE,'exhibition',$6,NOW(),NOW())
         RETURNING id`,
        [
          m.client_id, ownerId,
          (opts.product || m.next_action || 'Exhibition enquiry').slice(0, 200),
          opts.valueInr ?? (m.potential_value_inr != null ? Number(m.potential_value_inr) : null),
          `From exhibition meeting · ${m.company_name}${m.outcome ? ` · ${m.outcome}` : ''}`,
          user.email,
        ],
      );
      oppId = rows[0].id;
    }

    await client.query(
      `UPDATE exhibition_meetings SET
         follow_up_type=$3, follow_up_owner_id=$4, follow_up_note=$5,
         follow_up_set_at=NOW(), follow_up_set_by=$6,
         linked_visit_id=$7, linked_task_id=$8, linked_opportunity_id=$9,
         follow_up_date=COALESCE($10::date, follow_up_date), updated_at=NOW()
       WHERE id=$2 AND exhibition_id=$1`,
      [exhibitionId, meetingId, opts.type, ownerId, opts.note ?? null, user.id,
       visitId, taskId, oppId, opts.dueDate || null],
    );

    await client.query('COMMIT');
  } catch (e) { await client.query('ROLLBACK'); throw e; }
  finally { client.release(); }

  // Best-effort: a notification failure must never undo work already committed.
  if (ownerId && opts.type !== 'None') {
    await pushInApp([ownerId], {
      kind: 'exhibition_followup', section: 'Exhibitions', actor: user.email,
      title: `Exhibition follow-up: ${m.company_name}`,
      body: opts.note ?? m.outcome ?? null,
      link: opts.type === 'Opportunity' ? '/risansi/pipeline'
          : opts.type === 'Action' ? '/risansi/registry' : '/risansi/field',
      entityType: 'exhibition', entityId: String(exhibitionId),
    }).catch(() => {});
  }

  await recordAudit({
    action: 'exhibition_followup', entityType: 'exhibition', entityId: String(exhibitionId),
    summary: `${m.company_name} → ${opts.type}`, actorEmail: user.email,
  }).catch(() => {});
  touch(exhibitionId);
  revalidatePath('/risansi/registry');
  revalidatePath('/risansi/pipeline');
  revalidatePath('/risansi/field');
  return { ok: true };
}

export async function reviewExhibitionExpenses(exhibitionId: number): Promise<SaveResult> {
  const user = await requireUser();
  const g = await guardOwner(exhibitionId, user);
  if (!g.ok) return g;
  const open = guardNotClosed(g.ex.status);
  if (!open.ok) return open;
  await risansiPool.query(
    `UPDATE exhibitions SET expenses_reviewed_at=NOW(), expenses_reviewed_by=$2, updated_at=NOW()
      WHERE id=$1`, [exhibitionId, user.id],
  );
  await recordAudit({
    action: 'exhibition_expenses_reviewed', entityType: 'exhibition', entityId: String(exhibitionId),
    summary: 'signed off exhibition expenses', actorEmail: user.email,
  }).catch(() => {});
  touch(exhibitionId);
  return { ok: true };
}

/**
 * What still blocks closing. Returned as a list so the UI can name every reason
 * at once instead of failing one at a time.
 */
// ── A marked meeting becomes a lead ──────────────────────────────
//
// The rep marks a company at the stand; the person running the post-event
// review decides. Converting writes outside the exhibition tables — a client
// and an opportunity — which is the one deliberate exception to the rule at
// the top of this file, and it is why only the reviewer may do it.

/** What the lead form opens with: the meeting, as a client record. */
export async function meetingLeadPrefill(exhibitionId: number, meetingId: number): Promise<{
  legal_name: string; city: string | null; contact_person: string | null; designation: string | null;
  phone: string | null; email: string | null; potential_value_inr: number | null; requirement: string | null;
  exhibition_name: string; met_on: string | null; blocked: string | null;
} | null> {
  await requireUser();
  await assertCanManage(exhibitionId);
  const { rows } = await risansiPool.query<{
    company_name: string; city: string | null; contact_person: string | null; designation: string | null;
    phone: string | null; email: string | null; potential_value_inr: string | null; requirement: string | null;
    client_id: number | null; client_name: string | null; lead_client_id: number | null;
    exhibition_name: string; met_on: string | null;
  }>(
    `SELECT m.company_name, m.city, m.contact_person, m.designation, m.phone, m.email,
            m.potential_value_inr::text, m.requirement, m.client_id, c.legal_name AS client_name,
            m.lead_client_id, e.name AS exhibition_name, m.met_on::text AS met_on
       FROM exhibition_meetings m
       JOIN exhibitions e ON e.id = m.exhibition_id
       LEFT JOIN clients c ON c.id = m.client_id
      WHERE m.id = $1 AND m.exhibition_id = $2`, [meetingId, exhibitionId]);
  const m = rows[0];
  if (!m) return null;
  return {
    legal_name: m.company_name, city: m.city, contact_person: m.contact_person, designation: m.designation,
    phone: m.phone, email: m.email, potential_value_inr: m.potential_value_inr == null ? null : Number(m.potential_value_inr),
    requirement: m.requirement, exhibition_name: m.exhibition_name, met_on: m.met_on,
    // Already on the books, either from the lookup at the stand or from an
    // earlier conversion: there is nothing to create.
    blocked: m.client_id != null ? `${m.client_name ?? 'This company'} is already a client — raise an opportunity on the account instead.`
      : m.lead_client_id != null ? 'A lead has already been created from this meeting.' : null,
  };
}

/**
 * Create the lead: a Prospective-Lead client, its first contact, and a Suspect
 * opportunity carrying the potential value, all linked back to the meeting.
 *
 * The form is the Client Master's own, so everything it enforces about a client
 * record holds here too; the LEAD_ code is generated from the name the same way.
 *
 * Refusals come back as `{ ok: false }` rather than being thrown. Thrown, Next
 * redacts the message in production — which is how "this company is already a
 * client" reached somebody as "an error occurred", twice, before they gave up.
 */
export async function convertMeetingToLead(
  exhibitionId: number, meetingId: number, fd: FormData,
): Promise<SaveResult> {
  const user = await requireUser();
  const g = await guardOwner(exhibitionId, user);     // the reviewer, or a sysadmin
  if (!g.ok) return g;
  const ex = g.ex;
  // Closed means closed, including for the one write this module makes outside
  // its own tables. Returned rather than thrown, like every other refusal here.
  if (ex.status === 'Closed') {
    return { ok: false, error: 'This exhibition is closed. A sysadmin has to reopen it before a lead can be created from it.' };
  }

  const { rows: mRows } = await risansiPool.query<{
    company_name: string; client_id: number | null; lead_client_id: number | null;
    potential_value_inr: string | null; requirement: string | null; met_by: number | null;
    contact_person: string | null; designation: string | null; phone: string | null; email: string | null;
    exhibition_name: string;
  }>(
    `SELECT m.company_name, m.client_id, m.lead_client_id, m.potential_value_inr::text, m.requirement,
            m.met_by, m.contact_person, m.designation, m.phone, m.email, e.name AS exhibition_name
       FROM exhibition_meetings m JOIN exhibitions e ON e.id = m.exhibition_id
      WHERE m.id = $1 AND m.exhibition_id = $2`, [meetingId, exhibitionId]);
  const meeting = mRows[0];
  if (!meeting) return { ok: false, error: 'Meeting not found.' };
  if (meeting.client_id != null) {
    return { ok: false, error: 'This company is already a client — raise an opportunity on the account instead.' };
  }
  if (meeting.lead_client_id != null) {
    return { ok: false, error: 'A lead has already been created from this meeting.' };
  }

  const legalName = normalizeClientName((fd.get('legal_name') as string | null) ?? meeting.company_name);
  if (!legalName) return { ok: false, error: 'Company name is required.' };

  const { rows: taken } = await risansiPool.query<{ code: string }>("SELECT code FROM clients WHERE code LIKE 'LEAD\\_%'");
  const used = new Set(taken.map(r => r.code));
  const code = uniqueLeadCode(legalName, c => used.has(c));

  const text = (k: string) => { const v = fd.get(k); const t = typeof v === 'string' ? v.trim() : ''; return t === '' ? null : t; };
  const repId = Number(text('primary_rep_id')) || meeting.met_by || user.id;

  const { rows: cRows } = await risansiPool.query<{ id: number }>(
    // `clients` carries no origin column, so where the lead came from lives on
    // the opportunity's notes and in the audit trail below.
    `INSERT INTO clients (code, legal_name, status, country, state, city, address, google_maps_url,
                          market_type, industry, is_sugar, client_type, primary_rep_id, tour_id,
                          created_by, created_at, updated_at)
     VALUES ($1,$2,'PROSPECTIVE_LEAD',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,NOW(),NOW())
     RETURNING id`,
    [code, legalName, text('country') ?? 'India', text('state'), text('city'), text('address'),
     text('google_maps_url'), text('market_type'), text('industry'), fd.get('is_sugar') === 'true',
     text('client_type'), repId, Number(text('tour_id')) || null, user.email]);
  const clientId = cRows[0].id;

  // Everybody met at the stand, as the client's contacts, in the order they
  // were entered — the first one primary. Before migration 0120 a meeting held
  // one person and the second and third were lost in the discussion notes; the
  // whole point of carrying them here is that they are not lost again.
  let met: MeetingContact[] = [];
  try {
    const { rows } = await risansiPool.query<MeetingContact>(
      `SELECT name, designation, phone, email FROM exhibition_meeting_contacts
        WHERE meeting_id = $1 ORDER BY sort_order, id`, [meetingId]);
    met = rows;
  } catch { met = []; }     // nothing recorded for this meeting
  // The form's own contact fields override the first row field by field: the
  // reviewer may have corrected a name read off a card, or filled in the email
  // that was missing from it. A blank field changes nothing.
  const edited = {
    name: text('contact_person'), designation: text('designation'),
    phone: text('phone'), email: text('email'),
  };
  if (met.length === 0) {
    const name = edited.name ?? meeting.contact_person;
    if (name) {
      met = [{
        name,
        designation: edited.designation ?? meeting.designation,
        phone: edited.phone ?? meeting.phone,
        email: edited.email ?? meeting.email,
      }];
    }
  } else {
    met[0] = {
      name: edited.name ?? met[0].name,
      designation: edited.designation ?? met[0].designation,
      phone: edited.phone ?? met[0].phone,
      email: edited.email ?? met[0].email,
    };
  }
  // Anyone the lead form itself added. The Client Master's drawer carries its
  // own contact rows, and dropping what somebody typed into them would be the
  // same loss this whole change is about. Matched on name so a row seeded from
  // the meeting is not written twice.
  const extra = fd.get('contacts_json');
  if (typeof extra === 'string' && extra.trim() !== '') {
    try {
      const parsed: unknown = JSON.parse(extra);
      if (Array.isArray(parsed)) {
        const seen = new Set(met.map(p => p.name.trim().toUpperCase()));
        for (const entry of parsed) {
          const o = (entry ?? {}) as Record<string, unknown>;
          const pick = (v: unknown) => { const s = typeof v === 'string' ? v.trim() : ''; return s === '' ? null : s; };
          const name = pick(o.name);
          if (!name || seen.has(name.toUpperCase())) continue;
          seen.add(name.toUpperCase());
          met.push({ name, designation: pick(o.designation), phone: pick(o.phone), email: pick(o.email) });
        }
      }
    } catch { /* a malformed payload adds nobody */ }
  }

  for (const [i, person] of met.entries()) {
    if (!person.name) continue;
    await risansiPool.query(
      `INSERT INTO contacts (client_id, name, designation, phone, email, is_primary, added_by, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())`,
      [clientId, person.name, person.designation, person.phone, person.email, i === 0, user.email],
    ).catch(() => {});
  }

  // The requirement discussed, as a Suspect: nothing has been quoted, and the
  // potential value is the rep's estimate from the stand.
  const potential = meeting.potential_value_inr == null ? null : Number(meeting.potential_value_inr);
  const { rows: oRows } = await risansiPool.query<{ id: number }>(
    // opportunity_source is a fixed list that has no Exhibition in it; the
    // notes say where it came from instead.
    `INSERT INTO opportunities (client_id, rep_id, stage, product, product_type, value_cr,
                                notes, created_by, created_at, updated_at)
     VALUES ($1,$2,'Suspect',$3,'PCP',$4,$5,$6,NOW(),NOW())
     RETURNING id`,
    [clientId, repId, meeting.requirement?.slice(0, 120) || 'Exhibition enquiry',
     potential && potential > 0 ? potential / 10000000 : null,
     `From ${meeting.exhibition_name}. ${meeting.requirement ?? ''}`.trim(), user.email]);

  await risansiPool.query(
    `UPDATE exhibition_meetings
        SET lead_client_id = $1, lead_opportunity_id = $2, lead_created_at = NOW(), lead_created_by = $3,
            lead_decided_at = NOW(), lead_decided_by = $3, lead_skipped_reason = NULL, updated_at = NOW()
      WHERE id = $4 AND exhibition_id = $5`,
    [clientId, oRows[0].id, user.id, meetingId, exhibitionId]);

  await recordAudit({
    action: 'exhibition_lead_created', entityType: 'client', entityId: String(clientId),
    entityLabel: `${code} · ${legalName}`,
    summary: `Lead created from ${meeting.exhibition_name}: ${legalName}`
      + `${potential ? ` · potential ₹${potential.toLocaleString('en-IN')}` : ''}`
      + `${met.length > 1 ? ` · ${met.length} contacts` : ''}`,
    actorEmail: user.email,
  }).catch(() => {});
  touch(exhibitionId);
  revalidatePath('/risansi/clients');
  revalidatePath('/risansi/pipeline');
  return { ok: true };
}

/** Set a marked meeting aside, with the reason on the record. */
export async function skipMeetingLead(
  exhibitionId: number, meetingId: number, reason: string,
): Promise<SaveResult> {
  const user = await requireUser();
  const g = await guardOwner(exhibitionId, user);
  if (!g.ok) return g;
  const why = reason.trim();
  if (!why) return fail('Say why this one is not being taken forward.');
  const { rowCount } = await risansiPool.query(
    `UPDATE exhibition_meetings
        SET lead_skipped_reason = $1, lead_decided_at = NOW(), lead_decided_by = $2, updated_at = NOW()
      WHERE id = $3 AND exhibition_id = $4 AND lead_client_id IS NULL`,
    [why, user.id, meetingId, exhibitionId]);
  if (!rowCount) return fail('That meeting already has a lead.');
  touch(exhibitionId);
  return { ok: true };
}

/** Undo a set-aside, so it is decided again. */
export async function reopenMeetingLead(exhibitionId: number, meetingId: number): Promise<SaveResult> {
  const user = await requireUser();
  const g = await guardOwner(exhibitionId, user);
  if (!g.ok) return g;
  await risansiPool.query(
    `UPDATE exhibition_meetings SET lead_skipped_reason = NULL, lead_decided_at = NULL, lead_decided_by = NULL, updated_at = NOW()
      WHERE id = $1 AND exhibition_id = $2 AND lead_client_id IS NULL`, [meetingId, exhibitionId]);
  touch(exhibitionId);
  return { ok: true };
}

export async function closeReadiness(exhibitionId: number): Promise<string[]> {
  const { rows } = await risansiPool.query<{
    undecided: number; unpaid: number; no_invoice: number; undecided_leads: number;
    expenses_reviewed: boolean; has_review: boolean;
  }>(
    `SELECT
       (SELECT COUNT(*)::int FROM exhibition_meetings m
         WHERE m.exhibition_id = $1 AND m.follow_up_type IS NULL)                          AS undecided,
       (SELECT COUNT(*)::int FROM exhibition_expenses x
         WHERE x.exhibition_id = $1 AND COALESCE(x.actual_inr,0) > COALESCE(x.paid_inr,0)) AS unpaid,
       (SELECT COUNT(*)::int FROM exhibition_expenses x
         LEFT JOIN exhibition_expense_files f ON f.expense_id = x.id
        WHERE x.exhibition_id = $1 AND f.expense_id IS NULL)                               AS no_invoice,
       (SELECT COUNT(*)::int FROM exhibition_meetings m
         WHERE m.exhibition_id = $1 AND m.high_potential
           AND m.lead_client_id IS NULL AND m.lead_skipped_reason IS NULL
           AND m.client_id IS NULL)                                                        AS undecided_leads,
       (SELECT expenses_reviewed_at IS NOT NULL FROM exhibitions WHERE id = $1)            AS expenses_reviewed,
       (SELECT EXISTS (SELECT 1 FROM exhibition_reviews r WHERE r.exhibition_id = $1))     AS has_review`,
    [exhibitionId],
  );
  const r = rows[0];
  if (!r) return ['Exhibition not found'];
  const missing: string[] = [];
  if (r.undecided > 0)      missing.push(`${r.undecided} meeting(s) still need a follow-up decision`);
  if (r.undecided_leads > 0) missing.push(`${r.undecided_leads} high-potential meeting(s) are neither a lead nor set aside`);
  if (r.unpaid > 0)         missing.push(`${r.unpaid} expense line(s) are not fully paid`);
  if (r.no_invoice > 0)     missing.push(`${r.no_invoice} expense line(s) have no invoice attached`);
  if (!r.has_review)        missing.push('The post-event review has not been filled in');
  if (!r.expenses_reviewed) missing.push('Expenses have not been signed off');
  return missing;
}

export async function closeExhibition(exhibitionId: number): Promise<SaveResult> {
  const user = await requireUser();
  const g = await guardOwner(exhibitionId, user);
  if (!g.ok) return g;
  const open = guardNotClosed(g.ex.status);
  if (!open.ok) return open;

  // Re-checked on the server: the button being enabled is a convenience, this is
  // the rule. Closing makes everything read-only, so it has to be earned.
  const missing = await closeReadiness(exhibitionId);
  if (missing.length) return fail(`Cannot close yet — ${missing.join('; ')}.`);

  const client = await risansiPool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE exhibitions SET status='Closed', closed_at=NOW(), closed_by=$2, updated_at=NOW() WHERE id=$1`,
      [exhibitionId, user.id],
    );
    await client.query(
      `INSERT INTO exhibition_approvals (exhibition_id, decision, actor_id, actor_name, comments)
       VALUES ($1,'Closed',$2,(SELECT name FROM users WHERE id=$2),'Review complete')`,
      [exhibitionId, user.id],
    );
    await client.query('COMMIT');
  } catch (e) { await client.query('ROLLBACK'); throw e; }
  finally { client.release(); }

  await recordAudit({
    action: 'exhibition_closed', entityType: 'exhibition', entityId: String(exhibitionId),
    summary: 'closed the exhibition', actorEmail: user.email,
  }).catch(() => {});
  touch(exhibitionId);
  return { ok: true };
}

/** Sysadmin-only, and written into the history — a closed event that reopens
 *  should never be a quiet event. */
export async function reopenExhibition(exhibitionId: number, reason: string): Promise<SaveResult> {
  const user = await requireUser();
  if (!hasRole(user.role, 'sysadmin')) return fail('Only a sysadmin can reopen a closed exhibition.');
  if (!reason.trim()) return fail('Give a reason for reopening.');

  const client = await risansiPool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE exhibitions SET status='Completed', reopened_at=NOW(), reopened_by=$2,
              closed_at=NULL, closed_by=NULL, updated_at=NOW()
        WHERE id=$1 AND status='Closed'`, [exhibitionId, user.id],
    );
    await client.query(
      `INSERT INTO exhibition_approvals (exhibition_id, decision, actor_id, actor_name, comments)
       VALUES ($1,'Reopened',$2,(SELECT name FROM users WHERE id=$2),$3)`,
      [exhibitionId, user.id, reason.trim()],
    );
    await client.query('COMMIT');
  } catch (e) { await client.query('ROLLBACK'); throw e; }
  finally { client.release(); }

  await recordAudit({
    action: 'exhibition_reopened', entityType: 'exhibition', entityId: String(exhibitionId),
    summary: `reopened: ${reason.trim()}`, actorEmail: user.email,
  }).catch(() => {});
  touch(exhibitionId);
  return { ok: true };
}
