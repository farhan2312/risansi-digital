"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useCurrentUser } from "../../contexts/CurrentUserContext";
import { useTheme } from "../../contexts/ThemeContext";
import EditPasswordModal from "../ui/EditPasswordModal";
import { logout } from "../../services/authService";

const MoonIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="h-[16px] w-[16px] shrink-0">
    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
  </svg>
);

const KeyIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="h-[16px] w-[16px] shrink-0">
    <circle cx="8" cy="16" r="3" />
    <path d="M10 14l7-7m0 0h-3m3 0v3" />
  </svg>
);

const LogOutIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="h-[16px] w-[16px] shrink-0">
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
    <path d="M16 17l5-5-5-5" />
    <path d="M21 12H9" />
  </svg>
);

// Stale before the 3-role split, this used to label "admin" as "System
// Admin" (there was no third role yet) — anything else, including the new
// "system_admin" value itself, silently fell through to "User". That's why
// a promoted system_admin account showed up as "User" in the sidebar.
const roleLabel = (role: string | undefined) => {
  switch (role) {
    case "system_admin":
      return "System Admin";
    case "selection_head":
      return "Selection Head";
    case "pulley_owner":
      return "Pulley Owner";
    case "admin":
      return "Admin";
    default:
      return "User";
  }
};

/** User profile block pinned to the bottom of the sidebar — avatar, name,
 * role, and an expand chevron that opens an upward popup (theme toggle,
 * change password, log out). Tailwind-styled. */
const SidebarUserMenu = () => {
  const router = useRouter();
  const { theme, toggleTheme } = useTheme();
  const { user: currentUser } = useCurrentUser();

  const [open, setOpen] = useState(false);
  const [showEditPassword, setShowEditPassword] = useState(false);

  const userName = currentUser?.name || "User";
  const userEmail = currentUser?.email || "";

  const initial = userName.charAt(0).toUpperCase() || "U";

  const handleLogout = async () => {
    // Clear the httpOnly session cookie server-side — client JS can't
    // remove it directly.
    try {
      await logout();
    } finally {
      router.push("/");
    }
  };

  // Fixed px throughout (not Tailwind's rem-based p-2/gap-2.5/h-8/etc.) —
  // those scale with the app's 13px root font-size (index.css's "compact
  // scale"), rendering noticeably smaller than intended. Same fix as the
  // pump-selection wizard's formStyles.ts.
  return (
    <div className="relative mt-auto border-t border-white/10 pt-[8px]">
      {open && (
        <div className="absolute bottom-[calc(100%+6px)] left-0 right-0 z-20 rounded-md border border-white/10 bg-[#132240] pl-[8px] pr-[8px] pt-[8px] pb-[8px] shadow-[0_8px_24px_rgba(0,0,0,0.35)]">
          <div className="pl-[8px] pr-[8px] pt-[6px] pb-[6px]">
            <p className="text-[13px] font-semibold text-white truncate">{userName}</p>
            <p className="text-[11px] text-sidebar-fg/80 truncate">{userEmail}</p>
          </div>

          <div className="my-[6px] h-px bg-white/10" />

          <div className="flex items-center justify-between pl-[8px] pr-[8px] pt-[6px] pb-[6px]">
            <span className="flex items-center gap-[8px] text-[13px] text-sidebar-fg">
              <MoonIcon />
              Dark mode
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={theme === "dark"}
              aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
              onClick={toggleTheme}
              className={`relative h-[16px] w-[30px] rounded-full transition-colors ${
                theme === "dark" ? "bg-accent" : "bg-white/15"
              }`}
            >
              <span
                className={`absolute left-[2px] top-[2px] h-[12px] w-[12px] rounded-full bg-white transition-transform ${
                  theme === "dark" ? "translate-x-[14px]" : "translate-x-0"
                }`}
              />
            </button>
          </div>

          <div className="my-[6px] h-px bg-white/10" />

          <button
            type="button"
            onClick={() => {
              setShowEditPassword(true);
              setOpen(false);
            }}
            className="flex w-full items-center gap-[8px] text-left pl-[8px] pr-[8px] pt-[6px] pb-[6px] rounded text-[13px] text-sidebar-fg hover:bg-white/10 hover:text-white transition-colors"
          >
            <KeyIcon />
            Change Password
          </button>

          <div className="my-[6px] h-px bg-white/10" />

          <button
            type="button"
            onClick={handleLogout}
            className="flex w-full items-center gap-[8px] text-left pl-[8px] pr-[8px] pt-[6px] pb-[6px] rounded text-[13px] text-red-400 hover:bg-white/10 transition-colors"
          >
            <LogOutIcon />
            Sign out
          </button>
        </div>
      )}

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="true"
        aria-expanded={open}
        className="flex w-full items-center gap-[10px] rounded-md pl-[8px] pr-[8px] pt-[8px] pb-[8px] text-left hover:bg-white/5 transition-colors"
      >
        <span className="flex h-[32px] w-[32px] shrink-0 items-center justify-center rounded-full bg-accent text-[13px] font-semibold text-white">
          {initial}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-semibold text-white">{userName}</span>
          <span className="block truncate text-[11px] text-sidebar-fg/80">{roleLabel(currentUser?.role)}</span>
        </span>
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          className={`h-[14px] w-[14px] shrink-0 text-sidebar-fg/70 transition-transform ${open ? "rotate-180" : ""}`}
        >
          <path d="M6 9l6-6 6 6M6 15l6 6 6-6" />
        </svg>
      </button>

      {showEditPassword && <EditPasswordModal onClose={() => setShowEditPassword(false)} />}
    </div>
  );
};

export default SidebarUserMenu;
