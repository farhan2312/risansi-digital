'use client';

import AssignVisitDrawer from './AssignVisitDrawer';
import type { DrawerRep } from './AssignVisitDrawer';

// Thin client island — the drawer manages its own open/close state
// and renders its own trigger button.
export function AssignVisitButton({ reps, repId, role, currentUserName }: {
  reps: DrawerRep[];
  repId?: string | number | null;
  role?: string;
  currentUserName?: string;
}) {
  return <AssignVisitDrawer reps={reps} repId={repId} role={role} currentUserName={currentUserName} />;
}
