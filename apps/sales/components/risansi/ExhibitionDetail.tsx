'use client';

import { useEffect, useRef, useState, useMemo, type CSSProperties } from 'react';
import { useRouter } from 'next/navigation';
import {
  DECISIONS, EXPENSE_CATEGORIES, INTEREST_LEVELS, TEAM_ROLES, EDITABLE_STATUSES,
  STATUS_TONE, fmtInr, fmtInrFull, sumExpenses, eventDays,
  isUnlocked, canReview, submitReadiness,
  type ExhibitionStatus, type Decision,
} from '@/lib/risansi-exhibition-fields';
import {
  submitForApproval, decideExhibition, setExhibitionTeam,
  saveExhibitionMeeting, deleteExhibitionMeeting,
  saveExhibitionExpense, deleteExhibitionExpense, updateExhibition,
  advanceExhibition,
  type SaveResult,
} from '@/app/actions/risansi-exhibitions';
import { BusinessCards, uploadCards } from './BusinessCards';
import { MAX_INVOICE_BYTES, INVOICE_ACCEPT } from '@/lib/risansi-exhibition-files';
import {
  ExhibitionReviewWorkbench, MeetingLeadDialog, type ReviewMeeting,
} from './ExhibitionReview';
import { useCloseGuard, useDialogFocus, CloseX, CloseConfirm, KeepOpenHint } from './FormCloseGuard';
import type { UserOpt } from './ExhibitionsClient';
import { useTableSort, SortTH } from './SortTH';
import type { SortableColumn } from '@/lib/risansi-table-sort';

export interface ExhibitionFull {
  id: number; name: string; organizer: string | null; website: string | null;
  venue: string | null; city: string | null; state: string | null; country: string | null;
  industry: string | null; source: string | null;
  start_date: string | null; end_date: string | null;
  /** The days Risansi attends — a sub-range of start_date..end_date. */
  attend_from: string | null; attend_to: string | null;
  status: ExhibitionStatus; participation: string | null; suggested: string | null;
  estimated_cost_inr: number | null; recommendation: string | null;
  approver_id: number | null; approver_name: string | null;
  submitted_by: number | null; submitted_by_name: string | null; submitted_at: string | null;
  decided_by: number | null; decided_by_name: string | null; decided_at: string | null;
  decision_notes: string | null; created_by: number | null; created_by_name: string | null;
  expenses_reviewed_at: string | null; closed_at: string | null; closed_by_name: string | null;
  created_at: string | null;
}
export interface TeamMember {
  id: number; user_id: number; name: string; user_role: string; team_role: string;
  /** The days this person attends, 'YYYY-MM-DD'. */
  days?: string[];
}
export interface ApprovalRow { id: number; decision: string; actor_name: string | null; comments: string | null; created_at: string }
/**
 * One person met at a meeting (migration 0120). Row 0 is mirrored into the
 * contact_person / designation / phone / email columns below, which the
 * exhibition export and convertMeetingToLead still read.
 */
export interface MeetingContactRow {
  id: number; name: string;
  designation: string | null; phone: string | null; email: string | null;
}
export interface MeetingRow {
  id: number; client_id: number | null; company_name: string;
  contact_person: string | null; designation: string | null; phone: string | null;
  email: string | null; city: string | null; discussion: string | null;
  requirement: string | null; outcome: string | null; next_action: string | null;
  follow_up_date: string | null; interest: string | null; potential_value_inr: number | null;
  /** Marked by the rep as worth pursuing; decided at the post-event review. */
  high_potential?: boolean;
  met_by: number | null; met_by_name: string | null; met_on: string | null;
  client_code: string | null; client_legal_name: string | null; client_status: string | null;
  /** Everybody met, in entry order. Empty for a meeting saved before 0120 with
   *  no contact at all; otherwise the first row mirrors the columns above. */
  contacts?: MeetingContactRow[];
  /** Set once this meeting has been turned into a Prospective-Lead client. */
  lead_client_id?: number | null;
  lead_client_code?: string | null;
}
export interface ExpenseRow {
  id: number; category: string; description: string | null; vendor: string | null;
  estimated_inr: number | null; actual_inr: number | null; paid_inr: number | null;
  paid_on: string | null; has_invoice: boolean; file_name: string | null;
}

export interface ReviewRow {
  exhibition_id: number; new_leads: number | null; opportunities: number | null;
  potential_value_inr: number | null; business_won_inr: number | null; footfall: number | null;
  what_worked: string | null; what_did_not: string | null; key_learnings: string | null;
  competitor_notes: string | null; attend_next_year: string | null; next_year_notes: string | null;
  reviewed_by_name: string | null; reviewed_at: string | null;
}

type Tab = 'overview' | 'team' | 'meetings' | 'expenses' | 'review' | 'approvals';

export function ExhibitionDetail(props: {
  exhibition: ExhibitionFull; team: TeamMember[]; approvals: ApprovalRow[];
  meetings: MeetingRow[]; expenses: ExpenseRow[]; users: UserOpt[];
  review: ReviewRow | null;
  canManage: boolean; isApprover: boolean;
  isOwner: boolean; isSysadmin: boolean; blockers: string[];
}) {
  const { exhibition: ex, team, approvals, meetings, expenses, users, review,
          canManage, isApprover, isOwner, isSysadmin, blockers } = props;
  const [tab, setTab] = useState<Tab>('overview');
  const totals = useMemo(() => sumExpenses(expenses), [expenses]);
  const known  = meetings.filter(m => m.client_id != null).length;
  const days   = eventDays(ex.start_date, ex.end_date);

  // The operational tabs stay shut until the exhibition is actually approved, so
  // spend and captured leads cannot pile up against an event nobody agreed to.
  const unlocked  = isUnlocked(ex.status);
  // Closed is read-only. The tabs still render so the record can be read, but
  // nothing in them may be changed — the server enforces the same rule.
  const isClosed  = ex.status === 'Closed';
  const canEdit   = canManage && !isClosed;
  const reviewOk  = canReview(ex.status);
  const hasLead   = team.some(t => t.team_role === 'Team Lead');
  const readiness = submitReadiness(ex, team.length, hasLead);

  // Never leave someone parked on a tab that has since locked (e.g. after a
  // rejection), which would otherwise render an empty panel with no explanation.
  const activeTab: Tab =
    (!unlocked && (tab === 'meetings' || tab === 'expenses' || tab === 'review')) ? 'overview'
    : (!reviewOk && tab === 'review') ? 'overview'
    : tab;

  return (
    <div style={{ padding: '20px 24px 40px' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, marginBottom: 16, flexWrap: 'wrap' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <h1 style={{ fontSize: 21, fontWeight: 600, color: 'var(--title)', margin: 0 }}>{ex.name}</h1>
            <Chip status={ex.status} />
            {ex.participation && <Pill>{ex.participation}</Pill>}
          </div>
          <div style={{ fontSize: 12, color: 'var(--fg-3)', marginTop: 5 }}>
            {[ex.organizer, ex.venue, ex.city, ex.start_date && `${ex.start_date}${ex.end_date && ex.end_date !== ex.start_date ? ` → ${ex.end_date}` : ''}`, days && `${days} day${days > 1 ? 's' : ''}`]
              .filter(Boolean).join('  ·  ') || 'No details recorded yet'}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {/* Once closed, the whole record as a workbook — the same link as on
              the review page's closed banner, here so it can be found from any tab. */}
          {ex.status === 'Closed' && (
            <a href={`/api/risansi/exhibitions/${ex.id}/export`} title="Everything about this exhibition as a workbook" className="exh-export"
              style={{ padding: '8px 14px', borderRadius: 6, border: '1px solid var(--line-strong)', background: 'var(--bg-paper)', color: 'var(--fg)', fontSize: 13, fontWeight: 500, textDecoration: 'none', whiteSpace: 'nowrap' }}>
              ⤓ Export to Excel
            </a>
          )}
          <ApprovalBar exhibition={ex} canManage={canManage} isApprover={isApprover} readiness={readiness} />
        </div>
      </div>

      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12, marginBottom: 18 }}>
        <Kpi label="Budget"       value={fmtInr(ex.estimated_cost_inr)} />
        <Kpi label="Actual spend" value={fmtInr(totals.actual)}
             sub={ex.estimated_cost_inr ? (totals.actual > Number(ex.estimated_cost_inr) ? 'over budget' : 'within budget') : undefined} />
        <Kpi label="Paid"         value={fmtInr(totals.paid)} sub={totals.pending > 0 ? `${fmtInr(totals.pending)} pending` : 'settled'} />
        <Kpi label="Companies met" value={String(meetings.length)} />
        <Kpi label="Existing clients" value={String(known)}
             sub={meetings.length ? `${meetings.length - known} new` : undefined} />
        <Kpi label="Team"         value={String(team.length)} sub={team.find(t => t.team_role === 'Team Lead')?.name} />
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--line)', marginBottom: 16, flexWrap: 'wrap' }}>
        {([
          ['overview', 'Overview', true],
          ['team', `Team (${team.length})`, true],
          ['meetings', `Meetings (${meetings.length})`, unlocked],
          ['expenses', `Expenses (${expenses.length})`, unlocked],
          ['review', 'Post-event review', reviewOk],
          // Scoped to this exhibition, for the people accountable for it. The
          // module-wide feed lives in the sysadmin-only Audit Log.
          ['approvals', `History (${approvals.length})`, canManage || isApprover],
        ] as [Tab, string, boolean][]).map(([k, label, on]) => (
          <button key={k} onClick={() => on && setTab(k)} disabled={!on}
            title={on ? undefined
              : k === 'review' ? 'Available once the event is under way'
              : 'Unlocked once the exhibition is approved'}
            style={{
              padding: '8px 14px', border: 'none', background: 'none',
              cursor: on ? 'pointer' : 'not-allowed',
              fontSize: 13, fontFamily: 'inherit',
              color: activeTab === k ? 'var(--title)' : on ? 'var(--fg-3)' : 'var(--fg-3)',
              opacity: on ? 1 : 0.5,
              fontWeight: activeTab === k ? 600 : 400,
              borderBottom: activeTab === k ? '2px solid var(--brand-blue)' : '2px solid transparent',
            }}>{on ? label : `${label} 🔒`}</button>
        ))}
      </div>

      {activeTab === 'overview' && !unlocked && <LockedNotice status={ex.status} readiness={readiness} />}
      {activeTab === 'overview' && unlocked && (
        <StageNudge exhibition={ex} canManage={canManage} onGoReview={() => setTab('review')} />
      )}
      {activeTab === 'overview'  && <Overview exhibition={ex} users={users} canManage={canEdit} />}
      {activeTab === 'team'      && <TeamTab
              exhibitionId={ex.id} team={team} users={users} canManage={canEdit}
              attendFrom={ex.attend_from ?? ex.start_date}
              attendTo={ex.attend_to ?? ex.end_date ?? ex.start_date}
            />}
      {activeTab === 'meetings'  && <MeetingsTab exhibitionId={ex.id} meetings={meetings}
              users={users} canManage={canEdit} canConvert={isOwner && !isClosed} />}
      {activeTab === 'expenses'  && <ExpensesTab exhibitionId={ex.id} expenses={expenses} totals={totals} canManage={canEdit} />}
      {activeTab === 'review' && (
        <div style={{ display: 'grid', gap: 22 }}>
          <ReviewSummaryStrip meetings={meetings} totals={totals} review={review} />
          <ExhibitionReviewWorkbench
            exhibitionId={ex.id} status={ex.status}
            meetings={meetings as ReviewMeeting[]} expenses={expenses} users={users}
            expensesReviewedAt={ex.expenses_reviewed_at} closedAt={ex.closed_at}
            closedByName={ex.closed_by_name} isOwner={isOwner} isSysadmin={isSysadmin}
            blockers={blockers} hasReview={!!review} review={review} />
        </div>
      )}
      {activeTab === 'approvals' && <ApprovalsTab approvals={approvals} />}
    </div>
  );
}

