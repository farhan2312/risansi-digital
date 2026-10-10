'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, useEffect, type CSSProperties } from 'react';
import { signOut } from 'next-auth/react';
import { useTheme } from 'next-themes';
import {
  LayoutGrid, Building2, MapPinned, Receipt, Menu, X,
  GitBranch, RadioTower, ListChecks, Upload, Users, KeyRound,
  Network, ArchiveRestore, ClipboardList, Settings, Sun, Moon, LogOut, AlertTriangle, ListTodo, Gauge,
  Store, BarChart3, Wallet, Bug,
} from 'lucide-react';

export type BottomNavRole = 'staff' | 'rep' | 'manager' | 'exec' | 'admin' | 'sysadmin';

interface Item { href: string; label: string; Icon: React.ComponentType<{ size?: number }>; }

// Primary tabs — same for every role; everything else lives in "More".
const TABS: Item[] = [
  { href: '/risansi',         label: 'Home',    Icon: LayoutGrid },
  { href: '/risansi/clients', label: 'Clients', Icon: Building2 },
  { href: '/risansi/field',   label: 'Field',   Icon: MapPinned },
  { href: '/risansi/revenue', label: 'Revenue', Icon: Receipt },
];

// Kept deliberately in step with the desktop Sidebar — anything reachable there
// must be reachable here, or the feature simply does not exist on a phone.
const MORE_SALES: Item[] = [
  { href: '/risansi/registry',    label: 'Action Registry', Icon: ListTodo },
  { href: '/risansi/pipeline',    label: 'Opportunities',   Icon: GitBranch },
  { href: '/risansi/exhibitions', label: 'Exhibitions',     Icon: Store },
  { href: '/risansi/compete',     label: 'Competition',     Icon: RadioTower },
  { href: '/risansi/complaints',  label: 'Complaints',      Icon: AlertTriangle },
];

// Manager-and-above analysis, matching the Sidebar's own review group.
const MORE_REVIEW: Item[] = [
  { href: '/risansi/executive-review', label: 'Executive Review', Icon: BarChart3 },
];

const MORE_ADMIN: Item[] = [
  { href: '/risansi/admin/clients',     label: 'Client Master',       Icon: ListChecks },
  { href: '/risansi/admin/revenue',     label: 'Revenue Upload',      Icon: Upload },
  { href: '/risansi/admin/outstanding', label: 'Outstanding Upload',  Icon: Wallet },
  { href: '/risansi/admin/pumps',       label: 'Pump Ingestion',      Icon: Gauge },
  { href: '/risansi/admin/complaints',  label: 'Complaint Settings',  Icon: AlertTriangle },
];

const MORE_SYSADMIN: Item[] = [
  { href: '/risansi/admin/reps',        label: 'Reps & Managers', Icon: Network },
  { href: '/risansi/admin/recoverable', label: 'Recoverable',     Icon: ArchiveRestore },
  { href: '/admin',                     label: 'Users & Access',  Icon: Users },
  { href: '/risansi/admin/bugs',     label: 'Bugs',           Icon: Bug },
  { href: '/risansi/admin/audit',    label: 'Audit Log',      Icon: ClipboardList },
  { href: '/risansi/admin/settings', label: 'Settings',       Icon: Settings },
];

function isActive(pathname: string, href: string): boolean {
  // Home is also "active" on the dedicated mobile dashboard (/risansi/mobile).
  if (href === '/risansi') return pathname === '/risansi' || pathname.startsWith('/risansi/mobile');
  return pathname === href || pathname.startsWith(href + '/');
}

