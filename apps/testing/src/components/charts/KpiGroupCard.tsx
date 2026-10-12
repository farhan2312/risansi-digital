"use client";

import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import "./charts.css"; // .viz-root: the series colour tokens the tints come from
import "./kpiGroup.css";

export type KpiGroupIcon = "folder" | "clock" | "activity" | "check" | "timer";

export interface KpiGroupTile {
  label: string;
  value: ReactNode;
  /** Small muted line under the value ("21% of all", "All time"). */
  sub?: string;
  /** Omit for a display-only tile. */
  href?: string;
  /** Status emphasis for the value -- always paired with the label, never colour alone. */
  tone?: "critical";
  /** Shown on hover / keyboard focus: what the figure counts, with its breakdown. One line per entry. */
  hint?: string[];
}

interface KpiGroupCardProps {
  title: string;
  icon: KpiGroupIcon;
  /** Any CSS colour: tints the icon chip only. */
  tint?: string;
  tiles: KpiGroupTile[];
  /** Leave the small line under each value out (label and number only); the hover hint still carries the detail. */
  hideSub?: boolean;
}

const ICONS: Record<KpiGroupIcon, ReactNode> = {
  folder: <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />,
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  activity: <path d="M3 12h4l3-8 4 16 3-8h4" />,
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  timer: (
    <>
      <circle cx="12" cy="13" r="8" />
      <path d="M12 9v4l2.5 1.5M9 2h6" />
    </>
  ),
};

/** A compact KPI card: a small header (title + icon chip) over a row of figure tiles. */
const KpiGroupCard = ({ title, icon, tint = "var(--accent)", tiles, hideSub = false }: KpiGroupCardProps) => (
  <section className="viz-root kg-card" style={{ "--kg-tint": tint } as CSSProperties}>
    <header className="kg-head">
      <h3 className="kg-title">{title}</h3>
      <span className="kg-icon" aria-hidden="true">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          {ICONS[icon]}
        </svg>
      </span>
    </header>
    <div className="kg-tiles">
      {tiles.map((t, i) => {
        const body = (
          <>
            <span className="kg-tile-label">{t.label}</span>
            <span className={`kg-tile-value${t.tone === "critical" ? " kg-tile-value--critical" : ""}`}>{t.value}</span>
            {t.sub && !hideSub && <span className="kg-tile-sub">{t.sub}</span>}
            {t.hint && t.hint.length > 0 && (
              <span
                role="tooltip"
                className={`kg-tip pointer-events-none absolute top-full z-40 mt-2 hidden w-[250px] max-w-[80vw] flex-col gap-1 rounded-lg border border-border bg-surface px-3 py-2.5 text-left shadow-lg ${
                  i === 0 ? "left-0" : "right-0"
                }`}
              >
                <span className="text-[11px] font-bold uppercase tracking-[0.1em] text-text-muted">{t.label}</span>
                {t.hint.map((line, n) => (
                  <span key={n} className={`text-[12px] leading-snug ${n === 0 ? "font-semibold text-text-h" : "text-text-muted"}`}>
                    {line}
                  </span>
                ))}
              </span>
            )}
          </>
        );
        const tipClass = t.hint?.length ? " kg-tile--tip relative" : "";
        return t.href ? (
          <Link key={t.label} href={t.href} className={`kg-tile kg-tile--link${tipClass}`}>
            {body}
          </Link>
        ) : (
          <div key={t.label} className={`kg-tile${tipClass}`} tabIndex={t.hint?.length ? 0 : undefined}>
            {body}
          </div>
        );
      })}
    </div>
  </section>
);

export default KpiGroupCard;
