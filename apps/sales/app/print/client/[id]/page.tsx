import { notFound, redirect } from 'next/navigation';
import { probabilityPctSql } from '@/lib/risansi-probability-codes';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import risansiPool from '@/lib/db-risansi';
import { getCurrentUser, canViewClient } from '@/lib/risansi-auth';
import { formatRev, fmtCr, formatLastVisit } from '@/lib/risansi-utils';
import { clientStatusLabel } from '@/lib/risansi-client-status';
import { AutoPrint } from '@/components/risansi/AutoPrint';
import { clientRepNamesSql } from '@/lib/risansi-client-rep';
import {
  PRINT_CSS, ROOT, C, Section, Facts, TextBlock, TH, TD, DocHeader,
} from '@/components/risansi/print-shared';

async function q<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try { return await fn(); } catch { return fallback; }
}

// A profile is a document somebody prints and reads; a client with two hundred
// notes on it would turn two pages into forty. The section header says the true
// count whenever it is more than this.
const COMMENT_LIMIT = 40;

const COMPETITOR_PCP: Record<string, string> = {
  roto_pcp: 'Roto', rotomac_pcp: 'Rotomac', gita_pcp: 'Gita', psp_pcp: 'PSP',
  syno_pcp: 'Syno', ropman_pcp: 'Ropman', myto_pcp: 'Myto', vikas_pcp: 'Vikas',
  newpumps_pcp: 'Newpumps', indopump_pcp: 'Indopump', tushaco_pcp: 'Tushaco',
  yaswant_pcp: 'Yaswant', shivam_pcp: 'Shivam', saksham_pcp: 'Saksham', alpha_pcp: 'Alpha',
  gajanan_pcp: 'Gajanan', chandra_helicon_pcp: 'Chandra Helicon', netzsch_pcp: 'Netzsch',
  akanshi_pcp: 'Akanshi', pragati_pcp: 'Pragati', ropar_pcp: 'Ropar', rotor_flow_pcp: 'Rotor Flow',
  naishit_pcp: 'Naishit', delta_pcp: 'Delta', varun_pcp: 'Varun', npi_pcp: 'NPI',
  hydroprocav_pcp: 'Hydroprocav', sre_pcp: 'SRE', span_engg_pcp: 'Span Engg',
  pandey_pcp: 'Pandey', mahalaxmi_pcp: 'Mahalaxmi', ravalgoan_pcp: 'Ravalgoan', others_pcp: 'Others',
};

const COMPETITOR_MMP: Record<string, string> = {
  gita_mmp: 'Gita', sintech_mmp: 'Sintech', psp_mmp: 'PSP', syno_mmp: 'Syno',
  ropman_mmp: 'Ropman', vikas_mmp: 'Vikas', indopump_mmp: 'Indopump', yaswant_mmp: 'Yaswant',
  shivam_mmp: 'Shivam', elite_mmp: 'Elite', mather_mmp: 'Mather', varun_mmp: 'Varun',
  vs_engg_mmp: 'VS Engg', span_engg_mmp: 'Span Engg', pandey_mmp: 'Pandey',
  mahalaxmi_mmp: 'Mahalaxmi', ravalgoan_mmp: 'Ravalgoan', others_mmp: 'Others',
};

