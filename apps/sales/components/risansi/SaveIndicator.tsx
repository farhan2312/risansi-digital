'use client';

import type { CSSProperties } from 'react';
import type { DraftState } from './useFormDraft';

// The small "saving… / saved ✓" that sits top-right of a form.
//
// Deliberately tiny and unanimated: it is reassurance, not an announcement. It
// holds a blank line's worth of space when idle so the header doesn't jump every
// time it appears and disappears.
//
// role="status" so a screen reader hears it without the focus being stolen
// mid-typing, which is exactly what would happen with an alert.

export function SaveIndicator({ state, label = 'Draft', at, tone = 'auto' }: {
  state: DraftState;
  label?: string;
  /** When the draft was last written, so "saved" can say when rather than just that. */
  at?: number | null;
  /**
   * 'auto' takes its colour from the page tokens. 'onDark' is for the forms
   * whose heading sits on the deep blue bar, where --fg-3 is unreadable.
   */
  tone?: 'auto' | 'onDark';
}) {
  const time = at
    ? new Date(at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
    : '';
  const colour = tone === 'onDark'
    ? 'rgba(255,255,255,0.88)'
    : state === 'saved' ? 'var(--pos)' : 'var(--fg-3)';
  return (
    <span role="status" aria-live="polite" style={{
      ...BASE,
      color: colour,
      opacity: state === 'idle' ? 0 : 1,
    }}>
      {state === 'saving' && <>⟳ Saving…</>}
      {state === 'saved'  && <>✓ {label} saved{time ? ` ${time}` : ''}</>}
    </span>
  );
}

const BASE: CSSProperties = {
  fontSize: 10.5, fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap',
  transition: 'opacity 220ms, color 220ms', minWidth: 132, textAlign: 'right',
  display: 'inline-block', pointerEvents: 'none',
};

/**
 * The "we brought your typing back" banner shown once after a restore.
 *
 * `onDiscard` is the way out of a restore nobody wanted — a draft from last week
 * over a deal that has since changed. Without it the only escape would be
 * clearing every field by hand, so it is offered next to the dismiss.
 */
export function DraftRestoredBanner({ onDismiss, onDiscard, what }: {
  onDismiss: () => void;
  onDiscard?: () => void;
  what: string;
}) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8, padding: '7px 11px', marginBottom: 10,
      background: 'var(--accent-soft)', border: '1px solid var(--accent-line)',
      borderRadius: 6, fontSize: 11.5, color: 'var(--title)', flexWrap: 'wrap',
    }}>
      <span>Restored unsaved changes — the {what} you had typed but never saved.</span>
      {onDiscard && (
        <button type="button" onClick={onDiscard} style={{
          marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer',
          color: 'inherit', fontSize: 11.5, fontWeight: 700, fontFamily: 'inherit',
          textDecoration: 'underline', padding: 0,
        }}>Discard them</button>
      )}
      <button type="button" onClick={onDismiss} style={{
        marginLeft: onDiscard ? 0 : 'auto', background: 'none', border: 'none', cursor: 'pointer',
        color: 'inherit', fontSize: 15, lineHeight: 1, padding: '0 2px',
      }} aria-label="Dismiss">×</button>
    </div>
  );
}
