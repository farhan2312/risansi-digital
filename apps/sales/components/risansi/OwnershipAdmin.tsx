'use client';

import { useState, useTransition, useMemo, type CSSProperties } from 'react';
import { useRouter } from 'next/navigation';
import {
  setManagerRep, setPrimaryRep, moveClients, previewMove, restoreClient,
  type MovePreview,
} from '@/app/actions/risansi-ownership';
import { ClientOwnershipButton } from '@/components/risansi/ClientOwnershipButton';
import { ArchiveClientToggle } from '@/components/risansi/ArchiveClientToggle';
import { useTableSort, SortTH } from '@/components/risansi/SortTH';
import type { SortableColumn } from '@/lib/risansi-table-sort';
import { CLIENT_STATUSES } from '@/lib/risansi-client-status';

export interface Person { id: number; name: string; role: string; owned: number; covered: number; team?: number; }
export interface UnownedClient { id: number; code: string; name: string; status: string; opps: number; visits: number; }
export interface ArchivedClient { id: number; code: string; name: string; status: string; archived_at: string; opps: number; }

// ── shared bits ───────────────────────────────────────────────────

const CARD: CSSProperties = {
  background: 'var(--bg-paper)', border: '1px solid var(--line)',
  borderRadius: 'var(--radius)', overflow: 'hidden',
};
const TH: CSSProperties = {
  padding: '9px 12px', textAlign: 'left', fontSize: 10, fontWeight: 600,
  letterSpacing: '0.07em', textTransform: 'uppercase', color: 'var(--fg-3)',
  borderBottom: '1px solid var(--line)', background: 'var(--bg-elev)', whiteSpace: 'nowrap',
};
const TD: CSSProperties = { padding: '9px 12px', fontSize: 13, borderBottom: '1px solid var(--line-2)', verticalAlign: 'middle' };
const BTN: CSSProperties = {
  border: '1px solid var(--line-strong)', background: 'var(--bg-paper)', color: 'var(--fg)',
  borderRadius: 6, fontSize: 12, fontWeight: 600, padding: '6px 11px', cursor: 'pointer', fontFamily: 'inherit',
};
const BTN_PRI: CSSProperties = { ...BTN, background: 'var(--accent-fill)', color: 'var(--on-accent)', borderColor: 'var(--accent-fill)' };
const SEL: CSSProperties = {
  padding: '6px 9px', fontSize: 12.5, fontFamily: 'inherit', background: 'var(--bg-sunk)',
  border: '1px solid var(--line-strong)', borderRadius: 6, color: 'var(--fg)',
};
const NOTE: CSSProperties = { fontSize: 12, color: 'var(--fg-3)', margin: '0 0 12px' };

// Status columns follow CLIENT_STATUSES — the lifecycle a client actually
// travels (lead, prospective client, active, then the ways it ends). The
// alphabet would put ACTIVE before PROSPECTIVE_LEAD and read as nothing.
const STATUS_ORDER = CLIENT_STATUSES;

const UNOWNED_COLS: SortableColumn<UnownedClient>[] = [
  { key: 'code',   kind: 'text' },
  { key: 'name',   kind: 'text' },
  { key: 'status', kind: 'status', order: STATUS_ORDER },
  // The cell reads "3 opp · 1 visit". What the column is scanned for is how
  // much history is sitting here unowned, so it sorts on the two together.
  { key: 'history', kind: 'number', value: c => c.opps + c.visits },
];

const ARCHIVED_COLS: SortableColumn<ArchivedClient>[] = [
  { key: 'code',        kind: 'text' },
  { key: 'name',        kind: 'text' },
  { key: 'status',      kind: 'status', order: STATUS_ORDER },
  { key: 'archived_at', kind: 'date' },
  { key: 'opps',        kind: 'number' },
];

function Banner({ msg, bad }: { msg: string; bad?: boolean }) {
  if (!msg) return null;
  return (
    <div style={{
      margin: '0 0 12px', padding: '9px 13px', borderRadius: 6, fontSize: 12.5,
      background: bad ? 'var(--neg-soft)' : 'var(--pos-soft)',
      color: bad ? 'var(--neg-strong)' : 'var(--pos-strong)',
      border: `1px solid ${bad ? 'var(--neg)' : 'var(--pos)'}`,
    }}>{msg}</div>
  );
}

