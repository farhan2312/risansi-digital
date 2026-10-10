'use client';

import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';

const IDLE_MS = 60_000;     // count as idle after 60s with no input
const FLUSH_MS = 30_000;    // push accumulated time every 30s

// Normalise volatile id segments so per-page time aggregates by route,
// e.g. /risansi/clients/1062 → /risansi/clients/:id.
function normalize(path: string): string {
  return path.split('?')[0].split('/').map(seg =>
    /^\d+$/.test(seg) || /^[A-Za-z]{2,}\d{2,}[A-Za-z0-9]*$/.test(seg) ? ':id' : seg
  ).join('/') || '/';
}

// Records how long the signed-in user is ACTIVELY on each page (tab visible and
// not idle). Mounted once in the portal layout. Renders nothing.
export function ActivityTracker() {
  const pathname = usePathname();
  const pathRef = useRef(normalize(pathname));
  const secondsRef = useRef(0);            // unsent active seconds for pathRef.current
  const lastInputRef = useRef(Date.now());
  const sidRef = useRef('');

  function flush(path: string, beacon = false) {
    const sec = Math.round(secondsRef.current);
    secondsRef.current = 0;
    if (sec <= 0 || !path) return;
    const body = JSON.stringify({ path, seconds: sec, sessionId: sidRef.current });
    try {
      if (beacon && typeof navigator !== 'undefined' && navigator.sendBeacon) {
        navigator.sendBeacon('/api/risansi/activity', new Blob([body], { type: 'application/json' }));
      } else {
        fetch('/api/risansi/activity', { method: 'POST', body, keepalive: true, headers: { 'Content-Type': 'application/json' } }).catch(() => {});
      }
    } catch { /* ignore */ }
  }

  useEffect(() => {
    let sid = sessionStorage.getItem('ril_sid');
    if (!sid) {
      sid = (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      sessionStorage.setItem('ril_sid', sid);
    }
    sidRef.current = sid;

    const onInput = () => { lastInputRef.current = Date.now(); };
    const events = ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart', 'wheel'] as const;
    events.forEach(e => window.addEventListener(e, onInput, { passive: true }));

    const tick = setInterval(() => {
      if (document.visibilityState === 'visible' && Date.now() - lastInputRef.current < IDLE_MS) {
        secondsRef.current += 1;
      }
    }, 1000);
    const flushTimer = setInterval(() => flush(pathRef.current), FLUSH_MS);

    const onVis = () => { if (document.visibilityState === 'hidden') flush(pathRef.current, true); };
    const onHide = () => flush(pathRef.current, true);
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('pagehide', onHide);

    return () => {
      events.forEach(e => window.removeEventListener(e, onInput));
      clearInterval(tick); clearInterval(flushTimer);
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('pagehide', onHide);
      flush(pathRef.current, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // On route change, bank the previous page's time before switching.
  useEffect(() => {
    const next = normalize(pathname);
    if (pathRef.current !== next) {
      flush(pathRef.current);
      pathRef.current = next;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  return null;
}
