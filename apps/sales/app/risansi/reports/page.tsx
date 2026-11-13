import { redirect } from 'next/navigation';
import { Topbar } from '@/components/risansi';
import { getCurrentUser, getSession, hasRole } from '@/lib/risansi-auth';
import { listMyReports, listSharedReports } from '@/app/actions/risansi-reports';
import { ReportsHome } from '@/components/risansi/reports/ReportsHome';

// Reports is open to every signed-in role: reading one is reading your own
// numbers, which you were already entitled to. Building one is rep and above,
// which is what `canBuild` carries down.
//
// force-dynamic because the list is per-person and changes whenever anybody
// shares anything. There is nothing here worth caching across readers.
export const dynamic = 'force-dynamic';

export default async function ReportsPage() {
  const session = await getSession();
  if (!session?.user?.email) redirect('/api/auth/signin');

  const user = await getCurrentUser();
  const [mine, shared] = await Promise.all([listMyReports(), listSharedReports()]);

  return (
    <>
      <Topbar crumbs={['Risansi', 'Reports']} />
      <ReportsHome
        mine={mine.ok ? mine.data : []}
        shared={shared.ok ? shared.data : []}
        canBuild={hasRole(user.role, 'rep')}
      />
    </>
  );
}
