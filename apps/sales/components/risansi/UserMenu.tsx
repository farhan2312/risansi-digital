'use client';

import { useState, useRef, useEffect } from 'react';
import { useTheme } from 'next-themes';
import { Sun, Moon, KeyRound } from 'lucide-react';
import Link from 'next/link';
import type { CSSProperties } from 'react';

type UserMenuProps = {
  name: string;
  email: string;
  role: string;
};

const ROLE_LABELS: Record<string, string> = {
  // The three narrow roles first, in the order identity.app_roles lists them.
  // `staff` was missing and showed as the bare word "staff" in the menu.
  staff:    'Complaints + Client 360',
  viewer:   'Client 360 View',
  registry: 'Action Register',
  rep:      'Sales Representative',
  manager:  'Sales Manager',
  admin:    'Admin',
  sysadmin: 'System Admin',
};

export function UserMenu({ name, email, role }: UserMenuProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const isDark = mounted && resolvedTheme === 'dark';

  const roleLabel = ROLE_LABELS[role] ?? role;

  const initials = name
    ?.split(' ')
    .map(w => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase() || 'A';

  // Close on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  return (
    <div ref={ref} style={{ marginTop: 'auto', position: 'relative' }}>
      {/* Popup menu — above the user row */}
      {open && (
        <div style={POPUP}>
          <div style={{ padding: '12px 14px', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#FFFFFF' }}>{name}</div>
            <div style={{ fontSize: 11, color: '#8BA3C7', marginTop: 2, wordBreak: 'break-all' }}>{email}</div>
          </div>

          {/* Theme toggle */}
          <div style={{ padding: '6px 8px', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
            <button
              type="button"
              onClick={() => setTheme(isDark ? 'light' : 'dark')}
              style={THEME_BTN}
              aria-label="Toggle dark mode"
              aria-pressed={isDark}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {isDark ? <Moon size={13} /> : <Sun size={13} />}
                Dark mode
              </span>
              <span style={{ ...SWITCH_TRACK, background: isDark ? '#1A5CB8' : 'rgba(255,255,255,0.18)' }}>
                <span style={{ ...SWITCH_KNOB, transform: isDark ? 'translateX(14px)' : 'translateX(0)' }} />
              </span>
            </button>
          </div>

          {/* Change password */}
          <div style={{ padding: '6px 8px', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
            <Link href="/change-password" style={CHANGE_PW_BTN} onClick={() => setOpen(false)}>
              <KeyRound size={13} style={{ flexShrink: 0 }} />
              Change Password
            </Link>
          </div>

          <div style={{ padding: '6px 8px' }}>
            <form method="POST" action="/sign-out">
              <button type="submit" style={SIGNOUT_BTN}>
              <svg width={13} height={13} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                <path d="M10 8H3M6 5l-3 3 3 3M11 4V3a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h5a1 1 0 0 0 1-1v-1"/>
              </svg>
                Sign out
              </button>
            </form>
          </div>
        </div>
      )}

      {/* User row — click to toggle */}
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        style={USER_ROW}
      >
        <div style={AVATAR}>{initials}</div>
        <div style={{ minWidth: 0, flex: 1, textAlign: 'left' }}>
          <div style={WHO}>{name}</div>
          <div style={ROLE_LABEL}>{roleLabel}</div>
        </div>
        <svg
          width={12} height={12} viewBox="0 0 16 16" fill="none"
          stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round"
          style={{
            flexShrink: 0,
            color: '#8BA3C7',
            transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
            transition: 'transform 0.18s',
          }}
        >
          <path d="M4 6.5 8 10.5 12 6.5"/>
        </svg>
      </button>

    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────

const POPUP: CSSProperties = {
  position: 'absolute',
  bottom: '100%',
  left: 8,
  right: 8,
  background: '#132240',
  border: '1px solid rgba(255,255,255,0.10)',
  borderRadius: 8,
  boxShadow: '0 -8px 32px rgba(0,0,0,0.40)',
  marginBottom: 6,
  zIndex: 100,
  overflow: 'hidden',
};

const USER_ROW: CSSProperties = {
  width: '100%',
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  padding: '12px 14px 10px',
  border: 'none',
  borderTop: '1px solid rgba(255,255,255,0.08)',
  background: 'transparent',
  cursor: 'pointer',
  fontFamily: 'inherit',
};

const AVATAR: CSSProperties = {
  width: 32,
  height: 32,
  borderRadius: '50%',
  flexShrink: 0,
  background: 'rgba(26,92,184,0.35)',
  display: 'grid',
  placeItems: 'center',
  fontSize: 12,
  color: '#fff',
  fontWeight: 600,
};

const THEME_BTN: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  width: '100%',
  padding: '8px 10px',
  background: 'transparent',
  border: 'none',
  borderRadius: 5,
  fontSize: 12,
  color: '#C9D6EC',
  cursor: 'pointer',
  fontFamily: 'inherit',
  textAlign: 'left',
};

const SWITCH_TRACK: CSSProperties = {
  position: 'relative',
  display: 'inline-block',
  width: 30,
  height: 16,
  borderRadius: 999,
  flexShrink: 0,
  transition: 'background 0.18s',
};

const SWITCH_KNOB: CSSProperties = {
  position: 'absolute',
  top: 2,
  left: 2,
  width: 12,
  height: 12,
  borderRadius: '50%',
  background: '#fff',
  transition: 'transform 0.18s',
};

const CHANGE_PW_BTN: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  width: '100%',
  padding: '8px 10px',
  background: 'transparent',
  border: 'none',
  borderRadius: 5,
  fontSize: 12,
  color: '#C9D6EC',
  cursor: 'pointer',
  fontFamily: 'inherit',
  textAlign: 'left',
  // It is a link now, not a button: without this it renders underlined.
  textDecoration: 'none',
};

const SIGNOUT_BTN: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  width: '100%',
  padding: '8px 10px',
  background: 'transparent',
  border: 'none',
  borderRadius: 5,
  fontSize: 12,
  color: '#FF6B6B',
  cursor: 'pointer',
  fontFamily: 'inherit',
  textAlign: 'left',
};

const WHO: CSSProperties = {
  fontSize: 12,
  fontWeight: 500,
  color: '#FFFFFF',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

const ROLE_LABEL: CSSProperties = {
  fontSize: 10,
  color: '#8BA3C7',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};
