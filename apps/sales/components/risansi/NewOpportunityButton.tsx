'use client';

import { useState, type CSSProperties } from 'react';
import { NewOpportunityModal } from './NewOpportunityModal';

// Takes no session props: ownership is resolved server-side from the client's
// tour, so the modal no longer varies by who is looking at it.
export function NewOpportunityButton({ usdRate }: { usdRate?: number }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)} style={TRIGGER_BTN}>
        New Opportunity
      </button>
      <NewOpportunityModal open={open} onClose={() => setOpen(false)} usdRate={usdRate} />
    </>
  );
}

const TRIGGER_BTN: CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 16px',
  background: 'var(--accent-fill)', color: 'var(--on-accent)', border: 'none', borderRadius: 7,
  fontSize: 13, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0,
};
