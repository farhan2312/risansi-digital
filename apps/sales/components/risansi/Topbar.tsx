'use client';

import { useState, useEffect } from 'react';
import { ChevronRight, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ReportBugButton } from '@/components/risansi/ReportBugButton';
import { NotificationBell } from '@/components/risansi/NotificationBell';

// Honest "synced" label: data is fetched when the page renders, so this counts
// up from mount instead of claiming a fixed "2s ago" forever.
function LiveIndicator() {
  // Tick every 30s, not every second — this re-renders the whole top bar, and
  // the exact second on a "synced Ns ago" label isn't meaningful.
  const [secs, setSecs] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setSecs(s => s + 30), 30_000);
    return () => clearInterval(t);
  }, []);
  const ago = secs < 5 ? 'just now'
    : secs < 60 ? `${secs}s ago`
    : secs < 3600 ? `${Math.floor(secs / 60)}m ago`
    : `${Math.floor(secs / 3600)}h ago`;
  return <span className="mono text-[11px]">Live · synced {ago}</span>;
}

export type Crumb = string | { label: string; href: string };

export interface TopbarProps {
  crumbs: Crumb[];
  primaryAction?: string;
  primaryActionHref?: string;
}

export function Topbar({ crumbs, primaryAction, primaryActionHref }: TopbarProps) {
  return (
    <header className="risansi-topbar flex h-[52px] flex-shrink-0 items-center gap-3 border-b border-[var(--line)] bg-[var(--bg-paper)] px-6">
      {/* Breadcrumbs */}
      <nav className="flex items-center gap-1.5 text-[13px] text-[var(--fg-3)]">
        {crumbs.map((c, i) => {
          const label = typeof c === 'string' ? c : c.label;
          const href = typeof c === 'string' ? undefined : c.href;
          const isLast = i === crumbs.length - 1;
          return (
            <span key={i} className="flex items-center gap-1.5">
              {i > 0 && <ChevronRight size={12} className="text-[var(--fg-4)]" />}
              {isLast ? (
                <strong className="font-semibold text-[var(--brand-blue)]">{label}</strong>
              ) : href ? (
                <a href={href} className="text-[var(--fg-3)] no-underline hover:text-[var(--fg-2)]">
                  {label}
                </a>
              ) : (
                <span className="text-[var(--fg-3)]">{label}</span>
              )}
            </span>
          );
        })}
      </nav>

      {/* Live indicator — pushed right */}
      <div className="risansi-live ml-auto flex items-center gap-1.5 text-xs text-[var(--pos)]">
        <span className="live-dot" />
        <LiveIndicator />
      </div>

      {/* Report a bug — available from the title bar on every page */}
      <ReportBugButton />

      {/* Notifications — the live in-app feed (migration 0047 + risansi-inapp). */}
      <NotificationBell />

      {/* Primary action */}
      {primaryAction && primaryActionHref && (
        <Button asChild size="sm">
          <a href={primaryActionHref}>
            <Plus />
            {primaryAction}
          </a>
        </Button>
      )}
      {primaryAction && !primaryActionHref && (
        <Button size="sm">
          <Plus />
          {primaryAction}
        </Button>
      )}
    </header>
  );
}
