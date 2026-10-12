"use client";

import ChartCard from "@/components/charts/ChartCard";
import "@/components/ui/premium.css";
import { avatarColor } from "@/lib/avatar";
import { personInitials, ROLE_LABELS } from "./auditFormat";
import { auditIcons } from "./auditIcons";
import type { AuditLeader } from "@/types/testing";

interface LeaderboardProps {
  title: string;
  subtitle: string;
  leaders: AuditLeader[];
  /** Renders the headline figure ("2h 30m", "31"). */
  formatValue: (value: number) => string;
  /** What the share % is a share of ("of all session time"). */
  shareOf: string;
  /** Column header for the value in the table view. */
  valueLabel: string;
  emptyText: string;
}

/** A top-3 podium: medal, person, headline figure, and a bar showing how each
 * place compares with the leader. */
const Leaderboard = ({ title, subtitle, leaders, formatValue, shareOf, valueLabel, emptyText }: LeaderboardProps) => {
  const top = Math.max(1, ...leaders.map((l) => l.value));

  return (
    <ChartCard
      variant="panel"
      icon={auditIcons.trophy()}
      title={title}
      subtitle={subtitle}
      table={{
        columns: ["Rank", "User", valueLabel, "Share"],
        rows: leaders.map((l) => [l.rank, l.email ?? l.name ?? "Unknown", formatValue(l.value), `${l.share_pct}%`]),
      }}
    >
      {leaders.length === 0 ? (
        <p className="py-8 text-center text-sm text-text-muted">{emptyText}</p>
      ) : (
        <ol className="flex flex-col gap-2">
          {leaders.map((l) => (
            <li key={l.user_id} className={`rounded-xl px-3 py-3 ${l.rank === 1 ? "bg-accent-soft" : ""}`}>
              <div className="flex items-center gap-3">
                <span className={`medal medal--${l.rank}`} aria-label={`Rank ${l.rank}`}>
                  {l.rank}
                </span>
                <span
                  className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white"
                  style={{ background: avatarColor(l.email ?? l.name ?? l.user_id) }}
                  aria-hidden="true"
                >
                  {personInitials(l.name, l.email)}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold text-text-h" title={l.email ?? l.name ?? ""}>
                    {l.email ?? l.name ?? "Unknown user"}
                  </div>
                  <div className="truncate text-xs text-text-muted">
                    {l.role ? (ROLE_LABELS[l.role] ?? l.role) : "Removed user"} · {l.share_pct}% {shareOf}
                  </div>
                </div>
                <div className="text-right font-mono text-[17px] font-semibold leading-none text-text-h" style={{ fontVariantNumeric: "tabular-nums" }}>
                  {formatValue(l.value)}
                </div>
              </div>
              <div className="ml-[46px] mt-2.5 h-1.5 rounded-full bg-bg-sunk" aria-hidden="true">
                <div className="h-full rounded-full" style={{ width: `${Math.max(3, (l.value / top) * 100)}%`, background: "var(--series-1)" }} />
              </div>
            </li>
          ))}
        </ol>
      )}
    </ChartCard>
  );
};

export default Leaderboard;
