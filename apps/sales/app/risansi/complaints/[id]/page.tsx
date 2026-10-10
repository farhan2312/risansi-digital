import type { CSSProperties } from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Topbar } from '@/components/risansi';
import risansiPool from '@/lib/db-risansi';
import { getCurrentUser, canAccessComplaint, canViewClient, hasRole } from '@/lib/risansi-auth';
import {
  PAGES, pageStep, pageBySlug, NEXT, canEditPage, canMove, gateFor, dwells, dwellByHolder, isOpenStatus,
  isImmediateResponse, IMMEDIATE_RISK_FIELDS,
  SEVERITY_LABEL, SEVERITY_TONE, SEVERITY_REQUIRES, STATUS_TONE, missingOnPage,
  type ComplaintStatus, type ComplaintValues, type Severity,
} from '@/lib/risansi-complaint-flow';
import { ComplaintPageForm, type UserOpt, type OemOpt } from '@/components/risansi/complaints/ComplaintPageForm';
import type { ComplaintPartRow } from '@/components/risansi/complaints/ComplaintPartsEditor';
import { ComplaintTimeline, ComplaintLifecycle } from '@/components/risansi/complaints/ComplaintTimeline';
import { ComplaintMoveBar } from '@/components/risansi/complaints/ComplaintMoveBar';
import { ComplaintAttachments, type AttachmentMeta } from '@/components/risansi/complaints/ComplaintAttachments';
import { ComplaintNotes, type NoteRow } from '@/components/risansi/complaints/ComplaintNotes';

// Every date field of the form, re-selected as text after `c.*`.
//
// A `date` column comes back from pg as a JS Date, and serialising that to the
// client shifts it by the server's offset: 25 Aug became "2026-08-24T20:00:00Z",
// which the form's date input either showed as the 24th or refused outright,
// so the field looked blank and had to be typed again on every save. Selected
// again as text (last wins), each is a plain YYYY-MM-DD.
const DATE_FIELDS = PAGES.flatMap(p => p.fields.filter(f => f.type === 'date').map(f => f.name));

export const dynamic = 'force-dynamic';

// One complaint, end to end.
//
// The top answers "where is it and how long has it been there" before anything
// else: the seven-status timeline with days under each, the severity, who is
// holding it now. Below that the eight pages of the specification as tabs,
// each drawn from the catalogue and editable by whoever owns it, then the
// lifecycle — every stretch, every holder — and the files. A legacy record
// (schema_version 1) renders the same page read-only, with a three-step strip.

const day = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');

