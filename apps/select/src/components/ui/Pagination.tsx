import { useEffect, useMemo, useState } from "react";
import "./Pagination.css";

type PaginationProps = {
  /** 1-based current page. */
  page: number;
  /** Total item count (across all pages). */
  totalItems: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  /** Optional label for the counted items ("rows", "projects", …). Default "rows". */
  itemLabel?: string;
};

/** Build a compact page list with ellipses for large sets:
 *   1 … 4 5 [6] 7 8 … 20
 * Always keeps the first + last + 3 pages around the current page. */
function buildPageWindow(current: number, totalPages: number): (number | "…")[] {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, i) => i + 1);
  }
  const pages: (number | "…")[] = [];
  const window = new Set<number>([
    1,
    totalPages,
    current - 1,
    current,
    current + 1,
  ]);
  // Pad the current-page window when near the edges so the row stays 7 wide.
  if (current <= 3) {
    window.add(2);
    window.add(3);
    window.add(4);
  }
  if (current >= totalPages - 2) {
    window.add(totalPages - 1);
    window.add(totalPages - 2);
    window.add(totalPages - 3);
  }
  const sorted = [...window].filter((p) => p >= 1 && p <= totalPages).sort((a, b) => a - b);
  let prev = 0;
  for (const p of sorted) {
    if (p - prev > 1) pages.push("…");
    pages.push(p);
    prev = p;
  }
  return pages;
}

/** Compact numeric pagination bar — Prev / page numbers / Next, with an
 * "X–Y of Z rows" counter on the left. Renders nothing if the total fits on
 * one page. */
const Pagination = ({
  page,
  totalItems,
  pageSize,
  onPageChange,
  itemLabel = "rows",
}: PaginationProps) => {
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  if (totalItems <= pageSize) return null;

  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, totalItems);

  const pages = useMemo(() => buildPageWindow(page, totalPages), [page, totalPages]);
  const go = (p: number) => {
    const bounded = Math.max(1, Math.min(totalPages, p));
    if (bounded !== page) onPageChange(bounded);
  };

  return (
    <nav className="pagination" aria-label="Pagination">
      <span className="pagination-count">
        Showing <strong>{from}</strong>–<strong>{to}</strong> of{" "}
        <strong>{totalItems}</strong> {itemLabel}
      </span>
      <div className="pagination-controls">
        <button
          type="button"
          className="pagination-btn"
          onClick={() => go(page - 1)}
          disabled={page === 1}
          aria-label="Previous page"
        >
          <ChevronLeft />
        </button>
        {pages.map((p, i) =>
          p === "…" ? (
            <span key={`e-${i}`} className="pagination-ellipsis" aria-hidden="true">
              …
            </span>
          ) : (
            <button
              key={p}
              type="button"
              className={`pagination-btn pagination-num ${p === page ? "pagination-active" : ""}`}
              onClick={() => go(p)}
              aria-current={p === page ? "page" : undefined}
              aria-label={`Page ${p}`}
            >
              {p}
            </button>
          )
        )}
        <button
          type="button"
          className="pagination-btn"
          onClick={() => go(page + 1)}
          disabled={page === totalPages}
          aria-label="Next page"
        >
          <ChevronRight />
        </button>
      </div>
    </nav>
  );
};

const ChevronLeft = () => (
  <svg viewBox="0 0 24 24" fill="none" width="14" height="14">
    <path d="m14 6-6 6 6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
const ChevronRight = () => (
  <svg viewBox="0 0 24 24" fill="none" width="14" height="14">
    <path d="m10 6 6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/** Reset a paginator's `page` to 1 whenever `resetKey` changes (e.g. when the
 * search query or tab switches so the user isn't stranded on page 5 of a
 * filtered list that now has 2 pages). */
export function usePagination(totalItems: number, resetKey: unknown, pageSize = 50) {
  const [page, setPage] = useState(1);
  useEffect(() => {
    setPage(1);
  }, [resetKey]);
  // Clamp when the underlying list shrinks (delete row) so we don't render
  // a blank page past the new end.
  useEffect(() => {
    const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
    if (page > totalPages) setPage(totalPages);
  }, [totalItems, pageSize, page]);
  const from = (page - 1) * pageSize;
  const to = from + pageSize;
  return { page, setPage, from, to, pageSize };
}

export default Pagination;
