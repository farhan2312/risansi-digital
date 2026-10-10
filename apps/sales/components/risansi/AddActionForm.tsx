'use client';

import { useState, type FormEvent, type CSSProperties } from 'react';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { addTask } from '@/app/actions/risansi-tasks';

export interface ActionRep { id: number; name: string; zone?: string | null }

// The single "record an action" form, shared by the visit report and the
// Client 360 activity register. An action is assigned either to a rep in the
// system (dropdown) or to an external person — and an external person must have
// an email so they can be notified the same way in-system reps are.
//
// Somebody must be named. There used to be an "— Unassigned —" option, and it is
// how ten actions ended up belonging to nobody: an unassigned action shows in the
// registry under a heading that makes it somebody else's problem by construction,
// and appears in nobody's own list, which is the only list people actually read.
// `defaultRepId` preselects the obvious answer — the visit's rep, or the client's
// owner — so naming someone costs nothing in the common case.
export function AddActionForm({ visitId, clientId, reps, defaultRepId, onAdded, triggerLabel = '+ Add Action Point' }: {
  visitId?: number | null;
  clientId: number;
  reps: ActionRep[];
  defaultRepId?: number | null;
  onAdded: () => void;
  triggerLabel?: string;
}) {
  const [open, setOpen]           = useState(false);
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState('');
  const [title, setTitle]         = useState('');
  const [description, setDesc]    = useState('');
  const [dueDate, setDueDate]     = useState('');
  const [priority, setPriority]   = useState('Medium');
  const [mode, setMode]           = useState<'internal' | 'external'>('internal');
  const preset = defaultRepId != null && reps.some(r => r.id === defaultRepId) ? String(defaultRepId) : '';
  const [repId, setRepId]         = useState(preset);
  const [external, setExternal]   = useState('');
  const [extEmail, setExtEmail]   = useState('');

  const reset = () => {
    setTitle(''); setDesc(''); setDueDate(''); setPriority('Medium');
    setMode('internal'); setRepId(preset); setExternal(''); setExtEmail(''); setError('');
  };
  const close = () => { setOpen(false); reset(); };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim()) { setError('An action title is required.'); return; }
    if (mode === 'internal' && !repId) {
      setError('Choose who is doing this. An action with nobody on it is nobody\u2019s job.');
      return;
    }
    if (mode === 'external') {
      if (!external.trim()) { setError('Enter the external person’s name.'); return; }
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(extEmail.trim())) { setError('Enter a valid email for the external person.'); return; }
    }
    setLoading(true); setError('');
    try {
      // addTask returns its refusal rather than throwing it, so the sentence it
      // wrote survives to production and can be shown as-is. The catch below is
      // now only for a request that never arrived.
      const res = await addTask({
        visitId: visitId ?? null,
        clientId,
        title,
        description,
        dueDate: dueDate || null,
        priority,
        assignedToRep:           mode === 'internal' && repId ? parseInt(repId, 10) : null,
        assignedToExternal:      mode === 'external' ? external.trim() : null,
        assignedToExternalEmail: mode === 'external' ? extEmail.trim() : null,
      });
      if (!res.ok) { setError(res.error); return; }
      reset();
      setOpen(false);
      onAdded();
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
    } finally {
      setLoading(false);
    }
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        style={{
          marginTop: 8, fontSize: 12, color: 'var(--brand-blue)', background: 'none',
          border: '1px dashed var(--accent-line)', borderRadius: 6, padding: '6px 14px',
          cursor: 'pointer', width: '100%',
        }}
      >
        {triggerLabel}
      </button>
    );
  }

  return (
    <div style={{ marginTop: 8, padding: '14px', background: 'var(--bg-elev)', borderRadius: 8, border: '1px solid var(--line)' }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--fg)', marginBottom: 12, display: 'flex', justifyContent: 'space-between' }}>
        New Action
        <button type="button" onClick={close} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--fg-3)', fontSize: 16 }}>×</button>
      </div>

      <form onSubmit={handleSubmit}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <Input placeholder="Action title *" value={title} onChange={e => setTitle(e.target.value)} required />
          <Textarea placeholder="Description (optional)" value={description} onChange={e => setDesc(e.target.value)} rows={2} />

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <div>
              <label style={LBL}>Due Date</label>
              <Input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} />
            </div>
            <div>
              <label style={LBL}>Priority</label>
              <select value={priority} onChange={e => setPriority(e.target.value)} style={INP}>
                <option>High</option>
                <option>Medium</option>
                <option>Low</option>
              </select>
            </div>
          </div>

          {/* Assignee: in-system rep vs external person */}
          <div>
            <label style={LBL}>Assign To</label>
            <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
              <ModeTab active={mode === 'internal'} onClick={() => { setMode('internal'); setError(''); }}>Rep in system</ModeTab>
              <ModeTab active={mode === 'external'} onClick={() => { setMode('external'); setError(''); }}>External person</ModeTab>
            </div>

            {mode === 'internal' ? (
              <select
                value={repId} onChange={e => setRepId(e.target.value)} required
                style={{ ...INP, ...(repId ? null : { borderColor: 'var(--neg)' }) }}
              >
                <option value="">— Choose a person —</option>
                {reps.map(r => (
                  <option key={r.id} value={r.id}>{r.name}{r.zone ? ` · ${r.zone}` : ''}</option>
                ))}
              </select>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <Input placeholder="Name (e.g. Rajesh from Finance) *" value={external} onChange={e => setExternal(e.target.value)} />
                <Input type="email" placeholder="Email * (they’ll be notified)" value={extEmail} onChange={e => setExtEmail(e.target.value)} />
              </div>
            )}
          </div>

          {error && <div style={{ fontSize: 12, color: 'var(--neg)' }}>{error}</div>}

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <Button type="button" variant="outline" size="sm" onClick={close}>Cancel</Button>
            <Button
              type="submit" size="sm"
              disabled={loading || !title.trim() || (mode === 'internal' && !repId)}
            >
              {loading ? 'Adding…' : 'Add Action'}
            </Button>
          </div>
        </div>
      </form>
    </div>
  );
}

function ModeTab({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button" onClick={onClick}
      style={{
        flex: 1, padding: '6px 10px', fontSize: 12, fontFamily: 'inherit', borderRadius: 6, cursor: 'pointer',
        background: active ? 'var(--accent-soft)' : 'var(--bg-paper)',
        color: active ? 'var(--brand-blue)' : 'var(--fg-2)',
        border: `1px solid ${active ? 'var(--accent-line)' : 'var(--line-strong)'}`,
        fontWeight: active ? 600 : 400,
      }}
    >
      {children}
    </button>
  );
}

const LBL: CSSProperties = {
  display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--fg-2)',
  textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 5,
};
const INP: CSSProperties = {
  width: '100%', padding: '8px 10px', fontSize: 13, fontFamily: 'inherit', boxSizing: 'border-box',
  background: 'var(--bg-paper)', color: 'var(--fg)', border: '1px solid var(--line-strong)', borderRadius: 6, outline: 'none',
};