export function BottomNav({ role, user }: {
  role: BottomNavRole;
  user: { name: string; email: string };
}) {
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const isDark = mounted && resolvedTheme === 'dark';

  // Lock body scroll while the sheet is open.
  useEffect(() => {
    if (!moreOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [moreOpen]);

  const isAdmin    = role === 'admin' || role === 'sysadmin';
  const isSysAdmin = role === 'sysadmin';
  const isReviewer = role === 'manager' || role === 'exec' || isAdmin;
  // Staff get the same two screens the sidebar gives them. Home, Field and
  // Revenue would all redirect, and a tab bar whose tabs bounce you back is
  // worse than a shorter tab bar.
  const isStaffRole = role === 'staff';
  const tabs = isStaffRole
    ? [
        { href: '/risansi/clients',    label: 'Clients',    Icon: Building2 },
        { href: '/risansi/complaints', label: 'Complaints', Icon: AlertTriangle },
      ]
    : TABS;
  // Every group is included, so opening a sub-page still lights the More tab.
  const moreActive = [...MORE_SALES, ...MORE_REVIEW, ...MORE_ADMIN, ...MORE_SYSADMIN]
    .some(i => isActive(pathname, i.href));

  function closeAnd() { setMoreOpen(false); }

  return (
    <>
      {/* ── Bottom tab bar (mobile only — hidden ≥768px via globals.css) ── */}
      <nav className="risansi-bottom-nav" aria-label="Primary">
        {tabs.map(t => {
          const active = isActive(pathname, t.href);
          return (
            <Link key={t.href} href={t.href} style={tab(active)} onClick={closeAnd}>
              <t.Icon size={20} />
              <span style={TAB_LABEL}>{t.label}</span>
            </Link>
          );
        })}
        <button type="button" onClick={() => setMoreOpen(o => !o)} style={tab(moreOpen || moreActive)} aria-label="More">
          <Menu size={20} />
          <span style={TAB_LABEL}>More</span>
        </button>
      </nav>

      {/* ── "More" bottom sheet ── */}
      {moreOpen && (
        <div className="risansi-more-sheet">
          <div style={BACKDROP} onClick={() => setMoreOpen(false)} />
          <div style={SHEET}>
            <div style={SHEET_HANDLE_WRAP}>
              <div style={SHEET_HANDLE} />
            </div>
            <div style={SHEET_HEAD}>
              <span style={{ fontSize: 14, fontWeight: 700, color: '#fff' }}>Menu</span>
              <button type="button" onClick={() => setMoreOpen(false)} style={CLOSE_BTN} aria-label="Close">
                <X size={18} />
              </button>
            </div>

            <div style={SHEET_BODY}>
              <Group label="Sales">
                {(isStaffRole ? MORE_SALES.filter(i => i.href === '/risansi/complaints') : MORE_SALES)
                  .map(i => <Row key={i.href} item={i} active={isActive(pathname, i.href)} onClick={closeAnd} />)}
              </Group>

              {/* Executive Review is manager-and-above on the desktop sidebar, so
                  it is gated the same way here rather than shown to every rep. */}
              {isReviewer && !isStaffRole && (
                <Group label="Review">
                  {MORE_REVIEW.map(i => <Row key={i.href} item={i} active={isActive(pathname, i.href)} onClick={closeAnd} />)}
                </Group>
              )}

              {isAdmin && (
                <Group label="Admin">
                  {MORE_ADMIN.map(i => <Row key={i.href} item={i} active={isActive(pathname, i.href)} onClick={closeAnd} />)}
                </Group>
              )}

              {isSysAdmin && (
                <Group label="System Admin">
                  {MORE_SYSADMIN.map(i => <Row key={i.href} item={i} active={isActive(pathname, i.href)} onClick={closeAnd} />)}
                </Group>
              )}

              <Group label="Account">
                <div style={{ padding: '4px 14px 8px' }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#fff' }}>{user.name}</div>
                  <div style={{ fontSize: 11, color: '#8BA3C7', wordBreak: 'break-all' }}>{user.email}</div>
                </div>
                <button type="button" onClick={() => setTheme(isDark ? 'light' : 'dark')} style={ROW_BTN}>
                  {isDark ? <Moon size={18} /> : <Sun size={18} />}
                  <span style={{ flex: 1, textAlign: 'left' }}>Dark mode</span>
                  <span style={{ ...SWITCH_TRACK, background: isDark ? '#1A5CB8' : 'rgba(255,255,255,0.18)' }}>
                    <span style={{ ...SWITCH_KNOB, transform: isDark ? 'translateX(14px)' : 'translateX(0)' }} />
                  </span>
                </button>
                <Link href="/change-password" style={ROW_LINK} onClick={closeAnd}>
                  <KeyRound size={18} />
                  <span>Change Password</span>
                </Link>
                <button type="button" onClick={() => { if (window.confirm('Sign out of Risansi?')) signOut({ callbackUrl: '/api/auth/signin' }); }} style={{ ...ROW_BTN, color: '#FF6B6B' }}>
                  <LogOut size={18} />
                  <span>Sign out</span>
                </button>
              </Group>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 6 }}>
      <div style={GROUP_LABEL}>{label}</div>
      {children}
    </div>
  );
}

function Row({ item, active, onClick }: { item: Item; active: boolean; onClick: () => void }) {
  return (
    <Link href={item.href} style={{ ...ROW_LINK, color: active ? '#fff' : '#C9D6EC', background: active ? '#1A5CB8' : 'transparent' }} onClick={onClick}>
      <item.Icon size={18} />
      <span>{item.label}</span>
    </Link>
  );
}

// ── Styles ──────────────────────────────────────────────────────

function tab(active: boolean): CSSProperties {
  return {
    flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
    justifyContent: 'center', gap: 3, padding: '6px 2px',
    background: 'transparent', border: 'none', cursor: 'pointer',
    color: active ? 'var(--accent)' : 'var(--fg-3)', textDecoration: 'none',
    fontWeight: active ? 600 : 400, fontFamily: 'inherit', minWidth: 0,
  };
}
const TAB_LABEL: CSSProperties = { fontSize: 10, fontWeight: 600, letterSpacing: '0.02em' };

const BACKDROP: CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(5,11,22,0.55)' };

const SHEET: CSSProperties = {
  position: 'fixed', left: 0, right: 0, bottom: 0,
  maxHeight: '78vh', overflowY: 'auto',
  background: 'var(--brand-navy)', borderTopLeftRadius: 16, borderTopRightRadius: 16,
  boxShadow: '0 -12px 40px rgba(0,0,0,0.5)',
  paddingBottom: 'calc(16px + env(safe-area-inset-bottom, 0px))',
};
const SHEET_HANDLE_WRAP: CSSProperties = { display: 'flex', justifyContent: 'center', padding: '8px 0 2px' };
const SHEET_HANDLE: CSSProperties = { width: 38, height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.25)' };
const SHEET_HEAD: CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  padding: '6px 16px 10px', borderBottom: '1px solid rgba(255,255,255,0.08)',
};
const SHEET_BODY: CSSProperties = { padding: '10px 8px' };
const CLOSE_BTN: CSSProperties = {
  background: 'transparent', border: 'none', color: '#8BA3C7', cursor: 'pointer',
  width: 30, height: 30, display: 'grid', placeItems: 'center', borderRadius: 6,
};
const GROUP_LABEL: CSSProperties = {
  fontSize: 10, fontWeight: 700, color: '#00B4D8', textTransform: 'uppercase',
  letterSpacing: '0.12em', padding: '10px 14px 4px',
};
const ROW_LINK: CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 12, padding: '11px 14px',
  borderRadius: 7, fontSize: 14, color: '#C9D6EC', textDecoration: 'none', fontWeight: 500,
};
const ROW_BTN: CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 12, width: '100%', padding: '11px 14px',
  borderRadius: 7, fontSize: 14, color: '#C9D6EC', background: 'transparent', border: 'none',
  cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left',
};
const SWITCH_TRACK: CSSProperties = { position: 'relative', display: 'inline-block', width: 30, height: 16, borderRadius: 999, flexShrink: 0, transition: 'background 0.18s' };
const SWITCH_KNOB: CSSProperties = { position: 'absolute', top: 2, left: 2, width: 12, height: 12, borderRadius: '50%', background: '#fff', transition: 'transform 0.18s' };
