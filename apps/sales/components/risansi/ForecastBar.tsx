'use client';

import { useRef, useState } from 'react';

/**
 * Forecast progress bar: a realised-won segment, a weighted-pipe segment, and a
 * target marker. Hovering anywhere along the bar reveals a tooltip that reads off
 * the value and % of target at that horizontal position, so you can point at the
 * target line (or anywhere else) and see exactly how far along it sits.
 */
export function ForecastBar({ booked, weightedOpen, target }: {
  booked: number; weightedOpen: number; target: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<{ x: number; value: number; pct: number } | null>(null);

  const tot = Math.max(target, booked + weightedOpen) * 1.05 || 1;
  const bookedPct = Math.min((booked / tot) * 100, 100);
  const pipePct   = Math.min((weightedOpen / tot) * 100, Math.max(0, 100 - bookedPct));
  const targetPct = Math.min((target / tot) * 100, 99);

  const onMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const f = Math.min(Math.max((e.clientX - rect.left) / rect.width, 0), 1);
    const value = f * tot;
    const pct = target > 0 ? (value / target) * 100 : 0;
    setHover({ x: f * rect.width, value, pct });
  };

  return (
    <div
      ref={ref}
      onMouseMove={onMove}
      onMouseLeave={() => setHover(null)}
      style={{ height: 22, background: 'var(--bg-sunk)', borderRadius: 3, position: 'relative', overflow: 'visible', cursor: 'crosshair' }}
    >
      <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', borderRadius: 3 }}>
        <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${bookedPct}%`, background: 'var(--pos)' }} />
        <div style={{ position: 'absolute', left: `${bookedPct}%`, top: 0, bottom: 0, width: `${pipePct}%`, background: 'var(--accent)', opacity: 0.85 }} />
      </div>
      <div style={{ position: 'absolute', left: `${targetPct}%`, top: -3, bottom: -3, width: 2, background: 'var(--bg-ink)', zIndex: 1 }} />

      {/* Cursor guide + tooltip */}
      {hover && (
        <>
          <div style={{ position: 'absolute', left: hover.x, top: -3, bottom: -3, width: 1, background: 'var(--fg-2)', opacity: 0.55, zIndex: 2, pointerEvents: 'none' }} />
          <div
            style={{
              position: 'absolute', left: hover.x, top: -34, transform: 'translateX(-50%)',
              background: 'var(--bg-ink)', color: 'var(--bg-paper)', padding: '3px 7px', borderRadius: 4,
              fontSize: 11, fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap', zIndex: 3, pointerEvents: 'none',
              boxShadow: '0 2px 6px rgba(0,0,0,0.18)',
            }}
          >
            ₹{hover.value.toFixed(1)} Cr · {Math.round(hover.pct)}% of target
          </div>
        </>
      )}
    </div>
  );
}
