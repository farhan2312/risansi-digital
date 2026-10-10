'use client';

import { useState, type CSSProperties } from 'react';
import { useRouter } from 'next/navigation';
import { updateContact, deleteContact } from '@/app/actions/risansi';

interface ContactShape {
  id: number;
  name: string;
  designation: string | null;
  phone: string | null;
  email: string | null;
  whatsapp: string | null;
  notes: string | null;
  is_primary: boolean;
}

const DESIGNATIONS = [
  'GM Engineering', 'Chief Engineer', 'Deputy Chief Engineer',
  'Purchase Officer', 'GM Production', 'AGM', 'DGM', 'MD',
  'Director', 'Maintenance Engineer', 'Production Manager', 'Other',
];

export function EditContactButton({ contact, clientId }: { contact: ContactShape; clientId: number }) {
  const router = useRouter();
  const [open, setOpen]             = useState(false);
  const [loading, setLoading]       = useState(false);
  const [error, setError]           = useState('');
  const [delConfirm, setDelConfirm] = useState(false);
  const [isPrimary, setIsPrimary]   = useState(contact.is_primary);

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        title="Edit contact"
        style={{
          background: 'none', border: 'none', cursor: 'pointer',
          padding: '2px 6px', borderRadius: 4, color: 'var(--fg-3)',
          fontSize: 11, display: 'inline-flex', alignItems: 'center', gap: 3,
          transition: 'all 150ms', marginTop: 6, fontFamily: 'inherit',
        }}
        onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-elev)'; e.currentTarget.style.color = 'var(--brand-blue)'; }}
        onMouseLeave={e => { e.currentTarget.style.background = 'none'; e.currentTarget.style.color = 'var(--fg-3)'; }}
      >
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
          <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
        </svg>
        Edit
      </button>
    );
  }

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true); setError('');
    try {
      const fd = new FormData(e.currentTarget);
      fd.set('is_primary', isPrimary ? 'true' : 'false');
      const res = await updateContact(contact.id, clientId, fd);
      if (!res.ok) { setError(res.error); setLoading(false); return; }
      setOpen(false);
      router.refresh();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to update');
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    setLoading(true); setError('');
    try {
      const res = await deleteContact(contact.id, clientId);
      if (!res.ok) { setError(res.error); setLoading(false); return; }
      setOpen(false);
      router.refresh();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to delete');
      setLoading(false);
    }
  };

  return (
    <div style={{ marginTop: 10, padding: 14, background: 'var(--bg-elev)', border: '1px solid var(--line)', borderRadius: 8 }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--fg)', marginBottom: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        Edit Contact
        <button onClick={() => setOpen(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--fg-3)', fontSize: 16, lineHeight: 1 }}>×</button>
      </div>

      <form onSubmit={handleSubmit}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div>
            <label style={LABEL}>Name *</label>
            <input name="name" required defaultValue={contact.name} style={INPUT} />
          </div>

          <div>
            <label style={LABEL}>Designation</label>
            <input name="designation" defaultValue={contact.designation ?? ''} list="designation-options" style={INPUT} />
            <datalist id="designation-options">
              {DESIGNATIONS.map(d => <option key={d} value={d} />)}
            </datalist>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <div>
              <label style={LABEL}>Phone</label>
              <input name="phone" type="tel" defaultValue={contact.phone ?? ''} style={INPUT} />
            </div>
            <div>
              <label style={LABEL}>WhatsApp</label>
              <input name="whatsapp" type="tel" defaultValue={contact.whatsapp ?? ''} placeholder="Same as phone?" style={INPUT} />
            </div>
          </div>

          <div>
            <label style={LABEL}>Email</label>
            <input name="email" type="email" defaultValue={contact.email ?? ''} style={INPUT} />
          </div>

          <div>
            <label style={LABEL}>Notes</label>
            <textarea name="notes" rows={2} defaultValue={contact.notes ?? ''} style={{ ...INPUT, height: 'auto', resize: 'vertical', lineHeight: 1.5 }} />
          </div>

          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 12, color: 'var(--fg-2)' }}>
            <input type="checkbox" checked={isPrimary} onChange={e => setIsPrimary(e.target.checked)} style={{ width: 14, height: 14, accentColor: 'var(--brand-blue)' }} />
            Primary contact
          </label>

          {error && (
            <div style={{ padding: '8px 12px', background: 'var(--neg-soft)', border: '1px solid var(--neg)', borderLeft: '3px solid var(--neg)', borderRadius: 5, color: '#9B1C1C', fontSize: 12 }}>
              {error}
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: 4 }}>
            {delConfirm ? (
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <span style={{ fontSize: 11, color: 'var(--neg)' }}>Delete?</span>
                <button type="button" onClick={handleDelete} disabled={loading} style={{ padding: '5px 10px', borderRadius: 5, background: 'var(--neg-fill)', color: 'var(--on-accent)', border: 'none', cursor: 'pointer', fontSize: 12, fontFamily: 'inherit' }}>
                  {loading ? '…' : 'Yes'}
                </button>
                <button type="button" onClick={() => setDelConfirm(false)} style={{ padding: '5px 10px', borderRadius: 5, border: '1px solid var(--line-strong)', background: 'white', cursor: 'pointer', fontSize: 12, fontFamily: 'inherit' }}>
                  No
                </button>
              </div>
            ) : (
              <button type="button" onClick={() => setDelConfirm(true)} style={{ padding: '6px 12px', borderRadius: 6, border: '1px solid #F87171', background: 'white', color: '#E02424', cursor: 'pointer', fontSize: 12, fontFamily: 'inherit' }}>
                Delete
              </button>
            )}
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" onClick={() => setOpen(false)} style={{ padding: '6px 14px', borderRadius: 6, border: '1px solid var(--line-strong)', background: 'white', cursor: 'pointer', fontSize: 13, fontFamily: 'inherit' }}>
                Cancel
              </button>
              <button type="submit" disabled={loading} style={{ padding: '6px 16px', borderRadius: 6, background: 'var(--accent-fill)', color: 'var(--on-accent)', border: 'none', cursor: loading ? 'not-allowed' : 'pointer', fontSize: 13, fontWeight: 500, fontFamily: 'inherit', opacity: loading ? 0.7 : 1 }}>
                {loading ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      </form>
    </div>
  );
}

const LABEL: CSSProperties = {
  display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--fg-3)',
  textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4,
};

const INPUT: CSSProperties = {
  display: 'block', width: '100%', padding: '7px 9px', border: '1px solid var(--line-strong)',
  borderRadius: 6, fontSize: 13, background: 'var(--bg-paper)', color: 'var(--fg)',
  outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit',
};
