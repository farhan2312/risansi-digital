'use client';

import { useState, useRef, useEffect } from 'react';
import { signOut } from 'next-auth/react';
import { useTheme } from 'next-themes';
import { Sun, Moon, KeyRound } from 'lucide-react';
import type { CSSProperties, FormEvent } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

type UserMenuProps = {
  name: string;
  email: string;
  role: string;
};

const ROLE_LABELS: Record<string, string> = {
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

  // ── Change-password modal state ──────────────────────────────
  const [pwOpen,    setPwOpen]    = useState(false);
  const [currentPw, setCurrentPw] = useState('');
  const [newPw,     setNewPw]     = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [loading,   setLoading]   = useState(false);
  const [error,     setError]     = useState('');
  const [success,   setSuccess]   = useState(false);

  const resetForm = () => {
    setCurrentPw(''); setNewPw('');
    setConfirmPw(''); setError('');
    setSuccess(false);
  };

  const handleChangePassword = async (e: FormEvent) => {
    e.preventDefault();
    if (newPw !== confirmPw) return;
    if (newPw.length < 8) return;
    setLoading(true); setError('');
    try {
      const res = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPw, newPw }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Failed');
      setSuccess(true);
      setCurrentPw(''); setNewPw(''); setConfirmPw('');
      // Close the modal a couple of seconds after success.
      setTimeout(() => {
        setPwOpen(false);
        setSuccess(false);
      }, 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to change password');
    } finally {
      setLoading(false);
    }
  };

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
            <button
              type="button"
              onClick={() => { setOpen(false); resetForm(); setPwOpen(true); }}
              style={CHANGE_PW_BTN}
            >
              <KeyRound size={13} style={{ flexShrink: 0 }} />
              Change Password
            </button>
          </div>

          <div style={{ padding: '6px 8px' }}>
            <button
              onClick={() => signOut({ callbackUrl: '/api/auth/signin' })}
              style={SIGNOUT_BTN}
            >
              <svg width={13} height={13} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                <path d="M10 8H3M6 5l-3 3 3 3M11 4V3a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h5a1 1 0 0 0 1-1v-1"/>
              </svg>
              Sign out
            </button>
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

      {/* Change-password modal — kept outside the popup so it survives the
          popup closing on outside-click. Portals to <body>, so it renders in
          the app (light/dark) theme, not the dark sidebar chrome. */}
      <Dialog open={pwOpen} onOpenChange={(o) => { setPwOpen(o); if (!o) resetForm(); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Change Password</DialogTitle>
            <DialogDescription>
              Enter your current password and choose a new one.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleChangePassword}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: '8px 0' }}>
              <div>
                <label style={LABEL}>Current Password *</label>
                <Input
                  type="password"
                  value={currentPw}
                  onChange={e => setCurrentPw(e.target.value)}
                  required
                  placeholder="Enter current password"
                />
              </div>

              <div>
                <label style={LABEL}>New Password *</label>
                <Input
                  type="password"
                  value={newPw}
                  onChange={e => setNewPw(e.target.value)}
                  required
                  minLength={8}
                  placeholder="Min 8 characters"
                />
              </div>

              <div>
                <label style={LABEL}>Confirm New Password *</label>
                <Input
                  type="password"
                  value={confirmPw}
                  onChange={e => setConfirmPw(e.target.value)}
                  required
                  placeholder="Repeat new password"
                />
                {confirmPw && newPw !== confirmPw && (
                  <p style={{ fontSize: 11, color: 'var(--neg)', marginTop: 4 }}>
                    Passwords do not match
                  </p>
                )}
              </div>

              {error && (
                <div style={{ padding: '8px 12px', background: 'var(--neg-soft)', border: '1px solid var(--neg)', borderRadius: 6, fontSize: 12, color: 'var(--neg)' }}>
                  {error}
                </div>
              )}

              {success && (
                <div style={{ padding: '8px 12px', background: 'var(--pos-soft)', border: '1px solid var(--pos)', borderRadius: 6, fontSize: 12, color: 'var(--pos)' }}>
                  ✓ Password changed successfully
                </div>
              )}
            </div>

            <DialogFooter style={{ marginTop: 16 }}>
              <Button type="button" variant="outline" onClick={() => { setPwOpen(false); resetForm(); }}>
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={
                  loading ||
                  !currentPw || !newPw || !confirmPw ||
                  newPw !== confirmPw ||
                  newPw.length < 8
                }
              >
                {loading ? 'Changing…' : 'Change Password'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
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
};

const LABEL: CSSProperties = {
  display: 'block',
  fontSize: 12,
  fontWeight: 500,
  color: 'var(--fg-2)',
  marginBottom: 6,
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
