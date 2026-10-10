import { notFound, redirect } from 'next/navigation';
import { probabilityPctSql } from '@/lib/risansi-probability-codes';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import risansiPool from '@/lib/db-risansi';
import { getCurrentUser, clientScopeSql, canViewClient , OWN_OPEN } from '@/lib/risansi-auth';
import { AutoPrint } from '@/components/risansi/AutoPrint';
import {
  PRINT_CSS, ROOT, C, Section, Facts, TextBlock, TH, TD, DocHeader, RowFacts,
  SugarPumpTable, SUGAR_PUMP_KEYS,
} from '@/components/risansi/print-shared';

async function q<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try { return await fn(); } catch { return fallback; }
}

function fmtDate(v: string | Date | null | undefined, withTime = false): string {
  if (!v) return '—';
  const d = new Date(v);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-IN', {
    day: 'numeric', month: 'long', year: 'numeric',
    ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}),
  });
}

const yn = (v: boolean | null | undefined) => (v ? 'Yes' : 'No');

// A visit report is a short document. Twenty is more account history than any
// reader of one needs, and the header carries the true count.
const COMMENT_LIMIT = 20;

interface ClientComment { body: string; who: string; created_at: string; total: number }

export default async function VisitPrintPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) redirect('/api/auth/signin');

  const visitRes = await risansiPool.query<Record<string, unknown>>(
    `SELECT v.*,
       c.legal_name, c.code, c.industry, c.is_sugar, c.tcd, c.client_type, c.city, c.state, c.tier,
       COALESCE(r.name, '—') AS rep_name, r.email AS rep_email
     FROM visits v
     JOIN clients c ON v.client_id = c.id
     LEFT JOIN users r ON v.rep_id = r.id
     WHERE v.id = $1`,
    [id],
  );
  const visit = visitRes.rows[0];
  if (!visit) notFound();

  // Visibility guard — viewer must be able to SEE this visit, or (fallback) the
  // client it belongs to, so the Client-360 timeline PDF links always open.
  const viewer  = await getCurrentUser();
  const ownPred = clientScopeSql(viewer, 'v.client_id', OWN_OPEN.visit('v'));
  if (ownPred) {
    const { rows } = await risansiPool.query<{ ok: boolean }>(
      `SELECT (${ownPred}) AS ok FROM visits v WHERE v.id = $1`, [id],
    );
    if (!rows[0]?.ok && !(await canViewClient(viewer, Number(visit.client_id)))) notFound();
  }

  // Only a closed (submitted) visit may be exported. Otherwise bounce back.
  if (!visit.submitted_at) redirect(`/risansi/visits/${id}`);

  const cid = String(visit.client_id);
  const [contacts, equipment, sugar, nonsugar, opps, tasks, photos, rilInstalled, comments] = await Promise.all([
    q(async () => (await risansiPool.query<Record<string, unknown>>(
      `SELECT name, designation, phone, email, is_primary FROM contacts WHERE client_id = $1 ORDER BY is_primary DESC, name ASC`, [cid],
    )).rows, [] as Record<string, unknown>[]),
    q(async () => (await risansiPool.query<Record<string, unknown>>(
      `SELECT * FROM equipment WHERE visit_id = $1 ORDER BY is_ril DESC, created_at ASC`, [id],
    )).rows, [] as Record<string, unknown>[]),
    q(async () => (await risansiPool.query<Record<string, unknown>>(
      `SELECT * FROM visit_sugar_report WHERE visit_id = $1 LIMIT 1`, [id],
    )).rows[0] ?? null, null as Record<string, unknown> | null),
    q(async () => (await risansiPool.query<Record<string, unknown>>(
      `SELECT * FROM visit_nonsugar_report WHERE visit_id = $1 LIMIT 1`, [id],
    )).rows[0] ?? null, null as Record<string, unknown> | null),
    q(async () => (await risansiPool.query<Record<string, unknown>>(
      `SELECT id, product, stage, value_cr::text AS value_cr,
              ${probabilityPctSql('opportunities')} AS probability
         FROM opportunities WHERE visit_id = $1 ORDER BY created_at ASC`, [id],
    )).rows, [] as Record<string, unknown>[]),
    q(async () => (await risansiPool.query<Record<string, unknown>>(
      `SELECT t.title, t.status, t.due_date, t.priority, r.name AS assigned_rep_name
         FROM tasks t LEFT JOIN users r ON t.assigned_to_rep = r.id
         WHERE t.visit_id = $1
         ORDER BY CASE WHEN t.status = 'completed' THEN 1 ELSE 0 END, t.due_date ASC NULLS LAST`, [id],
    )).rows, [] as Record<string, unknown>[]),
    q(async () => (await risansiPool.query<Record<string, unknown>>(
      `SELECT id, COALESCE(caption,'') AS caption, uploaded_at FROM visit_photos WHERE visit_id = $1 ORDER BY uploaded_at, id`, [id],
    )).rows, [] as Record<string, unknown>[]),
    // Risansi installed base at this client (client-level, not visit-scoped) —
    // shown alongside the per-visit assessment so the Risansi side is never
    // blank. Grouped so near-duplicate pump rows collapse to one line.
    q(async () => (await risansiPool.query<Record<string, unknown>>(
      `SELECT pump_model_plate, liquid, capacity, head, COALESCE(SUM(quantity),0)::int AS qty
         FROM client_pumps WHERE client_id = $1
        GROUP BY pump_model_plate, liquid, capacity, head
        ORDER BY pump_model_plate NULLS LAST`, [cid],
    )).rows, [] as Record<string, unknown>[]),
    // The Comments box from Client 360. These belong to the CLIENT, not to this
    // visit — there is no visit-level comment — which is why the section says so
    // and why anything written after the visit date is marked as such.
    q(async () => (await risansiPool.query<ClientComment>(
      `SELECT cm.body,
              COALESCE(NULLIF(cm.author_name,''), cm.author_email) AS who,
              cm.created_at::date::text AS created_at,
              (SELECT COUNT(*) FROM client_comments x WHERE x.client_id = $1)::int AS total
         FROM client_comments cm WHERE cm.client_id = $1
        ORDER BY cm.created_at DESC, cm.id DESC LIMIT ${COMMENT_LIMIT}`, [cid],
    )).rows, [] as ClientComment[]),
  ]);
  const commentTotal = comments[0]?.total ?? 0;
  const visitDay = visit.visit_date ? String(visit.visit_date).slice(0, 10) : null;

  const isSugar = visit.industry_format === 'sugar' || (!visit.industry_format && !!visit.is_sugar);
  const rilEq  = equipment.filter(e => e.is_ril);
  const compEq = equipment.filter(e => !e.is_ril);
  // A line reading "Roto · PCP · qty 4" is four pumps, not one. The header used
  // to count rows, so a visit that saw four of one model reported "1". A row
  // with no quantity on it is one pump.
  const pumps = (rows: Record<string, unknown>[], qtyKey = 'qty') =>
    rows.reduce((n, r) => n + (Number(r[qtyKey]) || 1), 0);
  const rilPumps       = pumps(rilEq);
  const compPumps      = pumps(compEq);
  const installedPumps = pumps(rilInstalled as unknown as Record<string, unknown>[]);
  const s = visit as Record<string, unknown>;
  const str = (k: string) => (s[k] == null ? null : String(s[k]));
  // Show crushing capacity (TCD) on the visit report for sugar mills only.
  const isSugarMill = !!visit.is_sugar && /end user|group|direct mill/i.test(String(visit.client_type ?? ''));
  const tcdNum = Number(visit.tcd ?? 0);
  const tcdLabel = isSugarMill && tcdNum > 0 ? `${tcdNum.toLocaleString('en-IN')} TCD` : null;

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: PRINT_CSS }} />
      <div className="print-root" style={{ background: '#fff', minHeight: '100vh', padding: '16px' }}>
        <AutoPrint label="Save Visit Report as PDF" />
        <div style={ROOT}>
          <DocHeader
            kind="Visit Report"
            title={String(visit.legal_name)}
            subtitle={<>
              {String(visit.rep_name)} · {fmtDate(visit.visit_date as string)}
              {visit.purpose ? ` · ${String(visit.purpose)}` : ''}
            </>}
            meta={<>
              <div style={{ fontFamily: 'monospace' }}>{String(visit.code)}</div>
              <div style={{ marginTop: 2, color: C.pos, fontWeight: 700 }}>● CLOSED</div>
              <div style={{ marginTop: 2 }}>Submitted {fmtDate(visit.submitted_at as string)}</div>
            </>}
          />

          <Section title="Visit Details">
            <Facts rows={[
              ['Client Code', String(visit.code)],
              ['Industry', `${str('industry') ?? '—'}${isSugar ? ' · Sugar' : ''}`],
              ['TCD', tcdLabel],
              ['Location', [str('city'), str('state')].filter(Boolean).join(', ') || null],
              ['Tier', str('tier')],
              ['Representative', `${str('rep_name')}${str('rep_email') ? ` (${str('rep_email')})` : ''}`],
              ['Visit Date', fmtDate(visit.visit_date as string)],
              ['Purpose', str('purpose')],
              ['Outcome', str('outcome')],
              ['Status', String(visit.status)],
              ['Visit Type', visit.is_unplanned ? `Unplanned${str('unplanned_reason') ? ` — ${str('unplanned_reason')}` : ''}` : 'Planned'],
              ['Checked In', fmtDate(visit.check_in_time as string, true)],
              ['Checked Out', fmtDate(visit.check_out_time as string, true)],
              ['GPS Within Radius', visit.check_in_time ? yn(visit.gps_within_radius as boolean) : null],
            ]} />
          </Section>

          {/* Show whichever report actually has data — never gate on a flag that
              can disagree with what the rep filled (was hiding non-sugar reports). */}
          {sugar && (
            <Section title="Sugar Industry Report">
              <SugarPumpTable row={sugar} />
              <RowFacts row={sugar} skip={SUGAR_PUMP_KEYS} />
            </Section>
          )}
          {nonsugar && (
            <Section title="Industry Report"><RowFacts row={nonsugar} /></Section>
          )}

          {(equipment.length > 0 || rilInstalled.length > 0) && (
            <Section
              title="Equipment Assessment"
              right={`${rilPumps + installedPumps + compPumps} pump${rilPumps + installedPumps + compPumps === 1 ? '' : 's'} · ${rilPumps + installedPumps} Risansi · ${compPumps} competitor`}
            >
              {/* ── RISANSI — clearly segregated. Both what was assessed on this
                   visit AND the client's Risansi installed base, so the Risansi
                   side is never blank just because a visit only logged rivals. */}
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 10.5, fontWeight: 700, color: C.accent, marginBottom: 5, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Risansi Equipment
                </div>

                {rilEq.length > 0 && (
                  <div style={{ marginBottom: rilInstalled.length ? 10 : 0 }}>
                    <div style={{ fontSize: 9, fontWeight: 700, color: C.fg3, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 3 }}>Assessed this visit</div>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <thead><tr>{['Type', 'Model', 'Application', 'Qty', 'Condition', 'Feedback'].map(h => <th key={h} style={TH}>{h}</th>)}</tr></thead>
                      <tbody>
                        {rilEq.map((e, i) => (
                          <tr key={i}>
                            <td style={TD}>{String(e.pump_type ?? '—')}</td>
                            <td style={TD}>{`${String(e.supplier ?? '')} ${String(e.model ?? '')}`.trim() || '—'}</td>
                            <td style={TD}>{String(e.application ?? '—')}</td>
                            <td style={{ ...TD, textAlign: 'center' }}>{String(e.qty ?? 1)}</td>
                            <td style={TD}>{String(e.condition ?? '—')}{e.is_opportunity ? ' ⚡' : ''}</td>
                            <td style={TD}>{String(e.performance_feedback ?? '—')}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {rilInstalled.length > 0 && (
                  <div>
                    <div style={{ fontSize: 9, fontWeight: 700, color: C.fg3, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 3 }}>Installed base</div>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <thead><tr>{['Model', 'Liquid', 'Capacity', 'Head', 'Qty'].map(h => <th key={h} style={TH}>{h}</th>)}</tr></thead>
                      <tbody>
                        {rilInstalled.map((p, i) => (
                          <tr key={i}>
                            <td style={TD}>{String(p.pump_model_plate ?? '—')}</td>
                            <td style={TD}>{String(p.liquid ?? '—')}</td>
                            <td style={TD}>{String(p.capacity ?? '—')}</td>
                            <td style={TD}>{String(p.head ?? '—')}</td>
                            <td style={{ ...TD, textAlign: 'center' }}>{String(p.qty ?? 1)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {rilEq.length === 0 && rilInstalled.length === 0 && (
                  <div style={{ fontSize: 10, color: C.fg3, fontStyle: 'italic' }}>None recorded.</div>
                )}
              </div>

              {/* ── COMPETITOR ── */}
              <div>
                <div style={{ fontSize: 10.5, fontWeight: 700, color: C.fg2, marginBottom: 5, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Competitor Equipment
                </div>
                {compEq.length > 0 ? (
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead><tr>{['Type', 'Make / Model', 'Application', 'Qty', 'Condition', 'Reason'].map(h => <th key={h} style={TH}>{h}</th>)}</tr></thead>
                    <tbody>
                      {compEq.map((e, i) => (
                        <tr key={i}>
                          <td style={TD}>{String(e.pump_type ?? '—')}</td>
                          <td style={TD}>{`${String(e.supplier ?? '')} ${String(e.model ?? '')}`.trim() || '—'}</td>
                          <td style={TD}>{String(e.application ?? '—')}</td>
                          <td style={{ ...TD, textAlign: 'center' }}>{String(e.qty ?? 1)}</td>
                          <td style={TD}>{String(e.condition ?? '—')}{e.is_opportunity ? ' ⚡' : ''}</td>
                          <td style={TD}>{String(e.reason_for_competitor ?? '—')}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <div style={{ fontSize: 10, color: C.fg3, fontStyle: 'italic' }}>None recorded.</div>
                )}
              </div>
            </Section>
          )}

          <Section title="Visit Summary">
            <Facts rows={[
              ['Performance Feedback', str('performance_feedback')],
              ['Mgmt Intervention', str('mgmt_intervention')],
              ['Competitor Activity Observed', yn(visit.competitor_activity_observed as boolean)],
              ['Sample / Gift Given', visit.sample_or_gift_given ? `Yes${str('sample_gift_detail') ? ` — ${str('sample_gift_detail')}` : ''}` : 'No'],
              ['Follow-up Required', visit.follow_up_required ? `Yes${str('follow_up_due_date') ? ` (due ${fmtDate(visit.follow_up_due_date as string)})` : ''}` : 'No'],
              ['Next Visit Recommendation', fmtDate(visit.next_visit_recommendation as string)],
            ]} />
            <div style={{ marginTop: 12 }}>
              <TextBlock label="Visit Summary" value={str('summary')} />
              <TextBlock label="Open Remarks" value={str('open_remarks')} />
              <TextBlock label="Major Remarks" value={str('major_remarks')} />
              <TextBlock label="Follow-up Notes" value={str('follow_up_text')} />
              <TextBlock label="Complaint Notes" value={str('complaint_notes')} />
            </div>
          </Section>

          {comments.length > 0 && (
            <Section
              title="Client Comments"
              right={`${commentTotal}${commentTotal > comments.length ? ` · showing latest ${comments.length}` : ''}`}
            >
              <div style={{ fontSize: 9.5, color: C.fg3, marginBottom: 8 }}>
                Notes recorded against {String(visit.legal_name)} in Client 360, not against this visit.
              </div>
              <div style={{ display: 'grid', gap: 9 }}>
                {comments.map((cm, i) => {
                  // A March visit report carrying an August note should not read
                  // as if the note were said on the day.
                  const later = visitDay != null && cm.created_at > visitDay;
                  return (
                    <div key={i} className="avoid-break" style={{
                      paddingLeft: 9, borderLeft: `2px solid ${C.accentSoft}`,
                      ...(i > 0 ? { paddingTop: 8, borderTop: `1px solid ${C.line}` } : {}),
                    }}>
                      <div style={{ fontSize: 9.5, color: C.fg3, marginBottom: 2 }}>
                        <strong style={{ color: C.fg2, fontWeight: 700 }}>{cm.who}</strong>
                        {' · '}{fmtDate(cm.created_at)}
                        {later && <span style={{ color: C.warn }}>{' · after this visit'}</span>}
                      </div>
                      <div style={{ fontSize: 11, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{cm.body}</div>
                    </div>
                  );
                })}
              </div>
            </Section>
          )}

          {tasks.length > 0 && (
            <Section title="Action Register" right={`${tasks.length} item${tasks.length !== 1 ? 's' : ''}`}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr>{['Action', 'Owner', 'Due', 'Priority', 'Status'].map(h => <th key={h} style={TH}>{h}</th>)}</tr></thead>
                <tbody>
                  {tasks.map((t, i) => (
                    <tr key={i}>
                      <td style={TD}>{String(t.title ?? '—')}</td>
                      <td style={TD}>{String(t.assigned_rep_name ?? '—')}</td>
                      <td style={TD}>{fmtDate(t.due_date as string)}</td>
                      <td style={TD}>{String(t.priority ?? '—')}</td>
                      <td style={TD}>{String(t.status ?? '—')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Section>
          )}

          {opps.length > 0 && (
            <Section title="Opportunities" right={`${opps.length}`}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr>{['Product', 'Stage', 'Value (Cr)', 'Probability'].map(h => <th key={h} style={TH}>{h}</th>)}</tr></thead>
                <tbody>
                  {opps.map((o, i) => (
                    <tr key={i}>
                      <td style={TD}>{String(o.product ?? '—')}</td>
                      <td style={TD}>{String(o.stage ?? '—')}</td>
                      <td style={TD}>₹{Number(o.value_cr ?? 0).toFixed(2)}</td>
                      <td style={TD}>{o.probability != null ? `${o.probability}%` : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Section>
          )}

          {contacts.length > 0 && (
            <Section title="Contacts" right={`${contacts.length}`}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr>{['Name', 'Designation', 'Phone', 'Email'].map(h => <th key={h} style={TH}>{h}</th>)}</tr></thead>
                <tbody>
                  {contacts.map((c, i) => (
                    <tr key={i}>
                      <td style={TD}>{String(c.name ?? '—')}{c.is_primary ? ' ★' : ''}</td>
                      <td style={TD}>{String(c.designation ?? '—')}</td>
                      <td style={TD}>{String(c.phone ?? '—')}</td>
                      <td style={TD}>{String(c.email ?? '—')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Section>
          )}

          {photos.length > 0 && (
            <Section title="Photos" right={`${photos.length}`}>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                {photos.map((p, i) => (
                  <div key={i} style={{ width: '48%', breakInside: 'avoid', marginBottom: 6 }}>
                    {/* Served from the DB via the photo API; loads with the print page's session. */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={`/api/risansi/visit-photo/${String(p.id)}`}
                      alt={String(p.caption) || `Visit photo ${i + 1}`}
                      style={{ width: '100%', borderRadius: 4, border: `1px solid ${C.line}`, display: 'block' }}
                    />
                    <div style={{ fontSize: 8, color: C.fg3, marginTop: 2, fontFamily: 'monospace' }}>
                      Visit #{String(visit.id)} · {fmtDate(p.uploaded_at as string, true)}
                      {p.caption ? ` — ${String(p.caption)}` : ''}
                    </div>
                  </div>
                ))}
              </div>
            </Section>
          )}

          <div style={{ marginTop: 16, paddingTop: 8, borderTop: `1px solid ${C.line}`, fontSize: 9, color: C.fg3, display: 'flex', justifyContent: 'space-between' }}>
            <span>Risansi Intelligence Platform — Visit Report</span>
            <span>Generated {fmtDate(new Date(), true)}</span>
          </div>
        </div>
      </div>
    </>
  );
}
