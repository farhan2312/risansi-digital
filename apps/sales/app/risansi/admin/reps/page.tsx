import type { CSSProperties } from 'react';
import { Topbar } from '@/components/risansi';
import risansiPool from '@/lib/db-risansi';
import { getCurrentUser, hasRole } from '@/lib/risansi-auth';
import { AddRepButton } from '@/components/risansi/AddRepButton';
import { AdminRepsRoster } from '@/components/risansi/AdminRepsRoster';
import {
  TeamMatrix, UnassignedClients, MoveClients, RepClients,
  type Person, type UnownedClient, type RepClient,
} from '@/components/risansi/OwnershipAdmin';

export const dynamic = 'force-dynamic';

// Reps & Managers.
//
// This page used to administer tours, which is the thing the ownership model
// replaced. Routes are not managed here any more and have no tab: a route is an
// attribute of a client, so it is edited on the client. What is left is the three
// questions this page actually exists to answer — who works here, who reports to
// whom, and which clients still have nobody.

async function q<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try { return await fn(); } catch (e) { console.error('[admin/reps]', e); return fallback; }
}

const TABS = [
  { id: 'reps',       label: 'Reps' },
  { id: 'clients',    label: 'Clients' },
  { id: 'teams',      label: 'Teams' },
  { id: 'unassigned', label: 'Unassigned' },
] as const;
type TabId = typeof TABS[number]['id'];

export default async function RepsAndManagersPage({
  searchParams,
}: { searchParams: Promise<{ [k: string]: string | string[] | undefined }> }) {
  const me = await getCurrentUser();
  if (!hasRole(me.role, 'admin')) {
    return (
      <div>
        <Topbar crumbs={['Admin', 'Reps & Managers']} />
        <div style={{ padding: 24, fontSize: 14, color: 'var(--fg-2)' }}>
          You need admin access to manage reps and teams.
        </div>
      </div>
    );
  }

  const sp = await searchParams;
  const raw = typeof sp.tab === 'string' ? sp.tab : 'reps';
  const tab: TabId = (TABS.some(t => t.id === raw) ? raw : 'reps') as TabId;

  // Which rep the Clients tab is showing. Falls back to the first person with a
  // book, so the tab opens on something rather than on an empty picker.
  const repParam = typeof sp.rep === 'string' ? Number(sp.rep) : NaN;

  const [people, pairs, unowned] = await Promise.all([
    // Owned and covered are counted separately on purpose: a rep's own book and
    // the accounts they merely back up are different numbers, and adding them
    // together is what made the old per-rep counts sum to more than the client base.
    q<Person[]>(async () => (await risansiPool.query<Person>(`
      SELECT u.id::int AS id, u.name, u.role,
             (SELECT count(*)::int FROM clients c
               WHERE c.primary_rep_id = u.id AND c.deleted_at IS NULL) AS owned,
             (SELECT count(*)::int FROM client_secondary_reps s
                JOIN clients c ON c.id = s.client_id AND c.deleted_at IS NULL
               WHERE s.rep_id = u.id) AS covered,
             (SELECT count(*)::int FROM manager_reps mr WHERE mr.manager_id = u.id) AS team
        FROM users u
       WHERE u.is_active = TRUE AND u.role IN ('rep','manager')
       ORDER BY u.role DESC, u.name ASC`)).rows, []),

    q<{ manager_id: number; rep_id: number }[]>(async () => (await risansiPool.query<{ manager_id: number; rep_id: number }>(
      'SELECT manager_id::int, rep_id::int FROM manager_reps')).rows, []),

    // Clients with nobody. Those carrying history come first — they are the ones
    // costing something while they sit here.
    q<UnownedClient[]>(async () => (await risansiPool.query<UnownedClient>(`
      SELECT c.id::int AS id, c.code, c.legal_name AS name, c.status,
             (SELECT count(*)::int FROM opportunities o WHERE o.client_id = c.id) AS opps,
             (SELECT count(*)::int FROM visits v WHERE v.client_id = c.id) AS visits
        FROM clients c
       WHERE c.deleted_at IS NULL
         AND c.primary_rep_id IS NULL
         AND NOT EXISTS (SELECT 1 FROM client_secondary_reps s WHERE s.client_id = c.id)
       ORDER BY (SELECT count(*) FROM opportunities o WHERE o.client_id = c.id) DESC,
                (SELECT count(*) FROM visits v WHERE v.client_id = c.id) DESC,
                c.code
       LIMIT 1000`)).rows, []),
  ]);

  // The matrix's rows are managers, but its columns are everyone: a manager can
  // sit under another manager, and four of them already do.
  const managers = people.filter(p => p.role === 'manager');
  const withHistory = unowned.filter(c => c.opps || c.visits).length;

  // The roster, with both halves of the team link resolved to the names the
  // cells print. Doing it here rather than in the table means the Reports-to
  // and Team columns can be sorted on what a reader sees, and the client
  // bundle never needs the pairs list.
  const roster = people.map(p => ({
    id: p.id, name: p.name, role: p.role, owned: p.owned, covered: p.covered,
    reportsTo: managers
      .filter(m => pairs.some(x => x.manager_id === m.id && x.rep_id === p.id))
      .map(m => m.name).join(', '),
    team: people
      .filter(r => pairs.some(x => x.manager_id === p.id && x.rep_id === r.id))
      .map(r => r.name).join(', '),
  }));

  const selectedRep = people.find(r => r.id === repParam)
    ?? people.find(r => r.owned > 0 || r.covered > 0)
    ?? people[0];

  // Owned and covered in one list, each row saying which it is — that is the
  // question this tab exists to answer, and two separate tables would make the
  // reader do the merge themselves.
  const repClients = tab === 'clients' && selectedRep
    ? await q<RepClient[]>(async () => (await risansiPool.query<RepClient>(`
        SELECT c.id::int AS id, c.code, c.legal_name AS name, c.status,
               'primary' AS relation,
               (SELECT count(*)::int FROM opportunities o WHERE o.client_id = c.id) AS opps,
               (SELECT count(*)::int FROM client_secondary_reps s WHERE s.client_id = c.id) AS cover_count,
               (SELECT u.name FROM users u WHERE u.id = c.primary_rep_id) AS owner_name
          FROM clients c
         WHERE c.deleted_at IS NULL AND c.primary_rep_id = $1
        UNION ALL
        SELECT c.id::int, c.code, c.legal_name, c.status,
               'covering' AS relation,
               (SELECT count(*)::int FROM opportunities o WHERE o.client_id = c.id),
               (SELECT count(*)::int FROM client_secondary_reps s WHERE s.client_id = c.id),
               (SELECT u.name FROM users u WHERE u.id = c.primary_rep_id)
          FROM clients c
          JOIN client_secondary_reps s ON s.client_id = c.id AND s.rep_id = $1
         WHERE c.deleted_at IS NULL
         ORDER BY 5, 2`, [selectedRep.id])).rows, [])
    : [];

  const tabHref = (t: string) => `/risansi/admin/reps?tab=${t}`;

  return (
    <div>
      <Topbar crumbs={['Admin', 'Reps & Managers']} />

      <div style={{ padding: '18px 22px 0' }}>
        <div style={S.stats}>
          <Stat n={people.length} l="reps and managers" />
          <Stat n={people.reduce((s, p) => s + p.owned, 0)} l="clients owned" />
          <Stat n={pairs.length} l="team links" />
          <Stat n={unowned.length} l="unassigned" warn={unowned.length > 0} />
        </div>

        <nav style={S.tabs}>
          {TABS.map(t => (
            <a key={t.id} href={tabHref(t.id)} aria-current={tab === t.id}
              style={{ ...S.tab, ...(tab === t.id ? S.tabOn : null) }}>
              {t.label}
              {t.id === 'unassigned' && unowned.length > 0 && (
                <span style={S.badge}>{unowned.length}</span>
              )}
            </a>
          ))}
        </nav>
      </div>

      <div style={{ padding: '16px 22px 40px' }}>
        {tab === 'reps' && (
          <>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginBottom: 12 }}>
              <AddRepButton />
            </div>
            {/* Its own block rather than a flex item: open, this is a full panel,
                and it would be squeezed into a button-sized column up there. */}
            <MoveClients people={people} />
            <div style={S.card}>
              <AdminRepsRoster rows={roster} th={S.th} td={S.td} />
            </div>
          </>
        )}

        {tab === 'clients' && (
          selectedRep
            ? <RepClients people={people} selected={selectedRep} clients={repClients} />
            : <p style={{ fontSize: 13, color: 'var(--fg-2)' }}>No active reps or managers yet.</p>
        )}

        {tab === 'teams' && <TeamMatrix managers={managers} reps={people} pairs={pairs} />}

        {tab === 'unassigned' && (
          <>
            {withHistory > 0 && (
              <p style={{ fontSize: 12.5, color: 'var(--warn-strong)', margin: '0 0 12px' }}>
                {withHistory} of these carry opportunities or visits. Until someone owns them, only
                admins can see that work.
              </p>
            )}
            <UnassignedClients clients={unowned} reps={people} />
          </>
        )}
      </div>
    </div>
  );
}

