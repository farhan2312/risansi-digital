import { notFound } from 'next/navigation';
import { Topbar } from '@/components/risansi';
import risansiPool from '@/lib/db-risansi';
import { getCurrentUser } from '@/lib/risansi-auth';
import { canManageExhibition, canViewExhibition, closeReadiness } from '@/app/actions/risansi-exhibitions';
import { ExhibitionDetail } from '@/components/risansi/ExhibitionDetail';
import type {
  ExhibitionFull, TeamMember, ApprovalRow, MeetingContactRow, ExpenseRow, ReviewRow,
} from '@/components/risansi/ExhibitionDetail';
import type { ReviewMeeting } from '@/components/risansi/ExhibitionReview';
import type { UserOpt } from '@/components/risansi/ExhibitionsClient';

export const dynamic = 'force-dynamic';

async function q<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try { return await fn(); } catch (err) { console.error('[exhibition/detail]', err); return fallback; }
}

export default async function ExhibitionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: raw } = await params;
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) notFound();

  const me = await getCurrentUser();
  // Seeing an exhibition is not the default. Team, proposer, approver, admin —
  // anyone else gets the same answer as a URL that does not exist, rather than a
  // "forbidden" that confirms it does.
  if (!(await canViewExhibition(id))) notFound();

  const [exhibition, team, meetings, meetingContacts, approvals, expenses, review, users, canManage, blockers] = await Promise.all([
    q<ExhibitionFull | null>(async () => {
      const { rows } = await risansiPool.query<ExhibitionFull>(`
        SELECT e.id, e.name, e.organizer, e.website, e.venue, e.city, e.state, e.country,
               e.industry, e.source,
               e.start_date::text AS start_date, e.end_date::text AS end_date,
               -- The days Risansi is there, which may be only part of the run.
               -- Falls back to the run itself for anything created before the
               -- column existed, so no page has to special-case a null.
               COALESCE(e.attend_from, e.start_date)::text AS attend_from,
               COALESCE(e.attend_to, e.end_date, e.start_date)::text AS attend_to,
               e.status, e.participation, e.suggested,
               e.estimated_cost_inr::float8 AS estimated_cost_inr, e.recommendation,
               e.approver_id, ap.name AS approver_name,
               e.submitted_by, sb.name AS submitted_by_name, e.submitted_at::text AS submitted_at,
               e.decided_by, db.name AS decided_by_name, e.decided_at::text AS decided_at,
               e.decision_notes, e.created_by, e.created_by_name,
               e.expenses_reviewed_at::text AS expenses_reviewed_at,
               e.closed_at::text AS closed_at, cb.name AS closed_by_name,
               e.created_at::text AS created_at
          FROM exhibitions e
          LEFT JOIN users ap ON ap.id = e.approver_id
          LEFT JOIN users sb ON sb.id = e.submitted_by
          LEFT JOIN users db ON db.id = e.decided_by
          LEFT JOIN users cb ON cb.id = e.closed_by
         WHERE e.id = $1`, [id]);
      return rows[0] ?? null;
    }, null),

    q<TeamMember[]>(async () => {
      const { rows } = await risansiPool.query<TeamMember>(
        `SELECT t.id, t.user_id, u.name, u.role AS user_role, t.team_role,
                COALESCE((SELECT array_agg(d.day::text ORDER BY d.day)
                            FROM exhibition_team_days d WHERE d.team_id = t.id), '{}') AS days
           FROM exhibition_team t JOIN users u ON u.id = t.user_id
          WHERE t.exhibition_id = $1
          ORDER BY (t.team_role <> 'Team Lead'), u.name`, [id]);
      return rows;
    }, []),

    // The lookup surfaces here: client_id != NULL means the company was matched
    // to an existing client, and we join through for its code so the badge can
    // show which record it is. LEFT JOIN — an unmatched meeting is normal.
    q<ReviewMeeting[]>(async () => {
      const { rows } = await risansiPool.query<ReviewMeeting>(
        `SELECT m.id, m.client_id, m.company_name, m.contact_person, m.designation,
                m.phone, m.email, m.city, m.discussion, m.requirement, m.outcome,
                m.next_action, m.follow_up_date::text AS follow_up_date, m.interest,
                m.potential_value_inr::float8 AS potential_value_inr,
                m.met_by, m.met_by_name, m.met_on::text AS met_on,
                c.code AS client_code, c.legal_name AS client_legal_name, c.status AS client_status,
                m.follow_up_type, m.follow_up_owner_id, fo.name AS follow_up_owner_name,
                m.follow_up_note, m.linked_visit_id, m.linked_task_id, m.linked_opportunity_id,
                m.high_potential, m.lead_client_id, lc.code AS lead_client_code,
                m.lead_opportunity_id, m.lead_skipped_reason
           FROM exhibition_meetings m
           LEFT JOIN clients c ON c.id = m.client_id
           LEFT JOIN clients lc ON lc.id = m.lead_client_id
           LEFT JOIN users fo ON fo.id = m.follow_up_owner_id
          WHERE m.exhibition_id = $1
          ORDER BY m.met_on DESC NULLS LAST, m.id DESC`, [id]);
      return rows;
    }, []),

    // Everybody met, grouped by meeting (migration 0120). Its own query with
    // its own fallback on purpose: folded into the meetings query above, one
    // failure would empty the meeting list itself, and a meeting with no
    // contacts still reads perfectly well off its own four columns.
    q<Map<number, MeetingContactRow[]>>(async () => {
      const { rows } = await risansiPool.query<MeetingContactRow & { meeting_id: number }>(
        `SELECT c.id, c.meeting_id, c.name, c.designation, c.phone, c.email
           FROM exhibition_meeting_contacts c
           JOIN exhibition_meetings m ON m.id = c.meeting_id
          WHERE m.exhibition_id = $1
          ORDER BY c.meeting_id, c.sort_order, c.id`, [id]);
      const byMeeting = new Map<number, MeetingContactRow[]>();
      for (const r of rows) {
        const list = byMeeting.get(r.meeting_id) ?? [];
        list.push({ id: r.id, name: r.name, designation: r.designation, phone: r.phone, email: r.email });
        byMeeting.set(r.meeting_id, list);
      }
      return byMeeting;
    }, new Map()),

    // Scoped to this one exhibition, so its team and approver can see the trail
    // without being handed the sysadmin-only Audit Log page (which also carries
    // logins, usage and ownership changes). The module-wide feed lives there.
    q<ApprovalRow[]>(async () => {
      const { rows } = await risansiPool.query<ApprovalRow>(
        `SELECT id, decision, actor_name, comments, created_at::text AS created_at
           FROM exhibition_approvals WHERE exhibition_id = $1
          ORDER BY created_at DESC, id DESC`, [id]);
      return rows;
    }, []),

    q<ExpenseRow[]>(async () => {
      const { rows } = await risansiPool.query<ExpenseRow>(
        `SELECT x.id, x.category, x.description, x.vendor,
                x.estimated_inr::float8 AS estimated_inr,
                x.actual_inr::float8 AS actual_inr,
                x.paid_inr::float8 AS paid_inr,
                x.paid_on::text AS paid_on,
                (f.expense_id IS NOT NULL) AS has_invoice, f.file_name
           FROM exhibition_expenses x
           LEFT JOIN exhibition_expense_files f ON f.expense_id = x.id
          WHERE x.exhibition_id = $1
          ORDER BY x.category, x.id`, [id]);
      return rows;
    }, []),

    q<ReviewRow | null>(async () => {
      const { rows } = await risansiPool.query<ReviewRow>(
        `SELECT exhibition_id, new_leads, opportunities,
                potential_value_inr::float8 AS potential_value_inr,
                business_won_inr::float8 AS business_won_inr, footfall,
                what_worked, what_did_not, key_learnings, competitor_notes,
                attend_next_year, next_year_notes, reviewed_by_name,
                reviewed_at::text AS reviewed_at
           FROM exhibition_reviews WHERE exhibition_id = $1`, [id]);
      return rows[0] ?? null;
    }, null),

    q<UserOpt[]>(async () => {
      const { rows } = await risansiPool.query<UserOpt>(
        `SELECT id, name, role FROM users
          WHERE is_active = TRUE AND status = 'Approved' ORDER BY name`);
      return rows;
    }, []),

    canManageExhibition(id).catch(() => false),

    closeReadiness(id).catch(() => ['Could not check readiness']),
  ]);

  if (!exhibition) notFound();

  const meetingsWithContacts: ReviewMeeting[] =
    meetings.map(m => ({ ...m, contacts: meetingContacts.get(m.id) ?? [] }));

  const isOwner = me.role === 'sysadmin' ||
    (exhibition.created_by != null && me.id != null && Number(exhibition.created_by) === Number(me.id));

  const isApprover =
    me.role === 'sysadmin' ||
    (exhibition.approver_id != null && me.id != null && Number(exhibition.approver_id) === Number(me.id));

  return (
    <>
      <Topbar crumbs={[{ label: 'Exhibitions', href: '/risansi/exhibitions' }, exhibition.name]} />
      <ExhibitionDetail
        exhibition={exhibition}
        team={team}
        meetings={meetingsWithContacts}
        approvals={approvals}
        expenses={expenses}
        review={review}
        users={users}
        canManage={canManage}
        isApprover={isApprover}
        isOwner={isOwner}
        isSysadmin={me.role === 'sysadmin'}
        blockers={blockers}
      />
    </>
  );
}
