'use client';

import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { useRouter } from 'next/navigation';
import {
  canReassignClient, getReassignImpact, reassignOpportunityClient,
  type ReassignImpact,
} from '@/app/actions/risansi-opportunity-client';
import { useCloseGuard, CloseX, CloseConfirm, KeepOpenHint } from './FormCloseGuard';

// Sysadmin-only: point an opportunity at the client it should have been on.
//
// Renders nothing at all for everyone else, and asks the server rather than
// being told by a prop, so the check cannot drift from the one the action
// enforces. It is visible on a locked Won/Lost deal too — a mis-linked closed
// deal is exactly the case that needs correcting, and the lock exists to stop
// the commercials being edited, not the account being fixed.

interface ClientHit {
  id: number; code: string | null; legal_name: string;
  city: string | null; state: string | null; industry: string | null;
}

const CR = 10_000_000;

export function ChangeOppClient({ oppId, currentCode, currentName }: {
  oppId: number;
  currentCode?: string | null;
  currentName?: string | null;
}) {
  const router = useRouter();
  const [allowed, setAllowed] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => { canReassignClient().then(setAllowed).catch(() => setAllowed(false)); }, []);
  if (!allowed) return null;

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} style={LINK}>
        ⇄ Change client
      </button>
      {open && (
        <ChangeDialog
          oppId={oppId} currentCode={currentCode} currentName={currentName}
          onClose={() => setOpen(false)}
          onDone={() => { setOpen(false); router.refresh(); }}
        />
      )}
    </>
  );
}

