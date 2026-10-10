'use client';

import { useEffect, useState } from 'react';

/**
 * The competitor master list, for the "Lost to competitor" pickers.
 *
 * A hook rather than a prop, because the prop version shipped broken twice. It
 * was optional with a `= []` default, so a render site that forgot it produced a
 * dropdown holding only the four generic fallbacks — Price, OEM Tied, Budget
 * Cancelled, Other — and no actual competitor. TypeScript is happy either way,
 * and the failure looks like a data problem rather than a missing prop, so it
 * survived a fix: the edit drawer is rendered from the kanban AND from the
 * active-opportunities table, and only the first was given the list.
 *
 * Fetching where the list is used means there is nothing left to forget.
 */
export function useCompetitors(): string[] {
  const [names, setNames] = useState<string[]>([]);

  useEffect(() => {
    let alive = true;
    fetch('/api/risansi/competitors')
      .then(r => (r.ok ? r.json() : []))
      .then((rows: { name?: string }[] | string[]) => {
        if (!alive) return;
        // The route returns rows; older callers passed plain strings.
        setNames(rows.map(r => (typeof r === 'string' ? r : r.name ?? '')).filter(Boolean));
      })
      .catch(() => { /* the fallbacks below still give somewhere to record it */ });
    return () => { alive = false; };
  }, []);

  return names;
}
