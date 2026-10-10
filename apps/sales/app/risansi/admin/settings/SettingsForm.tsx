'use client';

import { useState, useTransition, type CSSProperties } from 'react';
import { useRouter } from 'next/navigation';
import { setAnnualTarget } from '@/app/actions/sysadmin';

export function SettingsForm({ current }: { current: string }) {
  const router = useRouter();
  const [val, setVal] = useState(current);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  function save() {
    setMsg(null);
    const f = new FormData();
    f.set('annual_target_cr', val);
    start(async () => {
      try {
        const res = await setAnnualTarget(f);
        if (!res.ok) { setMsg({ ok: false, text: res.error }); return; }
        setMsg({ ok: true, text: 'Saved.' });
        router.refresh();
      } catch {
        setMsg({ ok: false, text: 'Could not reach the server. Check your connection and try again.' });
      }
    });
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <span style={{ fontSize: 16, color: 'var(--fg-2)' }}>₹</span>
        <input
          type="number" min="0" step="0.5" value={val}
          onChange={e => setVal(e.target.value)}
          style={INP}
        />
        <span style={{ fontSize: 13, color: 'var(--fg-3)' }}>Cr</span>
        <button type="button" onClick={save} disabled={pending || val.trim() === ''}
          style={{ ...BTN, opacity: pending || val.trim() === '' ? 0.5 : 1 }}>
          {pending ? 'Saving…' : 'Save'}
        </button>
      </div>
      {msg && (
        <div style={{ fontSize: 12, marginTop: 10, color: msg.ok ? 'var(--pos)' : 'var(--neg)' }}>
          {msg.ok ? '✓ ' : ''}{msg.text}
        </div>
      )}
    </div>
  );
}

const INP: CSSProperties = {
  width: 120, padding: '8px 10px', fontSize: 14, fontFamily: 'inherit',
  background: 'var(--bg-elev)', border: '1px solid var(--line-strong)', borderRadius: 6,
  color: 'var(--fg)', outline: 'none',
};
const BTN: CSSProperties = {
  padding: '8px 16px', fontSize: 13, fontWeight: 600, background: 'var(--accent-fill)',
  color: 'var(--on-accent)', border: 'none', borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit',
};
