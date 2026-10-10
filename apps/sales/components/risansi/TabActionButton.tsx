'use client';

import { type ReactNode } from 'react';
import { useSearchParams } from 'next/navigation';

export function TabActionButton({
  repsButton,
  toursButton,
}: {
  repsButton: ReactNode;
  toursButton: ReactNode;
}) {
  const tab = useSearchParams().get('tab') === 'tours' ? 'tours' : 'reps';
  return <>{tab === 'tours' ? toursButton : repsButton}</>;
}
