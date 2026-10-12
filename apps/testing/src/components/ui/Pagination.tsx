"use client";

import { useMemo } from "react";
import "./Pagination.css";

interface PaginationProps {
  page: number;
  totalPages: number;
  total: number;
  pageSize: number;
  onPageChange: (page: number) => void;
}

/** Shared page-number control for every server-paginated list in the app
 * (25 rows/page, see src/lib/pagination.ts). Shows up to 5 numbered buttons
 * around the current page, with first/last page shortcuts once the range
 * doesn't already reach an edge. Renders nothing for a single page. */
const Pagination = ({ page, totalPages, total, pageSize, onPageChange }: PaginationProps) => {
  const pageNumbers = useMemo(() => {
    const pages: number[] = [];
    const start = Math.max(1, page - 2);
    const end = Math.min(totalPages, start + 4);
    for (let p = Math.max(1, end - 4); p <= end; p++) pages.push(p);
    return pages;
  }, [page, totalPages]);

  if (totalPages <= 1) return null;

  const rangeStart = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const rangeEnd = Math.min(page * pageSize, total);

  return (
    <div className="pagination">
      <button type="button" disabled={page === 1} onClick={() => onPageChange(page - 1)}>
        Prev
      </button>

      {pageNumbers[0] > 1 && (
        <>
          <button type="button" onClick={() => onPageChange(1)}>
            1
          </button>
          {pageNumbers[0] > 2 && <span className="pagination-ellipsis">…</span>}
        </>
      )}

      {pageNumbers.map((p) => (
        <button key={p} type="button" className={p === page ? "active" : ""} onClick={() => onPageChange(p)}>
          {p}
        </button>
      ))}

      {pageNumbers.at(-1)! < totalPages && (
        <>
          {pageNumbers.at(-1)! < totalPages - 1 && <span className="pagination-ellipsis">…</span>}
          <button type="button" onClick={() => onPageChange(totalPages)}>
            {totalPages}
          </button>
        </>
      )}

      <button type="button" disabled={page === totalPages} onClick={() => onPageChange(page + 1)}>
        Next
      </button>

      <span className="pagination-status">
        {rangeStart}–{rangeEnd} of {total}
      </span>
    </div>
  );
};

export default Pagination;
