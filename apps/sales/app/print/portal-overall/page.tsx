// The Overall tab, as a handout. Fetch here, layout in PortalOverallReport.
import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import risansiPool from '@/lib/db-risansi';
import { getCurrentUser } from '@/lib/risansi-auth';
import { PortalOverallReport } from '@/components/risansi/PortalOverallReport';
import { loadOverall, OVERALL_WINDOWS } from '@/lib/risansi-audit-overall';

export const dynamic = 'force-dynamic';

const ROLES = ['rep', 'manager', 'admin', 'sysadmin'];

const NOTICE = {
  maxWidth: 480, margin: '80px auto', textAlign: 'center' as const,
  fontFamily: '"Helvetica Neue", Arial, system-ui, sans-serif',
  fontSize: 14, color: '#64748B',
};

export default async function PortalOverallPrint({ searchParams }: {
  searchParams: Promise<{ win?: string; role?: string; user?: string }>;
}) {
  const sp = await searchParams;
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) redirect('/api/auth/signin');
  const me = await getCurrentUser();
  // Same gate as the Audit Log page this is launched from.
  if (me.role !== 'sysadmin') {
    return <div style={NOTICE}>You do not have access to this report.</div>;
  }

  const win = OVERALL_WINDOWS.some(w => w.id === sp.win) ? sp.win! : '30d';
  const role = sp.role && ROLES.includes(sp.role) ? sp.role : '';
  const user = (sp.user ?? '').trim().toLowerCase();

  const d = await loadOverall(risansiPool, { win, role, user });

  const filters = [
    OVERALL_WINDOWS.find(w => w.id === win)?.label ?? win,
    role ? `${role}s only` : null,
    user || null,
  ].filter(Boolean).join(' · ');

  return (
    <PortalOverallReport
      d={d} win={win} role={role} user={user} filters={filters}
      generated={new Date().toLocaleString('en-IN', {
        day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
        timeZone: 'Asia/Kolkata',
      })}
      generatedBy={session.user?.name || me.email || ''}
    />
  );
}
