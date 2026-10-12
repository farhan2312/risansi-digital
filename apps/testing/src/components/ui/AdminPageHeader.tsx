import type { ReactNode } from "react";

/** Flat admin page header: big title, one muted line under it, actions on the right. The admin screens
 * (Users & Access, Audit Log, Bug Tracker) share this instead of the gradient hero card. */
const AdminPageHeader = ({ title, subtitle, actions }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) => (
  <header className="tw-reset flex flex-wrap items-end justify-between gap-4">
    <div className="min-w-0">
      <h1 className="m-0 text-[28px] font-bold leading-tight tracking-tight text-text-h">{title}</h1>
      {subtitle && <p className="mt-1 text-sm text-text-muted">{subtitle}</p>}
    </div>
    {actions && <div className="flex flex-wrap items-center gap-2.5">{actions}</div>}
  </header>
);

export default AdminPageHeader;

const TONE_CLASSES = {
  default: "text-text-h",
  accent: "text-accent",
  warn: "text-warn",
  pos: "text-pos-strong",
  neg: "text-neg-strong",
} as const;

/** A plain white stat card: small uppercase label, large monospace figure, one muted line under it. */
export const StatCard = ({
  label,
  value,
  sub,
  tone = "default",
}: {
  label: string;
  value: ReactNode;
  sub?: string;
  tone?: keyof typeof TONE_CLASSES;
}) => (
  <div className="tw-reset rounded-xl border border-border bg-surface px-5 py-4 shadow-sm">
    <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-text-muted">{label}</div>
    <div className={`mt-1.5 font-mono text-[32px] font-medium leading-none tabular-nums ${TONE_CLASSES[tone]}`}>{value}</div>
    {sub && <div className="mt-1.5 text-xs text-text-muted">{sub}</div>}
  </div>
);
