'use client';

import { useCallback, useEffect, useRef, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';

export interface ScreenshotLightboxProps {
  /** Image URLs in the order they should be paged through. */
  srcs: string[];
  /** Which one is showing. Controlled so the opener can remember the thumbnail that was clicked. */
  index: number;
  onIndexChange: (next: number) => void;
  onClose: () => void;
  /** What the set of images is of, e.g. "bug #214". Used for the dialog label and the alt text. */
  subject: string;
}

/** Everything the Tab key is allowed to land on inside the overlay. */
const FOCUSABLE = 'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Full-screen image viewer for a set of attachments. Lives in a portal on
 * <body> rather than inline, because the surfaces that open it (the bug detail
 * modal) are themselves scrollable overlays with their own backdrop-click
 * handler — nesting inside one would both chain scrolling to it and close it on
 * every click in here.
 */
export function ScreenshotLightbox({ srcs, index, onIndexChange, onClose, subject }: ScreenshotLightboxProps) {
  const count = srcs.length;
  const many  = count > 1;
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const touchRef = useRef<{ x: number; y: number } | null>(null);

  // Wraps at both ends rather than stopping, so there is no dead control to
  // explain; the "n of m" readout is what tells you where you are.
  const step = useCallback((delta: number) => {
    if (count < 2) return;
    onIndexChange((index + delta + count) % count);
  }, [count, index, onIndexChange]);

  // Whatever had focus when the viewer opened gets it back on close — normally
  // the thumbnail button, so the reader does not lose their place in the modal.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    return () => { opener?.focus?.(); };
  }, []);

  // The page behind must not scroll. Body is the only scroll container left
  // once this is portalled out of the modal's own scrolling box.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  // Escape and the arrows are bound on the document, not the panel, so they
  // keep working even if a click lands somewhere unfocusable.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape')     { onClose(); }
      if (e.key === 'ArrowRight') { e.preventDefault(); step(1); }
      if (e.key === 'ArrowLeft')  { e.preventDefault(); step(-1); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, step]);

  // Tab cycles inside the overlay instead of walking into the modal underneath.
  const trapTab = (e: React.KeyboardEvent) => {
    if (e.key !== 'Tab' || !panelRef.current) return;
    const nodes = Array.from(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE));
    if (nodes.length === 0) return;
    const first = nodes[0];
    const last  = nodes[nodes.length - 1];
    const active = document.activeElement;
    const outside = !panelRef.current.contains(active);
    if (e.shiftKey && (outside || active === first)) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && (outside || active === last)) { e.preventDefault(); first.focus(); }
  };

  const src = srcs[index] ?? srcs[0];

  const body = (
    <div
      ref={panelRef}
      role="dialog"
      aria-modal="true"
      aria-label={`Screenshots on ${subject}`}
      onKeyDown={trapTab}
      // React routes portal events up the component tree, not the DOM tree, so
      // without this a backdrop click would also reach the host modal's own
      // close-on-backdrop handler and dismiss both at once.
      onClick={e => { e.stopPropagation(); onClose(); }}
      style={SCRIM}
    >
      <div style={BAR}>
        {many && (
          <span aria-live="polite" style={{ ...CHIP, fontFamily: 'var(--font-mono)' }}>
            {index + 1} of {count}
          </span>
        )}
        <button
          ref={closeRef}
          type="button"
          onClick={e => { e.stopPropagation(); onClose(); }}
          style={{ ...CHIP, ...TAP, marginLeft: 'auto', cursor: 'pointer', fontWeight: 600 }}
        >
          <span aria-hidden="true" style={{ fontSize: 17, lineHeight: 1 }}>×</span> Close
        </button>
      </div>

      <div
        style={STAGE}
        onTouchStart={e => { const t = e.touches[0]; touchRef.current = { x: t.clientX, y: t.clientY }; }}
        onTouchEnd={e => {
          const start = touchRef.current;
          touchRef.current = null;
          if (!start || !many) return;
          const t = e.changedTouches[0];
          const dx = t.clientX - start.x;
          const dy = t.clientY - start.y;
          // Horizontal intent only, so a vertical flick on a tall screenshot is
          // not read as a page turn.
          if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy)) step(dx < 0 ? 1 : -1);
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- dynamic API-route image, next/image can't optimise it */}
        <img
          src={src}
          alt={many ? `Screenshot ${index + 1} of ${count} on ${subject}` : `Screenshot on ${subject}`}
          draggable={false}
          onClick={e => e.stopPropagation()}
          style={IMAGE}
        />

        {many && (
          <>
            <button type="button" aria-label="Previous screenshot"
              onClick={e => { e.stopPropagation(); step(-1); }} style={{ ...ARROW, left: 8 }}>‹</button>
            <button type="button" aria-label="Next screenshot"
              onClick={e => { e.stopPropagation(); step(1); }} style={{ ...ARROW, right: 8 }}>›</button>
          </>
        )}
      </div>

      <div style={{ ...BAR, justifyContent: 'center', paddingTop: 0 }}>
        <a
          href={src}
          target="_blank"
          rel="noreferrer"
          onClick={e => e.stopPropagation()}
          style={{ ...CHIP, ...TAP, textDecoration: 'none', cursor: 'pointer' }}
        >
          Open original ↗
        </a>
        <span style={{ ...CHIP, color: 'var(--fg-3)' }}>
          {many ? '← → to switch · Esc to close' : 'Esc to close'}
        </span>
      </div>
    </div>
  );

  // No portal target during SSR; the viewer only ever opens from a click anyway.
  return typeof document === 'undefined' ? body : createPortal(body, document.body);
}

