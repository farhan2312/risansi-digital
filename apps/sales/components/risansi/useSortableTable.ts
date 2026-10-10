'use client';

import { useRouter, usePathname } from 'next/navigation';

// ── Hook ───────────────────────────────────────────────────────
//
// Provides sort navigation helpers for client-rendered table headers.
// The sort state (currentSort, currentDir) is passed in as props from
// the server component that parsed searchParams — this avoids the need
// for useSearchParams() and the accompanying Suspense boundary.
//
// Usage:
//   const { handleSort, sortIcon } = useSortableTable(currentSort, currentDir);

export function useSortableTable(
  currentSort: string,
  currentDir:  'asc' | 'desc',
) {
  const router   = useRouter();
  const pathname = usePathname();

  /** Navigate to a new sort. Preserves all other URL params. */
  function handleSort(col: string) {
    const params = new URLSearchParams(window.location.search);
    if (currentSort === col) {
      params.set('dir', currentDir === 'asc' ? 'desc' : 'asc');
    } else {
      params.set('sort', col);
      params.set('dir', 'asc');
    }
    params.delete('page');
    router.push(`${pathname}?${params.toString()}`);
  }

  /** Returns a sort direction indicator string (▲ / ▼ / '') */
  function sortIcon(col: string): string {
    if (currentSort !== col) return '';
    return currentDir === 'asc' ? ' ▲' : ' ▼';
  }

  function isActive(col: string): boolean {
    return currentSort === col;
  }

  return { handleSort, sortIcon, isActive };
}
