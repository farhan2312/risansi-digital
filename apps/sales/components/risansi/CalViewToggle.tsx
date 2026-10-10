'use client';

import { useRouter, usePathname, useSearchParams } from 'next/navigation';

// Week | Month | Quarter switch for the Field Activity calendar. Writes `cal` and
// clears the per-view navigation offsets (week / month / q) so switching views
// always lands on "today", not a stale offset from another view.

type CalView = 'week' | 'month' | 'quarter';
const VIEWS: { key: CalView; label: string }[] = [
  { key: 'week',    label: 'Week' },
  { key: 'month',   label: 'Month' },
  { key: 'quarter', label: 'Quarter' },
];

export function CalViewToggle({ current }: { current: CalView }) {
  const router       = useRouter();
  const pathname     = usePathname();
  const searchParams = useSearchParams();

  const go = (view: CalView) => {
    if (view === current) return;
    const params = new URLSearchParams(searchParams.toString());
    params.set('tab', 'calendar');
    params.set('cal', view);
    params.delete('week');
    params.delete('month');
    params.delete('q');
    router.push(`${pathname}?${params.toString()}`);
  };

  return (
    <div style={{
      display: 'inline-flex', border: '1px solid var(--line-strong)',
      borderRadius: 7, overflow: 'hidden', background: 'var(--bg-paper)',
    }}>
      {VIEWS.map((v, i) => {
        const active = v.key === current;
        return (
          <button
            key={v.key}
            onClick={() => go(v.key)}
            style={{
              padding: '6px 14px', fontSize: 13, fontFamily: 'inherit', cursor: active ? 'default' : 'pointer',
              border: 'none', borderLeft: i === 0 ? 'none' : '1px solid var(--line)',
              background: active ? 'var(--brand-blue)' : 'transparent',
              color: active ? '#fff' : 'var(--fg-2)',
              fontWeight: active ? 600 : 500,
            }}
          >
            {v.label}
          </button>
        );
      })}
    </div>
  );
}
