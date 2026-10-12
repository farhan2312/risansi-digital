"use client";

import type { ReactNode } from "react";

/**
 * Soft-glow header card used across the list pages (Enquiries, Reports,
 * Approvals, Dashboard): icon badge + title + subtitle on the left, actions on
 * the right, optional footer strip (filters, stats) under a hairline.
 */
export default function PageHeader({
  icon,
  title,
  subtitle,
  actions,
  children,
}: {
  icon: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-line bg-paper">
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(900px 220px at 0% 0%, color-mix(in srgb, var(--brand-blue) 12%, transparent), transparent 70%), radial-gradient(600px 220px at 100% 0%, color-mix(in srgb, var(--brand-cyan) 11%, transparent), transparent 70%)",
        }}
      />
      <div className="relative flex flex-wrap items-center justify-between gap-4 px-5 py-5">
        <div className="flex min-w-0 items-center gap-3.5">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[var(--brand-blue)] to-[var(--brand-cyan)] text-white shadow-[0_6px_18px_color-mix(in_srgb,var(--brand-blue)_32%,transparent)] [&_svg]:h-5 [&_svg]:w-5">
            {icon}
          </span>
          <div className="min-w-0">
            <h1 className="text-[22px] leading-tight font-bold text-fg">{title}</h1>
            {subtitle && <p className="mt-0.5 text-[13px] text-fg-3">{subtitle}</p>}
          </div>
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children && <div className="relative border-t border-line px-5 py-3">{children}</div>}
    </div>
  );
}
