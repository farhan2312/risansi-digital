'use client';

import { useState, type CSSProperties } from 'react';
import { useRouter } from 'next/navigation';
import { updateRep } from '@/app/actions/risansi-reps';

export interface RepData {
  id: number;
  rep_code: string;
  name: string;
  initials: string;
  email: string | null;
  zone: string | null;
  route: string | null;
  target_cr: string | number | null;
  role: string;
  is_active: boolean;
  client_count: string;
  visits_last_30d: string;
  last_visit_date: string | null;
}

export function RepRow({ rep }: { rep: RepData }) {
  const [editing, setEditing] = useState(false);
  const router = useRouter();

  if (!editing) {
    return (
      <tr style={{ borderBottom: '1px solid var(--line)', opacity: rep.is_active ? 1 : 0.5 }}>
        <td style={TD}>
          <div style={{ fontWeight: 600, color: 'var(--fg)' }}>{rep.name}</div>
          <div style={{ fontSize: 10, color: 'var(--fg-3)', fontFamily: 'var(--font-mono)', marginTop: 1 }}>
            {rep.rep_code}{rep.email ? ` · ${rep.email}` : ''}
          </div>
        </td>
        <td style={TD}>
          <span style={{ padding: '2px 7px', borderRadius: 10, fontSize: 11, fontWeight: 500, background: ZONE_BG[rep.zone ?? ''] ?? 'var(--bg-sunk)', color: ZONE_COLOR[rep.zone ?? ''] ?? 'var(--fg-3)' }}>
            {rep.zone ?? '—'}
          </span>
        </td>
        <td style={{ ...TD, color: 'var(--fg-3)', fontSize: 11 }}>{rep.route ?? '—'}</td>
        <td style={{ ...TD, textAlign: 'center', fontFamily: 'var(--font-mono)' }}>{rep.client_count}</td>
        <td style={{ ...TD, textAlign: 'center', fontFamily: 'var(--font-mono)', color: parseInt(rep.visits_last_30d) > 0 ? 'var(--pos)' : 'var(--fg-3)' }}>
          {rep.visits_last_30d}
        </td>
        <td style={{ ...TD, textAlign: 'center' }}>
          <span style={{ padding: '2px 7px', borderRadius: 10, fontSize: 11, fontWeight: 600, background: rep.is_active ? 'var(--pos-soft)' : 'var(--bg-sunk)', color: rep.is_active ? 'var(--pos-strong)' : 'var(--fg-3)' }}>
            {rep.is_active ? 'Active' : 'Inactive'}
          </span>
        </td>
        <td style={{ ...TD, textAlign: 'right' }}>
          <button
            onClick={() => setEditing(true)}
            style={{ padding: '4px 10px', borderRadius: 5, border: '1px solid var(--line-strong)', background: 'white', cursor: 'pointer', fontSize: 11, color: 'var(--fg-3)', fontFamily: 'inherit' }}
          >
            Edit
          </button>
        </td>
      </tr>
    );
  }

  return (
    <tr style={{ borderBottom: '1px solid var(--line)', background: 'var(--accent-soft)' }}>
      <td colSpan={7} style={{ padding: '12px 16px' }}>
        <RepEditForm rep={rep} onCancel={() => setEditing(false)} onSave={() => { setEditing(false); router.refresh(); }} />
      </td>
    </tr>
  );
}

function RepEditForm({ rep, onCancel, onSave }: { rep: RepData; onCancel: () => void; onSave: () => void }) {
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true); setError('');
    try {
      const fd = new FormData(e.currentTarget);
      await updateRep(rep.id, fd);
      onSave();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed');
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      <div style={{ fontSize: 11, color: 'var(--fg-3)', marginBottom: 8 }}>
        {rep.email ?? 'No email on file'}
        <span> · email, role &amp; target are managed in </span>
        <span style={{ fontWeight: 600, color: 'var(--fg-2)' }}>Users &amp; Access</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1.6fr 1fr 1.2fr 1fr auto', gap: 8, alignItems: 'end' }}>
        <div>
          <label style={LABEL}>Name *</label>
          <input name="name" required defaultValue={rep.name} style={INPUT} />
        </div>
        <div>
          <label style={LABEL}>Zone</label>
          <select name="zone" defaultValue={rep.zone ?? ''} style={INPUT}>
            <option value="">— None —</option>
            {['North', 'Central', 'West', 'South', 'Export'].map(z => <option key={z} value={z}>{z}</option>)}
          </select>
        </div>
        <div>
          <label style={LABEL}>Route</label>
          <input name="route" defaultValue={rep.route ?? ''} style={INPUT} />
        </div>
        <div>
          <label style={LABEL}>Status</label>
          <select name="is_active" defaultValue={rep.is_active ? 'true' : 'false'} style={INPUT}>
            <option value="true">Active</option>
            <option value="false">Inactive</option>
          </select>
        </div>
        <div style={{ display: 'flex', gap: 6, paddingBottom: 1 }}>
          <button type="button" onClick={onCancel} style={{ padding: '6px 10px', borderRadius: 5, border: '1px solid var(--line-strong)', background: 'white', cursor: 'pointer', fontSize: 11, fontFamily: 'inherit' }}>
            Cancel
          </button>
          <button type="submit" disabled={loading} style={{ padding: '6px 12px', borderRadius: 5, background: 'var(--accent-fill)', color: 'var(--on-accent)', border: 'none', cursor: 'pointer', fontSize: 11, fontWeight: 500, fontFamily: 'inherit', opacity: loading ? 0.7 : 1 }}>
            {loading ? '…' : 'Save'}
          </button>
        </div>
      </div>
      {error && <div style={{ marginTop: 8, fontSize: 11, color: 'var(--neg)' }}>{error}</div>}
    </form>
  );
}

export const ZONE_BG: Record<string, string> = {
  North: '#EFF6FF', Central: '#F5F3FF', West: '#FFF7ED', South: '#F0FDF4', Export: '#FDF4FF',
};
export const ZONE_COLOR: Record<string, string> = {
  North: '#1D4ED8', Central: '#6D28D9', West: '#C2410C', South: '#065F46', Export: '#7E22CE',
};

const TD: CSSProperties = { padding: '10px 12px', verticalAlign: 'middle' };
const LABEL: CSSProperties = {
  fontSize: 10, fontWeight: 600, color: 'var(--fg-3)', textTransform: 'uppercase',
  letterSpacing: '0.05em', display: 'block', marginBottom: 3,
};
const INPUT: CSSProperties = {
  width: '100%', padding: '6px 8px', border: '1px solid var(--line-strong)',
  borderRadius: 5, fontSize: 12, background: 'white', color: 'var(--fg)',
  boxSizing: 'border-box', fontFamily: 'inherit',
};
