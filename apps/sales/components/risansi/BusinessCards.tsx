'use client';

import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { CARD_ACCEPT } from '@/lib/risansi-exhibition-files';

// Business cards photographed at an exhibition meeting.
//
// Two modes, because a card is handed over before the meeting record exists.
// With a meetingId each photo uploads as it is taken. Without one — the rep is
// still filling in a new meeting — the files are held locally and flushed by the
// parent once the meeting has been saved and has an id.

export interface MeetingCard {
  id: number;
  file_name: string;
  mime_type: string;
  byte_size: number | null;
  uploaded_at: string;
  uploaded_by_name: string | null;
}

export const cardHref = (meetingId: number, cardId: number) =>
  `/api/risansi/exhibitions/meetings/${meetingId}/cards/${cardId}`;

/** Upload files one at a time. Exported so the meeting form can flush the
 *  photos it was holding once the meeting exists. Returns what failed. */
export async function uploadCards(meetingId: number, files: File[]): Promise<string[]> {
  const failures: string[] = [];
  for (const f of files) {
    try {
      const fd = new FormData(); fd.append('file', f);
      const res = await fetch(`/api/risansi/exhibitions/meetings/${meetingId}/cards`, { method: 'POST', body: fd });
      if (!res.ok) {
        const j = await res.json().catch(() => ({} as { error?: string }));
        failures.push(`${f.name} — ${j?.error || `failed (${res.status})`}`);
      }
    } catch { failures.push(`${f.name} — network error`); }
  }
  return failures;
}

export function BusinessCards({ meetingId, pending, onPendingChange, canEdit = true }: {
  /** null while the meeting is still being created. */
  meetingId: number | null;
  /** Photos held locally until the meeting has an id. */
  pending: File[];
  onPendingChange: (files: File[]) => void;
  canEdit?: boolean;
}) {
  const [cards, setCards] = useState<MeetingCard[]>([]);
  const [busy, setBusy]   = useState(false);
  const [msg, setMsg]     = useState('');
  const [err, setErr]     = useState(false);
  const camRef  = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    if (meetingId == null) return;
    try {
      const r = await fetch(`/api/risansi/exhibitions/meetings/${meetingId}/cards`);
      if (r.ok) setCards(((await r.json()) as { cards?: MeetingCard[] }).cards ?? []);
    } catch { /* leave what is on screen */ }
  }, [meetingId]);

  useEffect(() => { refresh(); }, [refresh]);

  // Object URLs for the not-yet-uploaded photos, revoked on change so a long
  // session at a stand does not leak a blob per card.
  const [previews, setPreviews] = useState<string[]>([]);
  useEffect(() => {
    const urls = pending.map(f => URL.createObjectURL(f));
    setPreviews(urls);
    return () => { urls.forEach(u => URL.revokeObjectURL(u)); };
  }, [pending]);

  const take = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(e.target.files ?? []);
    e.target.value = '';                 // let the same card be re-taken
    if (!picked.length) return;

    if (meetingId == null) {             // hold until the meeting exists
      onPendingChange([...pending, ...picked]);
      setErr(false);
      setMsg(`${picked.length} card${picked.length === 1 ? '' : 's'} ready — saved with the meeting.`);
      return;
    }
    setBusy(true); setMsg(''); setErr(false);
    const failures = await uploadCards(meetingId, picked);
    await refresh();
    setErr(failures.length > 0);
    setMsg(failures.length
      ? `Could not save: ${failures.join('; ')}`
      : `Saved ${picked.length} card${picked.length === 1 ? '' : 's'}.`);
    setBusy(false);
  };

  const remove = async (card: MeetingCard) => {
    if (meetingId == null) return;
    if (typeof window !== 'undefined' && !window.confirm('Remove this business card?')) return;
    setBusy(true); setMsg(''); setErr(false);
    try {
      const r = await fetch(cardHref(meetingId, card.id), { method: 'DELETE' });
      if (!r.ok) throw new Error('Delete failed');
      await refresh();
      setMsg('Card removed.');
    } catch { setErr(true); setMsg('Could not remove that card.'); }
    finally { setBusy(false); }
  };

  const dropPending = (i: number) => onPendingChange(pending.filter((_, n) => n !== i));
  const total = cards.length + pending.length;

  return (
    <div>
      <label style={LBL}>Business cards{total ? ` · ${total}` : ''}</label>

      {total > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
          {cards.map(c => (
            <figure key={c.id} style={TILE}>
              <a href={meetingId != null ? cardHref(meetingId, c.id) : undefined} target="_blank" rel="noreferrer">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={meetingId != null ? cardHref(meetingId, c.id) : ''} alt={c.file_name} style={IMG} />
              </a>
              {canEdit && (
                <button type="button" onClick={() => remove(c)} disabled={busy} style={X} aria-label="Remove card">×</button>
              )}
            </figure>
          ))}
          {pending.map((f, i) => (
            <figure key={`${f.name}:${i}`} style={{ ...TILE, borderStyle: 'dashed' }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={previews[i] ?? ''} alt={f.name} style={IMG} />
              <span style={BADGE}>not saved</span>
              <button type="button" onClick={() => dropPending(i)} style={X} aria-label="Discard card">×</button>
            </figure>
          ))}
        </div>
      )}

      {canEdit && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          {/* capture="environment" opens the rear camera straight away on a
              phone. On a desktop browser it is ignored and this behaves as a
              second file picker, so the button is honest either way.

              CARD_ACCEPT, not image/*. This said image/* and the photo was
              then refused on arrival: an iPhone shoots HEIC, and a camera
              input that advertises "any image" is taken at its word and sends
              one, while the validator accepts JPG and PNG only. Naming the two
              types is what makes iOS transcode to JPEG before it uploads. The
              picker and the validator have to agree, which is the whole reason
              CARD_ACCEPT is a shared constant. */}
          <input ref={camRef} type="file" accept={CARD_ACCEPT} capture="environment"
            multiple onChange={take} style={{ display: 'none' }} />
          <input ref={fileRef} type="file" accept={CARD_ACCEPT}
            multiple onChange={take} style={{ display: 'none' }} />
          <button type="button" onClick={() => camRef.current?.click()} disabled={busy} style={CAM}>
            {busy ? 'Saving…' : '📷 Take photo'}
          </button>
          <button type="button" onClick={() => fileRef.current?.click()} disabled={busy} style={BTN}>
            Choose from gallery
          </button>
        </div>
      )}

      {msg && (
        <div style={{ fontSize: 11, marginTop: 6, color: err ? 'var(--neg-strong)' : 'var(--fg-3)' }}>{msg}</div>
      )}
      {!total && canEdit && (
        <div style={{ fontSize: 10.5, color: 'var(--fg-3)', marginTop: 5 }}>
          Photograph the card and type the details from it into the fields above.
        </div>
      )}
    </div>
  );
}

