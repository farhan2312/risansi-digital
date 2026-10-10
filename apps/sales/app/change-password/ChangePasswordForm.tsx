'use client';

import { useState, type CSSProperties } from 'react';
import { useRouter } from 'next/navigation';

export function ChangePasswordForm({ forced }: { forced: boolean }) {
  const router = useRouter();
  const [currentPw, setCurrentPw] = useState('');
  const [newPw, setNewPw]         = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [error, setError]         = useState<string | null>(null);
  const [busy, setBusy]           = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (newPw.length < 8) { setError('New password must be at least 8 characters.'); return; }
    if (newPw !== confirmPw) { setError('New passwords do not match.'); return; }

    setBusy(true);
    try {
      const res = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPw, newPw }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? 'Could not change password.');
        setBusy(false);
        return;
      }
      // must_change_password is cleared server-side; the jwt callback re-reads it.
      router.push('/risansi');
      router.refresh();
    } catch {
      setError('Network error. Please try again.');
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <Field label="Current password" value={currentPw} onChange={setCurrentPw}
             placeholder={forced ? 'Your temporary password' : ''} />
      <Field label="New password" value={newPw} onChange={setNewPw} />
      <Field label="Confirm new password" value={confirmPw} onChange={setConfirmPw} />

      {error && (
        <div style={{ color: '#DC2626', fontSize: 12.5, margin: '4px 0 12px' }}>{error}</div>
      )}

      <button type="submit" disabled={busy} style={{
        width: '100%', padding: '10px 12px', marginTop: 6,
        background: busy ? '#93B4E8' : '#1A5CB8', color: '#fff',
        border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 600,
        cursor: busy ? 'default' : 'pointer',
      }}>
        {busy ? 'Saving…' : 'Save password'}
      </button>
    </form>
  );
}

function Field({ label, value, onChange, placeholder }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string;
}) {
  return (
    <label style={{ display: 'block', marginBottom: 14 }}>
      <span style={LBL}>{label}</span>
      <input
        type="password"
        value={value}
        placeholder={placeholder}
        onChange={e => onChange(e.target.value)}
        required
        style={INP}
      />
    </label>
  );
}

const LBL: CSSProperties = {
  display: 'block', fontSize: 11, fontWeight: 700, color: '#2C3E5A',
  textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 5,
};
const INP: CSSProperties = {
  display: 'block', width: '100%', padding: '9px 11px', fontSize: 14,
  background: '#F8FAFC', border: '1px solid #CBD5E1', borderRadius: 8,
  color: '#0D1B2A', outline: 'none', boxSizing: 'border-box',
};
