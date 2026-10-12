"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import "./BottomNav.css";
import { useCurrentUser } from "../../contexts/CurrentUserContext";
import SidebarUserMenu from "./SidebarUserMenu";
import { MAIN_LINKS, MY_BUG_LINKS, adminLinksFor, navIcons } from "./navLinks";

const MoreIcon = () => (
  <svg
    className="nav-icon"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    aria-hidden="true"
  >
    <circle cx="5" cy="12" r="1.4" />
    <circle cx="12" cy="12" r="1.4" />
    <circle cx="19" cy="12" r="1.4" />
  </svg>
);

/**
 * Mobile-only bottom navigation. The sidebar's full link list is too long for
 * a bottom bar, so the four Main destinations get fixed slots and everything
 * else (admin master-data pages, the user menu/theme toggle/logout) moves into
 * a "More" sheet. Rendered alongside the sidebar and toggled purely by CSS
 * media queries, so there's no JS-driven breakpoint state to get out of sync.
 */
const BottomNav = () => {
  const pathname = usePathname();
  const { user } = useCurrentUser();
  const [moreOpen, setMoreOpen] = useState(false);

  const adminLinks = adminLinksFor(user?.role);
  // Their own bug reports (read-only) — system admins have the Bug Tracker.
  const helpLinks = user && user.role !== "system_admin" ? MY_BUG_LINKS : [];

  // Close the sheet on navigation — otherwise it stays over the new page.
  useEffect(() => {
    setMoreOpen(false);
  }, [pathname]);

  // Lock background scroll while the sheet is open.
  useEffect(() => {
    if (!moreOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [moreOpen]);

  const isActive = (href: string) => pathname === href;
  // "More" counts as active when the current page lives inside it, so the bar
  // always highlights exactly one slot.
  const moreActive = [...adminLinks, ...helpLinks].some((l) => pathname === l.href);

  const item = (href: string, label: string, ic: ReactNode) => (
    <Link
      key={href}
      href={href}
      className={`bottom-nav-item${isActive(href) ? " is-active" : ""}`}
      aria-current={isActive(href) ? "page" : undefined}
    >
      {ic}
      <span>{label}</span>
    </Link>
  );

  return (
    <>
      {moreOpen && (
        <>
          <div
            className="bottom-sheet-backdrop"
            onClick={() => setMoreOpen(false)}
            aria-hidden="true"
          />
          <div className="bottom-sheet" role="dialog" aria-modal="true" aria-label="More">
            <div className="bottom-sheet-handle" aria-hidden="true" />

            {adminLinks.length > 0 && (
              <>
                <p className="bottom-sheet-label">Admin</p>
                <div className="bottom-sheet-links">
                  {adminLinks.map((l) => (
                    <Link
                      key={l.href}
                      href={l.href}
                      className={`bottom-sheet-link${pathname === l.href ? " is-active" : ""}`}
                    >
                      {navIcons[l.icon]}
                      <span>{l.label}</span>
                    </Link>
                  ))}
                </div>
              </>
            )}

            {helpLinks.length > 0 && (
              <>
                <p className="bottom-sheet-label">Help</p>
                <div className="bottom-sheet-links">
                  {helpLinks.map((l) => (
                    <Link
                      key={l.href}
                      href={l.href}
                      className={`bottom-sheet-link${pathname === l.href ? " is-active" : ""}`}
                    >
                      {navIcons[l.icon]}
                      <span>{l.label}</span>
                    </Link>
                  ))}
                </div>
              </>
            )}

            {/* Reuses the sidebar's account block (name/email, theme toggle,
                logout) so there's one implementation of that menu. */}
            <div className="bottom-sheet-account">
              <SidebarUserMenu />
            </div>
          </div>
        </>
      )}

      <nav className="bottom-nav" aria-label="Primary">
        {MAIN_LINKS.map((l) => item(l.href, l.shortLabel ?? l.label, navIcons[l.icon]))}

        <button
          type="button"
          className={`bottom-nav-item${moreActive || moreOpen ? " is-active" : ""}`}
          onClick={() => setMoreOpen((v) => !v)}
          aria-expanded={moreOpen}
        >
          <MoreIcon />
          <span>More</span>
        </button>
      </nav>
    </>
  );
};

export default BottomNav;