const LBL: CSSProperties = {
  display: 'block', fontSize: 10, fontWeight: 700, textTransform: 'uppercase',
  letterSpacing: '0.05em', color: 'var(--fg-3)', marginBottom: 6,
};
const TILE: CSSProperties = {
  position: 'relative', margin: 0, width: 104, height: 68, borderRadius: 7,
  overflow: 'hidden', border: '1px solid var(--line-strong)', background: 'var(--bg-elev)',
};
const IMG: CSSProperties = { width: '100%', height: '100%', objectFit: 'cover', display: 'block' };
const X: CSSProperties = {
  position: 'absolute', top: 2, right: 2, width: 20, height: 20, borderRadius: '50%',
  border: 'none', background: 'rgba(0,0,0,0.6)', color: '#fff', fontSize: 14, lineHeight: 1,
  cursor: 'pointer', fontFamily: 'inherit', padding: 0,
};
const BADGE: CSSProperties = {
  position: 'absolute', left: 0, bottom: 0, right: 0, fontSize: 9, textAlign: 'center',
  background: 'rgba(0,0,0,0.55)', color: '#fff', padding: '1px 0',
};
const CAM: CSSProperties = {
  border: 'none', background: 'var(--accent-fill)', color: 'var(--on-accent)', borderRadius: 6,
  fontSize: 12.5, fontWeight: 600, padding: '9px 14px', cursor: 'pointer',
  fontFamily: 'inherit', minHeight: 40,
};
const BTN: CSSProperties = {
  border: '1px solid var(--line-strong)', background: 'var(--bg-paper)', color: 'var(--fg)',
  borderRadius: 6, fontSize: 12.5, fontWeight: 600, padding: '9px 14px', cursor: 'pointer',
  fontFamily: 'inherit', minHeight: 40,
};
