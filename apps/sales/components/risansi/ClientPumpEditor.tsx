'use client';

import { useState, useEffect, useCallback, type CSSProperties } from 'react';
import { deleteClientPump } from '@/app/actions/risansi-pumps';
import { PumpBatchForm, blankPumpBatch, type PumpBatchValue } from './PumpBatchForm';

interface Pump {
  id: number;
  pump_model_plate: string | null;
  pump_sl_no: string | null;
  ec_number: string | null;
  so_number: string | null;
  liquid: string | null;
  capacity: string | null;
  head: string | null;
  batch_id?: string | null;
}

/**
 * Open a record for editing. A row saved before batches existed has no batch_id,
 * which is a batch of one — exactly how it already behaves (every row on file
 * has quantity 1). A row that IS in a batch opens with all of its siblings, so
 * the quantity box shows the real count.
 */
const toBatch = (p: Pump, all: Pump[]): PumpBatchValue => {
  const group = p.batch_id ? all.filter(x => x.batch_id === p.batch_id) : [p];
  return {
    batchId: p.batch_id ?? null,
    model: p.pump_model_plate ?? '', liquid: p.liquid ?? '',
    capacity: p.capacity ?? '', head: p.head ?? '',
    pumps: group.map(x => ({
      id: x.id, sr_no: x.pump_sl_no ?? '', so_no: x.so_number ?? '', ec_no: x.ec_number ?? '',
    })),
  };
};

// Editable list of a client's installed pumps. Writes straight to client_pumps,
// so edits show up immediately in Client 360. Used in the visit report's RIL section.
export function ClientPumpEditor({ clientId, compact = false, onCount }: { clientId: number | string; compact?: boolean; onCount?: (n: number) => void }) {
  const cid = Number(clientId);
  const [pumps, setPumps]   = useState<Pump[]>([]);
  const [loading, setLoad]  = useState(true);
  const [reloadKey, setReloadKey] = useState(0);
  const [draft, setDraft]   = useState<PumpBatchValue | null>(null);   // open editor (add or edit)
  const [busy, setBusy]     = useState(false);
  const [err, setErr]       = useState('');

  // Re-fetch on mount and whenever load() bumps reloadKey. All setState happens
  // inside async callbacks (not synchronously in the effect body).
  const load = useCallback(() => setReloadKey(k => k + 1), []);
  useEffect(() => {
    let active = true;
    fetch(`/api/risansi/client-pumps?clientId=${cid}`, { cache: 'no-store' })
      .then(r => r.ok ? r.json() : { pumps: [] })
      .then(d => { if (active) { const list: Pump[] = d.pumps ?? []; setPumps(list); onCount?.(list.length); } })
      .catch(() => { if (active) { setPumps([]); onCount?.(0); } })
      .finally(() => { if (active) setLoad(false); });
    return () => { active = false; };
  }, [cid, reloadKey, onCount]);

  const remove = async (id: number) => {
    if (!window.confirm('Delete this pump record?')) return;
    setBusy(true); setErr('');
    try {
      const res = await deleteClientPump(id, cid);
      if (!res.ok) { setErr(res.error); return; }
      load();
    }
    catch (e) { setErr(e instanceof Error ? e.message : 'Delete failed'); }
    finally { setBusy(false); }
  };

  const fs = compact ? 13 : 12;

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 10 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--fg)' }}>
          RIL Pumps {loading ? '' : `(${pumps.length})`}
        </span>
        {draft === null && (
          <button type="button" onClick={() => setDraft(blankPumpBatch())} style={{ ...BTN_ADD, marginLeft: 'auto' }}>
            + Add Pump
          </button>
        )}
      </div>

      {err && <div style={ERR}>{err}</div>}

      {/* Add / edit form — shared attributes, a quantity, then three boxes per pump */}
      {draft !== null && (
        <PumpBatchForm
          clientId={cid}
          initial={draft}
          compact={compact}
          onSaved={() => { setDraft(null); load(); }}
          onCancel={() => { setDraft(null); setErr(''); }}
          onDeleteRow={async (id) => {
            const res = await deleteClientPump(id, cid);
            if (!res.ok) throw new Error(res.error);   // PumpBatchForm shows it
            load();
          }}
        />
      )}

      {/* Existing pumps */}
      {loading ? (
        <div style={{ fontSize: fs, color: 'var(--fg-3)', padding: '10px 0' }}>Loading pumps…</div>
      ) : pumps.length === 0 ? (
        draft === null && <div style={{ fontSize: fs, color: 'var(--fg-3)', padding: '10px 0' }}>No pumps on record for this client yet.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: compact ? undefined : 360, overflowY: compact ? undefined : 'auto' }}>
          {pumps.map(p => (
            <div key={p.id} style={ROW}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: fs, fontWeight: 700, color: 'var(--fg)' }}>
                  {p.pump_model_plate || '— no model —'}
                </div>
                <div style={{ fontSize: 11, color: 'var(--fg-3)', marginTop: 2, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                  {p.pump_sl_no && <span>SR {p.pump_sl_no}</span>}
                  {p.ec_number && <span>EC {p.ec_number}</span>}
                  {p.so_number && <span>SO {p.so_number}</span>}
                  {p.liquid && <span>{p.liquid}</span>}
                  {p.capacity && <span>{p.capacity}</span>}
                  {p.head && <span>{p.head}</span>}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                <button type="button" onClick={() => setDraft(toBatch(p, pumps))} disabled={busy} style={MINI}>Edit</button>
                <button type="button" onClick={() => remove(p.id)} disabled={busy} style={{ ...MINI, color: 'var(--neg)', borderColor: 'rgba(220,38,38,0.4)' }}>Delete</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}


const ROW: CSSProperties = { display: 'flex', alignItems: 'center', gap: 10, padding: '9px 11px', border: '1px solid var(--line)', borderRadius: 8, background: 'var(--bg-paper)' };
const MINI: CSSProperties = { padding: '4px 9px', fontSize: 11, fontWeight: 500, background: 'var(--bg-paper)', border: '1px solid var(--line-strong)', color: 'var(--fg-2)', borderRadius: 5, cursor: 'pointer', fontFamily: 'inherit' };
const BTN_ADD: CSSProperties = { padding: '5px 11px', fontSize: 12, fontWeight: 600, background: 'var(--accent-soft)', color: 'var(--title)', border: '1px solid var(--accent-line)', borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit' };
const ERR: CSSProperties = { padding: '7px 11px', background: 'var(--neg-soft)', border: '1px solid rgba(220,38,38,0.2)', borderRadius: 6, fontSize: 12, color: 'var(--neg-strong)', marginBottom: 10 };
