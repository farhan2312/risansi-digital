'use client';

import { useMemo, useState, useTransition, type CSSProperties } from 'react';
import { useRouter } from 'next/navigation';
import { createComplaintV2 } from '@/app/actions/risansi-complaints-v2';
import { INPUT, NOTE, PRIMARY, GHOST } from './ComplaintPageForm';

// Lodging a complaint: who it is about, and whatever was sent in with it.
//
// This screen used to be the whole of Registration — source, category,
// description, and page 2's order details behind a toggle. That asked whoever
// answered the phone to classify a complaint before anyone had looked at it,
// which is why it was not being used: the person holding the complaint was not
// the person who could answer the form. So it asks for almost nothing now. The
// complaint number comes back immediately, and the Complaint Team fills in
// Registration afterwards, once they have done their initial analysis.
//
// Nothing is lost by lodging early. gateFor still holds the complaint at Open
// until Registration is complete, so a half-recorded complaint cannot progress
// — it can only be visible, which is the entire point.
//
// Direct or through an OEM decides what the two pickers mean. A complaint that
// arrives from an OEM has two accounts in it: the OEM who rang, and the mill
// whose pump it is. Both are kept. The complaint BELONGS to the mill — its
// pumps, its visit history and its rep are all there, and that rep is who
// chases it — while the OEM's own record shows it as one they raised.

export interface ClientOpt { id: number; code: string; name: string }

/**
 * The slots a complaint can be lodged with. The upload route takes images,
 * video, PDF, Word, Excel and text; anything else is refused there with a
 * message, not silently dropped.
 */
const AT_REGISTRATION: { key: string; label: string; hint: string }[] = [
  { key: 'complaint', label: 'Documents', hint: 'The email, the customer’s own report, a challan.' },
  { key: 'photo', label: 'Photos & video', hint: 'Of the part, the site, the damage, the pump running.' },
];

type ClientType = 'Direct' | 'OEM';

