'use client';

import { useState, useTransition, type CSSProperties } from 'react';
import { useRouter } from 'next/navigation';
import { archiveClient, restoreClient, clientArchivePreview, type ArchivePreview } from '@/app/actions/risansi-ownership';

// Archive a client from the Client Master list.
//
// Not optimistic, unlike the End Client tick this replaced. That one wrote a
// label; this one removes a client from every screen in the portal, and a box
// that ticks itself before anyone has read the consequences is the wrong shape
// for it. The tick opens a confirmation that names what is about to disappear —
// open opportunities and their value, planned visits, unresolved complaints —
// because 527 of 2,788 clients carry open work and "are you sure" tells nobody
// anything.
//
// Nothing is deleted. `deleted_at` is set, every query in the portal already
// reads `deleted_at IS NULL`, and the row comes back untouched with its visits,
// opportunities and revenue still attached.

const inr = (n: number) =>
  n >= 1e7 ? `₹${(n / 1e7).toFixed(2)} Cr` : n >= 1e5 ? `₹${(n / 1e5).toFixed(1)} L` : `₹${Math.round(n).toLocaleString('en-IN')}`;

export function ArchiveClientToggle({ clientId, name, archived, as = 'checkbox' }: {
  clientId: string;
  name: string;
  /** True when the row is an archived one, shown by the Show archived filter. */
  archived: boolean;
  /**
   * How the trigger looks. Client Master has an Archive column, where a tick
   * reads naturally beside the other ticks; the Unassigned tab on Reps &
   * Managers has a row of actions, where the same tick would look like a
   * selection box. Same confirmation, same action, either way.
   */
  as?: 'checkbox' | 'button';
}) {
  const router = useRouter();
  const [asking, setAsking] = useState(false);
  const [preview, setPreview] = useState<ArchivePreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [pending, start] = useTransition();

  const open = () => {
    setAsking(true); setPreview(null); setError(''); setLoading(!archived);
    // Restoring needs no preview: nothing is at risk and the record is already
    // out of everyone's way.
    if (archived) return;
    clientArchivePreview(Number(clientId))
      .then(p => setPreview(p))
      .finally(() => setLoading(false));
  };

  const confirm = () => {
    setError('');
    start(async () => {
      const res = archived
        ? await restoreClient(Number(clientId))
        : await archiveClient(Number(clientId));
      if (!res.ok) { setError(res.error); return; }
      setAsking(false);
      router.refresh();
    });
  };

  const anythingOpen = preview
    ? preview.openOpps + preview.plannedVisits + preview.openComplaints
    : 0;

  return (
    <>
      {as === 'button' ? (
        <button
          type="button" onClick={open}
          title={archived ? 'Restore this client' : 'Archive this client'}
          aria-label={archived ? `Restore ${name}` : `Archive ${name}`}
          style={{ ...BTN, padding: '6px 11px', fontSize: 12, color: archived ? 'var(--fg)' : 'var(--neg)' }}
        >
          {archived ? 'Restore' : 'Archive'}
        </button>
      ) : (
        <input
          type="checkbox"
          checked={archived}
          readOnly
          onClick={e => { e.preventDefault(); open(); }}
          title={archived ? 'Archived — click to restore' : 'Archive this client'}
          aria-label={archived ? `Restore ${name}` : `Archive ${name}`}
          style={{ width: 15, height: 15, accentColor: 'var(--neg)', cursor: 'pointer' }}
        />
      )}

      {asking && (
        <>
          <div style={SCRIM} onClick={() => !pending && setAsking(false)} />
          <div style={MODAL} role="dialog" aria-modal="true">
            <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>
              {archived ? 'Restore this client?' : 'Archive this client?'}
            </div>
            <div style={{ fontSize: 13, color: 'var(--fg-2)' }}>
              {preview ? `${preview.name} · ${preview.code}` : name}
            </div>

            {!archived && (
              <div style={{ marginTop: 12 }}>
                {loading && <div style={{ fontSize: 12.5, color: 'var(--fg-3)' }}>Checking what this would hide…</div>}

                {preview && anythingOpen > 0 && (
                  <div style={WARN}>
                    <div style={{ fontWeight: 600, marginBottom: 4 }}>This client still has open work.</div>
                    <ul style={{ margin: 0, paddingLeft: 18 }}>
                      {preview.openOpps > 0 && (
                        <li>
                          {preview.openOpps} open opportunit{preview.openOpps === 1 ? 'y' : 'ies'}
                          {preview.openValueInr > 0 && ` · ${inr(preview.openValueInr)}`}
                        </li>
                      )}
                      {preview.plannedVisits > 0 && (
                        <li>{preview.plannedVisits} planned visit{preview.plannedVisits === 1 ? '' : 's'}</li>
                      )}
                      {preview.openComplaints > 0 && (
                        <li>{preview.openComplaints} unresolved complaint{preview.openComplaints === 1 ? '' : 's'}</li>
                      )}
                    </ul>
                  </div>
                )}

                {preview && anythingOpen === 0 && (
                  <div style={{ fontSize: 12.5, color: 'var(--fg-3)' }}>
                    Nothing open against it
                    {preview.visits > 0 && ` · ${preview.visits} visit${preview.visits === 1 ? '' : 's'} on record`}
                    {preview.hasRevenue && ' · has revenue history'}.
                  </div>
                )}

                <div style={{ fontSize: 12.5, color: 'var(--fg-2)', marginTop: 10, lineHeight: 1.55 }}>
                  It disappears from Client 360, Opportunities, Field Activity and the
                  Executive Review. Nothing is deleted — its visits, opportunities and
                  revenue stay attached and come back with it.
                </div>
                <div style={{ fontSize: 11.5, color: 'var(--fg-3)', marginTop: 6 }}>
                  Restore it from Admin › Recoverable, or by ticking <strong>Show archived</strong> on this page.
                </div>
              </div>
            )}

            {archived && (
              <div style={{ fontSize: 12.5, color: 'var(--fg-2)', marginTop: 12, lineHeight: 1.55 }}>
                It returns to Client 360 and every other screen, with its history intact.
              </div>
            )}

            {error && <div style={ERR}>{error}</div>}

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
              <button type="button" onClick={() => setAsking(false)} disabled={pending} style={BTN}>Cancel</button>
              <button
                type="button" onClick={confirm} disabled={pending || (!archived && loading)}
                style={{ ...BTN, ...(archived ? GO : DANGER) }}
              >
                {pending ? 'Working…' : archived ? 'Restore' : 'Archive'}
              </button>
            </div>
          </div>
        </>
      )}
    </>
  );
}

