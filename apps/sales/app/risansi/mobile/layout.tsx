import type { ReactNode } from 'react';

// Auth is already enforced by the parent app/risansi/layout.tsx.
// This layout overlays the desktop shell via position:fixed to give a clean
// full-screen mobile experience. The single app-wide white bottom bar
// (BottomNav, from the parent layout) floats above this overlay (z-index 65 >
// 50), so this section no longer renders its own bar.

export default function MobileLayout({ children }: { children: ReactNode }) {
  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      zIndex: 50,
      background: 'var(--bg)',
      overflowY: 'auto',
      overflowX: 'hidden',
      WebkitOverflowScrolling: 'touch',
    } as React.CSSProperties}>
      <div style={{
        maxWidth: 430,
        margin: '0 auto',
        minHeight: '100dvh',
        display: 'flex',
        flexDirection: 'column',
        position: 'relative',
      }}>
        <main style={{ flex: 1, paddingBottom: 'calc(64px + env(safe-area-inset-bottom, 0px))' }}>
          {children}
        </main>
      </div>
    </div>
  );
}
