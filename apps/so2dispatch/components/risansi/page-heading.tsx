"use client";

import { useSyncExternalStore } from "react";
import { createPortal } from "react-dom";

/** The top bar's slot for the page's heading (app-shell renders it). */
export const PAGE_HEADING_SLOT = "page-heading-slot";

const noop = () => () => {};

/**
 * The page's title and what it is for, shown in the top bar in place of the
 * breadcrumb — the page's content then starts at the top. Renders nothing
 * where it is placed. The description is one line; hovering shows it whole.
 */
export function PageHeading({
  icon,
  title,
  description,
  amber = false,
}: {
  icon?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  /** The icon on amber (Payment Holds) rather than the primary colour. */
  amber?: boolean;
}) {
  const slot = useSyncExternalStore(
    noop,
    () => document.getElementById(PAGE_HEADING_SLOT),
    () => null
  );
  if (!slot) return null;
  return createPortal(
    <div className="flex min-w-0 items-center gap-2.5">
      {icon && (
        <span
          className={`hidden h-8 w-8 shrink-0 items-center justify-center rounded-lg sm:flex [&_svg]:h-[18px] [&_svg]:w-[18px] ${
            amber ? "bg-amber-500 text-white" : "bg-primary text-primary-foreground"
          }`}
          aria-hidden
        >
          {icon}
        </span>
      )}
      <div className="min-w-0">
        <h1 className="truncate font-display text-[15px] font-bold leading-tight tracking-tight text-foreground">{title}</h1>
        {description && (
          <p
            className="hidden truncate text-xs leading-snug text-muted lg:block"
            onMouseEnter={(e) => {
              const el = e.currentTarget;
              if (el.scrollWidth > el.clientWidth) el.title = el.textContent ?? "";
              else el.removeAttribute("title");
            }}
          >
            {description}
          </p>
        )}
      </div>
    </div>,
    slot
  );
}
