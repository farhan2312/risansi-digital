'use client';

import { useState, type CSSProperties } from 'react';
import { ClientFormDrawer } from './ClientFormDrawer';

interface EditData { client: Record<string, unknown>; contacts: unknown[] }

// Client Master page: clicking a client name opens the edit drawer (with the
// client code editable) instead of navigating to Client 360. The full record +
// contacts are fetched on demand from the admin edit-data endpoint.
export function EditClientLink({ clientId, name }: { clientId: number; name: string }) {
  const [open, setOpen]       = useState(false);
  const [data, setData]       = useState<EditData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');

  const openEdit = async () => {
    if (loading) return;
    setLoading(true); setError('');
    try {
      const res = await fetch(`/api/risansi/clients/${clientId}/edit-data`);
      if (!res.ok) throw new Error('Could not load this client.');
      setData(await res.json());
      setOpen(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to open editor.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <button type="button" onClick={openEdit} disabled={loading} title="Edit client details" style={LINK}>
        {name}{loading ? ' …' : ''}
      </button>
      {error && <div style={{ fontSize: 10, color: 'var(--neg)', marginTop: 2 }}>{error}</div>}
      {open && data && (
        <ClientFormDrawer
          mode="edit"
          client={data.client}
          existingContacts={data.contacts}
          allowCodeEdit
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

const LINK: CSSProperties = {
  fontWeight: 500, fontSize: 12, color: 'var(--fg)', background: 'none', border: 'none',
  padding: 0, cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit', lineHeight: 1.3,
};
