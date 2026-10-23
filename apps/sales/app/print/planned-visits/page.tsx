import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import risansiPool from '@/lib/db-risansi';
import { OWN_OPEN, clientScopeSql, getCurrentUser, getSession } from '@/lib/risansi-auth';
import { AutoPrint } from '@/components/risansi/AutoPrint';
import { C, TH, TD, DocHeader } from '@/components/risansi/print-shared';

// Landscape — the table is wide (9 columns).
const LANDSCAPE_CSS = `
  @page { size: A4 landscape; margin: 11mm 9mm; }
  @media print {
    .no-print { display: none !important; }
    .print-root { background: #fff !important; }
    thead { display: table-header-group; }
    tr { break-inside: avoid; page-break-inside: avoid; }
  }
  .print-root { color: #0F172A; }
`;

// Local date components (not toISOString, which shifts the day in +TZ regions).
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
function fmtDate(v: string | null): string {
  if (!v) return '—';
  const d = new Date(v);
  return isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}
function fmtDay(v: string | null): string {
  if (!v) return '';
  const d = new Date(v);
  return isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-IN', { weekday: 'short' });
}
const statusColor = (s: string) => s === 'completed' ? C.pos : s === 'checked-in' ? C.warn : C.fg3;

interface VRow {
  visit_date: string; status: string; purpose: string;
  legal_name: string; code: string; city: string | null; state: string | null;
  zone: string | null; tier: string | null; industry: string | null; rep_name: string;
  /** What the rep wrote up afterwards, and what they committed to next. */
  summary: string | null; action_points: string | null;
}

export default async function PlannedVisitsPrint({ searchParams }: {
  searchParams: Promise<{ from?: string; to?: string; rep?: string }>;
}) {
  const sp = await searchParams;
  const session = await getSession();
  if (!session?.user?.email) redirect('/api/auth/signin');
  const viewer = await getCurrentUser();

  const today = new Date();
  const valid = (s?: string) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null);
  const from  = valid(sp.from) ?? iso(new Date(today.getFullYear(), today.getMonth(), 1));
  const to    = valid(sp.to)   ?? iso(new Date(today.getFullYear(), today.getMonth() + 1, 0));
  const repId = sp.rep && /^\d+$/.test(sp.rep) ? Number(sp.rep) : null;

  const conds = ['v.visit_date >= $1', 'v.visit_date <= $2'];
  const params: unknown[] = [from, to];
  if (repId) { params.push(repId); conds.push(`v.rep_id = $${params.length}`); }
  const scope = clientScopeSql(viewer, 'v.client_id', OWN_OPEN.visit('v'));   // null for admin/sysadmin
  if (scope) conds.push(scope);

  let rows: VRow[] = [];
  try {
    rows = (await risansiPool.query<VRow>(
      `SELECT v.visit_date::text AS visit_date, v.status, COALESCE(v.purpose, '') AS purpose,
              c.legal_name, c.code, c.city, c.state, c.zone, c.tier, c.industry,
              v.summary,
              -- Action points come from the Action Register, not from
              -- visits.action_points. That column is empty on all 1,570 visits
              -- — nothing has ever written to it — while 106 real actions hang
              -- off visits as tasks. Printing the column would have given a
              -- page of dashes.
              --
              -- follow_up_text is the fallback: 17 visits carry one and no
              -- task, from the visit form's own follow-up box.
              COALESCE(
                (SELECT string_agg(
                          t.title || CASE WHEN t.due_date IS NOT NULL
                                          THEN ' (by ' || to_char(t.due_date,'DD Mon') || ')'
                                          ELSE '' END,
                          '; ' ORDER BY t.due_date NULLS LAST, t.id)
                   FROM tasks t WHERE t.visit_id = v.id),
                NULLIF(btrim(v.follow_up_text), '')
              ) AS action_points,
              COALESCE(r.name, '—') AS rep_name
         FROM visits v
         JOIN clients c ON c.id = v.client_id
         LEFT JOIN users r ON r.id = v.rep_id
        WHERE ${conds.join(' AND ')}
        ORDER BY v.visit_date ASC, c.legal_name ASC
        LIMIT 3000`, params)).rows;
  } catch (e) { console.error('[print/planned-visits]', e); }

  let repName: string | null = null;
  if (repId) {
    repName = (await risansiPool.query<{ name: string }>(`SELECT name FROM users WHERE id = $1`, [repId])).rows[0]?.name ?? null;
  }

  const loc = (r: VRow) => {
    const cs = [r.city, r.state].filter(Boolean).join(', ');
    return [cs, r.zone].filter(Boolean).join(' · ') || '—';
  };

  return (
    <div className="print-root" style={{ maxWidth: 1140, margin: '0 auto', padding: '0 4px 40px', fontFamily: '"Helvetica Neue", Arial, system-ui, sans-serif', fontSize: 12, lineHeight: 1.5, color: C.ink }}>
      <style>{LANDSCAPE_CSS}</style>
      <AutoPrint />

      <DocHeader
        kind="Field Visits"
        title="Planned Visits"
        subtitle={<>{fmtDate(from)} — {fmtDate(to)} · {repName ?? 'All reps'}</>}
        meta={<>{rows.length} visit{rows.length !== 1 ? 's' : ''}<br />Generated {fmtDate(iso(today))}</>}
      />

      {rows.length === 0 ? (
        <div style={{ padding: '40px 0', textAlign: 'center', color: C.fg3 }}>
          No visits found in this date range.
        </div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            {/* The six headings this report was asked for, in that order.
                Code, Location, Purpose and Tier came off to make room: summary
                and action points are prose and need real width, and eleven
                columns of it on A4 is a wall nobody reads. Status stays — on a
                sheet that carries planned and completed visits together, which
                one a row is matters. */}
            <tr>
              <th style={{ ...TH, width: 100 }}>Rep</th>
              <th style={{ ...TH, width: 170 }}>Client</th>
              <th style={{ ...TH, width: 100 }}>Industry</th>
              <th style={{ ...TH, width: 84 }}>Visit date</th>
              <th style={TH}>Visit summary</th>
              <th style={TH}>Action points</th>
              <th style={{ ...TH, width: 74 }}>Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                <td style={TD}>{r.rep_name}</td>
                <td style={{ ...TD, fontWeight: 600 }}>
                  {r.legal_name}
                  {/* The code keeps its place under the name rather than in a
                      column of its own — it is how an account is looked up
                      afterwards, and it costs no width here. */}
                  <div style={{ fontFamily: 'ui-monospace, monospace', color: C.fg3, fontWeight: 400 }}>
                    {r.code}{loc(r) ? ` · ${loc(r)}` : ''}
                  </div>
                </td>
                <td style={{ ...TD, color: C.fg2 }}>{r.industry ?? '—'}</td>
                <td style={{ ...TD, whiteSpace: 'nowrap' }}>
                  {fmtDate(r.visit_date)}<span style={{ color: C.fg3 }}> · {fmtDay(r.visit_date)}</span>
                </td>
                {/* Prose, so it wraps and breaks anywhere rather than forcing
                    the table wider than the page. A planned visit has neither
                    yet, which is what the dash means. */}
                <td style={{ ...TD, color: C.fg2, overflowWrap: 'anywhere' }}>{r.summary?.trim() || '—'}</td>
                <td style={{ ...TD, color: C.fg2, overflowWrap: 'anywhere' }}>{r.action_points?.trim() || '—'}</td>
                <td style={{ ...TD, textTransform: 'capitalize', color: statusColor(r.status), fontWeight: 600 }}>{r.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
