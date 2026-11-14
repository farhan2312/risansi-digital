import { redirect } from 'next/navigation';
import { Topbar } from '@/components/risansi';
import { getCurrentUser, getSession, hasRole } from '@/lib/risansi-auth';
import { Learn } from '@/components/risansi/reports/Learn';

/**
 * How reports work.
 *
 * A static page, except for one thing: what it shows depends on whether the
 * reader can build. `force-dynamic` because the role comes from the session,
 * and a cached copy of the builders' version served to a viewer would teach
 * them a screen they cannot open.
 *
 * `learn` sits beside `[id]`, and a static segment wins over a dynamic one —
 * report ids are numeric anyway, so there is nothing to collide with.
 */
export const dynamic = 'force-dynamic';

export default async function LearnReportsPage() {
  const session = await getSession();
  if (!session?.user?.email) redirect('/api/auth/signin');

  const user = await getCurrentUser();

  return (
    <>
      <Topbar crumbs={['Risansi', { label: 'Reports', href: '/risansi/reports' }, 'How reports work']} />
      <Learn canBuild={hasRole(user.role, 'rep')} />
    </>
  );
}
