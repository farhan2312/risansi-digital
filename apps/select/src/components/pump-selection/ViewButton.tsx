"use client";

import type { ReactNode } from "react";

/**
 * For actions that only show something (a PDF), so they still work when the
 * wizard is view only: its disabled <fieldset> turns off every real <button>
 * inside it, but not this. Style "not available" with [aria-disabled="true"].
 */
export default function ViewButton({
  disabled = false,
  onClick,
  className,
  title,
  children,
}: {
  disabled?: boolean;
  onClick: () => void;
  className?: string;
  title?: string;
  children: ReactNode;
}) {
  return (
    <span
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-disabled={disabled}
      className={className}
      title={title}
      onClick={() => !disabled && onClick()}
      onKeyDown={(e) => {
        if (disabled || (e.key !== "Enter" && e.key !== " ")) return;
        e.preventDefault();
        onClick();
      }}
    >
      {children}
    </span>
  );
}
