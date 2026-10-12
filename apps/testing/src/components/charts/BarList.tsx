"use client";

import Link from "next/link";

export interface BarItem {
  key: string;
  label: string;
  value: number;
  href?: string;
  /** Extra detail shown on hover/focus (e.g. a per-status breakdown). */
  detail?: string;
}

interface BarListProps {
  items: BarItem[];
  /** One series -> one color for every bar (never a value-ramp on nominal
   * categories). Defaults to categorical slot 1. */
  color?: string;
  emptyText?: string;
}

/** Horizontal bars: <= 10px thick, 4px rounded data-end, square at the
 * baseline, value at the tip. */
const BarList = ({ items, color = "var(--series-1)", emptyText = "Nothing in this range." }: BarListProps) => {
  if (items.length === 0) return <p className="py-6 text-center text-sm text-text-muted">{emptyText}</p>;

  const max = Math.max(1, ...items.map((i) => i.value));

  return (
    <ul className="flex flex-col gap-0.5">
      {items.map((item) => {
        const pct = (item.value / max) * 100;
        const content = (
          <>
            <div className="mb-1 flex items-baseline justify-between gap-3">
              <span className="truncate text-[13px] text-text">{item.label}</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="h-2.5 min-w-0 flex-1">
                <div
                  className="h-full transition-[width] duration-500"
                  style={{ width: `${Math.max(pct, item.value > 0 ? 1.5 : 0)}%`, background: color, borderRadius: "0 4px 4px 0" }}
                />
              </div>
              <span className="w-8 flex-shrink-0 text-right text-[13px] font-semibold text-text-h" style={{ fontVariantNumeric: "tabular-nums" }}>
                {item.value}
              </span>
              {item.href && (
                <span className="w-3 flex-shrink-0 text-xs text-text-faint opacity-40 transition-all group-hover/row:translate-x-0.5 group-hover/row:text-accent group-hover/row:opacity-100" aria-hidden="true">
                  &rarr;
                </span>
              )}
            </div>
          </>
        );
        const cls = "block rounded-lg px-2.5 py-2 transition-colors";
        return (
          <li key={item.key} title={item.detail}>
            {item.href ? (
              <Link href={item.href} className={`${cls} group/row hover:bg-surface-hover focus-visible:bg-surface-hover`}>
                {content}
              </Link>
            ) : (
              <div className={cls}>{content}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
};

export default BarList;
