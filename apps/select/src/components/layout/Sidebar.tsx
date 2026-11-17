"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import "./Sidebar.css";
import { useCurrentUser } from "../../contexts/CurrentUserContext";
import SidebarUserMenu from "./SidebarUserMenu";
import {
  ADMIN_LINKS,
  APPROVER_LINKS,
  PULLEY_OWNER_LINKS,
  mainLinksFor,
  MY_BUG_LINKS,
  SYSTEM_ADMIN_LINKS,
  navIcons,
} from "./navLinks";
import { canApprove } from "../../lib/approval";

/** Collapsed to its icons (user, 2026-11-17), remembered on this browser. */
const COLLAPSED_KEY = "sidebar-collapsed";

const Sidebar = () => {
  const pathname = usePathname();
  const { user } = useCurrentUser();
  // Read after mount, so the server's render (always open) matches the first paint.
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    setCollapsed(localStorage.getItem(COLLAPSED_KEY) === "1");
  }, []);
  const toggle = () =>
    setCollapsed((c) => {
      localStorage.setItem(COLLAPSED_KEY, c ? "0" : "1");
      return !c;
    });

  // Collapsed: the icon only, its name on hover.
  const navLink = (href: string, label: string, ic: ReactNode) => (
    <Link key={href} href={href} className={pathname === href ? "active-link" : ""} title={collapsed ? label : undefined} aria-label={collapsed ? label : undefined}>
      {ic}
      <span>{label}</span>
    </Link>
  );

  return (
    <aside className={`sidebar${collapsed ? " collapsed" : ""}`}>
      <div className="logo">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={collapsed ? "/icon.png" : "/logo.png"} alt="Risansi Industries" className="sidebar-logo" />
      </div>

      <button
        type="button"
        className="sidebar-toggle"
        onClick={toggle}
        aria-label={collapsed ? "Expand the sidebar" : "Collapse the sidebar"}
        title={collapsed ? "Expand" : "Collapse"}
      >
        {collapsed ? <PanelLeftOpen className="nav-icon" /> : <PanelLeftClose className="nav-icon" />}
        <span>Collapse</span>
      </button>

      <nav className="flex-1">
        <p className="sidebar-group-label">Main</p>
        {mainLinksFor(user?.role).map((l) => navLink(l.href, l.label, navIcons[l.icon]))}

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
        {user && user.role !== "system_admin" && user.role !== "operation" && (
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

      <SidebarUserMenu collapsed={collapsed} />
    </aside>
  );
};

export default Sidebar;
