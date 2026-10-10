'use client';

import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import type { CSSProperties, MouseEvent } from 'react';

// Quarter navigator for the Field Activity calendar. Quarters are calendar-aligned
// (Jan–Mar, Apr–Jun, Jul–Sep, Oct–Dec); `q` is the offset in whole quarters.

const NAV_BTN: CSSProperties = {
  padding: '6px 10px', borderRadius: 6,
  border: '1px solid var(--line-strong)',
  background: 'var(--bg-paper)', cursor: 'pointer', fontSize: 13,
  fontFamily: 'inherit', color: 'var(--fg)',
};

const hoverOn  = (e: MouseEvent<HTMLButtonElement>) => { e.currentTarget.style.background = 'var(--bg-elev)'; };
const hoverOff = (e: MouseEvent<HTMLButtonElement>) => { e.currentTarget.style.background = 'var(--bg-paper)'; };

export function QuarterNav({ currentOffset }: { currentOffset: number }) {
  const router       = useRouter();
  const pathname     = usePathname();
  const searchParams = useSearchParams();

  const go = (offset: number) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('tab', 'calendar');
    if (offset === 0) params.delete('q');
    else params.set('q', String(offset));
    router.push(`${pathname}?${params.toString()}`);
  };

  const now     = new Date();
  const qStart0 = now.getMonth() - (now.getMonth() % 3);
  const m1      = new Date(now.getFullYear(), qStart0 + currentOffset * 3, 1);
  const m3      = new Date(m1.getFullYear(), m1.getMonth() + 2, 1);
  const same    = m1.getFullYear() === m3.getFullYear();
  const l1      = m1.toLocaleDateString('en-IN', same ? { month: 'short' } : { month: 'short', year: 'numeric' });
  const l3      = m3.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' });
  const label   = `${l1} – ${l3}`;

  return (
    <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
      <button onClick={() => go(currentOffset - 1)} onMouseEnter={hoverOn} onMouseLeave={hoverOff} style={NAV_BTN}>
        ← Prev
      </button>
      <span style={{ padding: '6px 14px', fontWeight: 600, fontSize: 13, color: 'var(--fg)', minWidth: 150, textAlign: 'center' }}>
        {label}
      </span>
      {currentOffset !== 0 && (
        <button
          onClick={() => go(0)}
          style={{
            padding: '6px 10px', borderRadius: 6,
            border: '1px solid var(--brand-blue)', background: 'var(--accent-soft)',
            color: 'var(--brand-blue)', cursor: 'pointer', fontSize: 12,
            fontWeight: 500, fontFamily: 'inherit',
          }}
        >
          This quarter
        </button>
      )}
      <button onClick={() => go(currentOffset + 1)} onMouseEnter={hoverOn} onMouseLeave={hoverOff} style={NAV_BTN}>
        Next →
      </button>
    </div>
  );
}
