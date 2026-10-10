import { notFound, redirect } from 'next/navigation';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import risansiPool from '@/lib/db-risansi';
import { getCurrentUser, clientScopeSql, canViewClient, canEditVisitReport, whyCannotWorkClient, hasRole, OWN_OPEN } from '@/lib/risansi-auth';
import { Topbar } from '@/components/risansi';
import Link from 'next/link';
import { VisitReportForm } from '@/components/risansi/VisitReportForm';
import { withinVisitEditWindow, visitEditDaysLeft } from '@/lib/risansi-visit-edit-window';
import { prefillVisitFromPrevious } from '@/lib/risansi-visit-prefill';

async function q<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try { return await fn(); } catch { return fallback; }
}

export default async function VisitReportPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) redirect('/api/auth/signin');

  const visitRes = await risansiPool.query<{
    id: string; client_id: string; rep_id: string | null;
    visit_date: string; is_planned: boolean | null;
    is_unplanned: boolean | null; unplanned_reason: string | null;
    check_in_time: string | null; check_in_lat: number | null;
    check_in_lng: number | null; check_in_accuracy_m: number | null;
    gps_within_radius: boolean | null;
    manual_checkin: boolean | null; manual_checkin_note: string | null;
    check_out_time: string | null;
    purpose: string | null; outcome: string | null;
    summary: string | null; industry_format: string | null;
    competitor_activity_observed: boolean | null;
    sample_or_gift_given: boolean | null;
    sample_gift_detail: string | null; sample_gift_value: number | null;
    follow_up_required: boolean | null; follow_up_text: string | null;
    follow_up_due_date: string | null;
    next_visit_recommendation: string | null;
    status: string; submitted_at: string | null;
    performance_feedback: string | null; pcp_competitor: string | null;
    mgmt_intervention: string | null; action_points: string | null;
    complaint_notes: string | null; competitors_observed: string | null;
    open_remarks: string | null; major_remarks: string | null;
    ice_dispersal_by: string | null; negotiation_by: string | null;
    // Joined client fields
    legal_name: string; code: string; industry: string | null;
    is_sugar: boolean; city: string | null; state: string | null;
    tier: string | null; rep_name: string; rep_email: string | null;
    // Client profile edited on the Client Type page (persists to the client)
    client_type: string | null; focus_industries: string[] | null;
    avg_annual_pump_req: number | null; ongoing_tenders: number | null;
    upcoming_tenders: boolean | null; upcoming_tenders_details: string | null;
    pcp_suppliers: string | null; tcd: number | null;
  }>(
    `SELECT v.*,
       c.legal_name, c.code, c.industry, c.is_sugar,
       c.city, c.state, c.tier,
       c.client_type, c.focus_industries, c.avg_annual_pump_req,
       c.ongoing_tenders, c.upcoming_tenders, c.upcoming_tenders_details, c.pcp_suppliers, c.tcd,
       COALESCE(r.name, '—') AS rep_name,
       r.email AS rep_email
     FROM visits v
     JOIN clients c ON v.client_id = c.id
     LEFT JOIN users r ON v.rep_id = r.id
     WHERE v.id = $1`,
    [id],
  );

  const visit = visitRes.rows[0];
  if (!visit) notFound();

  // Visibility guard — viewer must be able to SEE this visit (own / shared tour),
  // or be admin/sysadmin. ownerVisibilitySql returns null for admin (no restriction).
  // Fallback: anyone who can SEE the client (Client 360) may read its visit
  // reports too, so the Client-360 visit timeline links always open (read-only).
  const viewer  = await getCurrentUser();
  const ownPred = clientScopeSql(viewer, 'v.client_id', OWN_OPEN.visit('v'));
  if (ownPred) {
    const { rows: visRows } = await risansiPool.query<{ ok: boolean }>(
      `SELECT (${ownPred}) AS ok FROM visits v WHERE v.id = $1`,
      [id],
    );
    if (!visRows[0]?.ok && !(await canViewClient(viewer, Number(visit.client_id)))) notFound();
  }

  // Ownership: only the assigned rep may fill / edit / submit this visit.
  // Everyone else (other reps, managers, admins) gets read-only VIEW access.
  const isSubmitted = !!visit.submitted_at;
  let myRepId: number | null = session.user.repId ?? null;
  if (myRepId == null && session.user.email) {
    const repRes = await risansiPool.query<{ id: number }>(
      'SELECT id FROM users WHERE lower(email) = lower($1) LIMIT 1',
      [session.user.email],
    );
    myRepId = repRes.rows[0]?.id ?? null;
  }
  // A submitted report is "Closed" but re-openable for the window by anyone
  // authorised to edit it — the assigned rep, a manager above them, or an
  // admin/sysadmin — not the rep alone.
  const visitRepId  = visit.rep_id != null ? Number(visit.rep_id) : null;
  const canEditVisit = await canEditVisitReport({ role: session.user.role ?? null, repId: myRepId }, visitRepId, Number(visit.client_id));
  // The visit is theirs and still they cannot work it: the client is not.
  // Blocked, in words, until an admin assigns the client.
  const blocked = !canEditVisit && !hasRole(session.user.role, 'admin') && visitRepId != null && myRepId != null && visitRepId === myRepId
    ? await whyCannotWorkClient(viewer, Number(visit.client_id))
    : null;

  // Seed a fresh, editable visit's competitor equipment + sugar/non-sugar pump
  // counts from the client's last submitted visit (runs once; won't clobber). The
  // RIL installed base already persists via client_pumps.
  if (canEditVisit && !isSubmitted) {
    await prefillVisitFromPrevious(Number(id), Number(visit.client_id));
  }

  const [contacts, equipment, sugarRes, nonsugarRes, oppsRes, tasksRes, reps, expansionOppRow] = await Promise.all([
    q(async () => {
      const { rows } = await risansiPool.query<{
        id: number; name: string; designation: string | null;
        phone: string | null; is_primary: boolean;
        email: string | null; whatsapp: string | null; notes: string | null;
      }>(
        `SELECT id, name, designation, phone, is_primary, email, whatsapp, notes
         FROM contacts WHERE client_id = $1
         ORDER BY is_primary DESC, name ASC`,
        [visit.client_id],
      );
      return rows;
    }, []),

    q(async () => {
      const { rows } = await risansiPool.query(
        `SELECT * FROM equipment
         WHERE client_id = $1 AND visit_id = $2
         ORDER BY is_ril DESC, created_at ASC`,
        [visit.client_id, id],
      );
      return rows;
    }, []),

    q(async () => {
      const { rows } = await risansiPool.query(
        'SELECT * FROM visit_sugar_report WHERE visit_id = $1 LIMIT 1',
        [id],
      );
      return rows;
    }, []),

    q(async () => {
      const { rows } = await risansiPool.query(
        'SELECT * FROM visit_nonsugar_report WHERE visit_id = $1 LIMIT 1',
        [id],
      );
      return rows;
    }, []),

    q(async () => {
      const { rows } = await risansiPool.query(
        'SELECT * FROM opportunities WHERE visit_id = $1 ORDER BY created_at ASC',
        [id],
      );
      return rows;
    }, []),

    q(async () => {
      const { rows } = await risansiPool.query(
        `SELECT t.*, r.name AS assigned_rep_name
         FROM tasks t
         LEFT JOIN users r ON t.assigned_to_rep = r.id
         WHERE t.visit_id = $1
         ORDER BY
           CASE WHEN t.status = 'completed' THEN 1 ELSE 0 END,
           t.due_date ASC NULLS LAST`,
        [id],
      );
      return rows;
    }, []),

    q(async () => {
      const { rows } = await risansiPool.query(
        `SELECT id, name, zone FROM users WHERE is_active = TRUE ORDER BY name ASC`,
      );
      return rows;
    }, []),

    q(async () => {
      const { rows } = await risansiPool.query(
        `SELECT id, product, product_type, stage, value_cr, probability, probability_code, eta_text, quote_ref, notes,
                tsm_user_id, tsm_external, tsm_external_email
         FROM opportunities
         WHERE visit_id = $1 AND auto_source = 'expansion_plan'
         ORDER BY created_at DESC LIMIT 1`,
        [id],
      );
      return rows[0] ?? null;
    }, null),
  ]);

  // Industry taxonomy for the Client Type page's "focus industries" multiselect
  // (reuses the same values as the client Industry field).
  const industryOptions = await q(async () => {
    const { rows } = await risansiPool.query<{ industry: string }>(
      `SELECT DISTINCT industry FROM clients WHERE industry IS NOT NULL AND industry <> '' AND deleted_at IS NULL ORDER BY industry`,
    );
    return rows.map(r => r.industry);
  }, []);

  // Drives the whole form's read-only state. A submitted report stays
  // correctable for VISIT_EDIT_WINDOW_DAYS so a rep can fix a mistake; after
  // that it locks for good. VisitReportForm disables every field, the auto-save
  // triggers, and the inline add-buttons off this single flag.
  const inEditWindow = withinVisitEditWindow(visit.submitted_at);
  const daysLeft     = visitEditDaysLeft(visit.submitted_at);
  // A closed report can be re-opened only by an authorised person, and only
  // while still inside the window (measured from the first closed date).
  const canReopen    = isSubmitted && canEditVisit && inEditWindow;
  const closedDate   = visit.submitted_at
    ? new Date(visit.submitted_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
    : null;
  const isSugar  = visit.industry_format === 'sugar' || (!visit.industry_format && visit.is_sugar);

  const visitDate = new Date(visit.visit_date).toLocaleDateString('en-IN', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ position: 'sticky', top: 0, zIndex: 10 }}>
        <Topbar crumbs={['Field Activity', { label: visit.legal_name, href: `/risansi/clients/${visit.code}` }, 'Visit Report']} />
      </div>

      <div style={{ flex: 1, overflowY: 'auto', background: 'var(--bg)' }}>
        <div style={{ maxWidth: 1180, margin: '0 auto', padding: '24px 24px 60px' }}>

          {/* Header */}
          <div style={{
            display: 'flex', justifyContent: 'space-between',
            alignItems: 'flex-start', marginBottom: 24,
          }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4, flexWrap: 'wrap' }}>
                <Link
                  href={`/risansi/clients/${visit.code}`}
                  style={{ fontSize: 20, fontWeight: 700, color: 'var(--fg)', textDecoration: 'none' }}
                >
                  {visit.legal_name}
                </Link>
                <StatusBadge status={visit.status} />
                {isSubmitted && (
                  <span style={{
                    fontSize: 11, padding: '2px 8px', borderRadius: 10,
                    background: '#F3F4F6', color: '#6B7280', fontWeight: 600,
                  }}>
                    🔒 Closed
                  </span>
                )}
              </div>
              <div style={{ fontSize: 13, color: 'var(--fg-3)' }}>
                {visit.rep_name} · {visitDate}
                {visit.purpose && ` · ${visit.purpose}`}
              </div>
              <div style={{ fontSize: 11, color: 'var(--fg-3)', marginTop: 4 }}>
                {visit.code} · {visit.city ?? ''}{visit.city && visit.industry ? ' · ' : ''}{visit.industry ?? ''}
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
              {isSubmitted && (
                <a
                  href={`/print/visit/${id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 6,
                    padding: '8px 14px', fontSize: 13, fontWeight: 600,
                    background: 'var(--accent-soft)', color: 'var(--title)',
                    border: '1px solid var(--accent-line)', borderRadius: 6, textDecoration: 'none',
                  }}
                >
                  🖨 Export PDF
                </a>
              )}
              {/* Submit moved into the wizard's final step (VisitReportForm) */}
            </div>
          </div>

          {/* View-only notice — a draft you're not allowed to fill. The
              closed / re-open banner lives inside the form (it owns re-open state). */}
          {blocked ? (
            <div style={{
              padding: '12px 16px', marginBottom: 16,
              background: 'var(--neg-soft)', border: '1px solid var(--neg)',
              borderRadius: 8, fontSize: 13, color: 'var(--neg-strong, var(--neg))',
              fontWeight: 600, display: 'flex', alignItems: 'flex-start', gap: 10,
            }}>
              <span aria-hidden style={{ fontSize: 15, lineHeight: 1 }}>⛔</span>
              <span style={{ lineHeight: 1.5 }}>
                {blocked}
                <span style={{ display: 'block', fontWeight: 400, marginTop: 2, color: 'var(--fg-2)' }}>
                  This visit is assigned to you, but the client is not. Nothing here can be filled in or submitted until an admin assigns the client to you on Reps &amp; Managers.
                </span>
              </span>
            </div>
          ) : !isSubmitted && !canEditVisit && (
            <div style={{
              padding: '10px 16px', marginBottom: 16,
              background: 'var(--warn-soft)',
              border: '1px solid var(--warn, rgba(217,119,6,0.35))',
              borderRadius: 8, fontSize: 12, color: 'var(--warn)',
              fontWeight: 500, display: 'flex', alignItems: 'center', gap: 8,
            }}>
              <span aria-hidden>👁</span>
              <span>
                View only — this visit is assigned to <strong>{visit.rep_name}</strong>.
              </span>
            </div>
          )}

          {/* Main form */}
          <VisitReportForm
            visit={visit}
            contacts={contacts}
            equipment={equipment}
            sugarReport={sugarRes[0] ?? null}
            nonsugarReport={nonsugarRes[0] ?? null}
            opportunities={oppsRes}
            tasks={tasksRes}
            reps={reps}
            expansionOpp={expansionOppRow}
            isSubmitted={isSubmitted}
            canEditVisit={canEditVisit}
            canReopen={canReopen}
            closedDate={closedDate}
            daysLeft={daysLeft}
            isSugar={isSugar}
            industries={industryOptions}
          />

        </div>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { bg: string; color: string }> = {
    planned:    { bg: '#E0E7FF', color: '#3730A3' },
    'checked-in': { bg: 'var(--info-soft)', color: 'var(--info-strong)' },
    completed:  { bg: 'var(--pos-soft)', color: 'var(--pos-strong)' },
    missed:     { bg: 'var(--neg-soft)', color: 'var(--neg-strong)' },
    cancelled:  { bg: 'var(--bg-elev)', color: 'var(--fg-3)' },
  };
  const s = map[status] ?? { bg: 'var(--bg-elev)', color: 'var(--fg-3)' };
  return (
    <span style={{
      fontSize: 11, padding: '2px 8px', borderRadius: 10,
      background: s.bg, color: s.color, fontWeight: 600,
      textTransform: 'capitalize',
    }}>
      {status.replace('-', ' ')}
    </span>
  );
}
