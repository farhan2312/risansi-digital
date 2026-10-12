import "./Skeleton.css";

interface SkeletonProps {
  width?: number | string;
  height?: number | string;
  className?: string;
  style?: React.CSSProperties;
}

/** Shimmering placeholder block -- the base primitive every other skeleton
 * piece on this page is built from. Purely decorative (aria-hidden), since
 * the loading state itself is already announced by the surrounding page. */
export const Skeleton = ({ width, height, className = "", style }: SkeletonProps) => (
  <span
    className={`skeleton ${className}`}
    style={{ width, height, ...style }}
    aria-hidden="true"
  />
);

/** A handful of shimmering text-line widths, so a paragraph of skeleton
 * lines doesn't look like a perfectly even brick of placeholders. */
const LINE_WIDTHS = ["92%", "78%", "85%", "65%", "90%"];

export const SkeletonText = ({ lines = 1, className = "" }: { lines?: number; className?: string }) => (
  <>
    {Array.from({ length: lines }).map((_, i) => (
      <Skeleton key={i} className={`skeleton-text ${className}`} width={LINE_WIDTHS[i % LINE_WIDTHS.length]} />
    ))}
  </>
);

/** Drop-in <tbody> replacement for a loading table -- keeps the real
 * <table>/<thead> visible (column headers don't jump once real rows land)
 * and fills in `rows` placeholder rows across `columns` cells each.
 * `cellClassName` is for Tailwind-styled tables (e.g. Users & Access) whose
 * <td> padding comes from a utility class rather than a plain-CSS `td`
 * element selector -- leave it unset on those and the row still lines up. */
export const SkeletonTableRows = ({
  rows = 6,
  columns,
  cellClassName,
}: {
  rows?: number;
  columns: number;
  cellClassName?: string;
}) => (
  <>
    {Array.from({ length: rows }).map((_, r) => (
      <tr key={r}>
        {Array.from({ length: columns }).map((_, c) => (
          <td key={c} className={cellClassName}>
            <Skeleton className="skeleton-table-cell" style={{ width: `${55 + ((r + c) % 4) * 10}%` }} />
          </td>
        ))}
      </tr>
    ))}
  </>
);

/** Matches the app's common 4-tile KPI stat-row layout (Users & Access,
 * Audit Log, etc.) so a page's header doesn't collapse to nothing while
 * its real counts load. */
export const SkeletonStatTiles = ({ count = 4 }: { count?: number }) => (
  <div className="skeleton-stats" aria-hidden="true">
    {Array.from({ length: count }).map((_, i) => (
      <div key={i} className="skeleton-stat">
        <Skeleton height={28} width="50%" />
        <Skeleton height={11} width="75%" />
      </div>
    ))}
  </div>
);

/** A generic shimmering card -- for single-record detail/form pages
 * (Report Detail, Requisition Detail, etc.) that don't have a table to
 * skeleton, just a handful of stacked fields. */
export const SkeletonCard = ({ lines = 4 }: { lines?: number }) => (
  <div className="skeleton-card" aria-hidden="true">
    <Skeleton height={20} width="40%" />
    <SkeletonText lines={lines} />
  </div>
);

/** Whole-page placeholder for screens that currently early-return a bare
 * "Loading..." line before their one record has arrived (Report Detail,
 * Requisition Detail, Edit Report, the Fill Test Report forms, etc.) -- a
 * page title bar plus a couple of stacked field cards, roughly matching
 * the shape those pages settle into once real data lands. */
export const SkeletonPage = ({ cards = 2 }: { cards?: number }) => (
  <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 16 }} aria-hidden="true">
    <Skeleton height={26} width="30%" />
    {Array.from({ length: cards }).map((_, i) => (
      <SkeletonCard key={i} lines={3} />
    ))}
  </div>
);
