import { redirect } from 'next/navigation';
import Link from 'next/link';
import { Topbar } from '@/components/risansi';
import { getSession } from '@/lib/risansi-auth';
import { getReport, getFilterOptions } from '@/app/actions/risansi-reports';
import { ReportBuilder } from '@/components/risansi/reports/ReportBuilder';

export const dynamic = 'force-dynamic';

/**
 * The builder, for a report you own.
 *
 * `canEdit` comes from getReport, which sets it by comparing the row's
 * owner_id to the session — so a recipient who types /edit onto the URL of a
 * report shared with them gets the refusal below rather than a builder whose
 * Save would fail. The save action re-checks ownership in its own WHERE
 * clause regardless; this screen is the courtesy, not the control.
 */
export default async function EditReportPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user?.email) redirect('/api/auth/signin');

  const { id } = await params;
  const [report, options] = await Promise.all([getReport(Number(id)), getFilterOptions()]);

  if (!report.ok || !report.data.canEdit) {
    return (
      <>
        <Topbar crumbs={['Risansi', { label: 'Reports', href: '/risansi/reports' }, 'Cannot edit']} />
        <div style={{ padding: 40, maxWidth: 520 }}>
          <h1 style={{ margin: 0, fontSize: 17, color: 'var(--fg)' }}>This report cannot be edited here</h1>
          <p style={{ fontSize: 13, color: 'var(--fg-3)', marginTop: 8, lineHeight: 1.6 }}>
            {report.ok
              ? 'It belongs to somebody else. Open it and take a copy — the copy is yours and you can change anything on it.'
              : report.error}
          </p>
          <Link href={report.ok ? `/risansi/reports/${report.data.id}` : '/risansi/reports'}
                style={{ fontSize: 13, color: 'var(--accent)' }}>
            {report.ok ? 'Open the report' : 'Back to Reports'}
          </Link>
        </div>
      </>
    );
  }

  const r = report.data;
  return (
    <>
      <Topbar crumbs={['Risansi', { label: 'Reports', href: '/risansi/reports' },
                       { label: r.title, href: `/risansi/reports/${r.id}` }, 'Edit']} />
      <ReportBuilder
        id={r.id}
        title={r.title}
        description={r.description}
        doc={r.doc}
        options={options.ok ? options.data
          : { states: [], industries: [], clientTypes: [], tiers: [], reps: [] }}
      />
    </>
  );
}