// ── Teams: the manager × rep matrix ───────────────────────────────
//
// Not sortable, and deliberately. Its columns are people rather than fields,
// its cells are checkboxes being edited, and both axes already carry the one
// order that means anything here — managers down, the same rep list across.
// A sort would shuffle the grid somebody is halfway through ticking.

export function TeamMatrix({ managers, reps, pairs }: {
  managers: Person[]; reps: Person[]; pairs: { manager_id: number; rep_id: number }[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState(''); const [bad, setBad] = useState(false);
  const [live, setLive] = useState(() => new Set(pairs.map(p => `${p.manager_id}|${p.rep_id}`)));

  const toggle = (managerId: number, repId: number) => {
    const key = `${managerId}|${repId}`;
    const on = !live.has(key);
    // Move the tick immediately; a checkbox that waits for a round trip feels
    // broken, and the server is the authority if it disagrees.
    setLive(s => { const n = new Set(s); if (on) n.add(key); else n.delete(key); return n; });
    setMsg('');
    start(async () => {
      const r = await setManagerRep(managerId, repId, on);
      if (!r.ok) {
        setLive(s => { const n = new Set(s); if (on) n.delete(key); else n.add(key); return n; });
        setMsg(r.error); setBad(true);
      } else { router.refresh(); }
    });
  };

  if (!managers.length || !reps.length) {
    return <p style={NOTE}>You need at least one manager and one rep before a team can be set.</p>;
  }

  return (
    <div>
      <p style={NOTE}>
        A manager sees every client owned or covered by the reps ticked on their row. Nobody manages
        themselves — they already see their own clients by owning them — so those cells are blank.
      </p>
      <Banner msg={msg} bad={bad} />
      <div style={{ ...CARD, overflowX: 'auto' }}>
        <table style={{ borderCollapse: 'collapse', width: '100%' }}>
          <thead>
            <tr>
              <th style={{ ...TH, position: 'sticky', left: 0, zIndex: 2, minWidth: 190 }}>Manager \ Rep</th>
              {reps.map(r => (
                <th key={r.id} style={{ ...TH, textAlign: 'center', minWidth: 92 }}>
                  <div style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)', height: 108, margin: '0 auto', fontWeight: 600 }}>
                    {r.name}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {managers.map(m => (
              <tr key={m.id}>
                <td style={{ ...TD, position: 'sticky', left: 0, background: 'var(--bg-paper)', fontWeight: 600, whiteSpace: 'nowrap' }}>
                  {m.name}
                  <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 400, color: 'var(--fg-3)' }}>
                    {reps.filter(r => live.has(`${m.id}|${r.id}`)).length || 'no'} rep{reps.filter(r => live.has(`${m.id}|${r.id}`)).length === 1 ? '' : 's'}
                  </span>
                </td>
                {reps.map(r => {
                  const self = r.id === m.id;
                  const on = live.has(`${m.id}|${r.id}`);
                  return (
                    <td key={r.id} style={{ ...TD, textAlign: 'center', background: on ? 'var(--accent-soft, rgba(26,92,184,0.08))' : undefined }}>
                      {self ? <span style={{ color: 'var(--fg-4)' }}>—</span> : (
                        <input
                          type="checkbox" checked={on} disabled={pending}
                          onChange={() => toggle(m.id, r.id)}
                          aria-label={`${m.name} manages ${r.name}`}
                          style={{ width: 16, height: 16, cursor: pending ? 'wait' : 'pointer', accentColor: 'var(--title)' }}
                        />
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Unassigned: clients with no owner ─────────────────────────────

export function UnassignedClients({ clients, reps }: { clients: UnownedClient[]; reps: Person[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState(''); const [bad, setBad] = useState(false);
  const [picks, setPicks] = useState<Record<number, string>>({});
  const [q, setQ] = useState('');

  const found = useMemo(() => {
    const t = q.trim().toLowerCase();
    return t ? clients.filter(c => c.code.toLowerCase().includes(t) || c.name.toLowerCase().includes(t)) : clients;
  }, [clients, q]);

  // Sorts whatever the search left behind. Unset by default, so the list keeps
  // the order the query chose — anything carrying history first.
  const { rows: shown, sortBy } = useTableSort(found, UNOWNED_COLS);

  const assign = (clientId: number) => {
    const repId = Number(picks[clientId]);
    if (!repId) return;
    setMsg('');
    start(async () => {
      const r = await setPrimaryRep(clientId, repId);
      if (!r.ok) { setMsg(r.error); setBad(true); }
      else { setMsg(`${clients.find(c => c.id === clientId)?.code ?? 'Client'} assigned.`); setBad(false); router.refresh(); }
    });
  };

  if (!clients.length) {
    return (
      <div style={{ ...CARD, padding: '30px 20px', textAlign: 'center' }}>
        <div style={{ fontSize: 26, marginBottom: 8 }}>✓</div>
        <div style={{ fontSize: 14, fontWeight: 600 }}>Every client has an owner.</div>
        <div style={{ ...NOTE, marginTop: 5 }}>That is what this tab is for — an empty list is the goal.</div>
      </div>
    );
  }

  return (
    <div>
      <p style={NOTE}>
        These clients have no primary rep, so only admins can see them. Anything with history is
        listed first — those are the ones costing you something while they sit here. Assign an
        owner, or archive the ones nobody should be working; archiving asks first and names any
        open work, and Admin › Recoverable brings a client back.
      </p>
      <Banner msg={msg} bad={bad} />
      <input
        value={q} onChange={e => setQ(e.target.value)} placeholder="Search code or name…"
        style={{ ...SEL, width: 260, marginBottom: 10 }}
      />
      <div style={{ ...CARD, overflowX: 'auto' }}>
        <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 780 }}>
          <thead>
            <tr>
              <SortTH {...sortBy('code')}    style={TH}>Code</SortTH>
              <SortTH {...sortBy('name')}    style={TH}>Client</SortTH>
              <SortTH {...sortBy('status')}  style={TH}>Status</SortTH>
              <SortTH {...sortBy('history')} style={{ ...TH, textAlign: 'right' }} align="right">History</SortTH>
              {/* A picker and a button. Neither holds a value to order by. */}
              <th style={TH}>Assign to</th>
              <th style={TH}></th>
            </tr>
          </thead>
          <tbody>
            {shown.map(c => (
              <tr key={c.id}>
                <td style={{ ...TD, fontFamily: 'var(--font-mono)', fontSize: 12 }}>{c.code}</td>
                <td style={TD}>{c.name}</td>
                <td style={{ ...TD, fontSize: 11.5, color: 'var(--fg-3)' }}>{c.status}</td>
                <td style={{ ...TD, textAlign: 'right', fontSize: 12, fontFamily: 'var(--font-mono)' }}>
                  {c.opps || c.visits
                    ? <span style={{ color: 'var(--warn-strong)' }}>{c.opps} opp · {c.visits} visit</span>
                    : <span style={{ color: 'var(--fg-4)' }}>none</span>}
                </td>
                <td style={TD}>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <select
                      value={picks[c.id] ?? ''} disabled={pending}
                      onChange={e => setPicks(p => ({ ...p, [c.id]: e.target.value }))}
                      style={{ ...SEL, minWidth: 150 }}
                    >
                      <option value="">Choose a rep…</option>
                      {reps.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                    </select>
                    <button
                      type="button" onClick={() => assign(c.id)}
                      disabled={pending || !picks[c.id]}
                      style={{ ...BTN_PRI, opacity: picks[c.id] ? 1 : 0.45, cursor: picks[c.id] ? 'pointer' : 'not-allowed' }}
                    >Assign</button>
                  </div>
                </td>
                <td style={{ ...TD, textAlign: 'right', whiteSpace: 'nowrap' }}>
                  <ArchiveClientToggle clientId={String(c.id)} name={c.name} archived={false} as="button" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {shown.length !== clients.length && (
        <p style={{ ...NOTE, marginTop: 10 }}>{shown.length} of {clients.length} shown.</p>
      )}
    </div>
  );
}

// ── Move a book from one person to another ────────────────────────

export function MoveClients({ people }: { people: Person[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState(''); const [to, setTo] = useState('');
  const [what, setWhat] = useState<'owned' | 'covered' | 'both'>('both');
  const [pv, setPv] = useState<MovePreview | null>(null);
  const [msg, setMsg] = useState(''); const [bad, setBad] = useState(false);

  const look = (f: string, t: string) => {
    setPv(null);
    if (!f || !t || f === t) return;
    start(async () => setPv(await previewMove(Number(f), Number(t))));
  };

  const go = () => {
    setMsg('');
    start(async () => {
      const r = await moveClients(Number(from), Number(to), what);
      if (!r.ok) { setMsg(r.error); setBad(true); }
      else {
        setMsg(r.message ?? 'Moved.'); setBad(false);
        setFrom(''); setTo(''); setPv(null); router.refresh();
      }
    });
  };

  const count = pv ? (what === 'owned' ? pv.owned : what === 'covered' ? pv.covered : pv.owned + pv.covered) : 0;

  if (!open) {
    return (
      <div style={{ marginBottom: 12 }}>
        <button type="button" onClick={() => setOpen(true)} style={BTN}>⇄ Move clients</button>
      </div>
    );
  }

  return (
    <div style={{ ...CARD, padding: 16, marginBottom: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <strong style={{ fontSize: 14 }}>Move clients</strong>
        <button type="button" onClick={() => { setOpen(false); setMsg(''); }} style={{ ...BTN, padding: '4px 9px' }}>Close</button>
      </div>
      <p style={NOTE}>
        Hand one person&apos;s book to another. Nothing moves on its own when an account is
        deactivated — a leaver&apos;s clients appear in Unassigned instead, which is the safer
        default.
      </p>
      <Banner msg={msg} bad={bad} />
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
        <select value={from} onChange={e => { setFrom(e.target.value); look(e.target.value, to); }} style={{ ...SEL, minWidth: 175 }}>
          <option value="">From…</option>
          {people.map(p => <option key={p.id} value={p.id}>{p.name} ({p.owned} owned)</option>)}
        </select>
        <span style={{ color: 'var(--fg-3)' }}>→</span>
        <select value={to} onChange={e => { setTo(e.target.value); look(from, e.target.value); }} style={{ ...SEL, minWidth: 175 }}>
          <option value="">To…</option>
          {people.filter(p => String(p.id) !== from).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <select value={what} onChange={e => setWhat(e.target.value as typeof what)} style={SEL}>
          <option value="both">Owned and covered</option>
          <option value="owned">Owned only</option>
          <option value="covered">Covered only</option>
        </select>
      </div>
      {pv && (
        <div style={{ fontSize: 12.5, color: 'var(--fg-2)', marginBottom: 12 }}>
          {pv.owned} owned · {pv.covered} covered.
          {pv.alreadyTheirs > 0 && (
            <> {pv.alreadyTheirs} of the owned are already covered by the receiver; those covering
            rows are removed, since owning a client includes everything covering it gave them.</>
          )}
        </div>
      )}
      <button
        type="button" onClick={go}
        disabled={pending || !from || !to || from === to || count === 0}
        style={{ ...BTN_PRI, opacity: (!from || !to || count === 0) ? 0.45 : 1 }}
      >
        {pending ? 'Moving…' : count ? `Move ${count} client${count === 1 ? '' : 's'}` : 'Nothing to move'}
      </button>
    </div>
  );
}

// ── Recoverable items ─────────────────────────────────────────────

export function RecoverableClients({ clients }: { clients: ArchivedClient[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState(''); const [bad, setBad] = useState(false);
  const { rows: shown, sortBy } = useTableSort(clients, ARCHIVED_COLS);

  const undo = (c: ArchivedClient) => {
    if (typeof window !== 'undefined'
      && !window.confirm(`Restore ${c.code} — ${c.name}? It comes back with no owner, so assign one afterwards.`)) return;
    setMsg('');
    start(async () => {
      const r = await restoreClient(c.id);
      if (!r.ok) { setMsg(r.error); setBad(true); }
      else { setMsg(`${c.code} restored. It has no owner until you set one.`); setBad(false); router.refresh(); }
    });
  };

  if (!clients.length) {
    return (
      <div style={{ ...CARD, padding: '30px 20px', textAlign: 'center' }}>
        <div style={{ fontSize: 14, fontWeight: 600 }}>Nothing archived.</div>
        <div style={{ ...NOTE, marginTop: 5 }}>Archived clients appear here and can be brought back at any time.</div>
      </div>
    );
  }

  return (
    <div>
      <Banner msg={msg} bad={bad} />
      <div style={{ ...CARD, overflowX: 'auto' }}>
        <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 700 }}>
          <thead>
            <tr>
              <SortTH {...sortBy('code')}        style={TH}>Code</SortTH>
              <SortTH {...sortBy('name')}        style={TH}>Client</SortTH>
              <SortTH {...sortBy('status')}      style={TH}>Status</SortTH>
              <SortTH {...sortBy('archived_at')} style={TH}>Archived</SortTH>
              <SortTH {...sortBy('opps')}        style={{ ...TH, textAlign: 'right' }} align="right">Records kept</SortTH>
              {/* Restore button. */}
              <th style={{ ...TH, textAlign: 'right' }}>Action</th>
            </tr>
          </thead>
          <tbody>
            {shown.map(c => (
              <tr key={c.id}>
                <td style={{ ...TD, fontFamily: 'var(--font-mono)', fontSize: 12 }}>{c.code}</td>
                <td style={TD}>{c.name}</td>
                <td style={{ ...TD, fontSize: 11.5, color: 'var(--fg-3)' }}>{c.status}</td>
                <td style={{ ...TD, fontSize: 12, color: 'var(--fg-3)' }}>{c.archived_at?.slice(0, 10) ?? '—'}</td>
                <td style={{ ...TD, textAlign: 'right', fontSize: 12, fontFamily: 'var(--font-mono)' }}>
                  {c.opps ? `${c.opps} opportunit${c.opps === 1 ? 'y' : 'ies'}` : <span style={{ color: 'var(--fg-4)' }}>none</span>}
                </td>
                <td style={{ ...TD, textAlign: 'right' }}>
                  <button type="button" onClick={() => undo(c)} disabled={pending} style={BTN}>Restore</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── One person's book: what they own, and what they cover ─────────

export interface RepClient {
  id: number; code: string; name: string; status: string;
  relation: 'primary' | 'covering';
  opps: number; cover_count: number; owner_name: string | null;
}

const REP_CLIENT_COLS: SortableColumn<RepClient>[] = [
  { key: 'code',   kind: 'text' },
  { key: 'name',   kind: 'text' },
  { key: 'status', kind: 'status', order: STATUS_ORDER },
  // Owning comes before covering, which is the order the query itself uses
  // (ORDER BY 5 puts 'covering' first only because of the alphabet) and the
  // order the pills are explained in: what this person owns, then what they
  // merely back up. Sorting it as text would lead on Covers.
  { key: 'relation', kind: 'status', order: ['primary', 'covering'] },
  { key: 'opps',     kind: 'number' },
];

/**
 * Every client a given rep or manager works, each row saying whether they own it
 * or cover it.
 *
 * One list rather than two tables. The question people actually arrive with is
 * "what is this person responsible for", and splitting owned from covered makes
 * the reader merge the halves themselves — while a single joined list with no
 * label is what made ownership ambiguous in the first place. So: one list, one
 * column that says which.
 */
export function RepClients({ people, selected, clients }: {
  people: Person[]; selected: Person; clients: RepClient[];
}) {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [only, setOnly] = useState<'all' | 'primary' | 'covering'>('all');

  const found = useMemo(() => {
    const t = q.trim().toLowerCase();
    return clients.filter(c =>
      (only === 'all' || c.relation === only)
      && (!t || c.code.toLowerCase().includes(t) || c.name.toLowerCase().includes(t)));
  }, [clients, q, only]);

  const { rows: shown, sortBy } = useTableSort(found, REP_CLIENT_COLS);

  const owned = clients.filter(c => c.relation === 'primary').length;
  const covers = clients.length - owned;

  return (
    <div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 12 }}>
        <label>
          <span style={{ display: 'block', fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--fg-3)', marginBottom: 4 }}>
            Rep or manager
          </span>
          <select
            value={selected.id}
            onChange={e => router.push(`/risansi/admin/reps?tab=clients&rep=${e.target.value}`)}
            style={{ ...SEL, minWidth: 230 }}
          >
            {people.map(p => (
              <option key={p.id} value={p.id}>
                {p.name}{p.role === 'manager' ? ' · manager' : ''} — {p.owned} owned{p.covered ? `, ${p.covered} covered` : ''}
              </option>
            ))}
          </select>
        </label>

        <div style={{ display: 'flex', gap: 4 }}>
          {([['all', `All ${clients.length}`], ['primary', `Owns ${owned}`], ['covering', `Covers ${covers}`]] as const).map(([k, label]) => (
            <button key={k} type="button" onClick={() => setOnly(k)}
              style={{ ...BTN, ...(only === k ? { background: 'var(--accent-fill)', color: 'var(--on-accent)', borderColor: 'var(--accent-fill)' } : null) }}>
              {label}
            </button>
          ))}
        </div>

        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search code or name…"
          style={{ ...SEL, width: 220, marginLeft: 'auto' }} />
      </div>

      {clients.length === 0 ? (
        <div style={{ ...CARD, padding: '30px 20px', textAlign: 'center' }}>
          <div style={{ fontSize: 14, fontWeight: 600 }}>{selected.name} works no clients.</div>
          <div style={{ ...NOTE, marginTop: 5 }}>
            Assign some from the Unassigned tab, or from Owner &amp; cover on Client Master.
          </div>
        </div>
      ) : (
        <div style={{ ...CARD, overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 760 }}>
            <thead>
              <tr>
                <SortTH {...sortBy('code')}     style={TH}>Code</SortTH>
                <SortTH {...sortBy('name')}     style={TH}>Client</SortTH>
                <SortTH {...sortBy('status')}   style={TH}>Status</SortTH>
                <SortTH {...sortBy('relation')} style={TH}>Relation</SortTH>
                <SortTH {...sortBy('opps')}     style={{ ...TH, textAlign: 'right' }} align="right">Opps</SortTH>
                {/* The ownership editor button. */}
                <th style={TH}>Owner &amp; cover</th>
              </tr>
            </thead>
            <tbody>
              {shown.map(c => (
                <tr key={`${c.relation}-${c.id}`}>
                  <td style={{ ...TD, fontFamily: 'var(--font-mono)', fontSize: 12 }}>
                    <a href={`/risansi/clients/${c.id}`} style={{ color: 'var(--accent)', textDecoration: 'none' }}>{c.code}</a>
                  </td>
                  <td style={TD}>{c.name}</td>
                  <td style={{ ...TD, fontSize: 11.5, color: 'var(--fg-3)' }}>{c.status}</td>
                  <td style={TD}>
                    {c.relation === 'primary'
                      ? <span style={{ ...PILL, background: 'var(--pos-soft)', color: 'var(--pos-strong)' }}>Owns</span>
                      : <span style={{ ...PILL, background: 'var(--bg-sunk)', color: 'var(--fg-2)' }}>
                          Covers{c.owner_name ? ` · ${c.owner_name} owns` : ''}
                        </span>}
                  </td>
                  <td style={{ ...TD, textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 12 }}>{c.opps || '—'}</td>
                  <td style={TD}>
                    <ClientOwnershipButton
                      clientId={c.id} clientCode={c.code} clientName={c.name}
                      reps={people.map(p => ({ id: p.id, name: p.name, role: p.role }))}
                      ownerName={c.owner_name} coverCount={c.cover_count}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {shown.length !== clients.length && (
        <p style={{ ...NOTE, marginTop: 10 }}>{shown.length} of {clients.length} shown.</p>
      )}
    </div>
  );
}

const PILL: CSSProperties = {
  display: 'inline-block', padding: '2px 8px', borderRadius: 999,
  fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap',
};
