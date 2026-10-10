'use client';

import { useState, useEffect, type CSSProperties } from 'react';
import { useRouter } from 'next/navigation';
import { createRep } from '@/app/actions/risansi-reps';

export function AddRepButton() {
  const [open, setOpen]       = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');
  const [managers, setManagers] = useState<Array<{ id: string; name: string }>>([]);
  const router = useRouter();

  useEffect(() => {
    if (!open) return;
    fetch('/api/risansi/reps').then(r => r.json())
      .then((d: Array<{ id: string; name: string; role: string }>) =>
        setManagers(Array.isArray(d) ? d.filter(u => u.role === 'manager') : []))
      .catch(() => {});
  }, [open]);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true); setError('');
    try {
      const res = await createRep(new FormData(e.currentTarget));
      if (!res.ok) { setError(res.error); setLoading(false); return; }
      setOpen(false);
      router.refresh();
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
      setLoading(false);
    }
  };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        style={{ padding: '7px 14px', borderRadius: 6, background: 'var(--accent-fill)', color: 'var(--on-accent)', border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 500, fontFamily: 'inherit' }}
      >
        + Add Rep
      </button>

      {open && (
        <>
          <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(10,22,40,0.35)', zIndex: 300 }} />
          <div className="risansi-modal" style={{ position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', width: 620, maxWidth: 'calc(100vw - 32px)', maxHeight: '90vh', background: 'var(--bg-paper)', borderRadius: 12, zIndex: 301, boxShadow: '0 20px 60px rgba(10,61,143,0.2)', overflowX: 'hidden', overflowY: 'auto' }}>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--line)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 15, fontWeight: 600 }}>Add New Rep</span>
              <button onClick={() => setOpen(false)} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: 'var(--fg-3)', lineHeight: 1 }}>×</button>
            </div>

            <form onSubmit={handleSubmit} style={{ padding: 20 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div>
                    <label style={LABEL}>Full Name *</label>
                    <input name="name" required style={INPUT} placeholder="e.g. Akshay Awasthi" />
                  </div>
                  <div>
                    <label style={LABEL}>Rep Code *</label>
                    <input name="rep_code" required style={INPUT} placeholder="e.g. r-aksh-awas" />
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div>
                    <label style={LABEL}>Zone *</label>
                    <select name="zone" required style={INPUT} defaultValue="">
                      <option value="">— Select —</option>
                      {['North', 'Central', 'West', 'South', 'Export'].map(z => <option key={z} value={z}>{z}</option>)}
                    </select>
                  </div>
                  <div>
                    <label style={LABEL}>Route</label>
                    <input name="route" style={INPUT} placeholder="e.g. U.P. East" />
                  </div>
                </div>

                <div>
                  <label style={LABEL}>Email</label>
                  <input name="email" type="email" style={INPUT} placeholder="name@risansi.com" />
                  <div style={{ fontSize: 10, color: 'var(--fg-3)', marginTop: 4 }}>
                    Used to sign in. Email &amp; revenue target are managed afterwards in Users &amp; Access.
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div>
                    <label style={LABEL}>Role</label>
                    <select name="role" style={INPUT} defaultValue="rep">
                      <option value="rep">Field Rep</option>
                      <option value="manager">Sales Manager</option>
                      <option value="admin">Admin</option>
                    </select>
                  </div>
                  <div>
                    <label style={LABEL}>Initials *</label>
                    <input name="initials" required style={INPUT} maxLength={5} placeholder="e.g. AA" />
                  </div>
                </div>

                <div>
                  <label style={LABEL}>Reports to (optional)</label>
                  <select name="manager_id" style={INPUT} defaultValue="">
                    <option value="">— Nobody, they manage themselves —</option>
                    {managers.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                  </select>
                  <div style={{ fontSize: 10, color: 'var(--fg-3)', marginTop: 4 }}>
                    Their manager sees every client they own or cover. Editable later on the Teams tab.
                  </div>
                </div>

                {error && (
                  <div style={{ padding: '8px 12px', background: 'var(--neg-soft)', border: '1px solid var(--neg)', borderLeft: '3px solid var(--neg)', borderRadius: 5, color: 'var(--neg-strong)', fontSize: 12 }}>
                    {error}
                  </div>
                )}

                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                  <button type="button" onClick={() => setOpen(false)} style={{ padding: '8px 16px', borderRadius: 6, border: '1px solid var(--line-strong)', background: 'var(--bg-paper)', cursor: 'pointer', fontSize: 13, fontFamily: 'inherit' }}>
                    Cancel
                  </button>
                  <button type="submit" disabled={loading} style={{ padding: '8px 20px', borderRadius: 6, background: 'var(--accent-fill)', color: 'var(--on-accent)', border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 500, fontFamily: 'inherit', opacity: loading ? 0.7 : 1 }}>
                    {loading ? 'Adding…' : 'Add Rep'}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </>
      )}
    </>
  );
}

const LABEL: CSSProperties = {
  fontSize: 11, fontWeight: 600, color: 'var(--fg-3)', textTransform: 'uppercase',
  letterSpacing: '0.06em', display: 'block', marginBottom: 5,
};
const INPUT: CSSProperties = {
  width: '100%', padding: '8px 10px', border: '1px solid var(--line-strong)',
  borderRadius: 6, fontSize: 13, background: 'var(--bg-paper)', color: 'var(--fg)',
  boxSizing: 'border-box', fontFamily: 'inherit',
};
