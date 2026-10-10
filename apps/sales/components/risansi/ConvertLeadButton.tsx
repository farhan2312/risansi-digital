'use client';

import { useState, useTransition, type CSSProperties } from 'react';
import { useRouter } from 'next/navigation';
import { convertLeadToClient } from '@/app/actions/risansi';

/**
 * "Convert to Client" — shown on a Prospective-Lead's page. Prompts for the ERP
 * client code, swaps the LEAD_ code for it, flips the status to Prospective-Client,
 * then navigates to the client's new URL (the code, and therefore the URL, change).
 */
export function ConvertLeadButton({ clientId, currentCode, legalName }: {
  clientId: number; currentCode: string; legalName: string;
}) {
  const router = useRouter();
  const [open, setOpen]   = useState(false);
  const [code, setCode]   = useState('');
  const [error, setError] = useState('');
  const [pending, start]  = useTransition();

  const submit = () => {
    setError('');
    const erp = code.trim().toUpperCase();
    if (!erp) { setError('Enter the ERP client code.'); return; }
    if (erp.startsWith('LEAD_')) { setError('That is a lead code — enter the real ERP client code.'); return; }
    start(async () => {
      try {
        const { newCode } = await convertLeadToClient(clientId, erp);
        setOpen(false);
        router.push(`/risansi/clients/${encodeURIComponent(newCode)}`);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Conversion failed.');
      }
    });
  };

  return (
    <>
      <button type="button" onClick={() => { setOpen(true); setCode(''); setError(''); }} style={BTN}>
        Convert to Client
      </button>

      {open && (
        <div style={OVERLAY} onClick={() => !pending && setOpen(false)}>
          <div style={MODAL} onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--fg)', marginBottom: 4 }}>Convert lead to client</div>
            <div style={{ fontSize: 13, color: 'var(--fg-3)', lineHeight: 1.5, marginBottom: 14 }}>
              Enter the ERP client code for <b style={{ color: 'var(--fg-2)' }}>{legalName}</b>. This replaces the
              lead code <span style={{ fontFamily: 'var(--font-mono)' }}>{currentCode}</span> and marks them
              <b> Prospective-Client</b>.
            </div>

            <label style={LBL}>ERP Client Code</label>
            <input
              autoFocus type="text" value={code} maxLength={20}
              onChange={e => setCode(e.target.value.toUpperCase())}
              onKeyDown={e => { if (e.key === 'Enter') submit(); }}
              placeholder="e.g. PUNE01A162"
              style={{ ...INP, fontFamily: 'var(--font-mono)' }} />

            {error && <div style={{ fontSize: 12, color: 'var(--neg)', marginTop: 8 }}>{error}</div>}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18 }}>
              <button type="button" onClick={() => setOpen(false)} disabled={pending} style={BTN_GHOST}>Cancel</button>
              <button type="button" onClick={submit} disabled={pending}
                style={{ ...BTN, opacity: pending ? 0.6 : 1 }}>
                {pending ? 'Converting…' : 'Convert'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

const BTN: CSSProperties = { padding: '7px 14px', fontSize: 13, fontWeight: 600, fontFamily: 'inherit', background: 'var(--accent-fill)', color: 'var(--on-accent)', border: 'none', borderRadius: 6, cursor: 'pointer' };
const BTN_GHOST: CSSProperties = { padding: '7px 14px', fontSize: 13, fontFamily: 'inherit', background: 'none', border: '1px solid var(--line-strong)', color: 'var(--fg-2)', borderRadius: 6, cursor: 'pointer' };
const OVERLAY: CSSProperties = { position: 'fixed', inset: 0, zIndex: 500, background: 'rgba(15,23,42,0.45)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '12vh 16px 16px' };
const MODAL: CSSProperties = { width: '100%', maxWidth: 440, background: 'var(--bg-paper)', border: '1px solid var(--line-strong)', borderRadius: 10, boxShadow: '0 20px 60px rgba(0,0,0,0.3)', padding: 20 };
const LBL: CSSProperties = { display: 'block', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--fg-3)', marginBottom: 5 };
const INP: CSSProperties = { width: '100%', boxSizing: 'border-box', padding: '9px 12px', fontSize: 13, fontFamily: 'inherit', color: 'var(--fg)', background: 'var(--bg-elev)', border: '1px solid var(--line-strong)', borderRadius: 6 };