export function NewComplaintForm({ clients, preselect }: {
  clients: ClientOpt[];
  preselect?: number | null;
}) {
  const router = useRouter();
  const [clientType, setClientType] = useState<ClientType>('Direct');
  // The party the complaint came from. When it came through an OEM this is the
  // OEM; otherwise it is the client itself.
  const [fromId, setFromId] = useState<number | ''>(
    preselect && clients.some(c => c.id === preselect) ? preselect : '');
  const [endId, setEndId] = useState<number | ''>('');
  const [details, setDetails] = useState('');
  const [staged, setStaged] = useState<{ key: string; file: File }[]>([]);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const isOem = clientType === 'OEM';
  // Whose record the complaint hangs off: the mill, always.
  const ownerId = isOem ? endId : fromId;
  const blocker = !fromId
    ? (isOem ? 'Name the OEM the complaint came from.' : 'Pick the client.')
    : isOem && !endId ? 'Name the end client whose pump it is.'
    : isOem && endId === fromId ? 'The OEM and the end client cannot be the same account.'
    : !details.trim() ? 'Say what the complaint is about.'
    : null;

  const submit = () => {
    setMsg(null);
    if (blocker) { setMsg({ ok: false, text: blocker }); return; }
    start(async () => {
      const res = await createComplaintV2({
        client_id: Number(ownerId),
        values: {
          client_type: clientType,
          oem_client_id: isOem ? Number(fromId) : null,
          details: details.trim(),
        },
      });
      if (!res.ok) { setMsg({ ok: false, text: res.error }); return; }
      // The complaint exists now, so what was sent in with it has somewhere to
      // go. A file that will not upload does not lose the complaint: the record
      // is saved either way and the next screen names the ones to try again.
      const failed: string[] = [];
      for (const { key, file } of staged) {
        const fd = new FormData();
        fd.set('file', file); fd.set('category', key);
        const up = await fetch(`/api/risansi/complaints/${res.data.id}/attachments`, { method: 'POST', body: fd });
        if (!up.ok) failed.push(file.name);
      }
      const q = failed.length ? `&files=${encodeURIComponent(failed.join('|'))}` : '';
      router.push(`/risansi/complaints/${res.data.id}?page=registration&lodged=${encodeURIComponent(res.data.complaint_no)}${q}`);
    });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <section style={PANEL}>
        <div style={HEAD}>
          <span style={{ fontSize: 13, fontWeight: 600 }}>Where it came from</span>
          <span style={{ fontSize: 11, color: 'var(--fg-3)' }}>decides whether an end client is needed</span>
        </div>
        <div style={{ padding: '14px 16px', display: 'flex', gap: 8 }}>
          {(['Direct', 'OEM'] as const).map(t => (
            <button
              key={t}
              type="button"
              onClick={() => { setClientType(t); if (t === 'Direct') setEndId(''); }}
              style={{
                ...GHOST,
                background: clientType === t ? 'var(--accent-soft)' : 'var(--bg-paper)',
                borderColor: clientType === t ? 'var(--accent)' : 'var(--line-strong)',
                color: clientType === t ? 'var(--accent)' : 'var(--fg-2)',
                fontWeight: clientType === t ? 600 : 500,
              }}
            >
              {t === 'Direct' ? 'Direct client' : 'Through an OEM'}
            </button>
          ))}
        </div>
      </section>

      <ClientPicker
        clients={clients}
        value={fromId}
        onPick={setFromId}
        title={isOem ? 'OEM' : 'Client'}
        note={isOem ? 'the OEM who raised it' : `${clients.length} to choose from`}
      />

      {isOem && (
        <ClientPicker
          clients={clients}
          value={endId}
          onPick={setEndId}
          title="End client"
          note="whose pump it is — the complaint belongs to them"
        />
      )}

      <section style={PANEL}>
        <div style={HEAD}>
          <span style={{ fontSize: 13, fontWeight: 600 }}>What happened</span>
          <span style={{ fontSize: 11, color: 'var(--fg-3)' }}>in the words it was reported in</span>
        </div>
        <div style={{ padding: '14px 16px' }}>
          <textarea
            value={details}
            onChange={e => setDetails(e.target.value)}
            rows={4}
            placeholder="What the customer reported — the pump, the symptom, what they said."
            style={{ ...INPUT, height: 'auto', resize: 'vertical', lineHeight: 1.5 }}
          />
          <div style={{ fontSize: 10.5, color: 'var(--fg-3)', marginTop: 6, lineHeight: 1.45 }}>
            Write it as it was told to you. It stays editable on the Registration page, so a fuller
            account can replace this once somebody has looked at the complaint.
          </div>
        </div>
      </section>

      <section style={PANEL}>
        <div style={HEAD}>
          <span style={{ fontSize: 13, fontWeight: 600 }}>Photos, video & documents</span>
          <span style={{ fontSize: 11, color: 'var(--fg-3)' }}>attached as soon as the number is generated</span>
          {staged.length > 0 && <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--fg-3)', fontFamily: 'var(--font-mono)' }}>{staged.length}</span>}
        </div>
        <div style={{ padding: '14px 16px', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 12 }}>
          {AT_REGISTRATION.map(slot => {
            const mine = staged.filter(s => s.key === slot.key);
            return (
              <div key={slot.key} style={SLOT}>
                <div style={{ fontSize: 12, fontWeight: 600 }}>{slot.label}</div>
                <div style={{ fontSize: 10.5, color: 'var(--fg-3)', marginTop: 2, lineHeight: 1.4 }}>{slot.hint}</div>
                <ul style={{ listStyle: 'none', margin: '8px 0 0', padding: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {mine.map((s, i) => (
                    <li key={`${s.file.name}-${i}`} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={s.file.name}>
                        {/^image\//.test(s.file.type) ? '🖼' : /^video\//.test(s.file.type) ? '🎬' : '📎'} {s.file.name}
                      </span>
                      <span style={{ fontSize: 10, color: 'var(--fg-3)', fontFamily: 'var(--font-mono)' }}>{Math.max(1, Math.round(s.file.size / 1e3))} KB</span>
                      <button type="button" disabled={pending} onClick={() => setStaged(cur => cur.filter(x => x !== s))} title="Remove" style={X}>×</button>
                    </li>
                  ))}
                </ul>
                <label style={{ ...UP, marginTop: 8, cursor: pending ? 'wait' : 'pointer' }}>
                  ⤒ Choose file
                  <input type="file" multiple disabled={pending} style={{ display: 'none' }}
                    onChange={e => { const picked = Array.from(e.target.files ?? []); e.target.value = ''; setStaged(cur => [...cur, ...picked.map(file => ({ key: slot.key, file }))]); }} />
                </label>
              </div>
            );
          })}
        </div>
      </section>

      {msg && (
        <div style={{ ...NOTE, marginBottom: 0, background: msg.ok ? 'var(--pos-soft)' : 'var(--neg-soft)', border: `1px solid ${msg.ok ? 'var(--pos)' : 'var(--neg)'}`, color: msg.ok ? 'var(--pos)' : 'var(--neg-strong, var(--neg))' }}>{msg.text}</div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <button type="button" onClick={submit} disabled={pending || !!blocker} style={{ ...PRIMARY, opacity: pending || blocker ? 0.6 : 1 }}>
          {pending ? (staged.length ? 'Lodging & attaching…' : 'Lodging…') : 'Lodge complaint'}
        </button>
        <span style={{ fontSize: 11, color: blocker ? 'var(--warn, #B45309)' : 'var(--fg-3)' }}>
          {blocker ?? (staged.length
            ? `${staged.length} file${staged.length === 1 ? '' : 's'} will be attached. The number comes back straight away.`
            : 'A number is generated straight away. The source and category are filled in on the next screen.')}
        </span>
      </div>
    </div>
  );
}

// ── Picking one client ─────────────────────────────────────────────────────

function ClientPicker({ clients, value, onPick, title, note }: {
  clients: ClientOpt[];
  value: number | '';
  onPick: (id: number | '') => void;
  title: string;
  note: string;
}) {
  const [search, setSearch] = useState('');

  // Ranked rather than filtered: an exact code first, then a name beginning
  // with the query, then code prefixes, then the rest. A mill's name is long
  // and half-remembered, so matching on word starts beats a plain substring.
  const shown = useMemo(() => {
    const words = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return clients.slice(0, 80);
    const scored: { c: ClientOpt; rank: number }[] = [];
    for (const c of clients) {
      const name = c.name.toLowerCase(), code = c.code.toLowerCase();
      const wordStart = (w: string) => name.startsWith(w) || /[\s(\-./&,]/.test(name) && new RegExp(`[\\s(\\-./&,]${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(name);
      if (!words.every(w => wordStart(w) || code.includes(w))) continue;
      const q = words.join(' ');
      const rank = code === q ? 0 : name.startsWith(words[0]) ? 1 : code.startsWith(words[0]) ? 2 : code.includes(words[0]) ? 3 : 4;
      scored.push({ c, rank });
    }
    return scored.sort((a, b) => a.rank - b.rank || a.c.name.localeCompare(b.c.name)).slice(0, 80).map(x => x.c);
  }, [clients, search]);

  const chosen = clients.find(c => c.id === value) ?? null;

  return (
    <section style={PANEL}>
      <div style={HEAD}>
        <span style={{ fontSize: 13, fontWeight: 600 }}>{title}</span>
        <span style={{ fontSize: 11, color: 'var(--fg-3)' }}>{note}</span>
      </div>
      <div style={{ padding: '14px 16px' }}>
        {chosen ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div>
              <div style={{ fontSize: 15, fontWeight: 600 }}>{chosen.name}</div>
              <div style={{ fontSize: 11, color: 'var(--fg-3)', fontFamily: 'var(--font-mono)' }}>{chosen.code}</div>
            </div>
            <button type="button" onClick={() => onPick('')} style={{ ...GHOST, marginLeft: 'auto' }}>Change</button>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(220px, 320px) 1fr', gap: 12, alignItems: 'start' }}>
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Type a client name or code…"
              style={INPUT}
            />
            <div style={{ maxHeight: 220, overflowY: 'auto', border: '1px solid var(--line)', borderRadius: 8 }}>
              {shown.length === 0 ? (
                <div style={{ padding: 12, fontSize: 12, color: 'var(--fg-3)' }}>Nothing matches “{search}”.</div>
              ) : shown.map(c => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => { onPick(c.id); setSearch(''); }}
                  style={{
                    display: 'flex', alignItems: 'baseline', gap: 10, width: '100%', textAlign: 'left',
                    padding: '8px 12px', fontSize: 12.5, fontFamily: 'inherit', cursor: 'pointer',
                    background: 'transparent', border: 'none', borderBottom: '1px solid var(--line-2)', color: 'var(--fg)',
                  }}
                >
                  <span style={{ flex: 1 }}>{c.name}</span>
                  <span style={{ fontSize: 10.5, color: 'var(--fg-3)', fontFamily: 'var(--font-mono)' }}>{c.code}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

const PANEL: CSSProperties = { background: 'var(--bg-paper)', border: '1px solid var(--line)', borderRadius: 'var(--radius)' };
const HEAD: CSSProperties = { display: 'flex', alignItems: 'baseline', gap: 10, padding: '11px 16px', borderBottom: '1px solid var(--line)' };
const SLOT: CSSProperties = { padding: '10px 12px', border: '1px solid var(--line)', borderRadius: 8, background: 'var(--bg-paper)' };
const UP: CSSProperties = { display: 'inline-block', padding: '5px 10px', fontSize: 11.5, fontWeight: 600, border: '1px solid var(--line-strong)', borderRadius: 6, background: 'var(--bg-paper)', color: 'var(--fg)' };
const X: CSSProperties = { border: 'none', background: 'transparent', color: 'var(--fg-3)', cursor: 'pointer', fontSize: 14, lineHeight: 1, padding: '0 2px' };
