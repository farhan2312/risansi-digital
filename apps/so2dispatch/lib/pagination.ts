/**
 * Server-side pagination helpers.
 *
 * Every list screen reads its page / search / filter state from the URL, so a
 * page is fetched with `LIMIT … OFFSET …` rather than the whole table being
 * shipped to the browser and sliced there. Search and filters therefore also
 * have to run in SQL — filtering only the rows on the current page would give
 * silently wrong answers.
 *
 * Plain module (no server imports) so both the page components and the client
 * controls can use the same parsing.
 */

export const PAGE_SIZE = 30;

/** One page of rows plus what the pager needs to render. */
export type PageResult<T> = {
  rows: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  from: number;
  to: number;
};

/** The raw query-string values a list screen understands. */
export type TableParams = {
  page?: string;
  q?: string;
  [key: string]: string | string[] | undefined;
};

/** 1-based page number, clamped to something sane. */
export function parsePage(value: string | string[] | undefined): number {
  const n = Number(Array.isArray(value) ? value[0] : value);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 1;
}

/** Trimmed free-text search term. */
export function parseQuery(value: string | string[] | undefined): string {
  const s = Array.isArray(value) ? value[0] : value;
  return (s ?? "").trim();
}

/** A comma-separated multi-select parameter (e.g. `zone=North,South`). */
export function parseList(value: string | string[] | undefined): string[] {
  const s = Array.isArray(value) ? value.join(",") : (value ?? "");
  return [...new Set(s.split(",").map((v) => v.trim()).filter(Boolean))];
}

/** A single-value parameter constrained to a known set. */
export function parseOne<T extends string>(
  value: string | string[] | undefined,
  allowed: readonly T[],
  fallback: T
): T {
  const s = Array.isArray(value) ? value[0] : value;
  return allowed.includes(s as T) ? (s as T) : fallback;
}

/**
 * Assemble a PageResult once the rows and the total are known. `page` is
 * clamped to the last page so deleting rows can't strand the user on an empty
 * page beyond the end.
 */
export function pageResult<T>(
  rows: T[],
  total: number,
  page: number,
  pageSize = PAGE_SIZE
): PageResult<T> {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const current = Math.min(Math.max(1, page), totalPages);
  return {
    rows,
    total,
    page: current,
    pageSize,
    totalPages,
    from: total === 0 ? 0 : (current - 1) * pageSize + 1,
    to: Math.min(current * pageSize, total),
  };
}

/**
 * Run a page query whose rows carry the total as `total_count` (from
 * count(*) OVER ()), asking for a separate count only when it cannot supply
 * one: an empty page past the end says nothing about how many rows exist, so
 * that case counts and re-fetches the last real page.
 *
 * The database is remote — a round trip costs far more than these queries do
 * to run — so the common case is a single trip.
 */
export async function pageWithTotal<T extends { total_count: string | number }>(
  requested: number,
  fetchPage: (page: number) => Promise<{ rows: T[] }>,
  countAll: () => Promise<number>,
  pageSize = PAGE_SIZE
): Promise<PageResult<Omit<T, "total_count">>> {
  const strip = (rows: T[]) =>
    rows.map((row) => {
      const rest: Partial<T> = { ...row };
      delete rest.total_count;
      return rest as Omit<T, "total_count">;
    });

  const page = Math.max(1, requested);
  const first = await fetchPage(page);
  if (first.rows.length > 0) {
    return pageResult(strip(first.rows), Number(first.rows[0].total_count ?? 0), page, pageSize);
  }
  if (page === 1) return pageResult([], 0, 1, pageSize);

  const total = await countAll();
  const clamped = clampPage(page, total, pageSize);
  if (clamped === page) return pageResult([], total, page, pageSize);
  const again = await fetchPage(clamped);
  return pageResult(strip(again.rows), total, clamped, pageSize);
}

/** OFFSET for a 1-based page number. */
export function offsetFor(page: number, pageSize = PAGE_SIZE): number {
  return (Math.max(1, page) - 1) * pageSize;
}

/**
 * Build an ILIKE pattern for a free-text search, escaping the LIKE wildcards
 * so a user typing `%` doesn't match everything.
 */
export function likePattern(term: string): string {
  return `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/**
 * Clamp a requested page to the last page that actually has rows. Call this
 * with the total *before* running the row query — clamping afterwards would
 * report a valid page number while the query had already skipped past the
 * end and returned nothing.
 */
export function clampPage(page: number, total: number, pageSize = PAGE_SIZE): number {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  return Math.min(Math.max(1, page), totalPages);
}
