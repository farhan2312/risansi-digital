import type { ReactNode } from "react";
import "./premium.css";

interface PageHeaderProps {
  /** A single emoji, shown in a gradient tile (matches the rest of the app's
   * existing emoji-as-icon convention -- 🐛/✨/🔔/⏰ elsewhere -- rather than
   * pulling in an icon library for this alone). */
  icon: string;
  title: ReactNode;
  subtitle?: ReactNode;
  /** Right-aligned action buttons/controls -- see pageHeaderButton() below
   * for the matching button styles. */
  actions?: ReactNode;
}

/** Shared page-header card -- gradient card with a soft glow, an icon tile,
 * title + subtitle, and optional right-aligned actions. Every dashboard-group
 * page renders one of these at the top instead of its own header markup. */
const PageHeader = ({ icon, title, subtitle, actions }: PageHeaderProps) => (
  <section className="hero-card hero-compact hero-card--open tw-reset mb-6">
    <div className="flex flex-wrap items-start justify-between gap-5 px-8 py-6">
      <div className="flex min-w-0 items-start gap-4">
        <span className="hero-badge" aria-hidden="true">
          {icon}
        </span>
        <div className="min-w-0">
          <h1 className="hero-title">{title}</h1>
          {subtitle && <p className="hero-subtitle">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2.5">{actions}</div>}
    </div>
  </section>
);

export default PageHeader;

/** Shared button styles for page-header actions -- pass to
 * <button className={pageHeaderButton("primary")}> or a <Link>. "primary" is
 * the lit accent call-to-action (one per header, e.g. "+ New Requisition");
 * "secondary" is for anything else (Clear Filters, Search, etc); "danger" is
 * for a destructive header action (Delete). */
export const pageHeaderButton = (variant: "primary" | "secondary" | "danger" = "secondary") => {
  if (variant === "primary") return "hero-btn";
  if (variant === "danger") return "hero-btn hero-btn--danger";
  return "hero-btn hero-btn--secondary";
};
