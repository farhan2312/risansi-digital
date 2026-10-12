"use client";

/** Shared building blocks for the Audit Log page (Tailwind). */
import type { ReactNode } from "react";

import { parseUserAgent } from "../../../lib/user-agent";

export const ROLE_LABELS: Record<string, string> = {
  system_admin: "System Admin",
  admin: "Admin",
  selection_head: "Selection Head",
  pulley_owner: "Pulley Owner",
  user: "User",
};
export const prettyRole = (role: string | null | undefined): string =>
  role ? ROLE_LABELS[role] ?? role : "—";

/** master.create/update/delete read as what happened to the master row. */
const MASTER_ACTIONS: Record<string, string> = {
  "end_connection.add": "End connection added",
  "flange_standard.add": "Flange standard added",
  "commercial.update": "Commercial prices updated",
  "product_pump.add": "Pump product code added",
  "quotation.create": "Quotation created",
  "quotation.tsm_change": "Quotation TSM changed",
  "quotation.internal_version": "Quotation internal version",
  "quotation.send": "Quotation sent to client",
  "master.create": "Master added",
  "master.update": "Master edited",
  "master.delete": "Master deleted",
  "user.request": "Access requested",
  "user.approve": "Approved request",
  "user.reject": "Rejected request",
  "user.create": "User added",
  "user.delete": "User deleted",
};

/** "user.role_change" -> "Role change" */
export const prettyAction = (action: string): string => {
  if (MASTER_ACTIONS[action]) return MASTER_ACTIONS[action];
  const tail = action.includes(".") ? action.slice(action.indexOf(".") + 1) : action;
  const words = tail.replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
};

export const fmtWhen = (iso: string | null | undefined): string => {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
};

/** "5m ago", "3h ago", "2d ago" */
export const fmtAgo = (iso: string | null | undefined): string => {
  if (!iso) return "";
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
};

// --- Cards -----------------------------------------------------------------------

export function Card({
  title,
  subtitle,
  icon,
  action,
  children,
  className = "",
  bodyClassName = "p-4",
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  icon?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={`min-w-0 overflow-hidden rounded-xl border border-line bg-paper ${className}`}>
      {(title || action) && (
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
          <div className="flex min-w-0 items-center gap-2.5">
            {icon && (
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-accent-soft text-accent">
                {icon}
              </span>
            )}
            <div className="min-w-0">
              <h3 className="truncate text-[13.5px] font-semibold text-fg">{title}</h3>
              {subtitle && <p className="truncate text-[11.5px] text-fg-3">{subtitle}</p>}
            </div>
          </div>
          {action}
        </header>
      )}
      <div className={bodyClassName}>{children}</div>
    </section>
  );
}

