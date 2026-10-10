'use client';

import { useState, useTransition, type CSSProperties } from 'react';
import { useRouter } from 'next/navigation';
import {
  getClientOwnership, setClientOwnership, type ClientOwnership,
} from '@/app/actions/risansi-ownership';

export interface AssignableRep { id: number; name: string; role: string }

/**
 * Set who owns and who covers one client, from wherever the client is listed.
 *
 * This replaced the Special Access button, which granted the same access by a
 * different name: a grant was invisible on the client itself, editable only from
 * the Client Master row that created it, and recorded as an exception to a rule
 * rather than as the arrangement it actually described. A covering rep says the
 * same thing where people already look for it.
 *
 * The current state is fetched on open rather than passed in, so a list of a
 * thousand rows costs one query for the row you actually touch.
 */
export function ClientOwnershipButton({ clientId, clientCode, clientName, reps, ownerName, coverCount }: {
  clientId: number;
  clientCode: string;
  clientName: string;
  reps: AssignableRep[];
  ownerName: string | null;
  coverCount: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [state, setState] = useState<ClientOwnership | null>(null);
  const [primary, setPrimary] = useState('');
  const [secondary, setSecondary] = useState<number[]>([]);
  const [msg, setMsg] = useState(''); const [bad, setBad] = useState(false);
  const [q, setQ] = useState('');

  const load = () => {
    setOpen(true); setMsg(''); setState(null);
    start(async () => {
      const o = await getClientOwnership(clientId);
      if (!o) { setMsg('Could not load this client.'); setBad(true); return; }
      setState(o);
      setPrimary(o.primaryRepId != null ? String(o.primaryRepId) : '');
      setSecondary(o.secondary.map(s => s.id));
    });
  };

  const save = () => {
    setMsg('');
    start(async () => {
      const r = await setClientOwnership(clientId, primary ? Number(primary) : null, secondary);
      if (!r.ok) { setMsg(r.error); setBad(true); return; }
      setMsg(r.message ?? 'Saved.'); setBad(false);
      router.refresh();
      setTimeout(() => setOpen(false), 700);
    });
  };

  const primaryId = primary ? Number(primary) : null;
  const shown = q.trim()
    ? reps.filter(r => r.name.toLowerCase().includes(q.trim().toLowerCase()))
    : reps;

  return (
    <>
      <button type="button" onClick={load} style={TRIGGER} title="Set the owner and covering reps">
        {ownerName
          ? <><span style={{ fontWeight: 600 }}>{ownerName}</span>{coverCount > 0 && <span style={{ color: 'var(--fg-3)' }}> +{coverCount}</span>}</>
          : <span style={{ color: 'var(--neg)', fontWeight: 600 }}>Unassigned</span>}
      </button>

      {open && (
        <>
          <div onClick={() => !pending && setOpen(false)} style={SCRIM} />
          <div className="risansi-modal" style={MODAL}>
            <div style={HEAD}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 600 }}>Who works this client</div>
                <div style={{ fontSize: 11.5, color: 'var(--fg-3)', fontFamily: 'var(--font-mono)', marginTop: 2 }}>
                  {clientCode} · {clientName}
                </div>
              </div>
              <button onClick={() => !pending && setOpen(false)} style={X}>×</button>
            </div>

            <div style={{ padding: 18 }}>
              {msg && (
                <div style={{
                  margin: '0 0 12px', padding: '9px 13px', borderRadius: 6, fontSize: 12.5,
                  background: bad ? 'var(--neg-soft)' : 'var(--pos-soft)',
                  color: bad ? 'var(--neg-strong)' : 'var(--pos-strong)',
                  border: `1px solid ${bad ? 'var(--neg)' : 'var(--pos)'}`,
                }}>{msg}</div>
              )}

              {!state ? (
                <div style={{ fontSize: 13, color: 'var(--fg-3)', padding: '20px 0' }}>Loading…</div>
              ) : (
                <>
                  <label style={{ display: 'block', marginBottom: 16 }}>
                    <span style={LBL}>Primary rep — owns the account</span>
                    <select value={primary} onChange={e => setPrimary(e.target.value)} style={{ ...SEL, width: '100%' }}>
                      <option value="">— Nobody (client becomes unassigned) —</option>
                      {reps.map(r => (
                        <option key={r.id} value={r.id}>{r.name}{r.role === 'manager' ? ' · manager' : ''}</option>
                      ))}
                    </select>
                    <span style={HINT}>
                      New visits and opportunities are filed against them by default.
                    </span>
                  </label>

                  <div>
                    <span style={LBL}>Also covers — same access, never the default owner</span>
                    <input
                      value={q} onChange={e => setQ(e.target.value)} placeholder="Search people…"
                      style={{ ...SEL, width: '100%', marginBottom: 8 }}
                    />
                    <div style={LIST}>
                      {shown.filter(r => r.id !== primaryId).map(r => {
                        const on = secondary.includes(r.id);
                        return (
                          <label key={r.id} style={{ ...ROW, background: on ? 'var(--accent-soft, rgba(26,92,184,0.08))' : undefined }}>
                            <input
                              type="checkbox" checked={on} disabled={pending}
                              onChange={() => setSecondary(s => on ? s.filter(x => x !== r.id) : [...s, r.id])}
                              style={{ width: 15, height: 15, accentColor: 'var(--title)' }}
                            />
                            <span style={{ fontSize: 13 }}>{r.name}</span>
                            {r.role === 'manager' && <span style={{ fontSize: 10.5, color: 'var(--fg-3)' }}>manager</span>}
                          </label>
                        );
                      })}
                      {shown.filter(r => r.id !== primaryId).length === 0 && (
                        <div style={{ fontSize: 12, color: 'var(--fg-3)', padding: 10 }}>Nobody matches.</div>
                      )}
                    </div>
                    {state.managers.length > 0 && (
                      <span style={HINT}>
                        Above them: {state.managers.join(', ')} — they see this client through their team.
                      </span>
                    )}
                  </div>

                  <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 18 }}>
                    <button type="button" onClick={() => setOpen(false)} disabled={pending} style={BTN}>Cancel</button>
                    <button type="button" onClick={save} disabled={pending} style={BTN_PRI}>
                      {pending ? 'Saving…' : 'Save'}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </>
      )}
    </>
  );
}

