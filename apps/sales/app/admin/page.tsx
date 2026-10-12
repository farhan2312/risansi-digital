/**
 * Users & Access — now at Risansi Digital.
 *
 * Phase 4b. This page approved access requests, created people, changed
 * roles, reset passwords, deactivated and deleted. All of it happens once at
 * digital.risansi.com/requests/people, and reaches every portal rather than
 * this one.
 *
 * The route and its sysadmin gate stay. Somebody looking for user management
 * will look where it has always been, and a page saying where it went is
 * worth more than a 404 or a vanished menu item they will read as a
 * permissions problem.
 */

import { redirect } from 'next/navigation';
import { getSession, hasRole } from '@/lib/risansi-auth';
import { Topbar } from '@/components/risansi';

export const dynamic = 'force-dynamic';

const HUB = (process.env.HUB_URL || 'https://digital.risansi.com').replace(/\/+$/, '');

export default async function AdminPage() {
  const session = await getSession();
  const role = session?.user?.role ?? '';

  if (!session?.user?.email || !hasRole(role, 'sysadmin')) {
    redirect('/risansi');
  }

  return (
    <>
      <Topbar crumbs={[{ label: 'Users & Access', href: '/admin' }]} />
      <div style={{ maxWidth: 680, padding: '48px 28px' }}>
        <h1 style={{ fontSize: 22, fontWeight: 600, color: 'var(--title)', margin: 0 }}>
          Users &amp; Access moved
        </h1>
        <p style={{ marginTop: 12, color: 'var(--fg-2)', lineHeight: 1.6 }}>
          Creating somebody, changing their role, resetting a password and
          switching an account off are all done at Risansi Digital now. One
          place, and it reaches every portal at once instead of only this one.
        </p>
        <p style={{ marginTop: 12, color: 'var(--fg-2)', lineHeight: 1.6 }}>
          Sales roles are still sales roles — rep, manager, staff, admin,
          sysadmin. They are chosen there, from the same list that was here.
        </p>
        <p style={{ marginTop: 12, color: 'var(--fg-2)', lineHeight: 1.6 }}>
          Reps and managers, tours and targets have not moved. They are this
          portal&rsquo;s own data and stay on <strong>Reps &amp; Managers</strong>.
        </p>
        <a
          href={`${HUB}/requests/people`}
          target="_blank"
          rel="noopener"
          style={{
            display: 'inline-block', marginTop: 22, padding: '10px 16px',
            borderRadius: 8, background: 'var(--accent)', color: 'var(--on-accent)',
            textDecoration: 'none', fontWeight: 500,
          }}
        >
          Manage people at Risansi Digital
        </a>
        <p style={{ marginTop: 22, fontSize: 13, color: 'var(--fg-3)', lineHeight: 1.6 }}>
          You will need approver access there. If you had it here and not
          there, ask an approver to add you — it is one row on their People tab.
        </p>
      </div>
    </>
  );
}
