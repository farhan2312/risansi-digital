'use client';

import dynamic from 'next/dynamic';
import type { MapClient } from './IndiaMap';

const IndiaMap = dynamic(
  () => import('./IndiaMap').then(m => ({ default: m.IndiaMap })),
  {
    ssr: false,
    loading: () => (
      <div style={{
        height: 520, display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'var(--bg-elev)', borderRadius: 8,
        color: 'var(--fg-3)', fontSize: 13,
      }}>
        Loading map…
      </div>
    ),
  },
);

export function IndiaMapWrapper({ clients }: { clients: MapClient[] }) {
  return <IndiaMap clients={clients} />;
}