function fmtDate(v: string | Date | null | undefined): string {
  if (!v) return '—';
  const d = new Date(v);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

export default async function ClientPrintPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) redirect('/api/auth/signin');

  const isNumeric = /^\d+$/.test(id);
  const whereClause = isNumeric ? 'c.id = $1::bigint' : 'c.code = $1';

  const client = await q<Record<string, unknown> | null>(async () => {
    const { rows } = await risansiPool.query<Record<string, unknown>>(
      `SELECT c.*,
              COALESCE(${clientRepNamesSql('c.id')}, '—') AS rep_name,
              tr.name AS tour_name, tr.zone AS tour_zone
       FROM clients c
       LEFT JOIN tour_routes tr ON tr.id = c.tour_id
       WHERE ${whereClause} AND c.deleted_at IS NULL`,
      [id],
    );
    return rows[0] ?? null;
  }, null);
  if (!client) notFound();

  const currentUser = await getCurrentUser();
  if (!(await canViewClient(currentUser, Number(client.id)))) notFound();

  const [contacts, clientRevByFY, compRow, visits, allOpps, clientPumps, comments] = await Promise.all([
    q(async () => (await risansiPool.query<Record<string, unknown>>(
      `SELECT name, designation, is_primary, phone, email, whatsapp, notes
         FROM contacts WHERE client_id = $1 ORDER BY is_primary DESC, created_at ASC`, [client.id],
    )).rows, [] as Record<string, unknown>[]),
    q(async () => (await risansiPool.query<{ fy: string; pump_inr: string; spare_inr: string; total_inr: string }>(
      `SELECT LPAD((EXTRACT(YEAR FROM month)::int % 100)::text,2,'0')||'-'||LPAD(((EXTRACT(YEAR FROM month)::int + 1) % 100)::text,2,'0') AS fy,
              COALESCE(SUM(pump_value),0)::text AS pump_inr, COALESCE(SUM(spare_value),0)::text AS spare_inr, COALESCE(SUM(total_value),0)::text AS total_inr
         FROM client_revenue_monthly WHERE client_id = $1 AND EXTRACT(MONTH FROM month) >= 4 GROUP BY 1
       UNION ALL
       SELECT LPAD(((EXTRACT(YEAR FROM month)::int - 1) % 100)::text,2,'0')||'-'||LPAD((EXTRACT(YEAR FROM month)::int % 100)::text,2,'0') AS fy,
              COALESCE(SUM(pump_value),0)::text, COALESCE(SUM(spare_value),0)::text, COALESCE(SUM(total_value),0)::text
         FROM client_revenue_monthly WHERE client_id = $1 AND EXTRACT(MONTH FROM month) < 4 GROUP BY 1
       ORDER BY fy ASC`, [client.id],
    )).rows, [] as { fy: string; pump_inr: string; spare_inr: string; total_inr: string }[]),
    q(async () => (await risansiPool.query<Record<string, number | string | null>>(
      `SELECT * FROM competitor_installed_base WHERE client_code = $1 LIMIT 1`, [client.code],
    )).rows[0] ?? null, null as Record<string, number | string | null> | null),
    q(async () => (await risansiPool.query<Record<string, unknown>>(
      `SELECT v.visit_date, COALESCE(r.name,'—') AS rep_name, v.purpose, v.outcome, v.summary, v.status
         FROM visits v LEFT JOIN users r ON r.id = v.rep_id
         WHERE v.client_id = $1 ORDER BY v.visit_date DESC LIMIT 30`, [client.id],
    )).rows, [] as Record<string, unknown>[]),
    q(async () => (await risansiPool.query<Record<string, unknown>>(
      // Every stage — Won opportunities are the client's order in hand and must
      // appear in the report. Order-in-hand first, then live pipeline, then closed.
      `SELECT product, stage, value_cr::text AS value_cr,
              ${probabilityPctSql('opportunities')} AS probability,
              final_value_cr::text AS final_value_cr,
              (SELECT COALESCE(SUM(so.so_value_cr), 0) FROM opportunity_sales_orders so WHERE so.opportunity_id = opportunities.id)::float8 AS so_sum_cr
         FROM opportunities WHERE client_id = $1
         ORDER BY CASE WHEN stage='Won' THEN 0 WHEN stage IN ('Lost','Dropped') THEN 2 ELSE 1 END,
                  value_cr DESC NULLS LAST`, [client.id],
    )).rows, [] as Record<string, unknown>[]),
    q(async () => (await risansiPool.query<Record<string, unknown>>(
      `SELECT pump_model_plate, quantity, customer_name AS supplier, ec_number, so_number, pump_sl_no, liquid, capacity, head
       FROM client_pumps WHERE client_id = $1 ORDER BY id`, [client.id],
    )).rows, [] as Record<string, unknown>[]),
    // The Comments box from Client 360, newest first as it reads on screen.
    // Capped: a client with two hundred notes should not turn a two-page profile
    // into a forty-page one, and the count below says what was left off.
    q(async () => (await risansiPool.query<{ body: string; who: string; created_at: string; total: number }>(
      `SELECT cm.body,
              COALESCE(NULLIF(cm.author_name,''), cm.author_email) AS who,
              cm.created_at::date::text AS created_at,
              (SELECT COUNT(*) FROM client_comments x WHERE x.client_id = $1)::int AS total
         FROM client_comments cm WHERE cm.client_id = $1
        ORDER BY cm.created_at DESC, cm.id DESC LIMIT ${COMMENT_LIMIT}`, [client.id],
    )).rows, [] as { body: string; who: string; created_at: string; total: number }[]),
  ]);
  const commentTotal = comments[0]?.total ?? 0;

  // ── Revenue rollup ──
  const INR_TO_L = 100_000;
  const revByFY: Record<string, { pump: number; spare: number }> = {};
  for (const r of clientRevByFY) {
    revByFY[r.fy] = { pump: Number(r.pump_inr) / INR_TO_L, spare: Number(r.spare_inr) / INR_TO_L };
  }
  const chartFYs = Object.keys(revByFY).sort();
  let lifePump = 0, lifeSpare = 0;
  for (const v of Object.values(revByFY)) { lifePump += v.pump; lifeSpare += v.spare; }
  const lifeTotal = lifePump + lifeSpare;

  // ── Competition (PCP + MMP installed base) ──
  const mkMakers = (labels: Record<string, string>) => compRow
    ? Object.entries(labels).map(([col, name]) => ({ name, units: Number(compRow[col] ?? 0) })).filter(m => m.units > 0).sort((a, b) => b.units - a.units)
    : [];

  const rilUnits = Number(compRow?.ril_pcp ?? 0);
  const makers = mkMakers(COMPETITOR_PCP);
  const sumNamed = rilUnits + makers.reduce((s, m) => s + m.units, 0);
  const totalUnits = Math.max(Number(compRow?.total_pcp ?? 0), sumNamed);
  const rilSharePct = totalUnits > 0 ? Math.round((rilUnits / totalUnits) * 100) : 0;

  const rilMmp = Number(compRow?.ril_mmp ?? 0);
  const mmpMakers = mkMakers(COMPETITOR_MMP);
  const sumNamedMmp = rilMmp + mmpMakers.reduce((s, m) => s + m.units, 0);
  const totalMmp = Math.max(Number(compRow?.total_mmp ?? 0), sumNamedMmp);
  const rilMmpSharePct = totalMmp > 0 ? Math.round((rilMmp / totalMmp) * 100) : 0;
  const rilPumpsTotal = rilUnits + rilMmp;

  // RIL pump detail + discrepancy vs installed base (for the PDF).
  const pumpDetailQty = clientPumps.reduce((s, p) => s + Number(p.quantity ?? 0), 0);
  const clientKey = String(client.legal_name).toUpperCase().replace(/[^A-Z0-9]/g, '');
  const pumpGap = rilPumpsTotal - pumpDetailQty;

  const compSections = [
    totalUnits > 0 ? { key: 'PCP', ril: rilUnits, total: totalUnits, makers,    sharePct: rilSharePct }    : null,
    totalMmp   > 0 ? { key: 'MMP', ril: rilMmp,   total: totalMmp,   makers: mmpMakers, sharePct: rilMmpSharePct } : null,
  ].filter(Boolean) as { key: string; ril: number; total: number; makers: { name: string; units: number }[]; sharePct: number }[];

  const openOpps      = allOpps.filter(o => !['Won', 'Lost', 'Dropped'].includes(String(o.stage)));
  const wonOpps       = allOpps.filter(o => String(o.stage) === 'Won');
  const pipelineTotal = openOpps.reduce((s, o) => s + Number(o.value_cr), 0);
  // Order in Hand = Won value not yet turned into a Sales Order: Σ max(final − Σ SO, 0).
  const wonTotal      = wonOpps.reduce((s, o) => {
    const finalCr = o.final_value_cr != null ? Number(o.final_value_cr) : Number(o.value_cr);
    return s + Math.max(0, finalCr - Number(o.so_sum_cr ?? 0));
  }, 0);
  const lastVisit = formatLastVisit(client.last_visit_date as string | null);
  const c = client as Record<string, unknown>;
  const str = (k: string) => (c[k] == null || c[k] === '' ? null : String(c[k]));
  // TCD (tonnes crushed / day) is the headline capacity metric for a sugar
  // mill — surface it prominently, but only for the sugar mill categories
  // (End User / Group Mills / Direct Mill), never for traders / OEMs.
  const isSugarMill = !!client.is_sugar && /end user|group|direct mill/i.test(String(client.client_type ?? ''));
  const tcdNum = Number(client.tcd ?? 0);
  const tcdLabel = isSugarMill && tcdNum > 0 ? `${tcdNum.toLocaleString('en-IN')} TCD` : null;

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: PRINT_CSS }} />
      <div className="print-root" style={{ background: '#fff', minHeight: '100vh', padding: '16px' }}>
        <AutoPrint label="Save Client Profile as PDF" />
        <div style={ROOT}>
          <DocHeader
            kind="Client Profile"
            title={String(client.legal_name)}
            subtitle={<>
              <span style={{ fontFamily: 'monospace' }}>{String(client.code)}</span>
              {str('industry') ? ` · ${str('industry')}` : ''}
              {str('tcd') ? ` · ${str('tcd')} TCD` : ''}
              {str('since_year') ? ` · Customer since ${str('since_year')}` : ''}
            </>}
            meta={<>
              <div style={{ fontWeight: 700, color: client.status === 'ACTIVE' ? C.pos : C.fg3 }}>{clientStatusLabel(client.status as string)}</div>
              {str('tier') ? <div style={{ marginTop: 2 }}>{str('tier')}</div> : null}
              {str('zone') ? <div style={{ marginTop: 2 }}>{str('zone')}</div> : null}
            </>}
          />

          {/* KPI strip */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginBottom: 14 }} className="avoid-break">
            {[
              ...(tcdLabel ? [['Crushing', tcdLabel]] : []),
              ['Lifetime Revenue', formatRev(lifeTotal * 100_000)],
              ['Last Visit', lastVisit.label],
              ['Risansi Pumps', rilPumpsTotal > 0 ? `${rilUnits} PCP · ${rilMmp} MMP` : '—'],
              ['Order in Hand', wonOpps.length > 0 ? `${fmtCr(wonTotal)} · ${wonOpps.length}` : '—'],
              ['Open Pipeline', openOpps.length > 0 ? `${fmtCr(pipelineTotal)} · ${openOpps.length}` : '—'],
            ].map(([l, v]) => (
              <div key={l} style={{ border: `1px solid ${C.line}`, borderRadius: 8, padding: 10 }}>
                <div style={{ fontSize: 9, color: C.fg3, textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600 }}>{l}</div>
                <div style={{ fontSize: 15, fontWeight: 700, marginTop: 3, color: C.ink }}>{v}</div>
              </div>
            ))}
          </div>

          <Section title="Account Overview">
            <Facts rows={[
              ['Legal Name', String(client.legal_name)],
              ['Trade Name', str('trade_name')],
              ['Group', str('group_name')],
              ['Client Code', String(client.code)],
              ['Industry', str('industry')],
              ['Business Category', str('business_category')],
              ['Market Type', str('market_type')],
              ['Client Type', str('client_type')],
              ['TCD', tcdLabel],
              ['Capacity', isSugarMill
                ? (str('klpd') ? `${str('klpd')} KLPD` : str('capacity_bracket'))
                : [str('tcd') ? `${str('tcd')} TCD` : null, str('klpd') ? `${str('klpd')} KLPD` : null].filter(Boolean).join(' · ') || str('capacity_bracket')],
              ['Owners', str('rep_name')],
              ['Tour', str('tour_name') ? `${str('tour_name')}${str('tour_zone') ? ` · ${str('tour_zone')}` : ''}` : null],
              ['Zone', str('zone')],
              ['Customer Since', str('since_year')],
              ['Total Outstanding', c.total_outstanding != null ? formatRev(Number(c.total_outstanding)) : null],
            ]} cols={3} />
          </Section>

          <Section title="Location">
            <Facts rows={[
              ['Address', str('address')],
              ['City', str('city')],
              ['State', str('state')],
              ['Country', str('country')],
              ['Google Maps', str('google_maps_url')],
            ]} />
          </Section>

          {chartFYs.length > 0 && (
            <Section title="Year-on-Year Revenue" right="₹ Lakhs">
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr>
                  <th style={TH}></th>
                  {chartFYs.map(f => <th key={f} style={{ ...TH, textAlign: 'right' }}>FY {f}</th>)}
                  <th style={{ ...TH, textAlign: 'right' }}>Total</th>
                </tr></thead>
                <tbody>
                  {([['Pump', 'pump', lifePump], ['Spare', 'spare', lifeSpare]] as const).map(([lbl, key, total]) => (
                    <tr key={lbl}>
                      <td style={{ ...TD, color: C.fg3 }}>{lbl} (₹ L)</td>
                      {chartFYs.map(f => <td key={f} style={{ ...TD, textAlign: 'right', fontFamily: 'monospace' }}>{revByFY[f][key] > 0 ? revByFY[f][key].toFixed(1) : '—'}</td>)}
                      <td style={{ ...TD, textAlign: 'right', fontFamily: 'monospace', fontWeight: 700 }}>{total.toFixed(1)}</td>
                    </tr>
                  ))}
                  <tr style={{ background: C.bgElev }}>
                    <td style={{ ...TD, fontWeight: 700 }}>Total</td>
                    {chartFYs.map(f => { const t = revByFY[f].pump + revByFY[f].spare; return <td key={f} style={{ ...TD, textAlign: 'right', fontFamily: 'monospace', fontWeight: 700 }}>{t > 0 ? t.toFixed(1) : '—'}</td>; })}
                    <td style={{ ...TD, textAlign: 'right', fontFamily: 'monospace', fontWeight: 700, color: C.accent }}>{lifeTotal.toFixed(1)}</td>
                  </tr>
                </tbody>
              </table>
            </Section>
          )}

          <Section title="Competition · Installed Base" right={rilPumpsTotal > 0 ? `Risansi: ${rilUnits} PCP · ${rilMmp} MMP` : undefined}>
            {compSections.length > 0 ? (
              compSections.map(sec => (
                <div key={sec.key} style={{ marginBottom: 10 }} className="avoid-break">
                  <div style={{ fontSize: 9, fontWeight: 700, color: C.fg3, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>
                    {sec.key} · {sec.total} pumps · RIL {sec.sharePct}%
                  </div>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead><tr>{['Make', 'Units', 'Share'].map(h => <th key={h} style={{ ...TH, textAlign: h === 'Make' ? 'left' : 'right' }}>{h}</th>)}</tr></thead>
                    <tbody>
                      {[{ name: 'RIL (us)', units: sec.ril, isRil: true }, ...sec.makers.map(m => ({ ...m, isRil: false }))].filter(m => m.units > 0).map(m => (
                        <tr key={m.name}>
                          <td style={{ ...TD, fontWeight: m.isRil ? 700 : 400, color: m.isRil ? C.accent : C.ink }}>{m.name}</td>
                          <td style={{ ...TD, textAlign: 'right', fontFamily: 'monospace' }}>{m.units}</td>
                          <td style={{ ...TD, textAlign: 'right', fontFamily: 'monospace' }}>{Math.round((m.units / sec.total) * 100)}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))
            ) : <div style={{ color: C.fg3 }}>No competitor installed-base data for this client</div>}
          </Section>

          {clientPumps.length > 0 && (
            <Section title="RIL Pumps"
              right={rilPumpsTotal > 0 ? `${pumpDetailQty} of ${rilPumpsTotal} installed have detail${pumpGap > 0 ? ` · ${pumpGap} missing` : pumpGap < 0 ? ` · ${-pumpGap} more` : ''}` : `${pumpDetailQty} pumps`}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr>{['Model', 'Qty', 'SR No', 'EC No', 'SO No', 'Liquid', 'Capacity', 'Head', 'Supplier'].map((h, i) =>
                  <th key={h} style={{ ...TH, textAlign: i === 1 ? 'right' : 'left' }}>{h}</th>)}</tr></thead>
                <tbody>
                  {clientPumps.map((p, i) => {
                    const supKey = String(p.supplier ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
                    const showSup = supKey && !(supKey === clientKey || supKey.includes(clientKey) || clientKey.includes(supKey));
                    const cell = (v: unknown) => (v == null || v === '') ? '—' : String(v);
                    return (
                      <tr key={i} className="avoid-break">
                        <td style={{ ...TD, fontFamily: 'monospace', fontWeight: 600 }}>{cell(p.pump_model_plate)}</td>
                        <td style={{ ...TD, textAlign: 'right', fontFamily: 'monospace' }}>{Number(p.quantity ?? 1)}</td>
                        <td style={{ ...TD, fontFamily: 'monospace' }}>{cell(p.pump_sl_no)}</td>
                        <td style={{ ...TD, fontFamily: 'monospace' }}>{cell(p.ec_number)}</td>
                        <td style={{ ...TD, fontFamily: 'monospace' }}>{cell(p.so_number)}</td>
                        <td style={TD}>{cell(p.liquid)}</td>
                        <td style={TD}>{cell(p.capacity)}</td>
                        <td style={TD}>{cell(p.head)}</td>
                        <td style={{ ...TD, color: C.fg3 }}>{showSup ? String(p.supplier) : ''}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </Section>
          )}

          {(str('action_points') || c.expected_to_pump != null || c.expected_to_spare != null || str('constraints_notes') || !!c.mgmt_intervention) && (
            <Section title="Plan of Action">
              <Facts rows={[
                ['Expected Pump', c.expected_to_pump != null ? formatRev(Number(c.expected_to_pump)) : null],
                ['Expected Spare', c.expected_to_spare != null ? formatRev(Number(c.expected_to_spare)) : null],
                ['Mgmt Intervention', c.mgmt_intervention ? 'Yes' : null],
                ['PCP Competitor', str('pcp_competitor')],
              ]} cols={3} />
              <div style={{ marginTop: 10 }}>
                <TextBlock label="Action Points" value={str('action_points')} />
                <TextBlock label="Constraints" value={str('constraints_notes')} />
                <TextBlock label="Competitors Observed" value={str('competitors_observed')} />
              </div>
            </Section>
          )}

          {(str('performance_feedback') || str('last_visit_summary') || str('open_remarks') || str('complaint_notes') || str('major_remarks')) && (
            <Section title="Field Intelligence" right={str('performance_feedback') ?? undefined}>
              <TextBlock label="Last Visit Summary" value={str('last_visit_summary')} />
              <TextBlock label="Open Remarks" value={str('open_remarks')} />
              <TextBlock label="Major Remarks" value={str('major_remarks')} />
              <TextBlock label="Open Complaints" value={str('complaint_notes')} />
            </Section>
          )}

          <Section
            title="Comments"
            right={commentTotal > 0 ? `${commentTotal}${commentTotal > comments.length ? ` · showing latest ${comments.length}` : ''}` : undefined}
          >
            {comments.length === 0 ? <div style={{ color: C.fg3 }}>No comments recorded</div> : (
              <div style={{ display: 'grid', gap: 9 }}>
                {comments.map((cm, i) => (
                  <div key={i} className="avoid-break" style={{
                    paddingLeft: 9, borderLeft: `2px solid ${C.accentSoft}`,
                    ...(i > 0 ? { paddingTop: 8, borderTop: `1px solid ${C.line}` } : {}),
                  }}>
                    <div style={{ fontSize: 9.5, color: C.fg3, marginBottom: 2 }}>
                      <strong style={{ color: C.fg2, fontWeight: 700 }}>{cm.who}</strong>
                      {' · '}{fmtDate(cm.created_at)}
                    </div>
                    {/* pre-wrap: the notes are typed with their own line breaks,
                        and collapsing them runs five observations into one
                        paragraph. */}
                    <div style={{ fontSize: 11, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{cm.body}</div>
                  </div>
                ))}
              </div>
            )}
          </Section>

          <Section title="Contacts" right={`${contacts.length}`}>
            {contacts.length === 0 ? <div style={{ color: C.fg3 }}>No contacts recorded</div> : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr>{['Name', 'Designation', 'Phone', 'Email', 'WhatsApp'].map(h => <th key={h} style={TH}>{h}</th>)}</tr></thead>
                <tbody>
                  {contacts.map((ct, i) => (
                    <tr key={i}>
                      <td style={TD}>{String(ct.name ?? '—')}{ct.is_primary ? ' ★' : ''}</td>
                      <td style={TD}>{String(ct.designation ?? '—')}</td>
                      <td style={TD}>{String(ct.phone ?? '—')}</td>
                      <td style={TD}>{String(ct.email ?? '—')}</td>
                      <td style={TD}>{String(ct.whatsapp ?? '—')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Section>

          {allOpps.length > 0 && (
            <Section
              title="Opportunities"
              right={[
                wonTotal > 0 ? `${fmtCr(wonTotal)} order in hand` : null,
                pipelineTotal > 0 ? `${fmtCr(pipelineTotal)} open` : null,
              ].filter(Boolean).join(' · ') || undefined}
            >
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr>{['Product', 'Stage', 'Probability', 'Expected Close', 'Value'].map(h => <th key={h} style={TH}>{h}</th>)}</tr></thead>
                <tbody>
                  {allOpps.map((o, i) => {
                    const won = String(o.stage) === 'Won';
                    return (
                    <tr key={i}>
                      <td style={TD}>{String(o.product ?? '—')}</td>
                      <td style={{ ...TD, fontWeight: won ? 600 : undefined }}>{won ? 'Won · order in hand' : String(o.stage ?? '—')}</td>
                      <td style={TD}>{!won && o.probability != null ? `${o.probability}%` : '—'}</td>
                      <td style={{ ...TD, fontFamily: 'monospace' }}>{fmtCr(Number(o.value_cr))}</td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </Section>
          )}

          <Section title="Visit Timeline" right={visits.length > 0 ? `${visits.length} visits` : undefined}>
            {visits.length === 0 ? <div style={{ color: C.fg3 }}>No visit history</div> : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr>{['Date', 'Rep', 'Purpose', 'Outcome', 'Summary'].map(h => <th key={h} style={TH}>{h}</th>)}</tr></thead>
                <tbody>
                  {visits.map((v, i) => (
                    <tr key={i}>
                      <td style={{ ...TD, whiteSpace: 'nowrap', fontFamily: 'monospace' }}>{fmtDate(v.visit_date as string)}</td>
                      <td style={TD}>{String(v.rep_name ?? '—')}</td>
                      <td style={TD}>{String(v.purpose ?? '—')}</td>
                      <td style={TD}>{String(v.outcome ?? '—')}</td>
                      <td style={TD}>{String(v.summary ?? '—')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Section>

          <div style={{ marginTop: 16, paddingTop: 8, borderTop: `1px solid ${C.line}`, fontSize: 9, color: C.fg3, display: 'flex', justifyContent: 'space-between' }}>
            <span>Risansi Intelligence Platform — Client Profile · {String(client.code)}</span>
            <span>Generated {new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
          </div>
        </div>
      </div>
    </>
  );
}
