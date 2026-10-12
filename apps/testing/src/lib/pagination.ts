/** Shared server-side pagination convention: fixed 25 rows/page across every
 * list endpoint that supports it (not client-configurable -- keeps every
 * list's page size predictable). `page` is 1-based; an invalid/missing
 * value falls back to page 1 rather than erroring, since a stale bookmark
 * or a manually-edited URL shouldn't break the page. */
export const PAGE_SIZE = 25;

export function parsePage(req: Request): number {
  const raw = new URL(req.url).searchParams.get("page");
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : 1;
}

export function offsetFor(page: number): number {
  return (page - 1) * PAGE_SIZE;
}
