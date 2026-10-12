"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import "./Sidebar.css";
import { useCurrentUser } from "../../contexts/CurrentUserContext";
import SidebarUserMenu from "./SidebarUserMenu";
import {
  ADMIN_LINKS,
  APPROVER_LINKS,
  PULLEY_OWNER_LINKS,
  MAIN_LINKS,
  MY_BUG_LINKS,
  SYSTEM_ADMIN_LINKS,
  navIcons,
} from "./navLinks";
import { canApprove } from "../../lib/approval";

const Sidebar = () => {
  const pathname = usePathname();
  const { user } = useCurrentUser();

  const navLink = (href: string, label: string, ic: ReactNode) => (
    <Link key={href} href={href} className={pathname === href ? "active-link" : ""}>
      {ic}
      <span>{label}</span>
    </Link>
  );

  return (
    <aside className="sidebar">
      <div className="logo">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo.png" alt="Risansi Industries" className="sidebar-logo" />
      </div>

      <nav className="flex-1">
        <p className="sidebar-group-label">Main</p>
        {MAIN_LINKS.map((l) => navLink(l.href, l.label, navIcons[l.icon]))}

        {canApprove(user?.role) && (
          <>
            <p className="sidebar-group-label">Approvals</p>
            {APPROVER_LINKS.map((l) => navLink(l.href, l.label, navIcons[l.icon]))}
          </>
        )}

        {(user?.role === "admin" || user?.role === "system_admin") && (
          <>
            <p className="sidebar-group-label">Admin</p>
            {ADMIN_LINKS.map((l) => navLink(l.href, l.label, navIcons[l.icon]))}
          </>
        )}

        {user?.role === "pulley_owner" && (
          <>
            <p className="sidebar-group-label">Masters</p>
            {PULLEY_OWNER_LINKS.map((l) => navLink(l.href, l.label, navIcons[l.icon]))}
          </>
        )}

        {/* Their own bug reports, read-only — system admins use the Bug Tracker. */}
        {user && user.role !== "system_admin" && (
          <>
            <p className="sidebar-group-label">Help</p>
            {MY_BUG_LINKS.map((l) => navLink(l.href, l.label, navIcons[l.icon]))}
          </>
        )}

        {/* System admin only — plain "admin" doesn't get user management,
            kept as its own group rather than folded into "Admin" above. */}
        {user?.role === "system_admin" && (
          <>
            <p className="sidebar-group-label">System Admin</p>
            {SYSTEM_ADMIN_LINKS.map((l) => navLink(l.href, l.label, navIcons[l.icon]))}
          </>
        )}
      </nav>

      <SidebarUserMenu />
    </aside>
  );
};

export default Sidebar;
