'use client';

import { useRouter, usePathname } from 'next/navigation';

// ── Types ──────────────────────────────────────────────────────

export interface FilterDef {
  param:    string;   // URL search param key
  label:    string;   // Human-readable label for the pill prefix
  values:   string[]; // Currently selected values (server-parsed)
  // Serializable value→label map (a function can't cross the server→client boundary).
  // The raw value is still used for removal; only the pill text uses the label.
  valueLabels?: Record<string, string>;
}

interface Props {
  filters: FilterDef[];
}

// ── Component ──────────────────────────────────────────────────

export function ActiveFilterBar({ filters }: Props) {
  const router   = useRouter();
  const pathname = usePathname();

  // Flatten all active (param, value) pairs into pills. `value` stays raw (used for
  // removal); `display` is the friendly label shown to the user.
  const pills: { param: string; filterLabel: string; value: string; display: string }[] = [];
  for (const { param, label, values, valueLabels } of filters) {
    for (const value of values) {
      pills.push({ param, filterLabel: label, value, display: valueLabels?.[value] ?? value });
    }
  }

  if (pills.length === 0) return null;

  function removePill(param: string, value: string) {
    const params = new URLSearchParams(window.location.search);
    const current = (params.get(param) ?? '').split(',').filter(Boolean);
    const next    = current.filter(v => v !== value);
    if (next.length === 0) {
      params.delete(param);
    } else {
      params.set(param, next.join(','));
    }
    params.delete('page');
    router.push(`${pathname}?${params.toString()}`);
  }

  function clearAll() {
    const params = new URLSearchParams(window.location.search);
    for (const { param } of filters) params.delete(param);
    params.delete('page');
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <div style={{
      display:    'flex',
      flexWrap:   'wrap',
      gap:        6,
      alignItems: 'center',
      marginTop:  6,
      marginBottom: 4,
    }}>
      <span style={{
        fontSize:       10,
        color:          'var(--fg-3)',
        fontWeight:     700,
        textTransform:  'uppercase',
        letterSpacing:  '0.08em',
        marginRight:    2,
      }}>
        Filters:
      </span>

      {pills.map(({ param, filterLabel, value, display }) => (
        <span
          key={`${param}:${value}`}
          className="r-pill"
          style={{
            display:    'inline-flex',
            alignItems: 'center',
            gap:        4,
            padding:    '2px 8px',
            borderRadius: 12,
            fontSize:   11,
            background: 'var(--accent-soft)',
            color:      'var(--title)',
            border:     '1px solid var(--accent-line)',
          }}
        >
          <span style={{ fontSize: 10, opacity: 0.7 }}>{filterLabel}:</span>
          {display}
          <button
            type="button"
            className="r-pill-x"
            onClick={() => removePill(param, value)}
            aria-label={`Remove ${filterLabel} ${display} filter`}
            style={{
              background:  'none',
              border:      'none',
              cursor:      'pointer',
              color:       'var(--title)',
              padding:     0,
              marginLeft:  2,
              fontSize:    13,
              lineHeight:  1,
              display:     'flex',
              alignItems:  'center',
            }}
          >
            ×
          </button>
        </span>
      ))}

      <button
        type="button"
        className="r-tap"
        onClick={clearAll}
        style={{
          padding:      '2px 10px',
          fontSize:     11,
          cursor:       'pointer',
          background:   'none',
          border:       '1px solid var(--line-strong)',
          color:        'var(--fg-3)',
          borderRadius: 12,
          fontFamily:   'inherit',
        }}
      >
        Clear all
      </button>
    </div>
  );
}