function Stat({ n, l, warn }: { n: number; l: string; warn?: boolean }) {
  return (
    <div style={S.stat}>
      <span style={{ ...S.statN, color: warn ? 'var(--warn-strong)' : 'var(--fg)' }}>{n}</span>
      <span style={S.statL}>{l}</span>
    </div>
  );
}

const S: Record<string, CSSProperties> = {
  stats: { display: 'flex', gap: 1, background: 'var(--line)', border: '1px solid var(--line)',
           borderRadius: 'var(--radius)', overflow: 'hidden', marginBottom: 16, flexWrap: 'wrap' },
  stat:  { background: 'var(--bg-paper)', padding: '11px 18px', minWidth: 118, flex: '1 1 118px' },
  statN: { display: 'block', fontFamily: 'var(--font-mono)', fontSize: 21, fontWeight: 500 },
  statL: { display: 'block', fontSize: 11, color: 'var(--fg-3)', marginTop: 1 },
  tabs:  { display: 'flex', gap: 4, borderBottom: '1px solid var(--line)' },
  tab:   { padding: '9px 15px', fontSize: 13, fontWeight: 500, color: 'var(--fg-3)',
           textDecoration: 'none', borderBottom: '2px solid transparent', display: 'inline-flex',
           alignItems: 'center', gap: 7 },
  tabOn: { color: 'var(--accent)', fontWeight: 600, borderBottomColor: 'var(--accent)' },
  badge: { fontFamily: 'var(--font-mono)', fontSize: 10.5, fontWeight: 600, padding: '1px 6px',
           borderRadius: 999, background: 'var(--warn-soft)', color: 'var(--warn-strong)' },
  card:  { background: 'var(--bg-paper)', border: '1px solid var(--line)',
           borderRadius: 'var(--radius)', overflow: 'auto' },
  th:    { padding: '9px 12px', textAlign: 'left', fontSize: 10, fontWeight: 600, letterSpacing: '0.07em',
           textTransform: 'uppercase', color: 'var(--fg-3)', borderBottom: '1px solid var(--line)',
           background: 'var(--bg-elev)', whiteSpace: 'nowrap' },
  td:    { padding: '9px 12px', fontSize: 13, borderBottom: '1px solid var(--line-2)' },
};
