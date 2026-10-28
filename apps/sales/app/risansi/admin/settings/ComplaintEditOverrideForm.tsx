'use client';

import { useState, useTransition, type CSSProperties } from 'react';
import { useRouter } from 'next/navigation';
import { setComplaintEditOverride } from '@/app/actions/sysadmin';

export function ComplaintEditOverrideForm({ current }: { current: boolean }) {
  const router = useRouter();
  const [on, setOn] = useState(current);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  function set(next: boolean) {
    if (next === on) return;
    setMsg(null);
    start(async () => {
      try {
        const res = await setComplaintEditOverride(next);
        if (!res.ok) { setMsg({ ok: false, text: res.error }); return; }
        setOn(next);
        setMsg({ ok: true, text: next ? 'Editing is open to everyone who can see a complaint.' : 'Back to the normal rules.' });
        router.refresh();
      } catch {
        setMsg({ ok: false, text: 'Could not reach the server. Check your connection and try again.' });
      }
    });
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 2, background: 'var(--bg-sunk)', borderRadius: 7, padding: 2, width: 'fit-content' }}>
        {[[false, 'Normal rules'], [true, 'Open to all']].map(([v, label]) => (
          <button key={String(v)} type="button" disabled={pending} onClick={() => set(v as boolean)}
            style={{ ...SEG, ...(on === v ? SEG_ON : null), opacity: pending ? 0.6 : 1 }}>
            {label as string}
          </button>
        ))}
      </div>

      {/* Said while it is on, not buried in a tooltip: an override nobody
          remembers is on is the thing that quietly becomes permanent. */}
      {on && (
        <div style={BANNER}>
          <strong style={{ color: 'var(--warn-strong)' }}>Override is on.</strong>{' '}
          Anyone who can see a complaint can edit every page of it, including closed ones,
          whatever department they are in. Turn it back to Normal rules once documents are filed.
        </div>
      )}

      {msg && (
        <div style={{ fontSize: 12, marginTop: 10, color: msg.ok ? 'var(--pos)' : 'var(--neg)' }}>
          {msg.ok ? '✓ ' : ''}{msg.text}
        </div>
      )}
    </div>
  );
}

const SEG: CSSProperties = {
  padding: '7px 16px', borderRadius: 5, border: 'none', background: 'transparent',
  fontSize: 13, fontWeight: 600, color: 'var(--fg-3)', cursor: 'pointer', fontFamily: 'inherit',
};
const SEG_ON: CSSProperties = {
  background: 'var(--bg-paper)', color: 'var(--fg)', boxShadow: '0 1px 2px rgba(0,0,0,0.10)',
};
const BANNER: CSSProperties = {
  marginTop: 12, padding: '9px 12px', background: 'var(--warn-soft)',
  borderLeft: '3px solid var(--warn)', borderRadius: 5,
  fontSize: 11.5, lineHeight: 1.5, color: 'var(--fg-2)',
};
