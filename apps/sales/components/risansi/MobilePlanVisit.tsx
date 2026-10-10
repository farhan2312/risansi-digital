'use client';

import type { CSSProperties } from 'react';
import AssignVisitDrawer, { OPEN_VISIT_DRAWER, type DrawerRep } from './AssignVisitDrawer';
import { PLAN_VISIT_LABEL } from '@/lib/risansi-utils';

// Plan a visit from the phone. The same drawer as Field Activity, so the same
// rules: a rep books only themselves, a manager themselves or their team,
// an admin anyone — and the server refuses anyone who does not work the
// client. mobile.css already makes the drawer full-screen; this only gives
// it a button that fits the phone's card column.
export function MobilePlanVisit({ reps, role, repId, currentUserName }: {
  reps: DrawerRep[]; role?: string; repId?: string | number | null; currentUserName?: string;
}) {
  return (
    <>
      <button type="button" style={BTN}
        onClick={() => window.dispatchEvent(new CustomEvent(OPEN_VISIT_DRAWER, { detail: {} }))}>
        📅 {PLAN_VISIT_LABEL}
      </button>
      <AssignVisitDrawer reps={reps} hideButton role={role} repId={repId} currentUserName={currentUserName} />
    </>
  );
}

const BTN: CSSProperties = {
  display: 'block', width: '100%', padding: '12px', fontSize: 13, fontWeight: 600, fontFamily: 'inherit',
  background: 'var(--accent-fill)', color: 'var(--on-accent)', border: 'none', borderRadius: 10, cursor: 'pointer',
};
