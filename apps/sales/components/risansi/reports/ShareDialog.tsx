'use client';

// Who else can read this report.
//
// WHAT SHARING IS HERE, AND WHAT IT IS NOT
//
// It is not sending somebody your figures. Every number in a report is
// recomputed under whoever has it open, so sharing a report is sharing the
// QUESTIONS, not the answers: a manager sharing their book with a rep has
// not leaked anything, and the rep opening it sees their own accounts only.
// The panel says so in as many words, because a share dialog that does not
// is a share dialog people are afraid to use.
//
// It is also read-only. A recipient can open it, filter it for themselves
// and take a copy; the original stays the author's. There is deliberately no
// co-editing — two people dragging cards around one saved document is a
// feature that needs conflict handling nobody has asked for.
//
// THE LIST
//
// Everybody active except you, with their role shown. Not narrowed to your
// own team: a rep sharing a report upwards with a manager who is not theirs,
// or sideways with a colleague, are both normal, and the recipient's own
// scope is what decides what they will actually see.

import { useEffect, useState, useTransition } from 'react';
import { getShareCandidates, setReportShares } from '@/app/actions/risansi-reports';

interface Candidate { id: number; name: string; email: string; role: string }

export function ShareDialog({ reportId, title, initial, onClose, onDone }: {
  reportId: number;
  title: string;
  /** Who it is shared with now. */
  initial: number[];
  onClose: () => void;
  /** The message to show, and who it ended up shared with. */
  onDone: (message: string, picked: number[]) => void;
}) {
  const [people, setPeople] = useState<Candidate[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<number[]>(initial);
  const [busy, start] = useTransition();

  useEffect(() => {
    let alive = true;
    void (async () => {
      const r = await getShareCandidates().catch(() => null);
      if (!alive) return;
      if (!r) setError('Could not load the list of people.');
      else if (!r.ok) setError(r.error);
      else setPeople(r.data);
    })();
    return () => { alive = false; };
  }, []);

  const needle = q.trim().toLowerCase();
  const shown = (people ?? []).filter(p =>
    !needle || p.name.toLowerCase().includes(needle) || p.email.toLowerCase().includes(needle));

  const toggle = (id: number) =>
    setPicked(ps => (ps.includes(id) ? ps.filter(x => x !== id) : [...ps, id]));

  const save = () => start(async () => {
    const r = await setReportShares(reportId, picked);
    if (!r.ok) { setError(r.error); return; }
    const bits: string[] = [];
    if (r.data.added) bits.push(`${r.data.added} ${r.data.added === 1 ? 'person' : 'people'} told`);
    if (r.data.removed > 0) bits.push(`${r.data.removed} removed`);
    onDone(
      picked.length
        ? `Shared with ${picked.length} ${picked.length === 1 ? 'person' : 'people'}${bits.length ? ` · ${bits.join(', ')}` : ''}`
        : 'Nobody else can see this report now.',
      picked,
    );
  });

  const added = picked.filter(id => !initial.includes(id)).length;
  const removed = initial.filter(id => !picked.includes(id)).length;

  return (
    <div
      role="dialog" aria-modal="true" aria-label={`Share ${title}`}
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 60,
               display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '7vh 16px' }}
    >
      <div onClick={e => e.stopPropagation()}
        style={{ background: 'var(--bg-paper)', border: '1px solid var(--line)', borderRadius: 9,
                 width: '100%', maxWidth: 440, maxHeight: '80vh', display: 'flex',
                 flexDirection: 'column', boxShadow: '0 18px 48px rgba(0,0,0,0.3)' }}>
        <header style={{ padding: '13px 15px 9px', borderBottom: '1px solid var(--line)' }}>
          <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: 'var(--fg)' }}>Share this report</h2>
          <p style={{ margin: '5px 0 0', fontSize: 11.5, color: 'var(--fg-3)', lineHeight: 1.5 }}>
            Everyone you pick can open <strong style={{ color: 'var(--fg-2)' }}>{title}</strong> and
            read it against <strong style={{ color: 'var(--fg-2)' }}>their own</strong> accounts — they
            will not see your figures, and they cannot change the report. They get an email and a
            notification; only people newly added are told.
          </p>
        </header>

        <div style={{ padding: '9px 15px 0' }}>
          <input type="search" value={q} onChange={e => setQ(e.target.value)}
            placeholder="Search by name or email…" autoFocus
            style={{ width: '100%', boxSizing: 'border-box', background: 'var(--bg)',
                     border: '1px solid var(--line)', borderRadius: 5, padding: '5px 8px',
                     fontSize: 12, color: 'var(--fg)', fontFamily: 'inherit' }} />
        </div>

        {error && (
          <p role="alert" style={{ margin: '9px 15px 0', fontSize: 11.5, color: 'var(--neg)' }}>{error}</p>
        )}

        <div style={{ flex: 1, overflowY: 'auto', padding: '7px 9px 9px', minHeight: 120 }}>
          {!people && !error && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5, padding: '4px 6px' }}>
              {[0, 1, 2, 3, 4].map(i => <div key={i} className="shimmer" style={{ height: 22 }} />)}
            </div>
          )}
          {people && !shown.length && (
            <p style={{ margin: '10px 6px', fontSize: 12, color: 'var(--fg-3)' }}>
              Nobody matches that.
            </p>
          )}
          {shown.map(p => {
            const on = picked.includes(p.id);
            return (
              <label key={p.id}
                style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 6px',
                         borderRadius: 5, cursor: 'pointer',
                         background: on ? 'var(--accent-soft)' : 'transparent' }}>
                <input type="checkbox" checked={on} onChange={() => toggle(p.id)} />
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'block', fontSize: 12.5, color: 'var(--fg)',
                                 overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {p.name}
                  </span>
                  <span style={{ display: 'block', fontSize: 10.5, color: 'var(--fg-4)',
                                 overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {p.email}
                  </span>
                </span>
                <span style={{ fontSize: 10, color: 'var(--fg-4)', textTransform: 'capitalize',
                               flexShrink: 0 }}>{p.role}</span>
              </label>
            );
          })}
        </div>

        <footer style={{ padding: '9px 15px 12px', borderTop: '1px solid var(--line)',
                         display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ flex: 1, fontSize: 11, color: 'var(--fg-3)' }}>
            {picked.length
              ? `${picked.length} ${picked.length === 1 ? 'person' : 'people'}`
              : 'Nobody'}
            {(added || removed) ? ' · ' : ''}
            {added ? `${added} to add` : ''}
            {added && removed ? ', ' : ''}
            {removed ? `${removed} to remove` : ''}
          </span>
          <button type="button" onClick={onClose} disabled={busy} style={BTN}>Cancel</button>
          <button type="button" onClick={save} disabled={busy || (!added && !removed)}
            style={{ ...BTN, background: 'var(--accent-fill)', color: '#fff', borderColor: 'transparent',
                     opacity: busy || (!added && !removed) ? 0.6 : 1 }}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </footer>
      </div>
    </div>
  );
}

const BTN: React.CSSProperties = {
  background: 'var(--bg)', border: '1px solid var(--line)', borderRadius: 5,
  padding: '5px 12px', fontSize: 12, color: 'var(--fg-2)', cursor: 'pointer', fontFamily: 'inherit',
};
