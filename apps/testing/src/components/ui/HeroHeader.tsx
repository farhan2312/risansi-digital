import type { CSSProperties, ReactNode } from "react";
import "./premium.css";

interface HeroHeaderProps {
  /** A single emoji, shown in a gradient tile. Omit for a text-only hero. */
  icon?: string;
  /** Small uppercase line above the title ("Admin · Security", a date). */
  eyebrow?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  /** Right-aligned actions -- use className="hero-btn" for the primary one. */
  actions?: ReactNode;
  /** Rendered in a frosted band under the title (filters, a stat strip). */
  children?: ReactNode;
  /** Tighter padding and title, for dashboards where the page content is the point. */
  dense?: boolean;
}

/** The premium page header: gradient card with glow, optional icon tile,
 * eyebrow / title / subtitle, actions, and a footer band. */
const HeroHeader = ({ icon, eyebrow, title, subtitle, actions, children, dense = false }: HeroHeaderProps) => (
  <section className={dense ? "hero-card hero-dense" : "hero-card"}>
    <div className={`flex flex-wrap justify-between gap-5 ${dense ? "items-center px-6 py-4" : "items-start px-9 py-8"}`}>
      <div className="flex min-w-0 items-start gap-5">
        {icon && (
          <span className="hero-badge" aria-hidden="true">
            {icon}
          </span>
        )}
        <div className="min-w-0">
          {eyebrow && <div className="hero-eyebrow">{eyebrow}</div>}
          <h1 className="hero-title">{title}</h1>
          {subtitle && <p className="hero-subtitle">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2.5">{actions}</div>}
    </div>
    {children && <div className="hero-footer">{children}</div>}
  </section>
);

export default HeroHeader;

/** One figure in a HeroHeader's stat strip: tinted icon chip, label, value. */
export const HeroStat = ({
  icon,
  label,
  chip,
  value,
  tint,
  critical = false,
}: {
  icon: string;
  label: string;
  /** Small pill after the label ("24H"). */
  chip?: string;
  value: ReactNode;
  /** Any CSS color for the icon chip's tint. */
  tint?: string;
  critical?: boolean;
}) => (
  <div className="flex items-center gap-4 px-9 py-5">
    <span className="hero-stat-chip" style={{ "--stat-tint": critical ? "var(--neg)" : (tint ?? "var(--accent)") } as CSSProperties} aria-hidden="true">
      {icon}
    </span>
    <div>
      <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-text-muted">
        {label}
        {chip && <span className="rounded-md bg-bg-sunk px-1.5 py-px text-[10px] font-bold tracking-normal text-text-muted">{chip}</span>}
      </div>
      <div className="hero-stat-value" style={critical ? { color: "var(--neg)" } : undefined}>
        {value}
      </div>
    </div>
  </div>
);