/* The scrim is the one deliberately non-token colour here: it has to darken
   whatever is behind it in both themes, so it cannot follow the theme. */
const SCRIM: CSSProperties = {
  position: 'fixed', inset: 0, zIndex: 900,
  display: 'flex', flexDirection: 'column',
  background: 'rgba(6, 12, 24, 0.72)',
  backdropFilter: 'blur(10px) saturate(120%)',
  WebkitBackdropFilter: 'blur(10px) saturate(120%)',
  overscrollBehavior: 'contain',
};

const BAR: CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
  padding: '10px 12px', flexShrink: 0,
};

/* Pills, not bare glyphs on the scrim: a token surface keeps the controls
   legible in both themes without picking a text colour against the blur. */
const CHIP: CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 6,
  padding: '6px 12px', fontSize: 12, fontFamily: 'inherit',
  color: 'var(--fg-2)', background: 'var(--bg-paper)',
  border: '1px solid var(--line-strong)', borderRadius: 999,
  boxShadow: '0 2px 10px rgba(0,0,0,0.35)',
};

/* Anything a thumb aims at clears the 44px target, on a phone as on a desktop. */
const TAP: CSSProperties = { minHeight: 44, padding: '0 16px', fontSize: 13, color: 'var(--fg)' };

const STAGE: CSSProperties = {
  position: 'relative', flex: 1, minHeight: 0,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  padding: '0 8px',
};

/* max-* with auto intrinsic sizing fits the image to the stage and, unlike a
   width of 100%, never blows a small screenshot up past its natural size. */
const IMAGE: CSSProperties = {
  maxWidth: '100%', maxHeight: '100%', width: 'auto', height: 'auto',
  objectFit: 'contain', display: 'block',
  borderRadius: 6, border: '1px solid var(--line-strong)',
  boxShadow: '0 24px 70px rgba(0,0,0,0.5)',
  background: 'var(--bg-paper)',
};

const ARROW: CSSProperties = {
  position: 'absolute', top: '50%', transform: 'translateY(-50%)',
  width: 48, height: 48, borderRadius: 999,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  fontSize: 28, lineHeight: 1, fontFamily: 'inherit',
  color: 'var(--fg)', background: 'var(--bg-paper)',
  border: '1px solid var(--line-strong)',
  boxShadow: '0 2px 14px rgba(0,0,0,0.4)',
  cursor: 'pointer', padding: 0,
};
