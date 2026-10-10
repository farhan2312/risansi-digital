'use client';

import { useState, useEffect, type CSSProperties, type MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { updateVisitPlan, deleteVisitPlan } from '@/app/actions/risansi';

const PURPOSES = [
  'Routine', 'Quote Follow-up', 'Complaint Resolution',
  'New Opportunity', 'Equipment Assessment', 'Management Relationship Visit',
];

interface Rep { id: string; name: string }

export interface EditVisitData {
  id: string;
  visit_date: string;        // 'YYYY-MM-DD'
  purpose: string;
  client_name: string;
  rep_id: string;
  rep_name: string;
}

export function EditVisitButton({ visit, role, compact = false }: {
  visit: EditVisitData;
  role: string;
  compact?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState((visit.visit_date || '').slice(0, 10));
  const [purpose, setPurpose] = useState(visit.purpose || 'Routine');
  const [repId, setRepId] = useState(visit.rep_id || '');
  const [reps, setReps] = useState<Rep[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [confirmDel, setConfirmDel] = useState(false);

  const canReassign = role !== 'rep';

  useEffect(() => {
    if (open && canReassign && reps.length === 0) {
      fetch('/api/risansi/reps').then(r => r.json()).then((rows: Rep[]) => setReps(rows)).catch(() => {});
    }
  }, [open, canReassign, reps.length]);

  function stop(e: MouseEvent) { e.preventDefault(); e.stopPropagation(); }

  function openModal(e: MouseEvent) {
    stop(e);
    setDate((visit.visit_date || '').slice(0, 10));
    setPurpose(visit.purpose || 'Routine');
    setRepId(visit.rep_id || '');
    setErr(''); setConfirmDel(false); setOpen(true);
  }

  async function save(e: MouseEvent) {
    stop(e); setErr(''); setBusy(true);
    try {
      const f = new FormData();
      f.set('visit_date', date);
      f.set('purpose', purpose);
      if (canReassign && repId) f.set('rep_id', repId);
      const res = await updateVisitPlan(visit.id, f);
      if (!res.ok) { setErr(res.error); return; }
      setOpen(false); router.refresh();
    } catch {
      setErr('Could not reach the server. Check your connection and try again.');
    } finally { setBusy(false); }
  }

  async function doDelete(e: MouseEvent) {
    stop(e); setErr(''); setBusy(true);
    try {
      const res = await deleteVisitPlan(visit.id);
      if (!res.ok) { setErr(res.error); setBusy(false); return; }
      setOpen(false); router.refresh();
    } catch {
      setErr('Could not reach the server. Check your connection and try again.');
      setBusy(false);
    }
  }

  return (
    <>
      <button type="button" onClick={openModal} title="Edit visit" style={iconBtn(compact)}>
        <svg width={compact ? 11 : 13} height={compact ? 11 : 13} viewBox="0 0 16 16" fill="none"
             stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
          <path d="M11.5 2.5l2 2L6 12l-2.5.5L4 10z" /><path d="M10.5 3.5l2 2" />
        </svg>
      </button>

      {/* Portalled to <body>: in the Visit Feed this button sits inside the
          card's <Link>, and a modal rendered in place is inside that anchor
          too. Save and Cancel preventDefault, but a click on the date field
          or a dropdown did not — so the link fired and the page went to the
          visit before anything was saved. Reps edit from the feed; that is
          why they could not save. Outside the anchor, nothing to fire. */}
      {open && typeof document !== 'undefined' && createPortal(
        <div onClick={stop} style={OVERLAY}>
          {/* Clicking outside does NOT close: the date picker and the dropdowns
              open past the edge of this box, and a stray click was throwing
              away half-made edits. Only Cancel, the x and Escape close it.
              Only stop propagation here — do NOT preventDefault, or clicks on
              the native date picker (which opens on click) get suppressed. */}
          <div onClick={(e) => e.stopPropagation()} onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); } }} style={MODAL}>
            <button type="button" onClick={(e) => { stop(e); setOpen(false); }} aria-label="Close" title="Close (Esc)" style={CLOSE_X}>×</button>
            <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--fg)', marginBottom: 2, paddingRight: 28 }}>Edit Visit</div>
            <div style={{ fontSize: 12, color: 'var(--fg-3)', marginBottom: 16 }}>{visit.client_name}</div>

            <label style={LBL}>Visit date</label>
            <input type="date" value={date} onChange={e => setDate(e.target.value)} style={INP} />

            <label style={{ ...LBL, marginTop: 12 }}>Purpose</label>
            <select value={purpose} onChange={e => setPurpose(e.target.value)} style={INP}>
              {PURPOSES.map(p => <option key={p} value={p}>{p}</option>)}
              {purpose && !PURPOSES.includes(purpose) && <option value={purpose}>{purpose}</option>}
            </select>

            {canReassign && (
              <>
                <label style={{ ...LBL, marginTop: 12 }}>Owner</label>
                <select value={repId} onChange={e => setRepId(e.target.value)} style={INP}>
                  <option value="">{visit.rep_name || '— Select owner —'}</option>
                  {reps.map(r => <option key={r.id} value={String(r.id)}>{r.name}</option>)}
                </select>
              </>
            )}

            {err && <div style={{ color: 'var(--neg-strong)', fontSize: 12, marginTop: 12 }}>{err}</div>}

            <div style={{ display: 'flex', gap: 8, marginTop: 18 }}>
              <button type="button" onClick={(e) => { stop(e); setOpen(false); }} style={BTN_GHOST}>Cancel</button>
              <div style={{ flex: 1 }} />
              <button type="button" onClick={save} disabled={busy || !date} style={{ ...BTN_PRIMARY, opacity: busy || !date ? 0.5 : 1 }}>
                {busy ? 'Saving…' : 'Save'}
              </button>
            </div>

            {/* Danger zone */}
            <div style={{ borderTop: '1px solid var(--line)', marginTop: 18, paddingTop: 14 }}>
              {!confirmDel ? (
                <button type="button" onClick={(e) => { stop(e); setConfirmDel(true); }} style={BTN_DELETE}>
                  Delete visit
                </button>
              ) : (
                <div>
                  <div style={{ fontSize: 12.5, color: 'var(--neg-strong)', marginBottom: 10 }}>
                    Delete this planned visit? This cannot be undone.
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button type="button" onClick={(e) => { stop(e); setConfirmDel(false); }} style={BTN_GHOST}>Cancel</button>
                    <button type="button" onClick={doDelete} disabled={busy} style={{ ...BTN_DELETE_SOLID, opacity: busy ? 0.5 : 1 }}>
                      {busy ? 'Deleting…' : 'Confirm delete'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}

// ── Styles ─────────────────────────────────────────────────────
function iconBtn(compact: boolean): CSSProperties {
  return {
    display: 'inline-grid', placeItems: 'center',
    width: compact ? 16 : 22, height: compact ? 16 : 22,
    padding: 0, background: 'var(--bg-paper)', color: 'var(--fg-3)',
    border: '1px solid var(--line-strong)', borderRadius: 4,
    cursor: 'pointer', flexShrink: 0,
  };
}
const OVERLAY: CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(10,22,40,0.45)',
  display: 'grid', placeItems: 'center', zIndex: 1000, padding: 20,
};
const MODAL: CSSProperties = {
  position: 'relative', width: '100%', maxWidth: 380, background: 'var(--bg-paper)', borderRadius: 12,
  padding: '20px 22px', boxShadow: '0 24px 60px rgba(0,0,0,0.3)', cursor: 'default',
};
const CLOSE_X: CSSProperties = {
  position: 'absolute', top: 10, right: 10, width: 30, height: 30, borderRadius: 8,
  border: '1px solid var(--line)', background: 'var(--bg-paper)', color: 'var(--fg-3)',
  fontSize: 20, lineHeight: 1, cursor: 'pointer', fontFamily: 'inherit',
};
const LBL: CSSProperties = {
  display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--fg-2)',
  textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 5,
};
const INP: CSSProperties = {
  display: 'block', width: '100%', padding: '8px 10px', fontSize: 13,
  fontFamily: 'inherit', background: 'var(--bg-sunk)', border: '1px solid var(--line-strong)',
  borderRadius: 6, color: 'var(--fg)', outline: 'none', boxSizing: 'border-box',
};
const BTN_PRIMARY: CSSProperties = {
  padding: '8px 16px', fontSize: 13, fontWeight: 600, background: 'var(--title)',
  color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit',
};
const BTN_GHOST: CSSProperties = {
  padding: '8px 14px', fontSize: 13, fontWeight: 500, background: 'transparent',
  color: 'var(--fg-3)', border: '1px solid var(--line-strong)', borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit',
};
const BTN_DELETE: CSSProperties = {
  padding: '7px 12px', fontSize: 12.5, fontWeight: 600, background: 'transparent',
  color: 'var(--neg-strong)', border: '1px solid var(--neg)', borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit',
};
const BTN_DELETE_SOLID: CSSProperties = {
  padding: '8px 14px', fontSize: 12.5, fontWeight: 600, background: 'var(--neg)',
  color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit',
};
