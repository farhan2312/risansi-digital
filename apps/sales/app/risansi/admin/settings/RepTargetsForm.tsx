'use client';

import { useMemo, useState, useTransition, type CSSProperties } from 'react';
import { useRouter } from 'next/navigation';
import { setRepTargets, type RepTargetInput } from '@/app/actions/risansi-targets';
import type { RepTarget } from '@/lib/risansi-targets';

type Props = {
  reps: RepTarget[];
  companyTargetCr: number;
  equalShareCr: number;
};

const cr = (n: number) => `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} Cr`;

export function RepTargetsForm({ reps, companyTargetCr, equalShareCr }: Props) {
  const router = useRouter();
  const [vals, setVals] = useState<Record<number, string>>(
    () => Object.fromEntries(reps.map(r => [r.id, r.targetCr === null ? '' : r.targetCr.toFixed(2)])),
  );
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // The running total is the sum of what the portal will ACTUALLY use, so a
  // blank row contributes its equal-share fallback rather than nothing. A sum
  // that silently treated a blank as zero would show a gap the portal does not
  // actually have.
  const { sum, blanks, bad } = useMemo(() => {
    let sum = 0, blanks = 0, bad = 0;
    for (const r of reps) {
      const raw = (vals[r.id] ?? '').trim();
      if (raw === '') { blanks++; sum += equalShareCr; continue; }
      const n = Number(raw);
      if (!Number.isFinite(n) || n < 0) { bad++; continue; }
      sum += n;
    }
    return { sum: Math.round(sum * 100) / 100, blanks, bad };
  }, [vals, reps, equalShareCr]);

  const gap = Math.round((sum - companyTargetCr) * 100) / 100;

  function splitEvenly() {
    setMsg(null);
    setVals(Object.fromEntries(reps.map(r => [r.id, equalShareCr.toFixed(2)])));
  }

  function save() {
    setMsg(null);
    const payload: RepTargetInput[] = reps.map(r => ({ id: r.id, targetCr: vals[r.id] ?? '' }));
    start(async () => {
      const res = await setRepTargets(payload);
      if (!res.ok) { setMsg({ ok: false, text: res.error }); return; }
      setMsg({ ok: true, text: 'Saved.' });
      router.refresh();
    });
  }

  if (reps.length === 0) {
    return <div style={{ fontSize: 12, color: 'var(--fg-3)' }}>No active reps or managers to give a target to.</div>;
  }

  return (
    <div>
      <div className="rt-list" style={{ border: '1px solid var(--line)', borderRadius: 8, overflow: 'hidden' }}>
        <div className="rt-row rt-head" style={{ ...ROW, background: 'var(--bg-elev)', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--fg-3)' }}>
          <span>Rep</span>
          <span style={{ textAlign: 'right' }}>Annual target (₹ Cr)</span>
        </div>
        {reps.map(r => {
          const raw = (vals[r.id] ?? '').trim();
          const invalid = raw !== '' && (!Number.isFinite(Number(raw)) || Number(raw) < 0);
          return (
            <div key={r.id} className="rt-row" style={{ ...ROW, borderTop: '1px solid var(--line)' }}>
              <span style={{ minWidth: 0 }}>
                <span style={{ fontSize: 13, color: 'var(--fg)' }}>{r.name}</span>
                <span style={{ fontSize: 11, color: 'var(--fg-3)', marginLeft: 8 }}>
                  {r.role}{r.repCode ? ` · ${r.repCode}` : ''}{r.zone ? ` · ${r.zone}` : ''}
                </span>
              </span>
              <span className="rt-input" style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'flex-end' }}>
                <input
                  type="number" min="0" step="0.05" inputMode="decimal"
                  value={vals[r.id] ?? ''}
                  placeholder={equalShareCr.toFixed(2)}
                  onChange={e => setVals(v => ({ ...v, [r.id]: e.target.value }))}
                  aria-label={`Annual target for ${r.name} in Crores`}
                  style={{ ...INP, borderColor: invalid ? 'var(--neg)' : 'var(--line-strong)' }}
                />
                {raw === '' && <span style={{ fontSize: 10, color: 'var(--fg-3)', width: 52 }}>implied</span>}
                {raw !== '' && <span style={{ width: 52 }} />}
              </span>
            </div>
          );
        })}
      </div>

      <div className="rt-row rt-total" style={{ ...ROW, paddingTop: 12, paddingBottom: 0 }}>
        <span style={{ fontSize: 12, color: 'var(--fg-2)' }}>Sum of {reps.length} rep targets</span>
        <span style={{ textAlign: 'right', fontSize: 13, fontWeight: 600, color: 'var(--fg)' }}>{cr(sum)}</span>
      </div>
      <div className="rt-row rt-total" style={{ ...ROW, paddingTop: 4, paddingBottom: 0 }}>
        <span style={{ fontSize: 12, color: 'var(--fg-2)' }}>Company annual target</span>
        <span style={{ textAlign: 'right', fontSize: 13, color: 'var(--fg-2)' }}>{cr(companyTargetCr)}</span>
      </div>
      <div className="rt-row rt-total" style={{ ...ROW, paddingTop: 4 }}>
        <span style={{ fontSize: 12, color: 'var(--fg-2)' }}>Difference</span>
        {/* --warn-strong, not --warn: this is text on the page background, and
            the plain amber fails to carry at 13px in the light theme. */}
        <span style={{ textAlign: 'right', fontSize: 13, fontWeight: 600, color: gap === 0 ? 'var(--pos)' : 'var(--warn-strong)' }}>
          {gap === 0 ? 'They match' : `${gap > 0 ? '+' : '−'}${cr(Math.abs(gap))}`}
        </span>
      </div>

      {blanks > 0 && (
        <div style={{ fontSize: 11, color: 'var(--fg-3)', marginTop: 8 }}>
          {blanks} rep{blanks === 1 ? ' has' : 's have'} no target set and fall{blanks === 1 ? 's' : ''} back to the equal share of {cr(equalShareCr)}.
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 14, flexWrap: 'wrap' }}>
        <button type="button" onClick={save} disabled={pending || bad > 0}
          style={{ ...BTN, opacity: pending || bad > 0 ? 0.5 : 1, cursor: pending || bad > 0 ? 'default' : 'pointer' }}>
          {pending ? 'Saving…' : 'Save all targets'}
        </button>
        <button type="button" onClick={splitEvenly} disabled={pending} style={BTN_GHOST}>
          Split {cr(companyTargetCr)} evenly
        </button>
      </div>

      {bad > 0 && (
        <div style={{ fontSize: 12, marginTop: 10, color: 'var(--neg)' }}>
          {bad} target{bad === 1 ? ' is' : 's are'} not a valid number. Fix {bad === 1 ? 'it' : 'them'} before saving.
        </div>
      )}
      {msg && (
        <div style={{ fontSize: 12, marginTop: 10, color: msg.ok ? 'var(--pos)' : 'var(--neg)' }}>
          {msg.ok ? '✓ ' : ''}{msg.text}
        </div>
      )}
    </div>
  );
}

const ROW: CSSProperties = {
  display: 'grid', gridTemplateColumns: '1fr 210px', gap: 10,
  alignItems: 'center', padding: '8px 12px',
};
const INP: CSSProperties = {
  width: 100, padding: '7px 9px', fontSize: 13, fontFamily: 'inherit', textAlign: 'right',
  background: 'var(--bg-elev)', border: '1px solid var(--line-strong)', borderRadius: 6,
  color: 'var(--fg)', outline: 'none',
};
const BTN: CSSProperties = {
  padding: '8px 16px', fontSize: 13, fontWeight: 600, background: 'var(--accent-fill)',
  color: 'var(--on-accent)', border: 'none', borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit',
};
const BTN_GHOST: CSSProperties = {
  padding: '8px 14px', fontSize: 13, fontWeight: 500, background: 'var(--bg-elev)',
  color: 'var(--fg-2)', border: '1px solid var(--line-strong)', borderRadius: 6,
  cursor: 'pointer', fontFamily: 'inherit',
};