const SCRIM: CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(10,22,40,0.4)', zIndex: 400 };
const MODAL: CSSProperties = {
  position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)',
  width: 'min(440px, calc(100vw - 32px))', zIndex: 401, textAlign: 'left',
  background: 'var(--bg-paper)', border: '1px solid var(--line)',
  borderRadius: 'var(--radius)', padding: '18px 20px',
  boxShadow: '0 18px 50px rgba(10,22,40,0.28)',
};
const WARN: CSSProperties = {
  background: 'var(--warn-soft)', border: '1px solid var(--warn)',
  color: 'var(--warn-strong, var(--warn))', borderRadius: 6,
  padding: '9px 12px', fontSize: 12.5, lineHeight: 1.6,
};
const ERR: CSSProperties = {
  marginTop: 10, padding: '8px 11px', background: 'var(--neg-soft)',
  border: '1px solid var(--neg)', borderRadius: 6, fontSize: 12.5, color: 'var(--neg)',
};
const BTN: CSSProperties = {
  padding: '7px 15px', fontSize: 12.5, fontWeight: 600, fontFamily: 'inherit',
  background: 'var(--bg-paper)', color: 'var(--fg)',
  border: '1px solid var(--line-strong)', borderRadius: 6, cursor: 'pointer',
};
const DANGER: CSSProperties = { background: 'var(--neg-fill)', color: 'var(--on-accent)', borderColor: 'var(--neg-fill)' };
const GO: CSSProperties = { background: 'var(--accent-fill)', color: 'var(--on-accent)', borderColor: 'var(--accent-fill)' };
