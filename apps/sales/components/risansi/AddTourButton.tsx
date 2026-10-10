'use client';

import { useState, type CSSProperties } from 'react';
import { useRouter } from 'next/navigation';
import { createTour } from '@/app/actions/risansi-reps';

export function AddTourButton() {
  const [open, setOpen]       = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true); setError('');
    try {
      const fd = new FormData(e.currentTarget);
      const res = await createTour(fd);
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
        + Add Tour
      </button>

      {open && (
        <>
          <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(10,22,40,0.35)', zIndex: 300 }} />
          <div className="risansi-modal" style={{ position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', width: 620, maxWidth: 'calc(100vw - 32px)', maxHeight: '90vh', background: 'var(--bg-paper)', borderRadius: 12, zIndex: 301, boxShadow: '0 20px 60px rgba(10,61,143,0.2)', overflowX: 'hidden', overflowY: 'auto' }}>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--line)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 15, fontWeight: 600 }}>Add New Tour</span>
              <button onClick={() => setOpen(false)} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: 'var(--fg-3)', lineHeight: 1 }}>×</button>
            </div>

            <form onSubmit={handleSubmit} style={{ padding: 20 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div>
                    <label style={LABEL}>Tour Name *</label>
                    <input name="name" required style={INPUT} placeholder="e.g. Lucknow Central" />
                  </div>
                  <div>
                    <label style={LABEL}>Zone *</label>
                    <select name="zone" required style={INPUT} defaultValue="">
                      <option value="">— Select —</option>
                      {['North', 'Central', 'West', 'South', 'Export'].map(z => <option key={z} value={z}>{z}</option>)}
                    </select>
                  </div>
                </div>

                <div style={{ fontSize: 11, color: 'var(--fg-3)' }}>
                  Add reps &amp; managers to this tour from the Tours tab after creating it.
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div>
                    <label style={LABEL}>Key Visit Freq (days)</label>
                    <input name="visit_freq_key_days" type="number" min="1" defaultValue={90} style={INPUT} />
                  </div>
                  <div>
                    <label style={LABEL}>Std Visit Freq (days)</label>
                    <input name="visit_freq_std_days" type="number" min="1" defaultValue={180} style={INPUT} />
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div>
                    <label style={LABEL}>Alert Key (days)</label>
                    <input name="alert_key_days" type="number" min="1" defaultValue={100} style={INPUT} />
                  </div>
                  <div>
                    <label style={LABEL}>Alert Std (days)</label>
                    <input name="alert_std_days" type="number" min="1" defaultValue={200} style={INPUT} />
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
                    {loading ? 'Adding…' : 'Add Tour'}
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
