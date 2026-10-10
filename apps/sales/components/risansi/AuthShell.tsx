'use client';

import { useRef, useEffect, type CSSProperties, type FocusEvent } from 'react';

// Shared chrome for the sign-in / request-access pages so they stay identical:
// the left video panel (public/login-bg.mp4, muted + looping behind a blue overlay)
// and the form field styling. The panel carries `login-brand`, so mobile.css hides
// it on phones. Only the descriptive paragraph differs between the two pages.
export function AuthVideoPanel({ description }: { description: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);

  // Force muted before autoplay — React can drop the `muted` attribute on the SSR
  // markup, and browsers block autoplay for un-muted video.
  useEffect(() => {
    const v = videoRef.current;
    if (v) { v.muted = true; v.playbackRate = 0.75; v.play?.().catch(() => {}); }
  }, []);

  return (
    <div className="login-brand" style={{
      position: 'relative', overflow: 'hidden', minHeight: '100vh',
      display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
      padding: '48px 56px', background: '#0A1628',
    }}>
      <video
        ref={videoRef}
        autoPlay muted loop playsInline preload="auto" aria-hidden="true"
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', zIndex: 0 }}
      >
        <source src="/login-bg.mp4" type="video/mp4" />
      </video>

      {/* Blue overlay — keeps it on-brand and the text readable over any frame */}
      <div style={{
        position: 'absolute', inset: 0, zIndex: 1,
        background: 'linear-gradient(150deg, rgba(10,22,40,0.86) 0%, rgba(12,44,96,0.62) 46%, rgba(0,163,196,0.42) 100%)',
      }} />

      <div style={{ position: 'relative', zIndex: 2 }}>
        <div style={{ background: '#fff', borderRadius: 10, padding: '8px 14px', display: 'inline-flex', alignItems: 'center', boxShadow: '0 6px 24px rgba(0,0,0,0.25)' }}>
          <img src="/logo.png" alt="Risansi Industries Ltd" style={{ height: 44, width: 'auto', objectFit: 'contain', display: 'block' }} />
        </div>
      </div>

      <div style={{ position: 'relative', zIndex: 2 }}>
        <p style={{ fontSize: 34, fontWeight: 300, color: '#fff', lineHeight: 1.25, letterSpacing: '-0.02em', margin: '0 0 16px', textShadow: '0 2px 28px rgba(0,0,0,0.4)' }}>
          Intelligence for<br />
          <span style={{ color: '#7FE7FF', fontWeight: 600 }}>every customer</span>
        </p>
        <p style={{ fontSize: 14, color: 'rgba(255,255,255,0.85)', lineHeight: 1.65, maxWidth: 350, textShadow: '0 1px 14px rgba(0,0,0,0.45)', margin: 0 }}>
          {description}
        </p>
      </div>

      <div style={{ position: 'relative', zIndex: 2, fontSize: 11, color: 'rgba(255,255,255,0.6)' }}>
        Risansi Industries Ltd · Internal use only
      </div>
    </div>
  );
}

export const AUTH_LABEL: CSSProperties = {
  fontSize: 12, fontWeight: 500, color: '#2D3E55', letterSpacing: '0.02em',
};

export const AUTH_INP: CSSProperties = {
  width: '100%', boxSizing: 'border-box', padding: '11px 13px', fontSize: 14, fontFamily: 'inherit',
  background: '#fff', border: '1px solid #DDE4EE', borderRadius: 8, color: '#0D1B2E',
  outline: 'none', transition: 'border-color 0.15s, box-shadow 0.15s',
};

export const authFocusOn = (e: FocusEvent<HTMLInputElement | HTMLSelectElement>) => {
  e.currentTarget.style.borderColor = '#1A5CB8';
  e.currentTarget.style.boxShadow = '0 0 0 3px rgba(26,92,184,0.14)';
};
export const authFocusOff = (e: FocusEvent<HTMLInputElement | HTMLSelectElement>) => {
  e.currentTarget.style.borderColor = '#DDE4EE';
  e.currentTarget.style.boxShadow = 'none';
};
