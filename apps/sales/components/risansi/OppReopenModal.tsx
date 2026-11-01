'use client';

import { useState, type CSSProperties } from 'react';
import { ALL_STAGES, STAGE_HINT, type OppStage } from '@/lib/risansi-opportunity-fields';
import { STAGE_TONE } from '@/lib/risansi-stage-tone';

// Taking a quotation back out of Lost.
//
// Lost is the one stage with no way out. The board will not drag a Lost card
// and the drawer opens read-only, so a deal the customer came back on had to be
// corrected in the database. That is the hole this closes — but a loss that can
// be undone silently is a win-rate nobody can trust, so the way out asks for a
// reason in words and keeps it.
//
// This form only collects the reason and the destination. The move itself goes
// through OppStageMoveModal, the same one every other move uses, so the stage
// being moved into still asks for everything it asks for normally.

/** Enough to be a sentence. 'ok' and 'mistake' are not a justification. */
const MIN_REASON = 20;

export interface ReopenOpp {
  client_name?: string;
  client_code?: string;
  quote_ref?: string | null;
  lost_to_competitor?: string | null;
  lost_reason?: string | null;
}

export function OppReopenModal({ opp, onCancel, onConfirm }: {
  opp: ReopenOpp;
  onCancel: () => void;
  onConfirm: (choice: { to: OppStage; reason: string }) => void;
}) {
  const [to, setTo] = useState<OppStage | null>(null);
  const [reason, setReason] = useState('');

  const trimmed = reason.trim();
  const short = trimmed.length < MIN_REASON;

  return (
    <div
      onClick={e => { if (e.target === e.currentTarget) onCancel(); }}
      style={{
        position: 'fixed', inset: 0, zIndex: 410, background: 'rgba(10,22,40,0.45)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
      }}
    >
      <div className="risansi-modal" role="dialog" aria-modal="true" style={{
        width: 560, maxWidth: '100%', maxHeight: '92vh', overflowY: 'auto',
        background: 'var(--bg-paper)', color: 'var(--fg)', borderRadius: 12,
        boxShadow: '0 24px 64px rgba(10,61,143,0.25)',
      }}>
        <div style={{ padding: '15px 20px', background: 'var(--neg)', color: '#FFF8F8' }}>
          <div style={{ fontSize: 15, fontWeight: 700 }}>Take this quotation out of Lost</div>
          <div style={{ fontSize: 11.5, opacity: 0.92, marginTop: 3 }}>
            {opp.client_name}{opp.client_code ? ` · ${opp.client_code}` : ''}
            {opp.quote_ref ? ` — ${opp.quote_ref}` : ''}
          </div>
        </div>

        <div style={{ padding: '18px 20px' }}>
          {/* What the loss currently says, because moving out of Lost erases it.
              Win-rate and the competitor analysis count this record today; after
              the move they will not, and that should not be a surprise. */}
          <div style={CLEARING}>
            <div style={{ fontWeight: 700, marginBottom: 5 }}>This clears the loss itself</div>
            <div>
              Lost to <strong>{opp.lost_to_competitor || 'not recorded'}</strong>
              {' · '}
              {opp.lost_reason || 'no reason recorded'}
            </div>
            <div style={{ marginTop: 5, opacity: 0.85 }}>
              Both are removed, so the deal stops counting against that competitor.
              What you write below is kept in its place.
            </div>
          </div>

          <label style={LBL} htmlFor="reopen-reason">Why is it coming back? *</label>
          <textarea
            id="reopen-reason"
            value={reason}
            onChange={e => setReason(e.target.value)}
            rows={4}
            placeholder="What changed — the customer came back, the order was re-tendered, this was recorded as Lost by mistake…"
            style={TEXTAREA}
          />
          <div style={{ fontSize: 10.5, color: short ? 'var(--warn)' : 'var(--fg-3)', marginTop: 4 }}>
            {short
              ? `${MIN_REASON - trimmed.length} more character${MIN_REASON - trimmed.length === 1 ? '' : 's'} — a line somebody can act on, not “mistake”.`
              : 'Kept against this deal with your name and the time, and in its stage history.'}
          </div>

          <div style={{ marginTop: 16 }}>
            <label style={LBL}>Move it to *</label>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {ALL_STAGES.filter(s => s !== 'Lost').map(s => (
                <button
                  key={s} type="button"
                  onClick={() => setTo(s)}
                  title={STAGE_HINT[s]}
                  style={{
                    padding: '6px 12px', borderRadius: 20, fontFamily: 'inherit',
                    border: `1px solid ${to === s ? STAGE_TONE[s] : 'var(--line-strong)'}`,
                    background: to === s ? STAGE_TONE[s] : 'var(--bg-paper)',
                    color: to === s ? '#FFFFFF' : 'var(--fg-2)',
                    fontSize: 12, fontWeight: 600, cursor: 'pointer',
                  }}
                >{s}</button>
              ))}
            </div>
            <div style={{ fontSize: 10.5, color: 'var(--fg-3)', marginTop: 6, lineHeight: 1.5 }}>
              {to
                ? STAGE_HINT[to]
                : 'The next step asks for whatever that stage needs — a PO for Won, a hold reason for On Hold, and so on.'}
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 18 }}>
            <button type="button" onClick={onCancel} style={GHOST}>Cancel</button>
            <button
              type="button"
              disabled={short || !to}
              onClick={() => { if (!short && to) onConfirm({ to, reason: trimmed }); }}
              style={{ ...PRIMARY, opacity: short || !to ? 0.5 : 1, cursor: short || !to ? 'not-allowed' : 'pointer' }}
            >
              {to ? `Continue to ${to}` : 'Continue'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

const CLEARING: CSSProperties = {
  padding: '10px 12px', borderRadius: 7, marginBottom: 16,
  background: 'var(--neg-soft)', border: '1px solid var(--neg)',
  borderLeft: '3px solid var(--neg)', color: 'var(--neg-strong)',
  fontSize: 11.5, lineHeight: 1.55,
};
const LBL: CSSProperties = {
  display: 'block', fontSize: 10, fontWeight: 700, textTransform: 'uppercase',
  letterSpacing: '0.05em', color: 'var(--fg-3)', marginBottom: 4,
};
const TEXTAREA: CSSProperties = {
  width: '100%', boxSizing: 'border-box', padding: '8px 10px', fontSize: 13,
  fontFamily: 'inherit', lineHeight: 1.5, resize: 'vertical',
  background: 'var(--bg-sunk)', border: '1px solid var(--line-strong)',
  borderRadius: 6, color: 'var(--fg)', outline: 'none',
};
const GHOST: CSSProperties = {
  border: '1px solid var(--line-strong)', background: 'var(--bg-paper)', color: 'var(--fg)',
  borderRadius: 6, fontSize: 13, fontWeight: 600, padding: '9px 16px', cursor: 'pointer', fontFamily: 'inherit',
};
const PRIMARY: CSSProperties = {
  border: 'none', background: 'var(--accent-fill)', color: 'var(--on-accent)', borderRadius: 6,
  fontSize: 13, fontWeight: 600, padding: '9px 18px', fontFamily: 'inherit',
};
