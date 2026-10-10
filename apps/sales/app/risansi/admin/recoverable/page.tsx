import { Topbar } from '@/components/risansi';
import risansiPool from '@/lib/db-risansi';
import { getCurrentUser, hasRole } from '@/lib/risansi-auth';
import { RecoverableClients, type ArchivedClient } from '@/components/risansi/OwnershipAdmin';

export const dynamic = 'force-dynamic';

// Recoverable items.
//
// Deleting a client sets deleted_at rather than removing the row, and every
// query in the application filters on it — so an archived client disappears from
// lists, search, dropdowns, exports and dashboards exactly as a deletion would.
// What was missing was the way back. Without this page, "archived" is
// indistinguishable from "gone" for anyone who is not writing SQL, which makes
// the soft delete a technicality rather than a safety net.
//
// Clients are what it holds today because they are what the ownership migration
// archived. Other soft-deletable records can be added as sections without
// rebuilding anything.

export default async function RecoverablePage() {
  const me = await getCurrentUser();
  if (!hasRole(me.role, 'admin')) {
    return (
      <div>
        <Topbar crumbs={['Admin', 'Recoverable Items']} />
        <div style={{ padding: 24, fontSize: 14, color: 'var(--fg-2)' }}>
          You need admin access to restore deleted items.
        </div>
      </div>
    );
  }

  let clients: ArchivedClient[] = [];
  try {
    clients = (await risansiPool.query<ArchivedClient>(`
      SELECT c.id::int AS id, c.code, c.legal_name AS name, c.status,
             c.deleted_at::text AS archived_at,
             (SELECT count(*)::int FROM opportunities o WHERE o.client_id = c.id) AS opps
        FROM clients c
       WHERE c.deleted_at IS NOT NULL
       ORDER BY c.deleted_at DESC, c.code
       LIMIT 500`)).rows;
  } catch (e) {
    console.error('[admin/recoverable]', e);
  }

  const keeping = clients.reduce((s, c) => s + c.opps, 0);

  return (
    <div>
      <Topbar crumbs={['Admin', 'Recoverable Items']} />
      <div style={{ padding: '20px 22px 40px' }}>
        <p style={{ fontSize: 13, color: 'var(--fg-2)', maxWidth: '68ch', margin: '0 0 6px' }}>
          Archived clients are hidden everywhere in the application but nothing about them was
          destroyed. Restoring one brings it back with no owner, so it will appear under
          Reps &amp; Managers → Unassigned until you give it one.
        </p>
        {keeping > 0 && (
          <p style={{ fontSize: 12.5, color: 'var(--fg-3)', margin: '0 0 16px' }}>
            {clients.length} archived {clients.length === 1 ? 'client' : 'clients'}, between them
            holding {keeping} {keeping === 1 ? 'opportunity' : 'opportunities'} that would have been
            lost to a hard delete.
          </p>
        )}
        <RecoverableClients clients={clients} />
      </div>
    </div>
  );
}