/** A compact segmented control. */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  loading = false,
}: {
  value: T;
  options: { key: T; label: string }[];
  onChange: (v: T) => void;
  /** Shows a spinner on the active option and blocks switching while its data loads. */
  loading?: boolean;
}) {
  return (
    <div className="inline-flex rounded-lg bg-sunk p-0.5" aria-busy={loading || undefined}>
      {options.map((o) => (
        <button
          key={o.key}
          type="button"
          disabled={loading}
          onClick={() => onChange(o.key)}
          className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[12px] font-medium whitespace-nowrap transition-colors disabled:cursor-wait ${
            value === o.key ? "bg-paper text-fg shadow-[0_1px_2px_rgba(10,22,40,0.12)]" : "text-fg-3 hover:text-fg"
          }`}
        >
          {loading && value === o.key && (
            <span
              aria-hidden="true"
              className="h-3 w-3 animate-spin rounded-full border-[1.5px] border-current border-t-transparent"
            />
          )}
          {o.label}
        </button>
      ))}
    </div>
  );
}

// --- People -----------------------------------------------------------------------------

const AVATAR_HUES = [212, 190, 160, 262, 330, 28, 142, 0];

export function Avatar({ email, size = 28 }: { email: string | null | undefined; size?: number }) {
  const name = (email ?? "?").split("@")[0] ?? "?";
  const parts = name.split(/[._-]+/).filter(Boolean);
  const initials = ((parts[0]?.[0] ?? "?") + (parts[1]?.[0] ?? "")).toUpperCase();
  let h = 0;
  for (const ch of email ?? "") h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const hue = AVATAR_HUES[h % AVATAR_HUES.length];
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.38,
        background: `linear-gradient(135deg, hsl(${hue} 70% 52%), hsl(${(hue! + 30) % 360} 70% 42%))`,
      }}
      aria-hidden
    >
      {initials}
    </span>
  );
}

export function UserCell({ email, role }: { email: string | null; role?: string | null }) {
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <Avatar email={email} />
      <div className="min-w-0">
        <div className="truncate font-medium text-fg">{email ?? "—"}</div>
        {role !== undefined && <div className="truncate text-[11px] text-fg-3">{prettyRole(role)}</div>}
      </div>
    </div>
  );
}

const ROLE_STYLES: Record<string, string> = {
  system_admin: "bg-[color-mix(in_srgb,var(--purple)_14%,transparent)] text-[var(--purple)]",
  admin: "bg-accent-soft text-accent",
  selection_head: "bg-[var(--warn-soft)] text-warn",
  pulley_owner: "bg-[color-mix(in_srgb,var(--brand-cyan)_15%,transparent)] text-[var(--brand-cyan)]",
  user: "bg-sunk text-fg-2",
};

export function RoleBadge({ role }: { role: string | null | undefined }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap ${
        ROLE_STYLES[role ?? ""] ?? "bg-sunk text-fg-3"
      }`}
    >
      {prettyRole(role)}
    </span>
  );
}

// --- Events ------------------------------------------------------------------------------

function actionTone(action: string, eventType?: string): string {
  if (eventType === "login_failed") return "bg-[var(--neg-soft)] text-neg";
  if (eventType === "login") return "bg-[var(--pos-soft)] text-pos";
  if (eventType === "logout") return "bg-sunk text-fg-2";
  if (action.startsWith("wizard.")) return "bg-accent-soft text-accent";
  if (action.startsWith("enquiry.") || action.startsWith("tag.")) return "bg-[color-mix(in_srgb,var(--brand-cyan)_15%,transparent)] text-[var(--brand-cyan)]";
  if (action.startsWith("approval.")) return "bg-[var(--warn-soft)] text-warn";
  if (action.startsWith("master.") || action.startsWith("drive_option.") || action.startsWith("end_connection.") || action.startsWith("flange_standard."))
    return "bg-[color-mix(in_srgb,#f97316_14%,transparent)] text-[#ea580c]";
  if (action === "user.approve") return "bg-[var(--pos-soft)] text-pos";
  if (action === "user.reject" || action === "user.delete") return "bg-[var(--neg-soft)] text-neg";
  if (action === "user.request") return "bg-[var(--warn-soft)] text-warn";
  if (action.startsWith("user.")) return "bg-[color-mix(in_srgb,var(--purple)_14%,transparent)] text-[var(--purple)]";
  if (action.startsWith("report.") || action.startsWith("audit.")) return "bg-[var(--pos-soft)] text-pos";
  return "bg-sunk text-fg-2";
}

export function ActionBadge({ action, eventType }: { action: string; eventType?: string }) {
  const label =
    eventType === "login_failed"
      ? action === "auth.login_blocked"
        ? "Blocked sign-in"
        : "Failed sign-in"
      : eventType === "login"
        ? "Signed in"
        : eventType === "logout"
          ? "Signed out"
          : prettyAction(action);
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11.5px] font-semibold whitespace-nowrap ${actionTone(action, eventType)}`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {label}
    </span>
  );
}

export function IpChip({ ip, extra }: { ip: string | null | undefined; extra?: number }) {
  if (!ip) return <span className="text-fg-4">—</span>;
  const local = ip === "::1" || ip === "127.0.0.1";
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap">
      <span
        className="rounded-md border border-line bg-elev px-1.5 py-0.5 font-mono text-[11.5px] text-fg-2"
        title={local ? "Local machine (development)" : ip}
      >
        {local ? "localhost" : ip}
      </span>
      {extra ? (
        <span className="text-[11px] text-fg-3" title={`${extra} more IP address${extra === 1 ? "" : "es"} in this period`}>
          +{extra}
        </span>
      ) : null}
    </span>
  );
}

export function DeviceCell({ ua }: { ua: string | null | undefined }) {
  if (!ua) return <span className="text-fg-4">—</span>;
  const d = parseUserAgent(ua);
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-fg-2" title={ua}>
      <span className="text-fg-3">{d.device === "Mobile" ? Icons.phone : d.device === "Tablet" ? Icons.tablet : Icons.monitor}</span>
      <span className="text-[12px]">
        {d.browser} <span className="text-fg-3">· {d.os}</span>
      </span>
    </span>
  );
}

// --- Icons (inline, stroke = currentColor) ------------------------------------------------------

const svg = (path: ReactNode, size = 15) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    {path}
  </svg>
);

export const Icons = {
  overview: svg(<><rect x="3" y="3" width="7" height="9" rx="1.5" /><rect x="14" y="3" width="7" height="5" rx="1.5" /><rect x="14" y="12" width="7" height="9" rx="1.5" /><rect x="3" y="16" width="7" height="5" rx="1.5" /></>),
  users: svg(<><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5" /><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14.8c2 .7 3.2 2.5 3.5 5.2" /></>),
  activity: svg(<path d="M3 12h4l3-8 4 16 3-8h4" />),
  login: svg(<><path d="M15 3h3a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-3" /><path d="M10 17l5-5-5-5M15 12H3" /></>),
  shield: svg(<><path d="M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6z" /><path d="M9 12l2 2 4-4" /></>),
  clock: svg(<><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>),
  alert: svg(<><path d="M12 3l9.5 17h-19z" /><path d="M12 10v4M12 17.5v.01" /></>),
  folder: svg(<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />),
  tag: svg(<><path d="M3 12V4a1 1 0 0 1 1-1h8l9 9-9 9z" /><circle cx="7.5" cy="7.5" r="1.3" /></>),
  file: svg(<><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" /><path d="M14 3v6h6M8 13h8M8 17h5" /></>),
  globe: svg(<><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z" /></>),
  monitor: svg(<><rect x="3" y="4" width="18" height="12" rx="1.5" /><path d="M8 20h8M12 16v4" /></>, 13),
  phone: svg(<><rect x="7" y="2.5" width="10" height="19" rx="2" /><path d="M11 18h2" /></>, 13),
  tablet: svg(<><rect x="4.5" y="2.5" width="15" height="19" rx="2" /><path d="M11 18h2" /></>, 13),
  download: svg(<><path d="M12 4v11M7 10l5 5 5-5" /><path d="M4 19h16" /></>),
  search: svg(<><circle cx="11" cy="11" r="6.5" /><path d="M20 20l-4-4" /></>, 14),
  calendar: svg(<><rect x="3.5" y="5" width="17" height="15" rx="2" /><path d="M3.5 10h17M8 3v4M16 3v4" /></>, 14),
  flame: svg(<path d="M12 21c-3.9 0-7-2.8-7-6.6 0-3.1 2-5 3.5-6.9.3 1.7 1.2 2.9 2.5 3.5C11 7.7 12.4 5 15 3c.2 3 3.9 5.4 3.9 10.4 0 4.3-3 7.6-6.9 7.6z" />),
  check: svg(<path d="M5 12.5l4.5 4.5L19 7.5" />),
  info: svg(<><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8v.01" /></>, 14),
};

export function TrendDelta({ current, previous, invert = false }: { current: number; previous: number | null | undefined; invert?: boolean }) {
  if (previous === null || previous === undefined) return null;
  if (previous === 0 && current === 0) return <span className="text-[11px] text-fg-3">no change</span>;
  if (previous === 0) return <span className="text-[11px] font-semibold text-pos">new</span>;
  const pct = Math.round(((current - previous) / previous) * 100);
  const up = pct > 0;
  const good = invert ? !up : up;
  if (pct === 0) return <span className="text-[11px] text-fg-3">no change</span>;
  return (
    <span className={`inline-flex items-center gap-0.5 text-[11px] font-semibold ${good ? "text-pos" : "text-neg"}`}>
      {up ? "▲" : "▼"} {Math.abs(pct)}%
    </span>
  );
}
