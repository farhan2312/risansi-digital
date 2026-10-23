'use client';

import { useState, type CSSProperties } from 'react';
import { useRouter } from 'next/navigation';
import { setVisitWaiver } from '@/app/actions/risansi-visit-waiver';
import { VISIT_WAIVER_REASONS, waiverReason } from '@/lib/risansi-visit-waiver';

// "A visit is not expected here, and this is why."
//
// Sits beside the Last Visit tile, because that is where somebody reads
// "Never visited" in red and wants to say the reason it is not a failure.
//
// Read-only for anyone who cannot work the account — the mark takes the client
// out of the coverage gap, which is not a viewer's call to make. Everyone sees
// the reason once it is set; the editing is what is gated.

export interface VisitWaiverState {
  code: string | null;
  note: string | null;
  until: string | null;
  byName: string | null;
  at: string | null;
}

const fmtDate = (d: string) =>
  new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });

export function VisitWaiverControl({ clientId, state, canEdit }: {
  clientId: number;
  state: VisitWaiverState;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [open, setOpen]       = useState(false);
  const [code, setCode]       = useState<string | null>(state.code);
  const [note, setNote]       = useState(state.note ?? '');
  const [until, setUntil]     = useState(state.until ?? '');
  const [busy, setBusy]       = useState(false);
  const [error, setError]     = useState('');

  const current = waiverReason(state.code);
  const expired = !!state.until && new Date(state.until + 'T23:59:59') < new Date();
  const picked  = waiverReason(code);

  const save = async (next: string | null) => {
    setBusy(true); setError('');
    const res = await setVisitWaiver(clientId, next, next === null ? null : note, next === null ? null : (until || null));
    if (!res.ok) { setError(res.error); setBusy(false); return; }
    setBusy(false); setOpen(false);
    router.refresh();
  };

  // ── Collapsed ───────────────────────────────────────────────
  if (!open) {
    if (!current) {
      if (!canEdit) return null;
      return (
        <button type="button" onClick={() => setOpen(true)} style={ADD}>
          + Visit not required?
        </button>
      );
    }
    return (
      <div style={{ ...CHIP, borderColor: expired ? 'var(--line)' : current.color }}>
        <span style={{ ...DOT, background: expired ? 'var(--fg-4)' : current.color }} />
        <span style={{ fontWeight: 600, color: 'var(--fg)' }}>{current.label}</span>
        {state.note && <span style={META}>&middot; {state.note}</span>}
        {state.until && (
          // Said plainly, because an expired waiver is back in the numbers and
          // the rep needs to know that without working out the date.
          <span style={{ ...META, color: expired ? 'var(--neg)' : 'var(--fg-3)' }}>
            &middot; {expired ? 'expired ' : 'until '}{fmtDate(state.until)}
          </span>
        )}
        {state.byName && <span style={META}>&middot; {state.byName}</span>}
        {canEdit && (
          <button type="button" onClick={() => setOpen(true)} style={LINKBTN}>Change</button>
        )}
      </div>
    );
  }

  // ── Open ────────────────────────────────────────────────────
  return (
    <div style={BOX}>
      <div style={HEADROW}>
        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--fg)' }}>Why no visit is expected</span>
        <button type="button" onClick={() => setOpen(false)} style={CLOSE} aria-label="Close">&times;</button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        {VISIT_WAIVER_REASONS.map(r => {
          const on = code === r.code;
          return (
            <button key={r.code} type="button" onClick={() => setCode(on ? null : r.code)}
              style={{ ...OPTION, borderColor: on ? r.color : 'var(--line)',
                       background: on ? 'var(--bg-sunk)' : 'transparent' }}>
              <span style={{ ...DOT, background: r.color, marginTop: 5 }} />
              <span>
                <span style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: 'var(--fg)' }}>{r.label}</span>
                <span style={{ display: 'block', fontSize: 11, color: 'var(--fg-3)', marginTop: 1 }}>{r.hint}</span>
              </span>
            </button>
          );
        })}
      </div>

      {code && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 8, marginTop: 10 }}>
          <div>
            <label style={LABEL}>Detail (optional)</label>
            <input value={note} onChange={e => setNote(e.target.value)} maxLength={120}
              placeholder={picked?.code === 'sick_unit' ? 'Shut since…' : 'Anything the review should see'}
              style={INPUT} />
          </div>
          <div>
            <label style={LABEL}>
              Review by {picked?.expects_until ? '' : '(optional)'}
            </label>
            <input type="date" value={until} onChange={e => setUntil(e.target.value)} style={{ ...INPUT, width: 150 }} />
          </div>
        </div>
      )}
      {code && (
        <p style={FOOT}>
          {until
            ? 'After this date the client counts towards the visit gap again.'
            : 'No date means this stands until somebody clears it.'}
        </p>
      )}

      {error && <div style={ERR}>{error}</div>}

      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginTop: 10 }}>
        {state.code
          ? <button type="button" disabled={busy} onClick={() => save(null)} style={CLEAR}>
              Visits are expected
            </button>
          : <span />}
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" onClick={() => setOpen(false)} style={CANCEL}>Cancel</button>
          <button type="button" disabled={busy || !code} onClick={() => save(code)}
            style={{ ...SAVE, opacity: busy || !code ? 0.5 : 1 }}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

