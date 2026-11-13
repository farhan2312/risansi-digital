import { redirect } from 'next/navigation';
import Link from 'next/link';
import { Topbar } from '@/components/risansi';
import { getCurrentUser, getSession, hasRole } from '@/lib/risansi-auth';
import { getReport, getFilterOptions } from '@/app/actions/risansi-reports';
import { ReportViewer } from '@/components/risansi/reports/ReportViewer';

export const dynamic = 'force-dynamic';

export default async function ReportPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user?.email) redirect('/api/auth/signin');

  const { id } = await params;
  const user = await getCurrentUser();

  // getReport refuses anything that is not the reader's own or shared with
  // them, in the WHERE clause rather than afterwards, so the refusal and the
  // "no such report" case are deliberately the same message: whether a
  // report exists is not something to leak either.
  const [report, options] = await Promise.all([getReport(Number(id)), getFilterOptions()]);

  if (!report.ok) {
    return (
      <>
        <Topbar crumbs={['Risansi', { label: 'Reports', href: '/risansi/reports' }, 'Not available']} />
        <div style={{ padding: 40, maxWidth: 520 }}>
          <h1 style={{ margin: 0, fontSize: 17, color: 'var(--fg)' }}>This report is not available</h1>
          <p style={{ fontSize: 13, color: 'var(--fg-3)', marginTop: 8 }}>{report.error}</p>
          <Link href="/risansi/reports" style={{ fontSize: 13, color: 'var(--accent)' }}>
            Back to Reports
          </Link>
        </div>
      </>
    );
  }

  const r = report.data;
  return (
    <>
      <Topbar crumbs={['Risansi', { label: 'Reports', href: '/risansi/reports' }, r.title]} />
      <ReportViewer
        id={r.id}
        title={r.title}
        description={r.description}
        ownerName={r.ownerName}
        mine={r.canEdit}
        canBuild={hasRole(user.role, 'rep')}
        pinned={!!r.pinned}
        doc={r.doc}
        options={options.ok ? options.data
          : { states: [], industries: [], clientTypes: [], tiers: [], reps: [] }}
      />
    </>
  );
}
