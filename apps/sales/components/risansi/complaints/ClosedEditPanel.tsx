'use client';

import { useState, useTransition } from 'react';
import { unlockClosedComplaint, relockComplaint } from '@/app/actions/risansi-complaints-v2';

const MIN_REASON = 20;

export interface GrantView {
  reason:     string;
  granted_by: string;
  granted_by_name: string | null;
  granted_at: string;
  expires_at: string;
}

/**
 * Correcting a closed complaint.
 *
 * Two states in one strip: closed and locked, with a way to ask; and open for
 * correction, saying who opened it, why, and until when. Reopen stays where it
 * is on the move bar and means what it always meant — there is more work to do
 * on this complaint. This is for the other case, the one that used to go
 * through a global switch: the record is finished and something in it is
 * wrong.
 */
export function ClosedEditPanel({ complaintId, grant, mayUnlock }: {
  complaintId: number;
  grant: GrantView | null;
  /** Whether this viewer could edit some page of it if it were not closed. */
  mayUnlock: boolean;
}) {
  const [open,   setOpen]   = useState(false);
  const [reason, setReason] = useState('');
  const [error,  setError]  = useState('');
  const [busy,   start]     = useTransition();

  const short = reason.trim().length < MIN_REASON;

  const submit = () => {
    setError('');
    start(async () => {
      const res = await unlockClosedComplaint(complaintId, reason);
      if (res.ok) { setOpen(false); setReason(''); }
      else setError(res.error);
    });
  };

  const lock = () => {
    setError('');
    start(async () => {
      const res = await relockComplaint(complaintId);
      if (!res.ok) setError(res.error);
    });
  };

  if (grant) {
    const until = new Date(grant.expires_at);
    return (
      <div style={{ ...BAR, background: 'var(--warn-soft)', border: '1px solid var(--warn)' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--warn-strong)' }}>
            Open for correction until {until.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--fg-2)', marginTop: 2 }}>
            {grant.granted_by_name ?? grant.granted_by} opened it: {grant.reason}
          </div>
          <div style={{ fontSize: 11, color: 'var(--fg-3)', marginTop: 2 }}>
            The complaint stays Closed. Every save while it is open is recorded against this reason.
          </div>
        </div>
        {mayUnlock && (
          <button type="button" onClick={lock} disabled={busy} style={GHOST}>
            {busy ? '…' : 'Lock it again'}
          </button>
        )}
        {error && <div style={ERR}>{error}</div>}
      </div>
    );
  }

  if (!mayUnlock) return null;

  return (
    <div style={{ ...BAR, background: 'var(--bg-elev)', border: '1px solid var(--line)', flexWrap: 'wrap' }}>
      {!open ? (
        <>
          <div style={{ flex: 1, minWidth: 0, fontSize: 11.5, color: 'var(--fg-2)' }}>
            Something recorded wrongly on a closed complaint can be corrected without reopening it.
          </div>
          <button type="button" onClick={() => setOpen(true)} style={GHOST}>
            Edit this closed complaint
          </button>
        </>
      ) : (
        <div style={{ width: '100%' }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--fg)' }}>What needs correcting, and why?</div>
          <div style={{ fontSize: 11.5, color: 'var(--fg-3)', marginTop: 2, marginBottom: 8 }}>
            Goes on the complaint&apos;s own record and into the audit log, against your name. Editing stays open
            for two hours and the complaint stays Closed throughout. If there is more work to do rather than a
            correction to make, use Reopen on the move bar instead.
          </div>
          <textarea
            value={reason}
            onChange={e => setReason(e.target.value)}
            rows={3}
            autoFocus
            placeholder="e.g. Challan number keyed as DC/26-87/00153, the slip says DC/26-27/00153."
            style={{
              width: '100%', boxSizing: 'border-box', padding: '8px 10px', fontSize: 12.5,
              fontFamily: 'inherit', color: 'var(--fg)', background: 'var(--bg-paper)',
              border: '1px solid var(--line-strong)', borderRadius: 6, resize: 'vertical',
            }}
          />
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8 }}>
            <span style={{ fontSize: 11, color: short ? 'var(--fg-3)' : 'var(--pos)' }}>
              {short ? `${MIN_REASON - reason.trim().length} more character${MIN_REASON - reason.trim().length === 1 ? '' : 's'}` : 'Reason recorded'}
            </span>
            <span style={{ flex: 1 }} />
            <button type="button" onClick={() => { setOpen(false); setReason(''); setError(''); }} style={GHOST}>
              Cancel
            </button>
            <button type="button" onClick={submit} disabled={busy || short} style={{
              ...GHOST,
              background: busy || short ? 'var(--bg-sunk)' : 'var(--accent-fill)',
              color: busy || short ? 'var(--fg-4)' : 'var(--on-accent)',
              borderColor: busy || short ? 'var(--line)' : 'var(--accent-fill)',
              cursor: busy || short ? 'not-allowed' : 'pointer',
            }}>
              {busy ? 'Opening…' : 'Open for correction'}
            </button>
          </div>
          {error && <div style={ERR}>{error}</div>}
        </div>
      )}
    </div>
  );
}

const BAR: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 12,
  padding: '10px 14px', borderRadius: 8, marginBottom: 12,
};
const GHOST: React.CSSProperties = {
  padding: '6px 12px', fontSize: 12, fontFamily: 'inherit', fontWeight: 500,
  background: 'var(--bg-paper)', color: 'var(--fg)',
  border: '1px solid var(--line-strong)', borderRadius: 6,
  cursor: 'pointer', whiteSpace: 'nowrap',
};
const ERR: React.CSSProperties = {
  width: '100%', marginTop: 8, fontSize: 11.5, color: 'var(--neg-strong)',
};