// ── Approval history (this exhibition only) ──────────────────────

/**
 * The decision trail for this exhibition, for the people accountable for it —
 * its team and its approver. Kept here rather than only in the Audit Log because
 * that page is sysadmin-only and also carries logins, usage and ownership
 * changes; opening it to approvers would hand over far more than the history they
 * need. The module-wide feed still lives there.
 */
function ApprovalsTab({ approvals }: { approvals: ApprovalRow[] }) {
  if (approvals.length === 0) {
    return <div style={PANEL}><Blank>Nothing submitted yet.</Blank></div>;
  }
  return (
    <div style={PANEL}>
      {approvals.map(a => (
        <div key={a.id} style={{ ...ROW, alignItems: 'flex-start' }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg)' }}>{a.decision}</div>
            {a.comments && <div style={{ fontSize: 12, color: 'var(--fg-2)', marginTop: 3 }}>{a.comments}</div>}
          </div>
          <div style={{ fontSize: 11, color: 'var(--fg-3)', textAlign: 'right', whiteSpace: 'nowrap' }}>
            <div>{a.actor_name ?? '—'}</div>
            <div>{a.created_at?.slice(0, 16).replace('T', ' ')}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Approval bar ─────────────────────────────────────────────────

function ApprovalBar({ exhibition: ex, canManage, isApprover, readiness }: {
  exhibition: ExhibitionFull; canManage: boolean; isApprover: boolean;
  readiness: { ready: boolean; missing: string[] };
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr]   = useState('');
  const [deciding, setDeciding] = useState<Decision | null>(null);
  const [note, setNote] = useState('');

  const awaiting = ex.status === 'Submitted';
  // Submitting only makes sense while the exhibition is still a proposal. The old
  // test was "anything except Approved/Rejected/Submitted", which meant a Closed,
  // Ongoing or Completed event still offered "Submit for approval" — and the
  // server would have accepted it, pushing a finished event back into the queue.
  const canSubmit = canManage && (ex.status === 'Draft' || ex.status === 'Shortlisted');

  // Submit, decide and the timeline moves all return their refusal now, so the
  // sentence the action wrote — "Nominate an approver before submitting",
  // "Cannot move from Draft to Closed" — is what lands in the banner. The catch
  // stays for what is still thrown: the auth and closed-record guards.
  async function run(fn: () => Promise<SaveResult>) {
    setBusy(true); setErr('');
    try {
      const res = await fn();
      if (!res.ok) { setErr(res.error); return; }
      setDeciding(null); setNote(''); router.refresh();
    }
    catch (e) {
      const raw = e instanceof Error ? e.message : '';
      const redacted = !raw || /unexpected response/i.test(raw) || Boolean((e as { digest?: string })?.digest);
      setErr(redacted ? 'That action could not be completed. You may not have permission.' : raw);
    }
    finally { setBusy(false); }
  }

  return (
    <div style={{ textAlign: 'right' }}>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
        {canSubmit && (
          <button disabled={busy || !readiness.ready}
            onClick={() => run(() => submitForApproval(ex.id))}
            title={readiness.ready ? undefined : `Still needed: ${readiness.missing.join(', ')}`}
            style={{ ...BTN_PRIMARY, opacity: readiness.ready ? 1 : 0.5, cursor: readiness.ready ? 'pointer' : 'not-allowed' }}>
            Submit for approval
          </button>
        )}
        {awaiting && isApprover && DECISIONS.map(d => (
          <button key={d} disabled={busy} onClick={() => setDeciding(d)}
            style={d === 'Reject' ? BTN_DANGER : d === 'More Info' ? BTN_GHOST : BTN_PRIMARY}>
            {d}
          </button>
        ))}
        {awaiting && !isApprover && (
          <span style={{ fontSize: 12, color: 'var(--fg-3)' }}>
            Awaiting {ex.approver_name ?? 'approver'}
          </span>
        )}

        {/* Timeline. These exist so reaching the post-event review is one click,
            rather than depending on someone finding the status dropdown inside
            Edit details. The label says what happens next, not the status name. */}
        {canManage && ex.status === 'Approved' && (
          <button disabled={busy} onClick={() => run(() => advanceExhibition(ex.id, 'Ongoing'))} style={BTN_GHOST}>
            ▶ Start event
          </button>
        )}
        {canManage && (ex.status === 'Approved' || ex.status === 'Ongoing') && (
          <button disabled={busy} onClick={() => run(() => advanceExhibition(ex.id, 'Completed'))} style={BTN_PRIMARY}>
            ✓ Event finished — write review
          </button>
        )}
        {canManage && ex.status === 'Completed' && (
          <button disabled={busy} onClick={() => run(() => advanceExhibition(ex.id, 'Closed'))} style={BTN_GHOST}>
            Close exhibition
          </button>
        )}
      </div>

      {deciding && (
        <div style={{ ...PANEL, padding: 12, marginTop: 10, textAlign: 'left', minWidth: 300 }}>
          <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Decision: {deciding}</div>
          <textarea value={note} onChange={e => setNote(e.target.value)} rows={3}
            placeholder="Comments (kept in the approval history)"
            style={{ ...INPUT, resize: 'vertical' }} />
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 8 }}>
            <button onClick={() => { setDeciding(null); setNote(''); }} style={BTN_GHOST}>Cancel</button>
            <button disabled={busy} onClick={() => run(() => decideExhibition(ex.id, deciding, note))}
              style={deciding === 'Reject' ? BTN_DANGER : BTN_PRIMARY}>
              {busy ? 'Saving…' : `Confirm ${deciding}`}
            </button>
          </div>
        </div>
      )}
      {err && <div style={{ ...ERR, marginTop: 8, textAlign: 'left' }}>{err}</div>}
      {ex.decided_at && (
        <div style={{ fontSize: 11, color: 'var(--fg-3)', marginTop: 6 }}>
          Decided by {ex.decided_by_name ?? '—'} on {ex.decided_at.slice(0, 10)}
        </div>
      )}
    </div>
  );
}

// ── Overview ─────────────────────────────────────────────────────

function Overview({ exhibition: ex, users, canManage }: { exhibition: ExhibitionFull; users: UserOpt[]; canManage: boolean }) {
  const router = useRouter();
  const [edit, setEdit] = useState(false);
  const [err, setErr]   = useState('');
  // Narrowing the attending window drops team members' days. The action says
  // whose; this is where that gets read out, because it used to be returned and
  // then dropped on the floor here.
  const [note, setNote] = useState('');
  const approvers = users.filter(u => u.role === 'admin' || u.role === 'sysadmin');

  if (!edit) {
    return (
      <>
      {note && (
        <div style={{ ...NOTICE, marginBottom: 14 }} role="status">
          {note}{' '}
          <button type="button" onClick={() => setNote('')} style={LINK_BTN}>Dismiss</button>
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 14 }}>
        <Card title="Event">
          <Detail k="Organizer" v={ex.organizer} />
          <Detail k="Website"   v={ex.website} link />
          <Detail k="Venue"     v={ex.venue} />
          <Detail k="City"      v={[ex.city, ex.state, ex.country].filter(Boolean).join(', ') || null} />
          <Detail k="Industry"  v={ex.industry} />
          <Detail k="Found via" v={ex.source} />
        </Card>
        <Card title="Participation">
          <Detail k="Status"     v={ex.status} />
          <Detail k="Suggested"  v={ex.suggested} />
          <Detail k="Decided"    v={ex.participation} />
          <Detail k="Budget"     v={ex.estimated_cost_inr != null ? fmtInrFull(ex.estimated_cost_inr) : null} />
          <Detail k="Approver"   v={ex.approver_name} />
          <Detail k="Created by" v={ex.created_by_name} />
        </Card>
        <Card title="Why attend">
          <div style={{ fontSize: 13, color: 'var(--fg-2)', whiteSpace: 'pre-wrap' }}>
            {ex.recommendation || <span style={{ color: 'var(--fg-3)' }}>Nothing recorded.</span>}
          </div>
          {canManage && (
            <button onClick={() => setEdit(true)} style={{ ...BTN_GHOST, marginTop: 12 }}>Edit details</button>
          )}
        </Card>
      </div>
      </>
    );
  }

  return (
    <div style={{ ...PANEL, padding: 18, maxWidth: 960 }}>
      <form action={async fd => {
        setErr('');
        try {
          const res = await updateExhibition(ex.id, fd);
          if (!res.ok) { setErr(res.error); return; }
          setNote(res.note ?? ''); setEdit(false); router.refresh();
        }
        catch (e) { setErr(e instanceof Error ? e.message : 'Could not save.'); }
      }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Two>
            <F label="Name"><input name="name" defaultValue={ex.name} style={INPUT} /></F>
            <F label="Organizer"><input name="organizer" defaultValue={ex.organizer ?? ''} style={INPUT} /></F>
          </Two>
          <Two>
            <F label="Start"><input name="start_date" type="date" defaultValue={ex.start_date ?? ''} style={INPUT} /></F>
            <F label="End"><input name="end_date" type="date" defaultValue={ex.end_date ?? ''} style={INPUT} /></F>
            {/* The exhibition runs for its own dates; Risansi may be there for
                only part of that. Team members pick days from THIS window, so
                narrowing it drops anyone's days that fall outside. */}
            <F label="Risansi attending from"><input name="attend_from" type="date" defaultValue={ex.attend_from ?? ex.start_date ?? ''} style={INPUT} /></F>
            <F label="Risansi attending to"><input name="attend_to" type="date" defaultValue={ex.attend_to ?? ex.end_date ?? ''} style={INPUT} /></F>
          </Two>
          <Two>
            <F label="Venue"><input name="venue" defaultValue={ex.venue ?? ''} style={INPUT} /></F>
            <F label="City"><input name="city" defaultValue={ex.city ?? ''} style={INPUT} /></F>
          </Two>
          <Two>
            <F label="State"><input name="state" defaultValue={ex.state ?? ''} style={INPUT} /></F>
            <F label="Country"><input name="country" defaultValue={ex.country ?? ''} style={INPUT} /></F>
          </Two>
          <Two>
            <F label="Industry"><input name="industry" defaultValue={ex.industry ?? ''} style={INPUT} /></F>
            <F label="Website"><input name="website" defaultValue={ex.website ?? ''} style={INPUT} /></F>
          </Two>
          <Two>
            <F label="Budget (₹)"><input name="estimated_cost_inr" inputMode="decimal" defaultValue={ex.estimated_cost_inr ?? ''} style={INPUT} /></F>
            <F label="Status">
              <select name="status" defaultValue={EDITABLE_STATUSES.includes(ex.status) ? ex.status : ''} style={INPUT}>
                <option value="">— unchanged —</option>
                {EDITABLE_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </F>
          </Two>
          <F label="Approver">
            <select name="approver_id" defaultValue={ex.approver_id ?? ''} style={INPUT}>
              <option value="">— unchanged —</option>
              {approvers.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </F>
          <F label="Why attend">
            <textarea name="recommendation" rows={3} defaultValue={ex.recommendation ?? ''} style={{ ...INPUT, resize: 'vertical' }} />
          </F>
          {err && <div style={ERR}>{err}</div>}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button type="button" onClick={() => setEdit(false)} style={BTN_GHOST}>Cancel</button>
            <button type="submit" style={BTN_PRIMARY}>Save</button>
          </div>
        </div>
      </form>
    </div>
  );
}

// ── Team ─────────────────────────────────────────────────────────

// Every day between two ISO dates, inclusive. Built from the parts so a
// timezone never shifts a day off either end.
function daysBetween(from: string | null, to: string | null): string[] {
  if (!from) return [];
  const out: string[] = [];
  const end = to ?? from;
  for (let d = new Date(from + 'T00:00:00'); d <= new Date(end + 'T00:00:00');
       d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) {
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
  }
  return out;
}

const dayLabel = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-IN', { weekday: 'short', day: '2-digit', month: 'short' });
};

function TeamTab({ exhibitionId, team, users, canManage, attendFrom, attendTo }: {
  exhibitionId: number; team: TeamMember[]; users: UserOpt[]; canManage: boolean;
  attendFrom: string | null; attendTo: string | null;
}) {
  const router = useRouter();
  // The days Risansi is at the stand. Each member attends some subset; nobody
  // can attend a day the company is not there, so this is the whole universe.
  const windowDays = daysBetween(attendFrom, attendTo);
  const [sel, setSel] = useState<{ userId: number; role: string; days: string[] }[]>(
    team.map(t => ({
      userId: t.user_id, role: t.team_role,
      days: (t.days ?? windowDays).filter(d => windowDays.includes(d)),
    })),
  );
  const [busy, setBusy] = useState(false);
  const [err, setErr]   = useState('');

  // The first person picked becomes Team Lead, because a team without one is
  // invalid and the server rejects it. Defaulting beats an unexplained failure.
  const toggle = (userId: number) => setSel(s => {
    if (s.some(x => x.userId === userId)) {
      const left = s.filter(x => x.userId !== userId);
      // Removing the lead promotes whoever is left, so the team stays valid.
      return left.length && !left.some(x => x.role === 'Team Lead')
        ? left.map((x, i) => (i === 0 ? { ...x, role: 'Team Lead' } : x))
        : left;
    }
    // Somebody just added is assumed to be there for the whole run. That is the
    // common case and the one that errs safely: an over-wide block costs a
    // conversation, a missing one costs a visit booked on a day they are away.
    return [...s, { userId, role: s.length === 0 ? 'Team Lead' : 'Member', days: [...windowDays] }];
  });

  const toggleDay = (userId: number, day: string) => setSel(s => s.map(x =>
    x.userId !== userId ? x
      : { ...x, days: x.days.includes(day) ? x.days.filter(d => d !== day) : [...x.days, day].sort() }));

  const setAllDays = (userId: number, all: boolean) => setSel(s => s.map(x =>
    x.userId === userId ? { ...x, days: all ? [...windowDays] : [] } : x));
  const setRole = (userId: number, role: string) => setSel(s =>
    // Exactly one lead: promoting someone demotes the incumbent, which is also
    // what the server enforces, so the UI can never submit an invalid team.
    s.map(x => role === 'Team Lead'
      ? { ...x, role: x.userId === userId ? 'Team Lead' : 'Member' }
      : (x.userId === userId ? { ...x, role } : x)));

  async function save() {
    setBusy(true); setErr('');
    try {
      // The team-lead rules come back as a sentence now ("Nominate one team
      // lead.", "Only one team lead per exhibition."), so the guess the catch
      // below had to make is only needed for what still throws.
      const res = await setExhibitionTeam(exhibitionId, sel);
      if (!res.ok) { setErr(res.error); return; }
      router.refresh();
    }
    catch (e) {
      const raw = e instanceof Error ? e.message : '';
      const redacted = !raw || /unexpected response|Server Components render/i.test(raw)
        || Boolean((e as { digest?: string })?.digest);
      setErr(redacted ? 'Could not save the team. Every team needs exactly one Team Lead.' : raw);
    }
    finally { setBusy(false); }
  }

  if (!canManage) {
    return (
      <div style={PANEL}>
        {team.length === 0 ? <Blank>No team assigned yet.</Blank> : team.map(t => (
          <div key={t.id} style={ROW}>
            <span>
              {t.name}
              {t.days && (
                <span style={{ fontSize: 11, color: 'var(--fg-3)', marginLeft: 8 }}>
                  {t.days.length === 0 ? 'no days set'
                    : t.days.length === 1 ? dayLabel(t.days[0])
                    : `${t.days.length} days · ${dayLabel(t.days[0])} – ${dayLabel(t.days[t.days.length - 1])}`}
                </span>
              )}
            </span>
            <span style={{ fontSize: 11, color: t.team_role === 'Team Lead' ? 'var(--title)' : 'var(--fg-3)' }}>{t.team_role}</span>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div style={{ ...PANEL, padding: 16 }}>
      <div style={{ fontSize: 12, color: 'var(--fg-3)', marginBottom: 10 }}>
        Pick who is attending, nominate one team lead, and set the days each person is there.
        {windowDays.length > 0
          ? ` Risansi is at this exhibition on ${windowDays.length} day${windowDays.length === 1 ? '' : 's'}` +
            ` (${dayLabel(windowDays[0])}${windowDays.length > 1 ? ` – ${dayLabel(windowDays[windowDays.length - 1])}` : ''}).` +
            ' Only the days you tick block that person\u2019s calendar.'
          : ' Set the exhibition dates on the Overview tab before assigning days.'}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))', gap: 8, marginBottom: 14 }}>
        {users.map(u => {
          const chosen = sel.find(x => x.userId === u.id);
          return (
            <div key={u.id} style={{
              display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 6, padding: '7px 10px',
              border: `1px solid ${chosen ? 'var(--brand-blue)' : 'var(--line-strong)'}`,
              background: chosen ? 'var(--accent-soft)' : 'var(--bg-paper)',
              borderRadius: 6,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%' }}>
                <input type="checkbox" checked={!!chosen} onChange={() => toggle(u.id)}
                  aria-label={`Add ${u.name} to the team`} />
                <span style={{ flex: 1, fontSize: 13 }}>{u.name}</span>
                {chosen && (
                  <select value={chosen.role} onChange={e => setRole(u.id, e.target.value)}
                    aria-label={`Role for ${u.name}`}
                    style={{ ...INPUT, width: 'auto', padding: '3px 6px', fontSize: 11 }}>
                    {TEAM_ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                  </select>
                )}
              </div>

              {chosen && windowDays.length > 0 && (
                <div style={{ width: '100%', borderTop: '1px solid var(--line)', paddingTop: 7, marginTop: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 5 }}>
                    <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--fg-3)' }}>
                      Attending
                    </span>
                    <span style={{ fontSize: 10.5, color: chosen.days.length ? 'var(--fg-3)' : 'var(--neg)' }}>
                      {chosen.days.length
                        ? `${chosen.days.length} of ${windowDays.length} day${windowDays.length === 1 ? '' : 's'}`
                        : 'no days — nothing blocked'}
                    </span>
                    <button type="button"
                      onClick={() => setAllDays(u.id, chosen.days.length !== windowDays.length)}
                      style={{ marginLeft: 'auto', background: 'none', border: 'none', padding: 0,
                               fontSize: 10.5, fontFamily: 'inherit', color: 'var(--accent)', cursor: 'pointer' }}>
                      {chosen.days.length === windowDays.length ? 'Clear all' : 'All days'}
                    </button>
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                    {windowDays.map(day => {
                      const on = chosen.days.includes(day);
                      return (
                        <button key={day} type="button" onClick={() => toggleDay(u.id, day)}
                          title={`${on ? 'Remove' : 'Add'} ${dayLabel(day)}`}
                          style={{
                            padding: '2px 7px', borderRadius: 999, fontSize: 10.5, cursor: 'pointer',
                            fontFamily: 'inherit', whiteSpace: 'nowrap',
                            border: `1px solid ${on ? 'var(--accent-fill)' : 'var(--line-strong)'}`,
                            background: on ? 'var(--accent-fill)' : 'var(--bg-paper)',
                            color: on ? 'var(--on-accent)' : 'var(--fg-2)',
                          }}>
                          {dayLabel(day)}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
      {err && <div style={{ ...ERR, marginBottom: 10 }}>{err}</div>}
      <button onClick={save} disabled={busy} style={BTN_PRIMARY}>
        {busy ? 'Saving…' : `Save team (${sel.length})`}
      </button>
    </div>
  );
}

// ── Meetings — the client lookup lives here ──────────────────────

/**
 * Everything the company's name, the people met, the city or the notes contain.
 * One haystack per meeting so a search for "medan boiler" does not have to
 * decide which field it is looking in.
 */
function meetingHaystack(m: MeetingRow): string {
  return [
    m.company_name, m.client_legal_name, m.client_code, m.city,
    m.contact_person, m.designation, m.phone, m.email,
    ...(m.contacts ?? []).flatMap(c => [c.name, c.designation, c.phone, c.email]),
    m.discussion, m.requirement, m.outcome, m.next_action, m.interest, m.met_by_name,
  ].filter(Boolean).join(' \u0001 ').toLowerCase();
}

function MeetingsTab({ exhibitionId, meetings, users, canManage, canConvert }: {
  exhibitionId: number; meetings: MeetingRow[]; users: UserOpt[];
  canManage: boolean;
  /** Converting writes a client, so it is the reviewer's call — the same rule
   *  the action enforces (assertOwner), mirrored here so the button only shows
   *  to somebody it would work for. */
  canConvert: boolean;
}) {
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<MeetingRow | null>(null);
  const [converting, setConverting] = useState<MeetingRow | null>(null);

  // Plain component state, not useSearchBox: that hook exists for a box whose
  // value also lives in the URL, and the race it fixes is the debounced
  // navigation echoing an older value back. Every meeting for this exhibition
  // is already on the page, so this filters what is in hand — no navigation, no
  // round trip, nothing to echo.
  const [query, setQuery] = useState('');
  const needle = query.trim().toLowerCase();
  const shown = useMemo(
    () => (needle === '' ? meetings : meetings.filter(m => meetingHaystack(m).includes(needle))),
    [meetings, needle],
  );

  return (
    <div>
      {(canManage || meetings.length > 0) && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 14 }}>
          {canManage && (
            <button onClick={() => { setEditing(null); setAdding(true); }} style={BTN_PRIMARY}>
              + Capture meeting
            </button>
          )}
          {/* The same workbook as after closure — the meetings and contacts so
              far, with the rest of the event — so the list can go to somebody
              mid-show without waiting for the review. */}
          {meetings.length > 0 && (
            <a href={`/api/risansi/exhibitions/${exhibitionId}/export`} className="exh-export"
              title="Every meeting and the contact it produced, as a sheet — plus the event, team, expenses and review so far"
              style={{ padding: '8px 14px', borderRadius: 6, border: '1px solid var(--line-strong)', background: 'var(--bg-paper)', color: 'var(--fg)', fontSize: 13, fontWeight: 500, textDecoration: 'none', whiteSpace: 'nowrap', marginLeft: canManage ? 'auto' : 0 }}>
              ⤓ Export meetings to Excel
            </a>
          )}
        </div>
      )}
      {/* Keyed on the row, so the dialog is a NEW component for every company.
          It used to be one long-lived form fed a changing `meeting` prop: its
          fields are seeded at mount (useState for the company lookup,
          defaultValue for the rest), so picking a second company only swapped
          the prop and left the first company's typing on screen. A key that
          changes forces the unmount, and the seeding runs again. */}
      {(adding || editing) && (
        <MeetingDialog
          key={editing ? `meeting-${editing.id}` : 'meeting-new'}
          exhibitionId={exhibitionId}
          meeting={editing}
          onDone={() => { setAdding(false); setEditing(null); }}
        />
      )}
      {/* Keyed on the meeting for the same reason: the lead form seeds its
          fields once, at mount. */}
      {converting && (
        <MeetingLeadDialog
          key={`lead-${converting.id}`}
          exhibitionId={exhibitionId}
          meeting={converting}
          users={users}
          onDone={() => setConverting(null)}
        />
      )}

      {/* A show the size of PALMEX Medan is thirty-four cards. Finding the one
          company somebody is asking about by scrolling is not finding it. */}
      {meetings.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
          <div style={{ position: 'relative', flex: '1 1 260px', maxWidth: 420 }}>
            <input type="search" value={query} onChange={e => setQuery(e.target.value)}
              aria-label="Search meetings"
              placeholder="Search company, contact, city or what was discussed…"
              style={{ ...INPUT, paddingLeft: 32 }} />
            <span aria-hidden="true" style={{
              position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)',
              fontSize: 13, color: 'var(--fg-3)', pointerEvents: 'none',
            }}>⌕</span>
          </div>
          <span style={{ fontSize: 12, color: 'var(--fg-3)' }}>
            {needle === ''
              ? `${meetings.length} meeting${meetings.length === 1 ? '' : 's'}`
              : `${shown.length} of ${meetings.length}`}
          </span>
          {needle !== '' && (
            <button onClick={() => setQuery('')} style={LINK_BTN}>clear</button>
          )}
        </div>
      )}

      {meetings.length === 0 ? (
        <div style={PANEL}><Blank>No meetings captured yet.</Blank></div>
      ) : shown.length === 0 ? (
        <div style={PANEL}><Blank>No meeting matches “{query.trim()}”.</Blank></div>
      ) : (
        <div style={{ display: 'grid', gap: 10 }}>
          {/* The whole list stays put while a meeting is being edited — the
              dialog sits over it, so there is nothing to mistake for a
              duplicate entry, and closing it leaves the page where it was. */}
          {shown.map(m => (
            <div key={m.id} style={{ ...PANEL, padding: 14 }}>
              <div className="exh-meeting-head" style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <strong style={{ fontSize: 14, color: 'var(--title)' }}>{m.company_name}</strong>
                    {/* The flag. A matched company is marked; an unmatched one is
                        simply left plain — not an error, just a company we do not
                        already work with. */}
                    {m.client_id != null ? (
                      <span style={FLAG_KNOWN} title={m.client_legal_name ?? undefined}>
                        ✓ Existing client{m.client_code ? ` · ${m.client_code}` : ''}
                      </span>
                    ) : (
                      <span style={FLAG_NEW}>New company</span>
                    )}
                    {m.high_potential && <Pill tone="warn">⭐ High potential</Pill>}
                    {m.interest && <Pill>{m.interest}</Pill>}
                    {m.lead_client_id != null && (
                      <a href={`/risansi/clients/${m.lead_client_id}`} style={{ ...FLAG_KNOWN, textDecoration: 'none' }}>
                        ✓ Lead{m.lead_client_code ? ` · ${m.lead_client_code}` : ''}
                      </a>
                    )}
                  </div>
                  {/* Every person met, one line each. A stand meeting is often
                      two or three people and the second and third used to end
                      up in the discussion notes, or nowhere. */}
                  {(m.contacts?.length ?? 0) > 0 ? (
                    <div style={{ fontSize: 12, color: 'var(--fg-3)', marginTop: 4, display: 'grid', gap: 2 }}>
                      {m.contacts!.map(c => (
                        <div key={c.id}>
                          <span style={{ color: 'var(--fg-2)' }}>{c.name}</span>
                          {[c.designation, c.phone, c.email].filter(Boolean).length > 0
                            && ` · ${[c.designation, c.phone, c.email].filter(Boolean).join(' · ')}`}
                        </div>
                      ))}
                      {m.city && <div>{m.city}</div>}
                    </div>
                  ) : (
                    <div style={{ fontSize: 12, color: 'var(--fg-3)', marginTop: 4 }}>
                      {[m.contact_person, m.designation, m.city, m.phone, m.email].filter(Boolean).join(' · ') || '—'}
                    </div>
                  )}
                </div>
                <div className="exh-meeting-meta" style={{ textAlign: 'right', fontSize: 11, color: 'var(--fg-3)', whiteSpace: 'nowrap' }}>
                  <div>{m.met_on ?? ''}</div>
                  <div>{m.met_by_name ?? ''}</div>
                  {m.potential_value_inr != null && (
                    <div style={{ fontFamily: 'var(--font-mono)', color: 'var(--fg-2)', marginTop: 2 }}>
                      {fmtInr(m.potential_value_inr)}
                    </div>
                  )}
                </div>
              </div>
              {(m.discussion || m.requirement || m.outcome) && (
                <div style={{ marginTop: 10, fontSize: 12, color: 'var(--fg-2)', display: 'grid', gap: 4 }}>
                  {m.discussion  && <div><K>Discussed</K> {m.discussion}</div>}
                  {m.requirement && <div><K>Requirement</K> {m.requirement}</div>}
                  {m.outcome     && <div><K>Outcome</K> {m.outcome}</div>}
                </div>
              )}
              {m.next_action && (
                <div style={{ marginTop: 8, fontSize: 12, color: 'var(--fg-2)' }}>
                  <K>Next</K> {m.next_action}
                  {m.follow_up_date && <span style={{ color: 'var(--fg-3)' }}> · due {m.follow_up_date}</span>}
                </div>
              )}
              {(canManage || canConvert) && (
                <div style={{ display: 'flex', gap: 10, marginTop: 10, flexWrap: 'wrap' }}>
                  {canManage && (
                    <button onClick={() => { setAdding(false); setEditing(m); }} style={LINK_BTN}>Edit</button>
                  )}
                  {canManage && <DeleteMeeting exhibitionId={exhibitionId} meetingId={m.id} />}
                  {/* Here, beside Edit and Delete, rather than only in the
                      post-event review. The review is where a marked company is
                      decided at the end of the event; a rep who has just
                      captured a company that is plainly a lead should not have
                      to wait for the event to finish to say so. Offered only
                      when there is no client and no lead yet — the two cases
                      the action refuses. */}
                  {canConvert && m.client_id == null && m.lead_client_id == null && (
                    <button onClick={() => setConverting(m)} style={LINK_BTN}
                      title="Create a Prospective-Lead client from this meeting">
                      → Prospective Lead
                    </button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function DeleteMeeting({ exhibitionId, meetingId }: { exhibitionId: number; meetingId: number }) {
  const router = useRouter();
  const [confirm, setConfirm] = useState(false);
  const [err, setErr] = useState('');
  // The refusal sits beside the control rather than replacing it. It used to
  // take the control's place, which was survivable while every failure read
  // "Could not delete." Now that the action says which of the three reasons it
  // was, that sentence would have stood where the button had been with no way
  // back to it.
  return (
    <span style={{ fontSize: 12, display: 'inline-flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
      {err && <span style={{ fontSize: 11, color: 'var(--neg)' }}>{err}</span>}
      {!confirm ? (
        <button onClick={() => { setErr(''); setConfirm(true); }} style={LINK_BTN}>Delete</button>
      ) : (
        <span>
          Sure?{' '}
          <button style={LINK_BTN} onClick={async () => {
            setErr('');
            try {
              const res = await deleteExhibitionMeeting(exhibitionId, meetingId);
              if (!res.ok) { setErr(res.error); setConfirm(false); return; }
              router.refresh();
            }
            catch (e) { setErr(e instanceof Error ? e.message : 'Could not delete.'); setConfirm(false); }
          }}>Yes</button>{' '}
          <button style={LINK_BTN} onClick={() => setConfirm(false)}>No</button>
        </span>
      )}
    </span>
  );
}

// ── The people met at one meeting ────────────────────────────────

type ContactDraft = { name: string; designation: string; phone: string; email: string };

/** Matches MAX_MEETING_CONTACTS in the action, and the Client Master's own
 *  limit, so a meeting can never hold more people than the client it becomes. */
const MAX_MEETING_CONTACTS = 10;
const EMPTY_CONTACT: ContactDraft = { name: '', designation: '', phone: '', email: '' };

/**
 * The rows the dialog opens with.
 *
 * Whoever is already recorded, in entry order. A meeting saved before migration
 * 0120 whose rows have not been backfilled falls back to the four single
 * columns, so nothing opens emptier than it was. Always at least one row —
 * typing a name should not need a button press first.
 */
function seedContacts(m: MeetingRow | null): ContactDraft[] {
  const rows = (m?.contacts ?? []).map(c => ({
    name: c.name ?? '', designation: c.designation ?? '',
    phone: c.phone ?? '', email: c.email ?? '',
  }));
  if (rows.length) return rows;
  if (m?.contact_person || m?.designation || m?.phone || m?.email) {
    return [{
      name: m.contact_person ?? '', designation: m.designation ?? '',
      phone: m.phone ?? '', email: m.email ?? '',
    }];
  }
  return [{ ...EMPTY_CONTACT }];
}

/**
 * Add a person, remove a person. A stand meeting is normally two or three — the
 * engineer who asked the question, the manager who decides, whoever handed over
 * the card — and one field for all of them meant the rest went into the
 * discussion notes or nowhere.
 *
 * The FIRST row is the primary: it is what the meeting's own contact columns are
 * set to (the export reads them), and it is the contact marked primary on the
 * client if this meeting becomes a lead. Said on screen, because the order of
 * the rows is otherwise invisible.
 */
function ContactRows({ contacts, onChange }: {
  contacts: ContactDraft[]; onChange: (next: ContactDraft[]) => void;
}) {
  const patch = (i: number, p: Partial<ContactDraft>) =>
    onChange(contacts.map((c, n) => (n === i ? { ...c, ...p } : c)));
  const full = contacts.length >= MAX_MEETING_CONTACTS;

  return (
    <div>
      <label style={LABEL}>People met{contacts.length > 1 ? ` · ${contacts.length}` : ''}</label>
      <div style={{ display: 'grid', gap: 10 }}>
        {contacts.map((c, i) => (
          <div key={i} style={{
            border: '1px solid var(--line)', borderRadius: 8, padding: 10, background: 'var(--bg-elev)',
          }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 7 }}>
              <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.06em',
                             textTransform: 'uppercase', color: 'var(--fg-3)' }}>
                {i === 0 ? 'Contact 1 · main' : `Contact ${i + 1}`}
              </span>
              {contacts.length > 1 && (
                <button type="button" style={{ ...LINK_BTN, marginLeft: 'auto' }}
                  title={`Remove ${c.name || `contact ${i + 1}`}`}
                  onClick={() => onChange(contacts.filter((_, n) => n !== i))}>
                  remove
                </button>
              )}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(155px, 1fr))', gap: 10 }}>
              <input value={c.name} onChange={e => patch(i, { name: e.target.value })}
                placeholder="Name" aria-label={`Contact ${i + 1} name`} style={INPUT} />
              <input value={c.designation} onChange={e => patch(i, { designation: e.target.value })}
                placeholder="Designation" aria-label={`Contact ${i + 1} designation`} style={INPUT} />
              <input value={c.phone} onChange={e => patch(i, { phone: e.target.value })}
                placeholder="Phone" inputMode="tel" aria-label={`Contact ${i + 1} phone`} style={INPUT} />
              <input value={c.email} onChange={e => patch(i, { email: e.target.value })}
                placeholder="Email" type="email" aria-label={`Contact ${i + 1} email`} style={INPUT} />
            </div>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginTop: 8, flexWrap: 'wrap' }}>
        <button type="button" onClick={() => onChange([...contacts, { ...EMPTY_CONTACT }])}
          disabled={full} title={full ? `${MAX_MEETING_CONTACTS} people is the limit` : undefined}
          style={{ ...BTN_GHOST, padding: '6px 12px', fontSize: 12.5, opacity: full ? 0.5 : 1,
                   cursor: full ? 'not-allowed' : 'pointer' }}>
          + Add another person
        </button>
        <span style={{ fontSize: 11, color: 'var(--fg-3)' }}>
          The first one is the meeting&rsquo;s main contact, and the primary contact if this
          company becomes a lead. A row with no name is dropped.
        </span>
      </div>
      {/* Read by saveExhibitionMeeting, which writes the rows and mirrors the
          first into the meeting's own contact columns. */}
      <input type="hidden" name="contacts_json" value={JSON.stringify(contacts)} />
    </div>
  );
}

/**
 * One meeting, in a dialog of its own.
 *
 * It is a dialog rather than a panel above the list because a rep working down
 * the stand's companies clicks Edit on one after another: an inline editor made
 * that a swap of props on a mounted form, and the fields kept the previous
 * company. Mounted per row (see the `key` at the call site) and closed on Save,
 * there is only ever one company's data in it.
 *
 * Closing follows the house rule set after a rep lost a long quotation to a
 * stray click: the backdrop does not close a form with typing in it, and the ×
 * and Escape ask first.
 *
 * Company field has a live lookup against the client master. This is the
 * module's only touch-point with existing data: it reads, flags, stores the id.
 */
function MeetingDialog({ exhibitionId, meeting, onDone }: {
  exhibitionId: number; meeting: MeetingRow | null; onDone: () => void;
}) {
  const router = useRouter();
  // Cards photographed before this meeting has an id, flushed on save.
  const [pendingCards, setPendingCards] = useState<File[]>([]);
  // Seeded once, at mount — the dialog is keyed per row (see the call site), so
  // a second company gets a second component rather than these rows.
  const [contacts, setContacts] = useState<ContactDraft[]>(() => seedContacts(meeting));
  const [company, setCompany] = useState(meeting?.company_name ?? '');
  const [clientId, setClientId] = useState<number | null>(meeting?.client_id ?? null);
  const [matched, setMatched] = useState<{ code: string | null; legal_name: string; city: string | null } | null>(
    meeting?.client_id != null
      ? { code: meeting.client_code, legal_name: meeting.client_legal_name ?? meeting.company_name, city: null }
      : null,
  );
  const [suggestions, setSuggestions] = useState<Array<{ id: number; code: string | null; legal_name: string; city: string | null; exact: boolean }>>([]);
  const [looking, setLooking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const panel = useRef<HTMLDivElement | null>(null);

  // Set by the form's own input event, so every named field counts without any
  // of them having to become controlled, plus the two things that change
  // without a keystroke: a picked client, and a photographed card.
  const [dirty, setDirty] = useState(false);
  const guard = useCloseGuard({ dirty, onClose: onDone, enabled: !busy });
  useDialogFocus(panel);

  // Debounced so a typed company name fires one lookup, not one per keystroke.
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    const q = company.trim();
    if (q.length < 2) { setSuggestions([]); return; }
    // Once a client is chosen, stop searching — the user has answered the question.
    if (clientId != null && matched && q === (matched.legal_name || company)) return;
    timer.current = setTimeout(async () => {
      setLooking(true);
      try {
        const res = await fetch(`/api/risansi/exhibitions/client-lookup?q=${encodeURIComponent(q)}`);
        if (!res.ok) { setSuggestions([]); return; }
        const data = await res.json();
        const list = Array.isArray(data.matches) ? data.matches : [];
        setSuggestions(list);
        // Auto-flag only on an unambiguous exact name match; anything softer is
        // offered as a suggestion so a person confirms it.
        const exact = list.find((m: { exact: boolean }) => m.exact);
        if (exact && clientId == null) {
          setClientId(exact.id);
          setMatched({ code: exact.code, legal_name: exact.legal_name, city: exact.city });
        }
      } catch { setSuggestions([]); }
      finally { setLooking(false); }
    }, 250);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [company, clientId, matched]);

  function choose(m: { id: number; code: string | null; legal_name: string; city: string | null }) {
    setClientId(m.id);
    setMatched({ code: m.code, legal_name: m.legal_name, city: m.city });
    setCompany(m.legal_name);
    setSuggestions([]);
    setDirty(true);
  }
  function clearMatch() {
    setClientId(null); setMatched(null); setSuggestions([]); setDirty(true);
  }

  return (
    <div onClick={guard.onBackdropClick}
      style={{
        position: 'fixed', inset: 0, zIndex: 430, background: 'rgba(10,22,40,0.45)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
      }}>
      <div className="risansi-modal" ref={panel} tabIndex={-1}
        role="dialog" aria-modal="true"
        aria-label={meeting ? `Edit meeting with ${meeting.company_name}` : 'Capture meeting'}
        style={{
          width: 760, maxWidth: '100%', maxHeight: '92vh', overflowY: 'auto',
          background: 'var(--bg-paper)', color: 'var(--fg)', borderRadius: 12,
          boxShadow: '0 24px 64px rgba(10,61,143,0.25)', outline: 'none',
        }}>
        {/* Sticky: the × stays in reach however far down the field list someone
            has scrolled. The Cancel at the foot used to be the only way out. */}
        <div style={{ padding: '14px 18px', background: 'var(--accent-fill)', color: 'var(--on-accent)', position: 'sticky', top: 0, zIndex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontSize: 15, fontWeight: 700, overflowWrap: 'anywhere' }}>
                {meeting ? meeting.company_name : 'Capture meeting'}
              </div>
              <div style={{ fontSize: 11.5, opacity: 0.9, marginTop: 3 }}>
                {meeting
                  ? `Editing this meeting${meeting.met_on ? ` · met ${meeting.met_on}` : ''}`
                  : 'A company met at the stand, and what was said'}
              </div>
            </div>
            <CloseX onClick={guard.requestClose} tone="onDark" title="Close this form" />
          </div>
          {guard.asking && (
            <CloseConfirm
              tone="onDark"
              message="Close without saving? What you typed here will be lost."
              onConfirm={guard.confirmClose}
              onCancel={guard.keepEditing}
            />
          )}
          {guard.hint && !guard.asking && <KeepOpenHint tone="onDark" />}
        </div>

      <form className="exh-form" style={{ padding: 18 }} onInput={() => { if (!dirty) setDirty(true); }} action={async fd => {
        setBusy(true); setErr('');
        try {
          const saved = await saveExhibitionMeeting(exhibitionId, fd, meeting?.id);
          // A refused save stays in the dialog with its reason, and nothing is
          // closed or thrown away.
          if (!saved.ok) { setErr(saved.error); setBusy(false); return; }
          const savedId = saved.id;
          // Cards photographed before the meeting existed have somewhere to go
          // now. A failure here must not read as "the meeting did not save" —
          // it did; only the photos did not.
          if (pendingCards.length && savedId) {
            const failed = await uploadCards(savedId, pendingCards);
            if (failed.length) {
              setErr(`Meeting saved, but ${failed.length} business card photo(s) could not be attached. Reopen the meeting to add them.`);
              setBusy(false);
              setPendingCards([]);
              router.refresh();
              return;
            }
            setPendingCards([]);
          }
          router.refresh(); onDone();
        } catch (e) {
          const raw = e instanceof Error ? e.message : '';
          const redacted = !raw || /unexpected response/i.test(raw) || Boolean((e as { digest?: string })?.digest);
          setErr(redacted ? 'Could not save the meeting.' : raw);
          setBusy(false);
        }
      }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* Company + lookup */}
          <div>
            <label style={LABEL}>Company *</label>
            <input name="company_name" required value={company}
              onChange={e => { setCompany(e.target.value); if (clientId != null) clearMatch(); }}
              placeholder="Type the company name…" style={INPUT} autoComplete="off" />
            <input type="hidden" name="client_id" value={clientId ?? ''} />

            <div style={{ marginTop: 6, minHeight: 22 }}>
              {looking && <span style={{ fontSize: 11, color: 'var(--fg-3)' }}>Checking the client master…</span>}
              {!looking && matched && (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span style={FLAG_KNOWN}>✓ Existing client{matched.code ? ` · ${matched.code}` : ''}</span>
                  <span style={{ fontSize: 11, color: 'var(--fg-3)' }}>
                    {matched.legal_name}{matched.city ? ` · ${matched.city}` : ''}
                  </span>
                  <button type="button" onClick={clearMatch} style={LINK_BTN}>not this one</button>
                </span>
              )}
              {!looking && !matched && company.trim().length >= 2 && suggestions.length === 0 && (
                <span style={FLAG_NEW}>New company — not in the client master</span>
              )}
            </div>

            {!matched && suggestions.length > 0 && (
              <div style={{ ...PANEL, marginTop: 6 }}>
                <div style={{ padding: '6px 10px', fontSize: 11, color: 'var(--fg-3)', borderBottom: '1px solid var(--line)' }}>
                  Did you mean one of these existing clients?
                </div>
                {suggestions.slice(0, 6).map(s => (
                  <button key={s.id} type="button" onClick={() => choose(s)}
                    style={{ ...ROW, width: '100%', border: 'none', background: 'none', cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit' }}>
                    <span style={{ fontSize: 13 }}>{s.legal_name}</span>
                    <span style={{ fontSize: 11, color: 'var(--fg-3)' }}>{[s.code, s.city].filter(Boolean).join(' · ')}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <ContactRows contacts={contacts}
            onChange={next => { setContacts(next); setDirty(true); }} />

          <Two>
            <F label="City"><input name="city" defaultValue={meeting?.city ?? ''} style={INPUT} /></F>
            <F label="Met on"><input name="met_on" type="date" defaultValue={meeting?.met_on ?? ''} style={INPUT} /></F>
          </Two>

          {/* Directly under the contact fields, so the card can be read off
              while they are typed. */}
          <BusinessCards
            meetingId={meeting?.id ?? null}
            pending={pendingCards}
            onPendingChange={files => { setPendingCards(files); setDirty(true); }}
          />

          <F label="What was discussed"><textarea name="discussion" rows={2} defaultValue={meeting?.discussion ?? ''} style={{ ...INPUT, resize: 'vertical' }} /></F>
          <F label="Requirement"><textarea name="requirement" rows={2} defaultValue={meeting?.requirement ?? ''} style={{ ...INPUT, resize: 'vertical' }} /></F>
          <F label="Outcome"><textarea name="outcome" rows={2} defaultValue={meeting?.outcome ?? ''} style={{ ...INPUT, resize: 'vertical' }} /></F>

          <Two>
            <F label="Interest">
              <select name="interest" defaultValue={meeting?.interest ?? ''} style={INPUT}>
                <option value="">— Select —</option>
                {INTEREST_LEVELS.map(i => <option key={i} value={i}>{i}</option>)}
              </select>
            </F>
            <F label="Potential value (₹)">
              <input name="potential_value_inr" inputMode="decimal" defaultValue={meeting?.potential_value_inr ?? ''} style={INPUT} placeholder="e.g. 5,00,000" />
            </F>
          </Two>
          {/* Marked by whoever took the meeting; nobody is notified. It is
              read at the post-event review, which cannot close until each
              marked company has been turned into a lead or set aside. */}
          <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '10px 12px', marginBottom: 12,
                          border: '1px solid var(--line-strong)', borderRadius: 8, background: 'var(--bg-elev)', cursor: 'pointer' }}>
            <input type="checkbox" name="high_potential" value="1" defaultChecked={meeting?.high_potential ?? false}
              style={{ width: 18, height: 18, marginTop: 1, flexShrink: 0 }} />
            <span>
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg)' }}>⭐ High potential — worth pursuing</span>
              <span style={{ display: 'block', fontSize: 11.5, color: 'var(--fg-3)', marginTop: 2, lineHeight: 1.45 }}>
                Flags this company for the post-event review, where it is turned into a lead or set aside with a reason. The exhibition cannot be closed while one is still undecided.
              </span>
            </span>
          </label>

          <Two>
            <F label="Next action"><input name="next_action" defaultValue={meeting?.next_action ?? ''} style={INPUT} placeholder="e.g. Send quotation" /></F>
            <F label="Follow-up by"><input name="follow_up_date" type="date" defaultValue={meeting?.follow_up_date ?? ''} style={INPUT} /></F>
          </Two>

          {/* The refusal belongs with the buttons that caused it, inside the
              dialog — nothing closes on a failed save. */}
          {err && <div style={ERR}>{err}</div>}
          <div className="exh-actions" style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button type="button" onClick={guard.requestClose} style={BTN_GHOST}>Cancel</button>
            <button type="submit" disabled={busy} style={BTN_PRIMARY}>{busy ? 'Saving…' : 'Save meeting'}</button>
          </div>
        </div>
      </form>
      </div>
    </div>
  );
}

// ── Expenses ─────────────────────────────────────────────────────

// The money columns sort on the stored rupee figure, not on the "₹1.2 L" the
// cell prints. The invoice column sorts on the attached file's name, so the
// lines with no bill against them collect at the bottom.
const EXPENSE_COLS: SortableColumn<ExpenseRow>[] = [
  { key: 'category',  kind: 'text',   value: x => x.category },
  { key: 'details',   kind: 'text',   value: x => x.description },
  { key: 'vendor',    kind: 'text',   value: x => x.vendor },
  { key: 'estimated', kind: 'number', value: x => x.estimated_inr },
  { key: 'actual',    kind: 'number', value: x => x.actual_inr },
  { key: 'paid',      kind: 'number', value: x => x.paid_inr },
  { key: 'invoice',   kind: 'text',   value: x => x.file_name },
];

function ExpensesTab({ exhibitionId, expenses, totals, canManage }: {
  exhibitionId: number; expenses: ExpenseRow[]; totals: ReturnType<typeof sumExpenses>; canManage: boolean;
}) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [err, setErr] = useState('');
  // Every expense line for this exhibition is already on the page, so the sort
  // is in memory and covers all of them.
  const { rows: lines, sortBy } = useTableSort(expenses, EXPENSE_COLS);

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12, marginBottom: 14 }}>
        <Kpi label="Estimated" value={fmtInr(totals.estimated)} />
        <Kpi label="Actual"    value={fmtInr(totals.actual)} />
        <Kpi label="Paid"      value={fmtInr(totals.paid)} />
        <Kpi label="Pending"   value={fmtInr(totals.pending)} />
        <Kpi label="Variance"  value={fmtInr(Math.abs(totals.variance))}
             sub={totals.variance > 0 ? 'over estimate' : totals.variance < 0 ? 'under estimate' : 'on estimate'} />
      </div>

      {canManage && !adding && (
        <button onClick={() => setAdding(true)} style={{ ...BTN_PRIMARY, marginBottom: 14 }}>+ Add expense</button>
      )}

      {adding && <ExpenseForm exhibitionId={exhibitionId} onDone={() => setAdding(false)} />}

      {expenses.length === 0 ? (
        <div style={PANEL}><Blank>No expenses recorded yet.</Blank></div>
      ) : (
        <div style={PANEL}>
          <table className="exh-table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr>
                <SortTH {...sortBy('category')}  style={TH}>Category</SortTH>
                <SortTH {...sortBy('details')}   style={TH}>Description</SortTH>
                <SortTH {...sortBy('vendor')}    style={TH}>Vendor</SortTH>
                <SortTH {...sortBy('estimated')} style={TH}>Estimated</SortTH>
                <SortTH {...sortBy('actual')}    style={TH}>Actual</SortTH>
                <SortTH {...sortBy('paid')}      style={TH}>Paid</SortTH>
                <SortTH {...sortBy('invoice')}   style={TH}>Invoice</SortTH>
                {/* The delete button's column. Nothing to order by. */}
                <th style={TH} />
              </tr>
            </thead>
            <tbody>
              {/* data-label feeds the ::before on each cell when the table
                  reflows to one card per row on a phone (app/mobile.css). */}
              {lines.map(x => (
                <tr key={x.id} style={{ borderTop: '1px solid var(--line)' }}>
                  <td data-label="Category"  style={{ ...TD, fontWeight: 600 }}>{x.category}</td>
                  <td data-label="Details"   style={TD}>{x.description || '—'}</td>
                  <td data-label="Vendor"    style={TD}>{x.vendor || '—'}</td>
                  <td data-label="Estimated" style={{ ...TD, fontFamily: 'var(--font-mono)' }}>{fmtInrFull(x.estimated_inr)}</td>
                  <td data-label="Actual"    style={{ ...TD, fontFamily: 'var(--font-mono)' }}>{fmtInrFull(x.actual_inr)}</td>
                  <td data-label="Paid"      style={{ ...TD, fontFamily: 'var(--font-mono)' }}>{fmtInrFull(x.paid_inr)}</td>
                  <td data-label="Invoice"   style={TD}>
                    <InvoiceCell expenseId={x.id} hasInvoice={x.has_invoice}
                      fileName={x.file_name} canManage={canManage} />
                  </td>
                  <td data-label="" style={TD}>
                    {canManage && <DeleteExpense exhibitionId={exhibitionId} expenseId={x.id} />}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/**
 * Add an expense with its invoice in one submit. The file rides along in the same
 * FormData, so the row and the receipt are written in a single transaction — an
 * actual amount can never be saved with the bill "to follow".
 */
function ExpenseForm({ exhibitionId, onDone }: { exhibitionId: number; onDone: () => void }) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr]   = useState('');

  // Every expense line carries a supporting document — no exceptions, including
  // estimate-only lines, where the quote or proforma is the document. Enforced
  // again in the server action; this is only the friendly half.
  const needsInvoice = true;

  return (
    <div style={{ ...PANEL, padding: 16, marginBottom: 14 }}>
      <form className="exh-form" action={async fd => {
        if (!file) {
          setErr('Attach the invoice, quote or a photo of the bill for this expense.');
          return;
        }
        setBusy(true); setErr('');
        if (file) fd.set('invoice', file);
        try {
          // A rejected category, a paid figure over the actual, or an invoice
          // the format check turned down all arrive as a sentence now. The
          // dialog stays open on a refusal so the field can be corrected.
          const res = await saveExhibitionExpense(exhibitionId, fd);
          if (!res.ok) { setErr(res.error); setBusy(false); return; }
          router.refresh(); onDone();
        }
        catch (e) {
          const raw = e instanceof Error ? e.message : '';
          const redacted = !raw || /unexpected response|Server Components render|Body exceeded/i.test(raw)
            || Boolean((e as { digest?: string })?.digest);
          setErr(redacted
            ? 'Could not save the expense. If you attached a large photo, try a smaller one.'
            : raw);
          setBusy(false);
        }
      }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Two>
            <F label="Category *">
              <select name="category" required defaultValue="" style={INPUT}>
                <option value="">— Select —</option>
                {EXPENSE_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </F>
            <F label="Vendor"><input name="vendor" style={INPUT} /></F>
          </Two>
          <F label="Description"><input name="description" style={INPUT} /></F>
          <Two>
            <F label="Estimated (₹)"><input name="estimated_inr" inputMode="decimal" style={INPUT} /></F>
            <F label="Actual (₹)"><input name="actual_inr" inputMode="decimal" style={INPUT} /></F>
          </Two>
          <Two>
            <F label="Paid (₹)" hint="Cannot exceed the actual amount">
              <input name="paid_inr" inputMode="decimal" style={INPUT} />
            </F>
            <F label="Paid on"><input name="paid_on" type="date" style={INPUT} /></F>
          </Two>

          <InvoicePicker value={file} onChange={f => { setFile(f); setErr(''); }} required={needsInvoice} />

          {err && <div style={ERR}>{err}</div>}
          <div className="exh-actions" style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button type="button" onClick={onDone} style={BTN_GHOST}>Cancel</button>
            <button type="submit" disabled={busy || (needsInvoice && !file)}
              title={needsInvoice && !file ? 'Attach the invoice first' : undefined}
              style={{ ...BTN_PRIMARY, opacity: busy || (needsInvoice && !file) ? 0.55 : 1 }}>
              {busy ? 'Saving…' : 'Save expense'}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}

function DeleteExpense({ exhibitionId, expenseId }: { exhibitionId: number; expenseId: number }) {
  const router = useRouter();
  const [confirm, setConfirm] = useState(false);
  const [err, setErr] = useState('');
  // Beside the control, not instead of it — see DeleteMeeting above.
  return (
    <span style={{ fontSize: 12, display: 'inline-flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
      {err && <span style={{ fontSize: 11, color: 'var(--neg)' }}>{err}</span>}
      {!confirm ? (
        <button onClick={() => { setErr(''); setConfirm(true); }} style={LINK_BTN}>Delete</button>
      ) : (
        <span>
          <button style={LINK_BTN} onClick={async () => {
            setErr('');
            try {
              const res = await deleteExhibitionExpense(exhibitionId, expenseId);
              if (!res.ok) { setErr(res.error); setConfirm(false); return; }
              router.refresh();
            }
            catch (e) { setErr(e instanceof Error ? e.message : 'Could not delete.'); setConfirm(false); }
          }}>Confirm</button>{' '}
          <button style={LINK_BTN} onClick={() => setConfirm(false)}>Cancel</button>
        </span>
      )}
    </span>
  );
}

// ── What happens next ────────────────────────────────────────────

/**
 * Tells an approved exhibition what its next move is, and offers the button for
 * it. Without this, advancing to the review depended on someone realising that
 * "Completed" had to be set first — which is not a thing anyone would guess.
 *
 * The prompt is driven by the event's own dates, so once an exhibition is over it
 * asks for the review by itself rather than waiting to be remembered.
 */
function StageNudge({ exhibition: ex, canManage, onGoReview }: {
  exhibition: ExhibitionFull; canManage: boolean; onGoReview: () => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr]   = useState('');
  // Compare as YYYY-MM-DD strings in local time. Parsing these as Dates would
  // reintroduce the UTC day-shift this codebase has been bitten by repeatedly.
  const today = (() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  })();
  const started = !!ex.start_date && ex.start_date <= today;
  const ended   = !!ex.end_date   && ex.end_date   <  today;

  async function go(next: 'Ongoing' | 'Completed') {
    setBusy(true); setErr('');
    try {
      const res = await advanceExhibition(ex.id, next);
      if (!res.ok) { setErr(res.error); return; }
      router.refresh();
    }
    catch (e) {
      const raw = e instanceof Error ? e.message : '';
      const redacted = !raw || /unexpected response|Server Components render/i.test(raw)
        || Boolean((e as { digest?: string })?.digest);
      setErr(redacted ? 'Could not update the exhibition.' : raw);
    } finally { setBusy(false); }
  }

  let body: React.ReactNode = null;

  if (ex.status === 'Closed') {
    body = (
      <>
        <b>This exhibition is closed.</b>{' '}
        {ex.closed_at
          ? `Closed by ${ex.closed_by_name ?? '—'} on ${ex.closed_at.slice(0, 10)}.`
          : ''}{' '}
        Everything below is read-only. A sysadmin can reopen it if something needs
        correcting.
      </>
    );
  } else if (ex.status === 'Completed') {
    body = (
      <>
        <b>The event is over.</b> Fill in the post-event review — clients met, spend
        and ROI are already worked out for you.
        <div style={{ marginTop: 8 }}>
          <button onClick={onGoReview} style={BTN_PRIMARY}>Open post-event review →</button>
        </div>
      </>
    );
  } else if (ended && canManage) {
    body = (
      <>
        <b>This exhibition ended on {ex.end_date}.</b> Mark it finished to open the
        post-event review.
        <div style={{ marginTop: 8 }}>
          <button disabled={busy} onClick={() => go('Completed')} style={BTN_PRIMARY}>
            {busy ? 'Working…' : '✓ Event finished — write review'}
          </button>
        </div>
      </>
    );
  } else if (ex.status === 'Approved' && started && canManage) {
    body = (
      <>
        <b>The event has started.</b> Capture meetings as you go; mark it finished
        afterwards to unlock the review.
        <div style={{ marginTop: 8 }}>
          <button disabled={busy} onClick={() => go('Ongoing')} style={BTN_GHOST}>▶ Mark as ongoing</button>
        </div>
      </>
    );
  } else if (ex.status === 'Approved' || ex.status === 'Ongoing') {
    body = (
      <>
        Approved{ex.participation ? ` to ${ex.participation.toLowerCase()}` : ''}.
        Capture meetings and expenses now; the post-event review opens once the
        event is marked finished.
      </>
    );
  }

  if (!body) return null;

  return (
    <div style={{
      ...PANEL, padding: 14, marginBottom: 16,
      background: 'var(--accent-soft)', border: '1px solid var(--accent-line)',
    }}>
      <div style={{ fontSize: 13, color: 'var(--fg-2)' }}>{body}</div>
      {err && <div style={{ ...ERR, marginTop: 8 }}>{err}</div>}
    </div>
  );
}

// ── Locked-stage explainer ───────────────────────────────────────

/** Shown above the Overview while the operational tabs are still shut, so the
 *  greyed-out tabs are never a mystery. */
function LockedNotice({ status, readiness }: {
  status: ExhibitionStatus; readiness: { ready: boolean; missing: string[] };
}) {
  const rejected = status === 'Rejected';
  const waiting  = status === 'Submitted';
  return (
    <div style={{
      ...PANEL, padding: 14, marginBottom: 16,
      background: rejected ? 'var(--neg-soft)' : 'var(--accent-soft)',
      border: `1px solid ${rejected ? 'var(--neg)' : 'var(--accent-line)'}`,
    }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: rejected ? 'var(--neg-strong)' : 'var(--title)' }}>
        {rejected ? 'This exhibition was not approved'
          : waiting ? 'Waiting for a decision'
          : 'Not submitted for approval yet'}
      </div>
      <div style={{ fontSize: 12, color: 'var(--fg-2)', marginTop: 5 }}>
        {rejected
          ? 'Meetings, expenses and the review stay closed. The record is kept for the history.'
          : waiting
            ? 'Meetings, expenses and the post-event review open as soon as the approver decides.'
            : 'Fill in the event details and pick the team, then submit. Meetings, expenses and the review unlock once it is approved.'}
      </div>
      {!waiting && !rejected && !readiness.ready && (
        <div style={{ marginTop: 8 }}>
          <div style={{ fontSize: 11, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Still needed
          </div>
          <ul style={{ margin: '4px 0 0', paddingLeft: 18, fontSize: 12, color: 'var(--fg-2)' }}>
            {readiness.missing.map(m => <li key={m}>{m}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}

// ── Derived outcome strip (top of the review tab) ────────────────

/** Figures taken straight from the meeting and expense records, so the review can
 *  never contradict them. ROI needs a business-won number, which only the
 *  summary at the foot of the page can supply. */
function ReviewSummaryStrip({ meetings, totals, review }: {
  meetings: MeetingRow[]; totals: ReturnType<typeof sumExpenses>; review: ReviewRow | null;
}) {
  const met   = meetings.length;
  const known = meetings.filter(m => m.client_id != null).length;
  const hot   = meetings.filter(m => m.interest === 'Hot').length;
  const pipeline = meetings.reduce((s, m) => s + Number(m.potential_value_inr ?? 0), 0);
  const spend = totals.actual;
  const won   = Number(review?.business_won_inr ?? 0);
  const roi   = spend > 0 && won > 0 ? ((won - spend) / spend) * 100 : null;
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
      <Kpi label="Companies met"   value={String(met)} sub={`${known} existing · ${met - known} new`} />
      <Kpi label="Hot leads"       value={String(hot)} sub="marked hot at the stand" />
      <Kpi label="Potential value" value={fmtInr(pipeline)} sub="summed from meetings" />
      <Kpi label="Total spend"     value={fmtInr(spend)} />
      <Kpi label="Business won"    value={fmtInr(won)} sub={review ? undefined : 'not recorded yet'} />
      <Kpi label="ROI"             value={roi == null ? '—' : `${roi > 0 ? '+' : ''}${roi.toFixed(0)}%`}
           sub={roi == null ? 'needs spend + business won' : 'business won vs spend'} />
    </div>
  );
}

// ── Invoice picker (inside the expense form) ─────────────────────

/**
 * Attach the bill while the expense is being written, not afterwards — a receipt
 * chased later is a receipt that never arrives.
 *
 * Three ways in, because the same form is used at a stand and at a desk:
 *   Take photo  — capture="environment" opens the rear camera straight away on a
 *                 phone. Ignored by desktop browsers, which fall back to a picker.
 *   Gallery     — no capture attribute, so a phone offers the photo library (and
 *                 files); the natural choice for a shot taken earlier.
 *   Browse      — the same list from a desk, where the emailed invoice is a PDF
 *                 on disk.
 *
 * The chosen file is held in component state and submitted with the rest of the
 * form, so the expense row and its invoice are written in one transaction.
 */
function InvoicePicker({ value, onChange, required, existingName }: {
  value: File | null;
  onChange: (f: File | null) => void;
  required: boolean;
  existingName?: string | null;
}) {
  const cameraRef  = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  const browseRef  = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [tooBig, setTooBig]   = useState(false);

  // Object URLs must be revoked or the blob leaks for the life of the page.
  useEffect(() => {
    if (!value || !value.type.startsWith('image/')) { setPreview(null); return; }
    const url = URL.createObjectURL(value);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [value]);

  function take(f: File | undefined) {
    if (!f) return;
    if (f.size > MAX_INVOICE_BYTES) { setTooBig(true); onChange(null); return; }
    setTooBig(false);
    onChange(f);
  }

  const chosen = value != null;

  return (
    <div>
      <label style={LABEL}>
        Invoice / bill {required && <span style={{ color: 'var(--neg)' }}>*</span>}
      </label>

      {/* Hidden inputs, one per entry point.

          All three advertise INVOICE_ACCEPT, not image/*. These two said image/*
          and the photo was then refused on arrival: an iPhone shoots HEIC, and
          an input that advertises "any image" is taken at its word and sends
          one, while checkInvoice accepts PDF, JPG and PNG only. Naming the
          types is what makes iOS transcode to JPEG before it uploads. The same
          fix as the business-card camera — see the comment in BusinessCards.tsx.
          The picker and the validator have to agree, which is the whole reason
          INVOICE_ACCEPT is a shared constant. */}
      <input ref={cameraRef} type="file" accept={INVOICE_ACCEPT} capture="environment"
        style={{ display: 'none' }} onChange={e => take(e.target.files?.[0])} />
      <input ref={galleryRef} type="file" accept={INVOICE_ACCEPT}
        style={{ display: 'none' }} onChange={e => take(e.target.files?.[0])} />
      <input ref={browseRef} type="file" accept={INVOICE_ACCEPT}
        style={{ display: 'none' }} onChange={e => take(e.target.files?.[0])} />

      {!chosen ? (
        <>
          <div className="exh-pick" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" onClick={() => cameraRef.current?.click()} style={PICK_BTN}>
              📷 Take photo
            </button>
            <button type="button" onClick={() => galleryRef.current?.click()} style={PICK_BTN}>
              🖼️ Gallery
            </button>
            <button type="button" onClick={() => browseRef.current?.click()} style={PICK_BTN}>
              📁 Browse
            </button>
          </div>
          {existingName && (
            <div style={{ fontSize: 11, color: 'var(--fg-3)', marginTop: 6 }}>
              Currently attached: {existingName} — pick a file only to replace it.
            </div>
          )}
          {required && !existingName && (
            <div style={{ fontSize: 11, color: 'var(--fg-3)', marginTop: 6 }}>
              Required on every expense — invoice, quote or a photo of the bill.
              PDF, JPG or PNG, up to 10 MB.
            </div>
          )}
        </>
      ) : (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10, padding: 10,
          border: '1px solid var(--line-strong)', borderRadius: 6, background: 'var(--bg-elev)',
        }}>
          {preview
            ? <img src={preview} alt="Invoice preview"
                style={{ width: 46, height: 46, objectFit: 'cover', borderRadius: 4, flexShrink: 0 }} />
            : <span style={{ fontSize: 22 }}>📄</span>}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12, color: 'var(--fg)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {value!.name}
            </div>
            <div style={{ fontSize: 11, color: 'var(--fg-3)' }}>
              {(value!.size / 1024 / 1024).toFixed(2)} MB
            </div>
          </div>
          <button type="button" onClick={() => onChange(null)} style={LINK_BTN}>Change</button>
        </div>
      )}

      {tooBig && (
        <div style={{ ...ERR, marginTop: 8 }}>
          That file is over 10 MB. Take the photo again at a lower resolution, or attach the PDF.
        </div>
      )}
    </div>
  );
}

// ── Invoice attachment (on an existing row) ──────────────────────

/** Upload / view / remove the invoice on one expense line. Mirrors the quotation
 *  PDF manager, which is also where the file-type checks come from. */
function InvoiceCell({ expenseId, hasInvoice, fileName, canManage }: {
  expenseId: number; hasInvoice: boolean; fileName: string | null; canManage: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr]   = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const url = `/api/risansi/exhibitions/expenses/${expenseId}/invoice`;

  async function upload(file: File) {
    setBusy(true); setErr('');
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch(url, { method: 'POST', body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setErr(data?.error ?? 'Upload failed.'); return; }
      router.refresh();
    } catch { setErr('Upload failed.'); }
    finally { setBusy(false); if (inputRef.current) inputRef.current.value = ''; }
  }

  async function remove() {
    setBusy(true); setErr('');
    try {
      const res = await fetch(url, { method: 'DELETE' });
      if (!res.ok) { setErr('Could not remove.'); return; }
      router.refresh();
    } catch { setErr('Could not remove.'); }
    finally { setBusy(false); }
  }

  if (err) return <span style={{ fontSize: 11, color: 'var(--neg)' }}>{err}</span>;
  if (busy) return <span style={{ fontSize: 11, color: 'var(--fg-3)' }}>Working…</span>;

  if (hasInvoice) {
    return (
      <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
        <a href={url} target="_blank" rel="noopener noreferrer"
           style={{ fontSize: 12, color: 'var(--accent)' }}
           title={fileName ?? undefined}>📎 View</a>
        {canManage && <button onClick={remove} style={LINK_BTN}>Remove</button>}
      </span>
    );
  }
  if (!canManage) return <span style={{ fontSize: 11, color: 'var(--fg-3)' }}>—</span>;
  return (
    <>
      <input ref={inputRef} type="file" accept=".pdf,.jpg,.jpeg,.png" style={{ display: 'none' }}
        onChange={e => { const f = e.target.files?.[0]; if (f) upload(f); }} />
      <button onClick={() => inputRef.current?.click()} style={LINK_BTN}>Attach</button>
    </>
  );
}

// ── Bits ─────────────────────────────────────────────────────────

function Chip({ status }: { status: ExhibitionStatus }) {
  const t = STATUS_TONE[status] ?? { bg: 'var(--bg-elev)', fg: 'var(--fg-2)' };
  return <span style={{ padding: '3px 10px', borderRadius: 999, fontSize: 11, fontWeight: 600, background: t.bg, color: t.fg }}>{status}</span>;
}
function Pill({ children, tone }: { children: React.ReactNode; tone?: 'warn' }) {
  return <span style={{ padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: tone ? 600 : 400,
    background: tone === 'warn' ? 'var(--warn-soft)' : 'var(--bg-elev)',
    color: tone === 'warn' ? 'var(--warn-strong, var(--warn))' : 'var(--fg-2)' }}>{children}</span>;
}
function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div style={{ ...PANEL, padding: '12px 14px' }}>
      <div style={{ fontSize: 10, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</div>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 20, marginTop: 4 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: 'var(--fg-3)', marginTop: 2 }}>{sub}</div>}
    </div>
  );
}
function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ ...PANEL, padding: 16 }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--title)', marginBottom: 10 }}>{title}</div>
      {children}
    </div>
  );
}
function Detail({ k, v, link }: { k: string; v: string | null; link?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '4px 0', fontSize: 12 }}>
      <span style={{ color: 'var(--fg-3)' }}>{k}</span>
      <span style={{ color: 'var(--fg-2)', textAlign: 'right', wordBreak: 'break-word' }}>
        {v
          ? (link && /^https?:\/\//i.test(v)
              ? <a href={v} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)' }}>{v}</a>
              : v)
          : '—'}
      </span>
    </div>
  );
}
function K({ children }: { children: React.ReactNode }) {
  return <span style={{ color: 'var(--fg-3)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', marginRight: 6 }}>{children}</span>;
}
function Blank({ children }: { children: React.ReactNode }) {
  return <div style={{ padding: 30, textAlign: 'center', fontSize: 13, color: 'var(--fg-3)' }}>{children}</div>;
}
function Two({ children }: { children: React.ReactNode }) {
  // exh-2col collapses to a single column under 767px (app/mobile.css).
  return <div className="exh-2col" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>{children}</div>;
}
function F({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label style={LABEL}>{label}</label>
      {children}
      {hint && <p style={{ fontSize: 11, color: 'var(--fg-3)', marginTop: 3 }}>{hint}</p>}
    </div>
  );
}

// ── Styles ───────────────────────────────────────────────────────

const PANEL: CSSProperties = { background: 'var(--bg-paper)', border: '1px solid var(--line)', borderRadius: 8, overflow: 'hidden' };
const ROW: CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, padding: '10px 14px', borderTop: '1px solid var(--line)' };
const TH: CSSProperties = { padding: '9px 12px', textAlign: 'left', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 500, color: 'var(--fg-3)', borderBottom: '1px solid var(--line)', whiteSpace: 'nowrap' };
const TD: CSSProperties = { padding: '10px 12px', verticalAlign: 'top' };
const INPUT: CSSProperties = { width: '100%', padding: '8px 10px', border: '1px solid var(--line-strong)', borderRadius: 6, fontSize: 13, background: 'var(--bg-paper)', color: 'var(--fg)', boxSizing: 'border-box', fontFamily: 'inherit' };
const LABEL: CSSProperties = { fontSize: 11, fontWeight: 600, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '0.06em', display: 'block', marginBottom: 5 };
const BTN_PRIMARY: CSSProperties = { padding: '8px 16px', borderRadius: 6, background: 'var(--accent-fill)', color: 'var(--on-accent)', border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 500, fontFamily: 'inherit' };
const BTN_GHOST: CSSProperties = { padding: '8px 16px', borderRadius: 6, border: '1px solid var(--line-strong)', background: 'var(--bg-paper)', color: 'var(--fg-2)', cursor: 'pointer', fontSize: 13, fontFamily: 'inherit' };
const BTN_DANGER: CSSProperties = { padding: '8px 16px', borderRadius: 6, background: 'var(--neg-fill)', color: 'var(--on-accent)', border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 500, fontFamily: 'inherit' };
const PICK_BTN: CSSProperties = { padding: '8px 14px', borderRadius: 6, border: '1px solid var(--line-strong)', background: 'var(--bg-paper)', color: 'var(--fg-2)', cursor: 'pointer', fontSize: 13, fontFamily: 'inherit' };
const LINK_BTN: CSSProperties = { background: 'none', border: 'none', padding: 0, color: 'var(--accent)', cursor: 'pointer', fontSize: 12, fontFamily: 'inherit', textDecoration: 'underline' };
const ERR: CSSProperties = { padding: '8px 12px', background: 'var(--neg-soft)', border: '1px solid var(--neg)', borderLeft: '3px solid var(--neg)', borderRadius: 5, color: 'var(--neg-strong)', fontSize: 12 };
/** ERR's shape in the warn tones: a save that worked but took something with it. */
const NOTICE: CSSProperties = { padding: '8px 12px', background: 'var(--warn-soft)', border: '1px solid var(--warn)', borderLeft: '3px solid var(--warn)', borderRadius: 5, color: 'var(--warn-strong)', fontSize: 12 };
const FLAG_KNOWN: CSSProperties = { padding: '2px 9px', borderRadius: 999, fontSize: 11, fontWeight: 600, background: 'var(--pos-soft)', color: 'var(--pos-strong)' };
const FLAG_NEW: CSSProperties = { padding: '2px 9px', borderRadius: 999, fontSize: 11, background: 'var(--bg-elev)', color: 'var(--fg-3)' };