const TRIGGER: CSSProperties = {
  background: 'none', border: '1px solid transparent', borderRadius: 5, padding: '3px 7px',
  fontSize: 12, fontFamily: 'inherit', color: 'var(--fg)', cursor: 'pointer', textAlign: 'left',
  maxWidth: 190, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
};
const SCRIM: CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(10,22,40,0.35)', zIndex: 300 };
const MODAL: CSSProperties = {
  position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)',
  width: 520, maxWidth: 'calc(100vw - 32px)', maxHeight: '88vh', overflowY: 'auto',
  background: 'var(--bg-paper)', borderRadius: 12, zIndex: 301,
  boxShadow: '0 20px 60px rgba(10,61,143,0.2)',
};
const HEAD: CSSProperties = {
  padding: '15px 18px', borderBottom: '1px solid var(--line)',
  display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12,
};
const X: CSSProperties = { background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: 'var(--fg-3)', lineHeight: 1 };
const LBL: CSSProperties = {
  display: 'block', fontSize: 10.5, fontWeight: 600, textTransform: 'uppercase',
  letterSpacing: '0.06em', color: 'var(--fg-3)', marginBottom: 5,
};
const HINT: CSSProperties = { display: 'block', fontSize: 11.5, color: 'var(--fg-3)', marginTop: 5 };
const SEL: CSSProperties = {
  padding: '7px 10px', fontSize: 13, fontFamily: 'inherit', background: 'var(--bg-sunk)',
  border: '1px solid var(--line-strong)', borderRadius: 6, color: 'var(--fg)', boxSizing: 'border-box',
};
const LIST: CSSProperties = {
  maxHeight: 200, overflowY: 'auto', border: '1px solid var(--line-strong)', borderRadius: 6,
};
const ROW: CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 9, padding: '7px 10px',
  borderBottom: '1px solid var(--line-2)', cursor: 'pointer',
};
const BTN: CSSProperties = {
  border: '1px solid var(--line-strong)', background: 'var(--bg-paper)', color: 'var(--fg)',
  borderRadius: 6, fontSize: 13, padding: '8px 16px', cursor: 'pointer', fontFamily: 'inherit',
};
const BTN_PRI: CSSProperties = { ...BTN, background: 'var(--accent-fill)', color: 'var(--on-accent)', borderColor: 'var(--accent-fill)', fontWeight: 500 };
