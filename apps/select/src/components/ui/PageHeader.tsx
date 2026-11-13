"use client";

import type { ReactNode } from "react";
import { usePageTitle } from "../layout/PageTitle";

/**
 * The list pages' header (Enquiries, Reports, Approvals, Client Prices…). The title and
 * subtitle go to the top bar (user, 2026-11-13: frees the page's space); what stays on
 * the page is the footer strip (filters, stats) with the actions beside it, or just the
 * actions. `icon` is kept for the callers; it is no longer drawn.
 */
export default function PageHeader({
  title,
  subtitle,
  actions,
  children,
}: {
  icon?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  usePageTitle(title, subtitle);
  if (!actions && !children) return null;
  if (!children) return <div className="flex flex-wrap items-center justify-end gap-2">{actions}</div>;
  return (
    <div className="rounded-xl border border-line bg-paper">
      <div className="flex flex-wrap items-start gap-3 px-4 py-3">
        <div className="min-w-0 flex-1">{children}</div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}
