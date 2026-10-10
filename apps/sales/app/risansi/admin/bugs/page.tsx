import type { CSSProperties } from 'react';
import { Topbar, MultiSelectFilter } from '@/components/risansi';
import { TextSearchFilter } from '@/components/risansi/TextSearchFilter';
import risansiPool from '@/lib/db-risansi';
import { getCurrentUser } from '@/lib/risansi-auth';
import { AccessDenied } from '../_components/AccessDenied';
import { BugsBoard, type BugCard } from '@/components/risansi/BugsBoard';
import { BUG_SEVERITIES, BUG_SEVERITY_LABELS, turnaround } from '@/lib/risansi-bugs';

export const dynamic = 'force-dynamic';

const iso = (v: unknown): string | null => (v ? new Date(v as string).toISOString() : null);

interface KpiRow { total: number; open: number; active: number; fixed: number; avg_secs: string | null; avg_n: number }

export default async function BugsPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const me = await getCurrentUser();
  if (me.role !== 'sysadmin') return <AccessDenied crumbs={['System Admin', 'Bugs']} />;

  const sp = await searchParams;
  const sevFilts = typeof sp.severity === 'string' && sp.severity ? sp.severity.split(',').filter(Boolean) : [];
  const q        = typeof sp.q === 'string' ? sp.q.trim() : '';

  const conds: string[] = [];
  const vals: (string | string[])[] = [];
  let idx = 1;
  if (sevFilts.length) { conds.push(`b.severity = ANY($${idx})`); vals.push(sevFilts); idx++; }
  if (q) { conds.push(`(b.title ILIKE $${idx} OR b.description ILIKE $${idx} OR b.reporter_name ILIKE $${idx})`); vals.push(`%${q}%`); idx++; }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';

  const [bugs, kpi] = await Promise.all([
    (async (): Promise<BugCard[]> => {
      const { rows } = await risansiPool.query(`
        SELECT b.id, b.title, b.description, b.page_url, b.type, b.severity, b.status,
               b.reporter_name, b.reporter_email, b.recorded_by, b.recorded_at,
               b.resolved_by, b.testing_at, b.resolved_at, b.resolution_notes, b.created_at,
               -- Every screenshot on the bug, oldest first, so the board can show
               -- the whole set rather than just the one the old join could carry.
               COALESCE((
                 SELECT array_agg(s.id ORDER BY s.id)
                   FROM bug_screenshots s WHERE s.bug_id = b.id
               ), '{}') AS screenshot_ids
        FROM bugs b
        ${where}
        ORDER BY b.created_at DESC`, vals);
      return rows.map(r => ({
        id: r.id, title: r.title, description: r.description, page_url: r.page_url,
        type: r.type, severity: r.severity, status: r.status,
        reporter_name: r.reporter_name, reporter_email: r.reporter_email,
        recorded_by: r.recorded_by, recorded_at: iso(r.recorded_at),
        resolved_by: r.resolved_by, testing_at: iso(r.testing_at), resolved_at: iso(r.resolved_at),
        resolution_notes: r.resolution_notes,
        created_at: iso(r.created_at) as string,
        screenshot_ids: (r.screenshot_ids ?? []).map(Number),
      }));
    })(),
    (async (): Promise<KpiRow> => {
      const { rows } = await risansiPool.query<KpiRow>(`
        SELECT
          COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE status <> 'fixed')::int AS open,
          COUNT(*) FILTER (WHERE status IN ('in_progress','testing'))::int AS active,
          COUNT(*) FILTER (WHERE status = 'fixed')::int AS fixed,
          -- To the handover: testing where there is one, else the day it was
          -- fixed. Measuring everything to 'fixed' counted however long a bug
          -- waited on somebody else to verify it, and left out the ones sitting
          -- in testing right now. Falling back to resolved_at keeps the bugs
          -- that went straight to fixed in the figure, and carries the 71
          -- closed before testing_at existed, which have no testing date to
          -- find.
          AVG(EXTRACT(EPOCH FROM (COALESCE(testing_at, resolved_at) - created_at)))
            FILTER (WHERE COALESCE(testing_at, resolved_at) IS NOT NULL) AS avg_secs,
          COUNT(*) FILTER (WHERE COALESCE(testing_at, resolved_at) IS NOT NULL)::int AS avg_n
        FROM bugs b
        ${where}`, vals);
      return rows[0] ?? { total: 0, open: 0, active: 0, fixed: 0, avg_secs: null, avg_n: 0 };
    })(),
  ]);

  const avgSecs = kpi.avg_secs != null ? Number(kpi.avg_secs) : null;
  const avgLabel = avgSecs != null && Number.isFinite(avgSecs)
    ? turnaround(new Date(0), new Date(avgSecs * 1000)) : '—';
  const anyFilter = sevFilts.length > 0 || !!q;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ position: 'sticky', top: 0, zIndex: 10 }}>
        <Topbar crumbs={['System Admin', 'Bugs']} />
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '22px 24px 40px', background: 'var(--bg)' }}>
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 20, fontWeight: 500, color: 'var(--fg)' }}>Bug Tracker</div>
          <div style={{ fontSize: 12, color: 'var(--fg-3)', marginTop: 3 }}>
            Reports filed through the portal. Drag a card across the pipeline as you record, work, test and close it.
          </div>
        </div>

        {/* KPI cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12, marginBottom: 16 }}>
          <Kpi label="Total Bugs"    value={String(kpi.total)}  color="var(--fg)" />
          <Kpi label="Open"          value={String(kpi.open)}   color="var(--accent)" sub="Not yet fixed" />
          <Kpi label="On Hold + Testing" value={String(kpi.active)} color="var(--warn)" sub="parked or under verification" />
          <Kpi label="Fixed"         value={String(kpi.fixed)}  color="var(--pos)" sub="Resolved & closed" />
          <Kpi label="Avg Turnaround" value={avgLabel}          color="var(--fg)"
            sub={avgSecs != null ? `Reported → handed over · ${kpi.avg_n} bug${kpi.avg_n === 1 ? '' : 's'}` : 'Reported → handed over'} />
        </div>

        {/* Filters */}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginBottom: 14 }}>
          <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '0.08em', marginRight: 2 }}>Filter</span>
          <MultiSelectFilter param="severity" label="Severity"
            options={BUG_SEVERITIES.map(s => ({ value: s, label: BUG_SEVERITY_LABELS[s] }))} selected={sevFilts} />
          <TextSearchFilter param="q" placeholder="Search title / reporter…" width={220} />
          {anyFilter && (
            <a href="/risansi/admin/bugs" style={{ fontSize: 11, color: 'var(--neg)', textDecoration: 'none' }}>Clear</a>
          )}
        </div>

        {bugs.length === 0 && !anyFilter ? (
          <div style={{ ...PANEL, padding: '48px 20px', textAlign: 'center' }}>
            <div style={{ fontSize: 30, marginBottom: 8 }}>🐞</div>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--fg)' }}>No bugs reported yet</div>
            <div style={{ fontSize: 12, color: 'var(--fg-3)', marginTop: 4 }}>
              Users can file bugs from the “Report a Bug” button on the dashboard.
            </div>
          </div>
        ) : (
          <BugsBoard initialBugs={bugs} />
        )}
      </div>
    </div>
  );
}

function Kpi({ label, value, color, sub }: { label: string; value: string; color: string; sub?: string }) {
  return (
    <div style={{ ...PANEL, padding: 14 }}>
      <div style={{ fontSize: 10, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{label}</div>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 26, marginTop: 3, color, lineHeight: 1.1 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: 'var(--fg-3)', marginTop: 3 }}>{sub}</div>}
    </div>
  );
}

const PANEL: CSSProperties = {
  background: 'var(--bg-paper)', border: '1px solid var(--line)', borderRadius: 'var(--radius)',
};
