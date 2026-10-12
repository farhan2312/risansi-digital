import "./Skeleton.css";

type SkeletonProps = {
  width?: number | string;
  height?: number | string;
  /** Rounded pill shape (e.g. for a chip/badge placeholder). */
  pill?: boolean;
  /** Circular (e.g. avatar). If true, width is also used as height. */
  circle?: boolean;
  className?: string;
};

/** Shimmering placeholder rectangle — pairs with the shimmer keyframes in
 * index.css. Use one per real element (text line, badge, avatar) so the
 * loading layout mirrors the loaded layout. */
export const Skeleton = ({
  width = "100%",
  height = 12,
  pill = false,
  circle = false,
  className = "",
}: SkeletonProps) => (
  <span
    className={`skeleton ${pill ? "skeleton-pill" : ""} ${circle ? "skeleton-circle" : ""} ${className}`}
    style={{
      width: typeof width === "number" ? `${width}px` : width,
      height: typeof height === "number" ? `${height}px` : height,
    }}
    aria-hidden="true"
  />
);

/** N stacked text-line skeletons of gently varying widths — for paragraphs
 * or list items. */
export const SkeletonLines = ({ count = 3 }: { count?: number }) => {
  const widths = ["92%", "86%", "78%", "94%", "82%"];
  return (
    <div className="skeleton-lines">
      {Array.from({ length: count }).map((_, i) => (
        <Skeleton key={i} width={widths[i % widths.length]} height={11} />
      ))}
    </div>
  );
};

/** N skeleton rows sized like a data-table row — bar per column. */
export const SkeletonRows = ({ rows = 5, cols = 4 }: { rows?: number; cols?: number }) => (
  <div className="skeleton-rows">
    {Array.from({ length: rows }).map((_, r) => (
      <div className="skeleton-row" key={r}>
        {Array.from({ length: cols }).map((_, c) => (
          <Skeleton
            key={c}
            height={12}
            width={c === 0 ? "18%" : c === cols - 1 ? "14%" : "22%"}
          />
        ))}
      </div>
    ))}
  </div>
);

export default Skeleton;
