'use client';

import { useEffect } from 'react';

/**
 * Renders a small on-screen toolbar (hidden when printing) and auto-opens the
 * browser print dialog shortly after mount, so a /print/* route doubles as a
 * one-click "Save as PDF". The user can re-trigger it with the button.
 */
export function AutoPrint({ label = 'Print / Save as PDF' }: { label?: string }) {
  useEffect(() => {
    let fired = false;
    const fire = () => {
      if (fired) return;
      fired = true;
      try { window.print(); } catch { /* user can still use the button */ }
    };

    // Wait for any images (e.g. visit photos) to finish loading first, so they
    // aren't blank in the PDF. Fall back to printing anyway after a few seconds.
    const pending = Array.from(document.images).filter(img => !img.complete);
    if (pending.length === 0) {
      const t = setTimeout(fire, 700);
      return () => clearTimeout(t);
    }

    let remaining = pending.length;
    const onSettled = () => { remaining -= 1; if (remaining <= 0) setTimeout(fire, 250); };
    pending.forEach(img => {
      img.addEventListener('load', onSettled);
      img.addEventListener('error', onSettled);
    });
    const fallback = setTimeout(fire, 5000);
    return () => {
      clearTimeout(fallback);
      pending.forEach(img => {
        img.removeEventListener('load', onSettled);
        img.removeEventListener('error', onSettled);
      });
    };
  }, []);

  return (
    <div
      className="no-print"
      style={{
        position: 'sticky', top: 0, zIndex: 50,
        display: 'flex', gap: 8, justifyContent: 'flex-end',
        padding: '10px 14px', marginBottom: 12,
        background: '#0A3D8F', borderRadius: 8,
      }}
    >
      <button
        onClick={() => window.print()}
        style={{
          padding: '7px 16px', fontSize: 13, fontWeight: 600,
          background: '#fff', color: '#0A3D8F', border: 'none',
          borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit',
        }}
      >
        🖨 {label}
      </button>
      <button
        onClick={() => window.close()}
        style={{
          padding: '7px 16px', fontSize: 13, fontWeight: 500,
          background: 'transparent', color: '#fff',
          border: '1px solid rgba(255,255,255,0.5)',
          borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit',
        }}
      >
        Close
      </button>
    </div>
  );
}
