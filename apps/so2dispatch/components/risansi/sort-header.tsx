"use client";

import { useUrlTable } from "./url-table";

/**
 * A column header that sorts the queue by it: first click ascending (▲),
 * second descending (▼), third back to the queue's own order (↕). The sort
 * lives in the URL (\`sort\`), so the server sorts every page, not just this one.
 */
export function SortHeader({ label, sortKey }: { label: string; sortKey: string }) {
  const { get, setParams } = useUrlTable();
  const now = get("sort");
  const state = now === sortKey ? "asc" : now === `-${sortKey}` ? "desc" : null;
  return (
    <button
      type="button"
      onClick={() =>
        setParams({ sort: state === "asc" ? `-${sortKey}` : state === "desc" ? null : sortKey })
      }
      className="inline-flex items-center gap-1 uppercase tracking-wide hover:text-foreground"
      aria-label={`Sort by ${label}`}
    >
      {label}
      <span aria-hidden className="text-[10px]">
        {state === "asc" ? "▲" : state === "desc" ? "▼" : "↕"}
      </span>
    </button>
  );
}
