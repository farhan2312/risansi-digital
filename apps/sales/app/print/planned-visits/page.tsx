import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import risansiPool from '@/lib/db-risansi';
import { getCurrentUser, clientScopeSql , OWN_OPEN } from '@/lib/risansi-auth';
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
}

export default async function PlannedVisitsPrint({ searchParams }: {
  searchParams: Promise<{ from?: string; to?: string; rep?: string }>;
}) {
  const sp = await searchParams;
  const session = await getServerSession(authOptions);
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
            <tr>
              <th style={{ ...TH, width: 84 }}>Date</th>
              <th style={TH}>Client</th>
              <th style={{ ...TH, width: 78 }}>Code</th>
              <th style={{ ...TH, width: 150 }}>Location</th>
              <th style={{ ...TH, width: 96 }}>Rep</th>
              <th style={TH}>Purpose</th>
              <th style={{ ...TH, width: 74 }}>Status</th>
              <th style={{ ...TH, width: 60 }}>Tier</th>
              <th style={{ ...TH, width: 96 }}>Industry</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                <td style={{ ...TD, whiteSpace: 'nowrap' }}>
                  {fmtDate(r.visit_date)}<span style={{ color: C.fg3 }}> · {fmtDay(r.visit_date)}</span>
                </td>
                <td style={{ ...TD, fontWeight: 600 }}>{r.legal_name}</td>
                <td style={{ ...TD, fontFamily: 'ui-monospace, monospace', color: C.fg3 }}>{r.code}</td>
                <td style={TD}>{loc(r)}</td>
                <td style={TD}>{r.rep_name}</td>
                <td style={{ ...TD, color: C.fg2 }}>{r.purpose || '—'}</td>
                <td style={{ ...TD, textTransform: 'capitalize', color: statusColor(r.status), fontWeight: 600 }}>{r.status}</td>
                <td style={TD}>{r.tier ?? '—'}</td>
                <td style={{ ...TD, color: C.fg2 }}>{r.industry ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
