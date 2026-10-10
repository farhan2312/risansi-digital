'use client';

import { useState, useTransition, type CSSProperties } from 'react';
import { useRouter } from 'next/navigation';
import { moveComplaint } from '@/app/actions/risansi-complaints-v2';
import { NEXT, type ComplaintStatus } from '@/lib/risansi-complaint-flow';

// The moves a complaint can make from where it is, as buttons; the refusal, in
// words, when a gate holds it back. Reopening asks why. Closure Decision from
// the specification's page 8 is these two buttons, Close and Reopen, not a
// second status field that could disagree with the first.

const TONE: Partial<Record<ComplaintStatus, CSSProperties>> = {
  Resolved: { background: 'var(--pos)', borderColor: 'var(--pos)', color: '#fff' },
  Closed:   { background: 'var(--fg-2)', borderColor: 'var(--fg-2)', color: '#fff' },
};

export function ComplaintMoveBar({ complaintId, status, canMove, gate }: {
  complaintId: number;
  status: string;
  canMove: boolean;
  /** What each next status still needs, computed on the server for the current record. */
  gate: Partial<Record<ComplaintStatus, string[]>>;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [asking, setAsking] = useState<ComplaintStatus | null>(null);
  const [note, setNote] = useState('');
  const [err, setErr] = useState('');
  const [blocked, setBlocked] = useState<{ to: ComplaintStatus; need: string[] } | null>(null);

  const next = NEXT[status as ComplaintStatus] ?? [];
  if (!next.length) return null;
  const reopening = (to: ComplaintStatus) => (status === 'Resolved' || status === 'Closed') && to === 'Under Investigation';

  const go = (to: ComplaintStatus, why?: string) => {
    setErr(''); setBlocked(null);
    start(async () => {
      const res = await moveComplaint(complaintId, to, why);
      if (!res.ok) { setErr(res.error); return; }
      setAsking(null); setNote('');
      router.refresh();
    });
  };

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--fg-3)' }}>Move to</span>
        {next.map(to => {
          const need = gate[to] ?? [];
          const isReopen = reopening(to);
          const held = need.length > 0 && !isReopen;
          return (
            <button key={to} type="button" disabled={!canMove || pending}
              title={!canMove ? 'Only the Complaint Team, QC, or the person a stage is assigned to can move a complaint'
                : held ? `Not yet: ${need.join(' · ')}` : isReopen ? 'Reopen — a reason is asked for' : `Move to ${to}`}
              onClick={() => { if (held) { setBlocked({ to, need }); return; } if (isReopen) { setAsking(to); setErr(''); return; } go(to); }}
              style={{ ...BTN, ...(held || !canMove ? { opacity: 0.55 } : TONE[to] ?? {}), ...(isReopen ? { color: 'var(--warn)', borderColor: 'var(--warn)', background: 'var(--bg-paper)' } : {}) }}>
              {isReopen ? '↩ Reopen' : to}{held && <span aria-hidden style={{ marginLeft: 6, fontSize: 10 }}>🔒</span>}
            </button>
          );
        })}
      </div>

      {blocked && (
        <div style={{ ...MSG, background: 'var(--warn-soft)', border: '1px solid var(--warn)', color: 'var(--warn-strong, var(--warn))' }}>
          <b>Before {blocked.to}:</b>
          <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>{blocked.need.map(n => <li key={n}>{n}</li>)}</ul>
        </div>
      )}

      {asking && (
        <div style={{ ...MSG, background: 'var(--bg-elev)', border: '1px solid var(--line-strong)' }}>
          <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Why is this being reopened?</div>
          <textarea value={note} onChange={e => setNote(e.target.value)} rows={2} autoFocus
            placeholder="e.g. Customer reports the same leak after the replacement stator was fitted."
            style={{ width: '100%', boxSizing: 'border-box', padding: '8px 10px', fontSize: 13, fontFamily: 'inherit', border: '1px solid var(--line-strong)', borderRadius: 6, background: 'var(--bg-paper)', color: 'var(--fg)' }} />
          <div style={{ display: 'flex', gap: 8, marginTop: 8, justifyContent: 'flex-end' }}>
            <button type="button" onClick={() => { setAsking(null); setNote(''); setErr(''); }} style={BTN}>Cancel</button>
            <button type="button" disabled={!note.trim() || pending} onClick={() => go(asking, note)}
              style={{ ...BTN, background: 'var(--warn)', borderColor: 'var(--warn)', color: '#fff', opacity: note.trim() ? 1 : 0.5 }}>
              {pending ? 'Reopening…' : 'Reopen'}
            </button>
          </div>
        </div>
      )}

      {err && <div style={{ ...MSG, background: 'var(--neg-soft)', border: '1px solid var(--neg)', color: 'var(--neg-strong, var(--neg))' }}>{err}</div>}
    </div>
  );
}

const BTN: CSSProperties = {
  padding: '7px 13px', fontSize: 12, fontWeight: 600, fontFamily: 'inherit', borderRadius: 6, cursor: 'pointer',
  background: 'var(--bg-paper)', color: 'var(--fg)', border: '1px solid var(--line-strong)',
};
const MSG: CSSProperties = { marginTop: 10, padding: '9px 12px', borderRadius: 6, fontSize: 12, lineHeight: 1.5 };
