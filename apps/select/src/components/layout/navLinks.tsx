import type { ReactNode } from "react";

/**
 * Single source of truth for the app's navigation, shared by the desktop
 * Sidebar and the mobile BottomNav so the two can't drift apart.
 */

// 15x15 stroke icons (stroke:currentColor, width 1.5) per the Risansi guide §7.7.
const icon = (path: ReactNode) => (
  <svg
    className="nav-icon"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.6"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    {path}
  </svg>
);

export const navIcons: Record<string, ReactNode> = {
  dashboard: icon(
    <>
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
    </>,
  ),
  projects: icon(
    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />,
  ),
  pump: icon(
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9L17 7M7 17l-2.1 2.1" />
    </>,
  ),
  reports: icon(
    <>
      <path d="M14 3v4a1 1 0 0 0 1 1h4" />
      <path d="M17 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7l5 5v11a2 2 0 0 1-2 2z" />
      <path d="M9 13h6M9 17h4" />
    </>,
  ),
  users: icon(
    <>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
    </>,
  ),
  database: icon(
    <>
      <ellipse cx="12" cy="5" rx="8" ry="3" />
      <path d="M4 5v6a8 3 0 0 0 16 0V5" />
      <path d="M4 11v6a8 3 0 0 0 16 0v-6" />
    </>,
  ),
  calculator: icon(
    <>
      <rect x="5" y="3" width="14" height="18" rx="2" />
      <path d="M8 7h8M8 11h.01M12 11h.01M16 11h.01M8 15h.01M12 15h.01M16 15h.01M8 18h.01M12 18h.01M16 18h.01" />
    </>,
  ),
  approvals: icon(
    <>
      <path d="M12 3.5 5 6v5.5c0 4.2 2.9 7.4 7 8.9 4.1-1.5 7-4.7 7-8.9V6l-7-2.5Z" />
      <path d="m9.2 12 2 2 3.6-3.8" />
    </>,
  ),
};

export type NavLink = {
  href: string;
  label: string;
  /** Shorter caption for the bottom bar, where slots are narrow. */
  shortLabel?: string;
  icon: keyof typeof navIcons & string;
};

export const MAIN_LINKS: NavLink[] = [
  { href: "/dashboard", label: "Dashboard", shortLabel: "Home", icon: "dashboard" },
  { href: "/projects", label: "Enquiries", icon: "projects" },
  { href: "/pump-selection", label: "Pump Selection", shortLabel: "Select", icon: "pump" },
  { href: "/selection-summary", label: "Reports", icon: "reports" },
  { href: "/head-calculator", label: "Head Calculator", shortLabel: "Calc", icon: "calculator" },
  { href: "/client-prices", label: "Client Quoted Prices", shortLabel: "Prices", icon: "reports" },
];

/** Master-data pages — admin and system_admin alike. */
export const ADMIN_LINKS: NavLink[] = [
  { href: "/admin/pump-model-master", label: "Pump Model Master", icon: "database" },
  { href: "/admin/pulley-master", label: "Pulley Master", icon: "database" },
  { href: "/admin/gearbox-master", label: "Gearbox Master", icon: "database" },
  { href: "/admin/motor-master", label: "Motor Master", icon: "database" },
  { href: "/admin/boi-master", label: "BOI Master", icon: "database" },
];

/** system_admin only — plain "admin" explicitly does not get these. */
export const SYSTEM_ADMIN_LINKS: NavLink[] = [
  { href: "/admin/users", label: "Users & Access", icon: "users" },
  { href: "/admin/audit", label: "Audit Log", icon: "database" },
  { href: "/admin/bug-tracker", label: "Bug Tracker", icon: "database" },
];

/** Everyone except system_admin (who has the full Bug Tracker): their own
 *  reports, read-only. */
export const MY_BUG_LINKS: NavLink[] = [
  { href: "/my-bug-reports", label: "My Bug Reports", icon: "reports" },
];

/** pulley_owner: User access plus the Pulley Master only. */
export const PULLEY_OWNER_LINKS: NavLink[] = ADMIN_LINKS.filter(
  (l) => l.href === "/admin/pulley-master",
);

/** Selection heads and system admins — whoever decides approvals
 * (APPROVER_ROLES in lib/approval.ts). */
export const APPROVER_LINKS: NavLink[] = [
  { href: "/approvals", label: "Approvals", icon: "approvals" },
];

/** Every non-Main link the given role can see, flattened for the mobile
 * "More" sheet (which doesn't split them into separate groups). */
export const adminLinksFor = (role: string | undefined): NavLink[] => {
  if (role === "system_admin") return [...APPROVER_LINKS, ...ADMIN_LINKS, ...SYSTEM_ADMIN_LINKS];
  if (role === "selection_head") return APPROVER_LINKS;
  if (role === "pulley_owner") return PULLEY_OWNER_LINKS;
  if (role === "admin") return ADMIN_LINKS;
  return [];
};