const ADD: CSSProperties = {
  background: 'none', border: '1px dashed var(--line-strong)', borderRadius: 6,
  padding: '4px 10px', fontSize: 11.5, color: 'var(--fg-3)', cursor: 'pointer',
  fontFamily: 'inherit', marginTop: 8,
};
const CHIP: CSSProperties = {
  display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 5, marginTop: 8,
  padding: '5px 10px', border: '1px solid var(--line)', borderLeftWidth: 3,
  borderRadius: 6, background: 'var(--bg-elev)', fontSize: 11.5, color: 'var(--fg-2)',
};
const DOT: CSSProperties = {
  width: 6, height: 6, borderRadius: '50%', flexShrink: 0, display: 'inline-block',
};
const META: CSSProperties = { fontSize: 11, color: 'var(--fg-3)' };
const LINKBTN: CSSProperties = {
  marginLeft: 'auto', background: 'none', border: 'none', padding: 0,
  color: 'var(--brand-blue)', fontSize: 11, cursor: 'pointer', fontFamily: 'inherit',
};
const BOX: CSSProperties = {
  marginTop: 8, padding: 12, background: 'var(--bg-elev)',
  border: '1px solid var(--line)', borderRadius: 8,
};
const HEADROW: CSSProperties = {
  display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10,
};
const CLOSE: CSSProperties = {
  background: 'none', border: 'none', cursor: 'pointer',
  color: 'var(--fg-3)', fontSize: 16, lineHeight: 1, fontFamily: 'inherit',
};
const OPTION: CSSProperties = {
  display: 'flex', alignItems: 'flex-start', gap: 8, textAlign: 'left',
  padding: '7px 10px', border: '1px solid var(--line)', borderLeftWidth: 3,
  borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit',
};
const LABEL: CSSProperties = {
  display: 'block', fontSize: 10, fontWeight: 600, color: 'var(--fg-3)',
  textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 3,
};
const INPUT: CSSProperties = {
  display: 'block', width: '100%', padding: '6px 8px', border: '1px solid var(--line-strong)',
  borderRadius: 6, fontSize: 12.5, background: 'var(--bg-paper)', color: 'var(--fg)',
  outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit',
};
const FOOT: CSSProperties = { margin: '6px 0 0', fontSize: 10.5, color: 'var(--fg-3)' };
const ERR: CSSProperties = {
  marginTop: 8, padding: '7px 10px', background: 'var(--neg-soft)',
  borderLeft: '3px solid var(--neg)', borderRadius: 5,
  color: 'var(--neg-strong)', fontSize: 11.5,
};
const BTN: CSSProperties = {
  padding: '6px 13px', borderRadius: 6, fontSize: 12.5,
  cursor: 'pointer', fontFamily: 'inherit',
};
const CANCEL: CSSProperties = {
  ...BTN, border: '1px solid var(--line-strong)',
  background: 'var(--bg-paper)', color: 'var(--fg-2)',
};
const CLEAR: CSSProperties = {
  ...BTN, border: '1px solid var(--line-strong)',
  background: 'var(--bg-paper)', color: 'var(--fg-3)',
};
const SAVE: CSSProperties = {
  ...BTN, border: 'none', background: 'var(--accent-fill)',
  color: 'var(--on-accent)', fontWeight: 500,
};
