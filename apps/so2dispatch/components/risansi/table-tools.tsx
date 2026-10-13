"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";

/**
 * Pager for the views that still hold their whole row set: the department
 * dashboards, whose figures aggregate every row. Every other list — the central
 * dashboard's pipeline included — pages in SQL; see url-table.tsx.
 */
export function Pagination({
  page,
  totalPages,
  setPage,
  from,
  to,
  total,
}: {
  page: number;
  totalPages: number;
  setPage: (page: number) => void;
  from: number;
  to: number;
  total: number;
}) {
  if (total === 0) return null;

  const stepClass =
    "inline-flex h-8 w-8 items-center justify-center rounded-lg border border-input-border text-foreground transition-colors hover:bg-background disabled:cursor-not-allowed disabled:opacity-50";

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-card-border px-4 py-3 text-sm text-muted">
      <span>
        Showing {from}–{to} of {total}
      </span>
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => setPage(page - 1)}
          disabled={page <= 1}
          aria-label="Previous page"
          className={stepClass}
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        {pageNumbers(page, totalPages).map((p, i) =>
          p === "…" ? (
            <span key={`e${i}`} className="px-1 text-muted-foreground">
              …
            </span>
          ) : (
            <button
              key={p}
              type="button"
              onClick={() => setPage(p)}
              aria-current={p === page ? "page" : undefined}
              className={`inline-flex h-8 min-w-8 items-center justify-center rounded-lg px-2 text-xs font-medium transition-colors ${
                p === page
                  ? "bg-primary text-primary-foreground"
                  : "border border-input-border text-foreground hover:bg-background"
              }`}
            >
              {p}
            </button>
          )
        )}
        <button
          type="button"
          onClick={() => setPage(page + 1)}
          disabled={page >= totalPages}
          aria-label="Next page"
          className={stepClass}
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

/** Page numbers with ellipsis for large page counts. */
function pageNumbers(page: number, totalPages: number): (number | "…")[] {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, i) => i + 1);
  }
  const pages: (number | "…")[] = [1];
  if (page > 3) pages.push("…");
  const start = Math.max(2, page - 1);
  const end = Math.min(totalPages - 1, page + 1);
  for (let i = start; i <= end; i++) pages.push(i);
  if (page < totalPages - 2) pages.push("…");
  pages.push(totalPages);
  return pages;
}