function ChangeDialog({ oppId, currentCode, currentName, onClose, onDone }: {
  oppId: number; currentCode?: string | null; currentName?: string | null;
  onClose: () => void; onDone: () => void;
}) {
  const [impact, setImpact] = useState<ReassignImpact | null>(null);
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<ClientHit[]>([]);
  const [picked, setPicked] = useState<ClientHit | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [done, setDone] = useState<string>('');
  const boxRef = useRef<HTMLInputElement>(null);

  useEffect(() => { getReassignImpact(oppId).then(setImpact).catch(() => {}); }, [oppId]);
  useEffect(() => { boxRef.current?.focus(); }, []);

  // Debounced, and guarded against out-of-order responses: typing quickly fires
  // several searches and the slowest must not overwrite the newest.
  const seq = useRef(0);
  const search = useCallback((term: string) => {
    const mine = ++seq.current;
    if (term.trim().length < 2) { setHits([]); return; }
    fetch(`/api/risansi/clients-search?q=${encodeURIComponent(term.trim())}`)
      .then(r => r.ok ? r.json() : [])
      .then((rows: ClientHit[]) => { if (mine === seq.current) setHits(rows.slice(0, 12)); })
      .catch(() => { if (mine === seq.current) setHits([]); });
  }, []);
  useEffect(() => { const t = setTimeout(() => search(q), 220); return () => clearTimeout(t); }, [q, search]);

  const submit = async () => {
    if (!picked) return;
    setBusy(true); setErr('');
    try {
      const res = await reassignOpportunityClient(oppId, picked.id);
      // The refusal is the useful half here — "that is already the client on
      // this opportunity" used to arrive as the generic redacted message below.
      if (!res.ok) { setErr(res.error); setBusy(false); return; }
      setDone(
        `Moved to ${res.newClientCode ?? ''} ${res.newClientName}.`
        + (res.movedOrders ? ` ${res.movedOrders} order(s) moved with it.` : '')
        + (res.clearedVisit ? ' The visit link was cleared — it belonged to the old client.' : ''),
      );
      setTimeout(onDone, 1400);
    } catch (e) {
      const raw = e instanceof Error ? e.message : '';
      const redacted = !raw || /unexpected response/i.test(raw) || Boolean((e as { digest?: string })?.digest);
      setErr(redacted ? 'Could not change the client.' : raw);
      setBusy(false);
    }
  };

  // No draft here — nothing is typed into this one but a client search, and the
  // search results are a lookup rather than work. The close still has to be
  // deliberate, though: a picked client thrown away by a stray backdrop click
  // sends the sysadmin back through the search.
  const guard = useCloseGuard({
    dirty: Boolean(picked) || q.trim().length > 0,
    onClose,
    enabled: !busy && !done,
  });

  return (
    <div onClick={guard.onBackdropClick}
      style={{
        position: 'fixed', inset: 0, zIndex: 600, background: 'rgba(0,0,0,0.5)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
      }}>
      <div className="risansi-modal" role="dialog" aria-modal="true"
        style={{
          width: 560, maxWidth: '100%', maxHeight: '88vh', overflowY: 'auto',
          background: 'var(--bg-paper)', color: 'var(--fg)', borderRadius: 12,
          boxShadow: '0 24px 64px rgba(0,0,0,0.35)',
        }}>
        <div style={{ padding: '14px 18px', background: 'var(--accent-fill)', color: 'var(--on-accent)', position: 'sticky', top: 0, zIndex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontSize: 14, fontWeight: 700 }}>Change the client on this opportunity</div>
              <div style={{ fontSize: 11.5, opacity: 0.9, marginTop: 3 }}>
                Sysadmin only · {impact?.quoteRef ?? `Opportunity #${oppId}`}
              </div>
            </div>
            <CloseX onClick={guard.requestClose} tone="onDark" title="Close this form" />
          </div>
          {guard.asking && (
            <CloseConfirm
              tone="onDark"
              message="Close without moving it? The client you picked will be forgotten."
              onConfirm={guard.confirmClose}
              onCancel={guard.keepEditing}
            />
          )}
          {guard.hint && !guard.asking && <KeepOpenHint tone="onDark" />}
        </div>

        <div style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ fontSize: 12 }}>
            <span style={{ color: 'var(--fg-3)' }}>Currently on</span>{' '}
            <strong>{currentCode ?? impact?.currentClientCode ?? ''} {currentName ?? impact?.currentClientName ?? '…'}</strong>
          </div>

          {/* Said before anything moves, so the consequence is never a surprise. */}
          {impact && (impact.orders > 0 || impact.visitId != null) && (
            <div style={{
              fontSize: 11.5, lineHeight: 1.55, padding: '8px 11px', borderRadius: 6,
              color: 'var(--warn-strong)', background: 'var(--warn-soft)',
              border: '1px solid var(--warn)',
            }}>
              {impact.orders > 0 && (
                <div>
                  {impact.orders} order{impact.orders === 1 ? '' : 's'} worth ₹
                  {Math.round(impact.ordersValueCr * CR).toLocaleString('en-IN')} will move to the new
                  client as well, so the order and the deal stay on the same account.
                </div>
              )}
              {impact.visitId != null && (
                <div style={{ marginTop: impact.orders ? 4 : 0 }}>
                  This deal was created from a visit. If the visit belongs to the old client, that link
                  will be cleared rather than left pointing across accounts.
                </div>
              )}
            </div>
          )}

          <div>
            <label style={LBL}>Search for the correct client</label>
            <input ref={boxRef} value={q} onChange={e => { setQ(e.target.value); setPicked(null); }}
              placeholder="Name or client code — at least 2 characters"
              style={INPUT} />
          </div>

          {picked ? (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8, padding: '9px 11px', borderRadius: 6,
              background: 'var(--pos-soft)', border: '1px solid var(--pos)',
            }}>
              <div style={{ fontSize: 12.5 }}>
                <strong>{picked.legal_name}</strong>
                <div style={{ fontSize: 11, color: 'var(--fg-3)', fontFamily: 'var(--font-mono)' }}>
                  {picked.code ?? '—'} · {[picked.city, picked.state].filter(Boolean).join(', ') || '—'}
                </div>
              </div>
              <button type="button" onClick={() => { setPicked(null); }}
                style={{ ...LINK, marginLeft: 'auto' }}>Change</button>
            </div>
          ) : hits.length > 0 && (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, maxHeight: 210, overflowY: 'auto', border: '1px solid var(--line)', borderRadius: 6 }}>
              {hits.map(h => (
                <li key={h.id}>
                  <button type="button" onClick={() => { setPicked(h); setHits([]); }}
                    disabled={h.id === impact?.currentClientId}
                    style={{
                      width: '100%', textAlign: 'left', border: 'none', background: 'none',
                      padding: '8px 11px', cursor: h.id === impact?.currentClientId ? 'not-allowed' : 'pointer',
                      opacity: h.id === impact?.currentClientId ? 0.45 : 1,
                      borderBottom: '1px solid var(--line-2)', fontFamily: 'inherit',
                    }}>
                    <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--fg)' }}>{h.legal_name}</div>
                    <div style={{ fontSize: 10.5, color: 'var(--fg-3)' }}>
                      <span style={{ fontFamily: 'var(--font-mono)' }}>{h.code ?? '—'}</span>
                      {' · '}{[h.city, h.state].filter(Boolean).join(', ') || '—'}
                      {h.id === impact?.currentClientId ? ' · already on this deal' : ''}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}

          {err && <div style={ERRBOX}>{err}</div>}
          {done && <div style={{ ...ERRBOX, color: 'var(--pos)', background: 'var(--pos-soft)', borderColor: 'var(--pos)' }}>{done}</div>}

          {!done && (
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button type="button" onClick={guard.requestClose} disabled={busy} style={GHOST}>Cancel</button>
              <button type="button" onClick={submit} disabled={busy || !picked}
                style={{ ...PRIMARY, opacity: busy || !picked ? 0.5 : 1 }}>
                {busy ? 'Moving…' : 'Move this opportunity'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const LINK: CSSProperties = {
  background: 'none', border: 'none', color: 'var(--brand-blue)', cursor: 'pointer',
  fontSize: 11.5, fontWeight: 600, fontFamily: 'inherit', padding: 0, textDecoration: 'underline',
};
const LBL: CSSProperties = {
  display: 'block', fontSize: 10, fontWeight: 700, textTransform: 'uppercase',
  letterSpacing: '0.05em', color: 'var(--fg-3)', marginBottom: 5,
};
const INPUT: CSSProperties = {
  width: '100%', boxSizing: 'border-box', padding: '9px 11px', fontSize: 13,
  fontFamily: 'inherit', background: 'var(--bg-sunk)', border: '1px solid var(--line-strong)',
  borderRadius: 6, color: 'var(--fg)', outline: 'none',
};
const ERRBOX: CSSProperties = {
  fontSize: 11.5, color: 'var(--neg-strong)', background: 'var(--neg-soft)',
  border: '1px solid var(--neg)', borderRadius: 6, padding: '8px 11px', lineHeight: 1.5,
};
const GHOST: CSSProperties = {
  border: '1px solid var(--line-strong)', background: 'var(--bg-paper)', color: 'var(--fg)',
  borderRadius: 6, fontSize: 12.5, fontWeight: 600, padding: '8px 14px', cursor: 'pointer', fontFamily: 'inherit',
};
const PRIMARY: CSSProperties = {
  border: 'none', background: 'var(--accent-fill)', color: 'var(--on-accent)', borderRadius: 6,
  fontSize: 12.5, fontWeight: 600, padding: '8px 16px', cursor: 'pointer', fontFamily: 'inherit',
};
