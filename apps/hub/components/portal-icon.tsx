/**
 * The tile icons, keyed by `identity.apps.slug`.
 *
 * The four paths are lifted from the static index.html, where they were
 * hardcoded one per `<a class="card">` block. The grid is rendered from the
 * database now, so the icon has to be looked up rather than written inline —
 * and this is the single place that mapping lives. Adding a fifth application
 * is a row in `identity.apps` plus an entry here; until the entry exists it
 * gets the generic mark below rather than an empty square.
 *
 * Sizing, colour and stroke all come from `.card-icon svg` in the stylesheet,
 * so nothing here sets a dimension or a colour.
 */

import type { ReactElement } from 'react';

const SHARED = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
};

const ICONS: Record<string, ReactElement> = {
  /* Sales — a rising trend line. */
  sales: (
    <svg {...SHARED}>
      <path d="M3 17l6-6 4 4 8-8" />
      <path d="M21 7v6h-6" />
    </svg>
  ),
  /* Pump Selection — a dial with a duty curve under it. */
  select: (
    <svg {...SHARED}>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 12l3.5-3.5" />
      <path d="M8.5 15.5a4.95 4.95 0 0 1 7 0" />
    </svg>
  ),
  /* Testing — a flask. */
  testing: (
    <svg {...SHARED}>
      <path d="M9 3h6" />
      <path d="M10 3v6.3L5.2 17a3 3 0 0 0 2.6 4.5h8.4a3 3 0 0 0 2.6-4.5L14 9.3V3" />
      <path d="M7.5 14h9" />
    </svg>
  ),
  /* SO to Dispatch — a lorry. */
  so2dispatch: (
    <svg {...SHARED}>
      <path d="M1 8h13v9H1z" />
      <path d="M14 11h4l3 3v3h-7" />
      <circle cx="5.5" cy="19" r="1.8" />
      <circle cx="17.5" cy="19" r="1.8" />
    </svg>
  ),
};

/** An application added to the database before it is added to this file. */
const FALLBACK: ReactElement = (
  <svg {...SHARED}>
    <rect x="3.5" y="3.5" width="17" height="17" rx="3" />
    <path d="M8 12h8" />
    <path d="M12 8v8" />
  </svg>
);

export function PortalIcon({ slug }: { slug: string }) {
  return <span className="card-icon" aria-hidden="true">{ICONS[slug] ?? FALLBACK}</span>;
}
