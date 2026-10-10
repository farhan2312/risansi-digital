// One person's portal usage, as a handout.
//
// The Overall tab answers "is the team using this". This answers "how is this
// one person using it, and how far from the rest are they" — the version you can
// send to a rep or walk through in a review. Same numbers as the adoption
// workbook: both read lib/risansi-person-metrics.ts.
//
// Every figure is shown against the person's own role cohort. Comparing a rep
// with a sysadmin who spends the day on data uploads would report their job
// titles rather than their work.
import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import risansiPool from '@/lib/db-risansi';
import { getCurrentUser } from '@/lib/risansi-auth';
import { PortalUsageReport, moduleOf } from '@/components/risansi/PortalUsageReport';
import { loadPersonMetrics, comparePerson, cohortFor, PERSON_WINDOWS } from '@/lib/risansi-person-metrics';
import { windowStartSql } from '@/lib/risansi-audit-overall';

export const dynamic = 'force-dynamic';

const NOTICE = {
  maxWidth: 480, margin: '80px auto', textAlign: 'center' as const,
  fontFamily: '"Helvetica Neue", Arial, system-ui, sans-serif',
  fontSize: 14, color: '#64748B',
};



export default async function PortalUsagePrint({ searchParams }: {
  searchParams: Promise<{ user?: string; win?: string }>;
}) {
  const sp = await searchParams;
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) redirect('/api/auth/signin');
  const me = await getCurrentUser();
  // Same gate as the Audit Log page this is launched from. An activity report
  // about a named individual is not a document to widen access to by accident.
  if (me.role !== 'sysadmin') {
    return <div style={NOTICE}>You do not have access to this report.</div>;
  }

  const win = PERSON_WINDOWS.find(w => w.id === sp.win) ?? PERSON_WINDOWS[0];
  const email = (sp.user ?? '').trim().toLowerCase();

  const all = await loadPersonMetrics(risansiPool, win.days);
  const subject = all.find(r => r.email.toLowerCase() === email);
  if (!subject) {
    return <div style={NOTICE}>
      {email ? <>No active user with the address <strong>{email}</strong>.</> : 'Pick a person on the Audit Log page first.'}
    </div>;
  }

  const { rows: cohort, label: cohortLabel } = cohortFor(subject, all);
  const cmp = comparePerson(subject, cohort);
  const by = (k: string) => cmp.find(m => m.key === k)!;

  // Where their time went, and what the cohort's split looks like, so a rep who
  // lives in one screen is visible as such.
  const cohortIds = cohort.map(r => r.id).join(',') || '0';
  const winClause = win.days ? ` AND p.occurred_at >= ${windowStartSql(win.days)}` : '';
  const modules = await risansiPool.query<{ path: string; mine: string; cohort_hours: string }>(`
    SELECT p.path,
           COALESCE(round(sum(p.active_seconds) FILTER (WHERE p.user_id = ${subject.id})/3600.0, 2), 0)::text AS mine,
           COALESCE(round(sum(p.active_seconds)/3600.0, 2), 0)::text AS cohort_hours
      FROM page_activity p
     WHERE p.user_id IN (${cohortIds})${winClause}
     GROUP BY p.path`).then(r => r.rows).catch(() => []);

  const mineByMod = new Map<string, number>(), cohortByMod = new Map<string, number>();
  for (const r of modules) {
    const m = moduleOf(r.path);
    mineByMod.set(m, (mineByMod.get(m) ?? 0) + Number(r.mine));
    cohortByMod.set(m, (cohortByMod.get(m) ?? 0) + Number(r.cohort_hours));
  }
  const modRows = [...mineByMod.entries()]
    .map(([m, h]) => ({ m, mine: h, avg: (cohortByMod.get(m) ?? 0) / Math.max(cohort.length, 1) }))
    .filter(r => r.mine > 0.01)
    .sort((a, b) => b.mine - a.mine)
    .slice(0, 10);

  // Month by month, so a report sent in September is not read as if the work
  // happened evenly across the window.
  const trend = await risansiPool.query<{ ym: string; hours: string; days: string; sessions: string }>(`
    SELECT to_char(p.occurred_at AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM') AS ym,
           round(sum(p.active_seconds)/3600.0, 1)::text AS hours,
           count(DISTINCT (p.occurred_at AT TIME ZONE 'Asia/Kolkata')::date)::text AS days,
           count(DISTINCT p.session_id)::text AS sessions
      FROM page_activity p WHERE p.user_id = ${subject.id}${winClause}
     GROUP BY 1 ORDER BY 1`).then(r => r.rows).catch(() => []);

  const generated = new Date().toLocaleString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
    timeZone: 'Asia/Kolkata',
  });

  const HEADLINE = ['hours', 'days_active', 'visits_owned', 'audited_actions'].map(by);
  const groups = [...new Set(cmp.map(m => m.group))];

  return (
    <PortalUsageReport
      subject={subject}
      cmp={cmp}
      cohortLabel={cohortLabel}
      cohortSize={cohort.length}
      winLabel={win.label}
      modRows={modRows}
      trend={trend.map(t => ({
        ym: t.ym, hours: Number(t.hours), days: Number(t.days), sessions: Number(t.sessions),
      }))}
      generated={generated}
      generatedBy={session.user?.name || me.email || ''}
    />
  );
}
