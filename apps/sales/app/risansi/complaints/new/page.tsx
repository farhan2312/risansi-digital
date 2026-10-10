import Link from 'next/link';
import { Topbar } from '@/components/risansi';
import risansiPool from '@/lib/db-risansi';
import { NewComplaintForm, type ClientOpt } from '@/components/risansi/complaints/NewComplaintForm';

export const dynamic = 'force-dynamic';

// Lodging a complaint. Three answers and whatever was sent in with it; the
// number comes back immediately and Registration is filled in afterwards.
//
// Every live client is offered, to anyone signed in. This used to be narrowed
// to the clients the viewer works, which read as a sensible guard and in
// practice meant the person holding the complaint often could not write it
// down — a complaint reaches whoever answers the phone, not whoever owns the
// account. Lodging commits nothing that a correction cannot undo, and a
// complaint recorded against the wrong client is recoverable in a way that one
// nobody recorded is not.
//
// `?client=ID` preselects, from Client 360 and from visit reports.

export default async function NewComplaintPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const preselect = typeof sp.client === 'string' && /^\d+$/.test(sp.client) ? Number(sp.client) : null;

  const { rows: clients } = await risansiPool.query<ClientOpt>(`
    SELECT c.id::int AS id, c.code, c.legal_name AS name
      FROM clients c
     WHERE c.deleted_at IS NULL AND c.status <> 'DUPLICATE'
     ORDER BY c.legal_name`);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ position: 'sticky', top: 0, zIndex: 10 }}>
        <Topbar crumbs={[{ label: 'Complaints', href: '/risansi/complaints' }, 'Lodge']} />
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: '22px 24px 40px', background: 'var(--bg)' }}>
        <div style={{ maxWidth: 1080 }}>
          <Link href="/risansi/complaints" style={{ fontSize: 11.5, color: 'var(--fg-3)', textDecoration: 'none' }}>← Complaints</Link>
          <h1 style={{ fontSize: 22, fontWeight: 600, margin: '5px 0 3px' }}>Lodge a complaint</h1>
          <p style={{ fontSize: 12.5, color: 'var(--fg-3)', margin: '0 0 16px', maxWidth: 720, lineHeight: 1.5 }}>
            Just enough to get it on the record: who it is about, and anything that came with it.
            A complaint number is generated straight away. The source and category are filled in on
            the Registration page afterwards, where the description stays editable too.
          </p>
          {clients.length ? (
            <NewComplaintForm clients={clients} preselect={preselect} />
          ) : (
            <div style={{ padding: '18px 20px', background: 'var(--bg-paper)', border: '1px solid var(--line)', borderRadius: 'var(--radius)', fontSize: 13, color: 'var(--fg-2)' }}>
              There are no clients on the master yet, so there is nothing to raise a complaint against.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