export default async function ComplaintPage({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id: idStr } = await params;
  const id = Number(idStr);
  if (!Number.isInteger(id)) notFound();
  const sp = await searchParams;

  const user = await getCurrentUser();
  if (!user.email || !(await canAccessComplaint(user, id))) notFound();

  const [{ rows: [c] }, { rows: userRows }, { rows: lookupRows }, { rows: cascadeRows }, { rows: oems }, { rows: partRows }, { rows: logRows }, { rows: files }, { rows: notes }] = await Promise.all([
    risansiPool.query<ComplaintValues & {
      id: number; complaint_no: string; status: string; schema_version: number; client_id: number | null;
      client_name: string | null; client_code: string | null; rep_name: string | null; reporter_name: string | null;
      inv_name: string | null; act_name: string | null; ret_name: string | null; severity: Severity | null;
      created_at: string; legacy_ref: string | null; assigned_name: string | null; assigned_to_external: string | null;
    }>(`
      SELECT c.*, ${DATE_FIELDS.map(f => `c.${f}::text AS ${f}`).join(', ')},
             cl.legal_name AS client_name, cl.code AS client_code,
             ur.name AS rep_name, rp.name AS reporter_name, iu.name AS inv_name, au.name AS act_name, ru.name AS ret_name,
             ol.name AS assigned_name, c.created_at::text AS created_at
        FROM complaints c
        LEFT JOIN clients cl ON cl.id = c.client_id
        -- The rep shown is the client's owner — one owner per client, and the
        -- complaint is attributed to them (lib/risansi-attribution.ts).
        -- c.rep_user_id stands in only where the complaint has no client.
        LEFT JOIN users ur ON ur.id = COALESCE(cl.primary_rep_id, c.rep_user_id)
        LEFT JOIN users rp ON rp.id = c.reported_by_user
        LEFT JOIN users iu ON iu.id = c.investigation_assigned_to
        LEFT JOIN users au ON au.id = c.action_assigned_to
        LEFT JOIN users ru ON ru.id = c.returnable_owner
        LEFT JOIN users ol ON ol.id = c.assigned_to_user
       WHERE c.id = $1`, [id]),
    risansiPool.query<UserOpt>(`
      SELECT u.id, u.name, u.role,
             ARRAY(SELECT d.department FROM user_departments d WHERE d.user_id = u.id ORDER BY 1) AS departments
        FROM users u WHERE u.is_active ORDER BY u.name`),
    // The flat lists. `parent_value IS NULL` is not decoration: without it
    // `part_name` comes back with Shaft in it twice — once under External, once
    // under Child Parts of Joints — and a flat map cannot say which is which.
    risansiPool.query<{ kind: string; value: string }>(
      'SELECT kind, value FROM complaint_lookups WHERE is_active AND parent_value IS NULL ORDER BY kind, sort_order, value'),
    // The cascading lists, grouped by the parent choice they hang under: the
    // sub-category under the category, the part name under the part type, the
    // root cause under the root cause category.
    risansiPool.query<{ kind: string; parent_value: string; value: string }>(`
      SELECT kind, parent_value, value FROM complaint_lookups
       WHERE is_active AND parent_value IS NOT NULL
       ORDER BY kind, parent_value, sort_order, value`),
    risansiPool.query<OemOpt>(`
      SELECT id, legal_name AS name, code
        FROM clients WHERE client_type = 'OEM' AND deleted_at IS NULL ORDER BY legal_name`),
    // The parts this complaint is about. `quantity` is numeric and the two
    // dates are `date`, so all three are cast to text before they reach the
    // editor — a Date serialised to a client component loses a day in IST.
    risansiPool.query<ComplaintPartRow>(`
      SELECT id, sort_order, part_type, part_name, quantity::text AS quantity, moc, vendor_name,
             mfg_date::text AS mfg_date, part_code, ec_no, ec_date::text AS ec_date, liquid, head, capacity
        FROM complaint_parts WHERE complaint_id = $1 ORDER BY sort_order, id`, [id]),
    risansiPool.query<{ to_status: string; holder_department: string | null; holder_user_id: number | null; holder_name: string | null; created_at: string; note: string | null; actor: string | null; from_status: string | null }>(`
      SELECT l.to_status, l.from_status, l.holder_department, l.holder_user_id, u.name AS holder_name, l.created_at::text AS created_at, l.note,
             COALESCE(a.name, l.actor_email) AS actor
        FROM complaint_stage_log l
        LEFT JOIN users u ON u.id = l.holder_user_id
        LEFT JOIN users a ON lower(a.email) = lower(l.actor_email)
       WHERE l.complaint_id = $1 ORDER BY l.created_at, l.id`, [id]),
    risansiPool.query<AttachmentMeta>(`
      SELECT id, category, file_name, mime_type, byte_size, caption, uploaded_by, uploaded_at::text AS uploaded_at
        FROM complaint_attachments WHERE complaint_id = $1 ORDER BY uploaded_at`, [id]),
    risansiPool.query<NoteRow>(`
      SELECT u.body, u.created_by, u.created_at::text AS created_at, a.name AS author
        FROM complaint_updates u LEFT JOIN users a ON lower(a.email) = lower(u.created_by)
       WHERE u.complaint_id = $1 AND u.body NOT LIKE 'Status changed to %' ORDER BY u.created_at DESC LIMIT 100`, [id]),
  ]);
  if (!c) notFound();

  const lookups: Record<string, string[]> = {};
  for (const r of lookupRows) (lookups[r.kind] ??= []).push(r.value);
  const cascades: Record<string, Record<string, string[]>> = {};
  for (const r of cascadeRows) ((cascades[r.kind] ??= {})[r.parent_value] ??= []).push(r.value);

  const legacy = c.schema_version < 2;
  const worksClient = c.client_id != null && !hasRole(user.role, 'admin') ? await canViewClient(user, c.client_id) : hasRole(user.role, 'admin');
  const access = { ...c, worksClient } as Parameters<typeof canEditPage>[1];
  const editor = { id: user.id, role: user.role, departments: user.departments };
  const mayMove = canMove(editor, access);
  const hasCapa = files.some(f => f.category === 'capa');
  const sev = (c.severity as Severity | null) ?? null;

  const gate: Partial<Record<ComplaintStatus, string[]>> = {};
  for (const to of (NEXT[c.status as ComplaintStatus] ?? [])) gate[to] = gateFor(c.status, to, { values: c, severity: sev, hasCapaDocument: hasCapa });

  const nowIso = new Date().toISOString();
  const life = dwells(logRows, nowIso);
  const holders = dwellByHolder(life);
  const current = life.find(d => d.current);

  const slug = typeof sp.page === 'string' ? sp.page : PAGES[0].slug;
  const page = pageBySlug(slug) ?? PAGES[0];
  const canEditThis = canEditPage(editor, access, page);
  const whyNot = legacy ? 'This is a legacy complaint, recorded before the workflow. It is shown as it was and does not change.'
    : c.status === 'Closed' ? 'This complaint is closed. Reopen it from the move bar if there is more to do.'
    : `${page.title} is edited by ${page.owner}${[4, 5, 7].includes(page.id) ? ', or whoever it is assigned to' : ''}.`;
  const pageHref = (s: string) => `/risansi/complaints/${id}?page=${s}`;
  const canEditFiles = canEditPage(editor, access, PAGES[0]);
  const canEditCapa = canEditPage(editor, access, PAGES[5]);
  const overdueTarget = c.target_completion_date && isOpenStatus(c.status) && String(c.target_completion_date).slice(0, 10) < nowIso.slice(0, 10);
  // Severe / Immediate Response, separate from the S-grade: one Yes among
  // Safety, Shutdown, Penalty or Repeat and this needs looking at today. The
  // department was notified when the answer was given; this is the same fact
  // on the complaint's own page, for whoever opens it afterwards.
  const severe = isImmediateResponse(c as Parameters<typeof isImmediateResponse>[0]);
  const severeWhy = IMMEDIATE_RISK_FIELDS.filter(f => c[f.key] === true).map(f => f.label).join(' · ');
  // Files staged on the registration screen that would not upload. The
  // complaint was still registered; this says which ones to attach again.
  const failedFiles = (typeof sp.files === 'string' ? sp.files : '').slice(0, 600)
    .split('|').map(s => s.trim().slice(0, 120)).filter(Boolean).slice(0, 10);
  // Arrived straight from the lodge window. The number is the thing the person
  // lodging needs back, and the next ask — register it — is not obvious from a
  // page that looks like a form they have already filled in.
  const justLodged = typeof sp.lodged === 'string' && sp.lodged.trim() === c.complaint_no;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ position: 'sticky', top: 0, zIndex: 10 }}>
        <Topbar crumbs={[{ label: 'Complaints', href: '/risansi/complaints' }, c.complaint_no]} />
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: '22px 24px 40px', background: 'var(--bg)' }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, flexWrap: 'wrap', marginBottom: 14 }}>
          <div style={{ flex: 1, minWidth: 300 }}>
            <Link href="/risansi/complaints" style={{ fontSize: 11.5, color: 'var(--fg-3)', textDecoration: 'none' }}>← Complaints</Link>
            <h1 style={{ fontSize: 22, fontWeight: 600, margin: '5px 0 3px', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <span style={{ fontFamily: 'var(--font-mono)' }}>{c.complaint_no}</span>
              <span style={{ ...PILL, background: STATUS_TONE[c.status] ?? 'var(--fg-3)' }}>{c.status}</span>
              {sev && <span style={{ ...PILL, background: SEVERITY_TONE[sev] }} title={SEVERITY_REQUIRES[sev]}>{SEVERITY_LABEL[sev]}</span>}
              {severe && <span style={{ ...PILL, background: 'var(--neg-fill)' }} title={`Immediate response: ${severeWhy}`}>Severe</span>}
              {legacy && <span style={{ ...PILL, background: 'var(--fg-4)' }}>Legacy</span>}
              {c.repeat_complaint === true && <span style={{ ...PILL, background: 'var(--warn)' }}>Repeat</span>}
              {(c.reopen_count as number) > 0 && <span style={{ ...PILL, background: 'var(--warn)' }}>Reopened ×{String(c.reopen_count)}</span>}
            </h1>
            <div style={{ fontSize: 13, color: 'var(--fg)' }}>
              {c.client_id ? <Link href={`/risansi/clients/${c.client_id}`} style={{ color: 'var(--fg)', fontWeight: 600, textDecoration: 'none' }}>{c.client_name}</Link> : 'No client'}
              <span style={{ color: 'var(--fg-3)', fontFamily: 'var(--font-mono)', fontSize: 11, marginLeft: 8 }}>{c.client_code}</span>
            </div>
            <div style={{ fontSize: 12, color: 'var(--fg-3)', marginTop: 4, display: 'flex', gap: 14, flexWrap: 'wrap' }}>
              <span>raised {day(String(c.complaint_date ?? c.created_at))}{c.reporter_name ? ` by ${c.reporter_name}` : ''}</span>
              {c.rep_name && <span>rep {c.rep_name}</span>}
              {/* Category and sub-category where they exist; the complaints
                  raised before the category did still read on Type and Defect
                  Category, so those are the fallback rather than a blank. */}
              {(() => {
                const now = [c.complaint_category, c.complaint_subcategory].filter(Boolean).map(String);
                const was = [c.complaint_type, c.defect_category].filter(Boolean).map(String);
                const show = now.length ? now : was;
                return show.length ? <span>{show.join(' · ')}</span> : null;
              })()}
              {c.responsible_department ? <span>responsible: {String(c.responsible_department)}</span> : null}
              {c.target_completion_date ? <span style={{ color: overdueTarget ? 'var(--neg)' : undefined, fontWeight: overdueTarget ? 600 : 400 }}>target {day(String(c.target_completion_date))}{overdueTarget ? ' · overdue' : ''}</span> : null}
            </div>
            <p style={{ fontSize: 13, color: 'var(--fg-2)', margin: '10px 0 0', maxWidth: 820, lineHeight: 1.55, whiteSpace: 'pre-wrap' }}>{String(c.details ?? '')}</p>
          </div>
          {current && (
            <div style={{ ...PANEL, padding: '12px 14px', minWidth: 220 }}>
              <div style={LBL}>Sitting with</div>
              <div style={{ fontSize: 14, fontWeight: 600 }}>{current.holderName ?? current.department}</div>
              {current.holderName && <div style={{ fontSize: 11, color: 'var(--fg-3)' }}>{current.department}</div>}
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 20, marginTop: 4, color: current.days > 7 ? 'var(--neg)' : 'var(--fg)' }}>
                {current.days < 1 ? '<1' : Math.round(current.days)}<span style={{ fontSize: 11, color: 'var(--fg-3)', marginLeft: 3 }}>days in {current.status}</span>
              </div>
            </div>
          )}
        </div>

        {/* Timeline */}
        <div style={{ ...PANEL, padding: '14px 16px', marginBottom: 12 }}>
          <ComplaintTimeline status={c.status} dwells={life} legacy={legacy} />
          {!legacy && (
            <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--line-2)' }}>
              <ComplaintMoveBar complaintId={id} status={c.status} canMove={mayMove} gate={gate} />
            </div>
          )}
        </div>

        {/* Pages */}
        <div style={{ ...PANEL, marginBottom: 12 }}>
          <div className="cmp-pages" style={{ display: 'flex', gap: 2, borderBottom: '1px solid var(--line)', padding: '0 8px', overflowX: 'auto' }}>
            {PAGES.map(p => {
              const missing = legacy ? 0 : missingOnPage(p, c).length;
              const on = p.id === page.id;
              return (
                <Link key={p.id} href={pageHref(p.slug)} style={{
                  padding: '10px 12px', fontSize: 12, textDecoration: 'none', whiteSpace: 'nowrap',
                  color: on ? 'var(--accent)' : 'var(--fg-3)', fontWeight: on ? 600 : 400,
                  borderBottom: on ? '2px solid var(--accent)' : '2px solid transparent', marginBottom: -1,
                }} title={`${p.title} — ${p.owner}`}>
                  <span style={{ fontFamily: 'var(--font-mono)', marginRight: 6, opacity: 0.7 }}>{pageStep(p)}</span>{p.title}
                  {missing > 0 && <span title={`${missing} required field${missing === 1 ? '' : 's'} still empty`} style={{ marginLeft: 6, fontSize: 9.5, fontWeight: 700, color: 'var(--warn)' }}>●</span>}
                </Link>
              );
            })}
          </div>
          <div style={{ padding: '14px 16px' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 12 }}>
              <span style={{ fontSize: 14, fontWeight: 600 }}>{pageStep(page)}. {page.title}</span>
              <span style={{ fontSize: 11, color: 'var(--fg-3)' }}>owner: {page.owner}</span>
            </div>
            {page.id === 1 && (
              <div style={{ marginBottom: 14 }}>
                {justLodged && (
                  <div style={{ padding: '10px 13px', borderRadius: 6, fontSize: 12.5, lineHeight: 1.5, marginBottom: 10,
                                background: 'var(--pos-soft)', border: '1px solid var(--pos)', color: 'var(--pos-strong)' }}>
                    Lodged as <b style={{ fontFamily: 'var(--font-mono)', fontWeight: 700 }}>{c.complaint_no}</b>.
                    It is on the record and anyone can find it now. Fill in the source and category below
                    once you have looked at it, and correct the description if it needs more — until
                    then it shows as <b>NEW</b> on the complaints list.
                  </div>
                )}
                {failedFiles.length > 0 && (
                  <div style={{ padding: '9px 12px', borderRadius: 6, fontSize: 12, lineHeight: 1.5, marginBottom: 10,
                                background: 'var(--warn-soft)', border: '1px solid var(--warn)', color: 'var(--warn-strong, var(--warn))' }}>
                    The complaint was registered, but {failedFiles.length === 1 ? 'one file' : `${failedFiles.length} files`} chosen at registration did not upload: {failedFiles.join(', ')}. Attach {failedFiles.length === 1 ? 'it' : 'them'} again below.
                  </div>
                )}
                <ComplaintAttachments complaintId={id} files={files} canEdit={canEditFiles} canEditCapa={canEditCapa} only={['complaint', 'photo']} />
              </div>
            )}
            <ComplaintPageForm key={page.id} complaintId={id} clientId={c.client_id} page={page} initial={c} oems={oems}
              lookups={lookups} cascades={cascades} parts={partRows} users={userRows} canEdit={canEditThis} whyNot={whyNot} />
            {page.id === 6 && (
              <div style={{ marginTop: 16 }}>
                <div style={LBL}>Documents & attachments</div>
                <ComplaintAttachments complaintId={id} files={files} canEdit={canEditFiles} canEditCapa={canEditCapa} only={['capa', 'customer', 'other']} />
              </div>
            )}
            {page.id === 4 && legacy && c.root_cause == null && (
              <div style={{ fontSize: 12, color: 'var(--fg-3)' }}>No investigation was recorded on this legacy complaint.</div>
            )}
          </div>
        </div>

        {/* Lifecycle */}
        <div style={{ ...PANEL, padding: '14px 16px', marginBottom: 12 }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Lifecycle</div>
          <ComplaintLifecycle dwells={life} byHolder={holders} />
          {logRows.some(l => l.note) && (
            <div style={{ marginTop: 12 }}>
              <div style={LBL}>Notes on moves</div>
              {logRows.filter(l => l.note).map((l, i) => (
                <div key={i} style={{ fontSize: 12, padding: '6px 0', borderBottom: '1px solid var(--line-2)' }}>
                  <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--fg-3)', fontSize: 11 }}>{day(l.created_at)}</span>
                  <span style={{ margin: '0 8px', color: 'var(--fg-3)' }}>{l.from_status ? `${l.from_status} → ` : ''}{l.to_status}</span>
                  <span>{l.note}</span>
                  {l.actor && <span style={{ color: 'var(--fg-3)' }}> — {l.actor}</span>}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Notes */}
        <div style={{ ...PANEL, padding: '14px 16px' }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Notes</div>
          {(c.assigned_name || c.assigned_to_external) ? <div style={{ fontSize: 12, color: 'var(--fg-2)', marginBottom: 6 }}>Originally escalated to {c.assigned_name ?? String(c.assigned_to_external)}.</div> : null}
          {c.resolution ? <div style={{ fontSize: 12, color: 'var(--fg-2)', marginBottom: 10, whiteSpace: 'pre-wrap' }}><b>Resolution on record:</b> {String(c.resolution)}</div> : null}
          <ComplaintNotes complaintId={id} notes={notes} isAdmin={hasRole(user.role, 'admin')} />
        </div>
      </div>
    </div>
  );
}

const PANEL: CSSProperties = { background: 'var(--bg-paper)', border: '1px solid var(--line)', borderRadius: 'var(--radius)' };
const PILL: CSSProperties = { padding: '3px 9px', borderRadius: 999, fontSize: 11, fontWeight: 700, color: '#fff', whiteSpace: 'nowrap' };
const LBL: CSSProperties = { fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--fg-3)', marginBottom: 4 };
