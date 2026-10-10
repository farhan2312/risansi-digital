'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { CSSProperties } from 'react';
import { UserMenu } from './UserMenu';

// ── Types ─────────────────────────────────────────────────────

export type SidebarRole = 'staff' | 'rep' | 'manager' | 'exec' | 'admin' | 'sysadmin';

export interface SidebarUser {
  name: string;
  initials: string;
  role: string;
  email: string;
}

export interface SidebarAlerts {
  tasks?: number;
  compete?: number;
  admin?: number;
}

export interface SidebarProps {
  active?: string;
  role: SidebarRole;
  user: SidebarUser;
  alerts?: SidebarAlerts;
  pendingCount?: number;
}

// ── Nav item definitions ───────────────────────────────────────

interface NavItem {
  id: string;
  href: string;
  label: string;
  Icon: () => React.JSX.Element;
  alertKey?: keyof SidebarAlerts;
  isAlert?: boolean;
}

// GROUP 1 — Sales (all roles)
const SALES_NAV: NavItem[] = [
  { id: 'dash',      href: '/risansi',          label: 'Dashboard',      Icon: IcDash },
  { id: 'registry',  href: '/risansi/registry', label: 'Action Registry', Icon: IcTasks },
  { id: 'client360', href: '/risansi/clients',  label: 'Client 360',     Icon: IcClient },
  { id: 'field',     href: '/risansi/field',    label: 'Field Activity', Icon: IcMap },
  { id: 'revenue',   href: '/risansi/revenue',  label: 'Revenue',        Icon: IcBag },
  { id: 'pipeline',  href: '/risansi/pipeline', label: 'Opportunities',  Icon: IcPipeline },
  { id: 'compete',   href: '/risansi/compete',  label: 'Competition',    Icon: IcTower, alertKey: 'compete' },
  { id: 'complaints',href: '/risansi/complaints', label: 'Complaints',   Icon: IcAlert },
  { id: 'exhibitions', href: '/risansi/exhibitions', label: 'Exhibitions', Icon: IcList },
  // Open to every role — scoped server-side: admins see every TSM/account,
  // managers their own team, reps only themselves.
  { id: 'exec-review', href: '/risansi/executive-review', label: 'Executive Review', Icon: IcDash },
];

// GROUP 2 — Admin (admin / sysadmin only)
const ADMIN_NAV: NavItem[] = [
  { id: 'clients-admin', href: '/risansi/admin/clients', label: 'Client Master',  Icon: IcList },
  { id: 'revenue-admin', href: '/risansi/admin/revenue', label: 'Revenue Upload', Icon: IcBag },
  { id: 'outstanding-admin', href: '/risansi/admin/outstanding', label: 'Outstanding Upload', Icon: IcBag },
  { id: 'pumps-admin',   href: '/risansi/admin/pumps',   label: 'Pump Ingestion', Icon: IcPump },
  // The complaint module's editable parts: its dropdown lists, who an action
  // assigns to, and the overdue thresholds. Admin rather than sysadmin, because
  // the Complaint Team is who revises them.
  { id: 'complaints-admin', href: '/risansi/admin/complaints', label: 'Complaint Settings', Icon: IcAlert },
];

// GROUP 3 — System Admin (sysadmin only)
const SYSADMIN_ITEM: NavItem = {
  id: 'access', href: '/admin', label: 'Users & Access', Icon: IcUser, isAlert: true,
};

const SYSADMIN_NAV: NavItem[] = [
  { id: 'reps-admin',     href: '/risansi/admin/reps',     label: 'Reps & Managers', Icon: IcTeam },
  { id: 'recover-admin',  href: '/risansi/admin/recoverable', label: 'Recoverable',  Icon: IcUndo },
  { id: 'bugs-admin',     href: '/risansi/admin/bugs',     label: 'Bugs',            Icon: IcBug },
  { id: 'audit-admin',    href: '/risansi/admin/audit',    label: 'Audit Log',       Icon: IcClipboard },
  { id: 'settings-admin', href: '/risansi/admin/settings', label: 'Settings',        Icon: IcGear },
];

// Path → id mapping for URL-based active derivation
const PATH_TO_ID: [string, string][] = [
  ['/admin',                    'access'],
  ['/risansi/admin/users',      'access'],   // legacy route → redirects to /admin
  // Both of these redirect into Reps & Managers, so they light the same lamp.
  ['/risansi/admin/tours',      'reps-admin'],
  ['/risansi/admin/unassigned', 'reps-admin'],
  ['/risansi/admin/recoverable', 'recover-admin'],
  ['/risansi/admin/audit',      'audit-admin'],
  ['/risansi/admin/settings',   'settings-admin'],
  ['/risansi/executive-review', 'exec-review'],
  ['/risansi/admin/clients',    'clients-admin'],
  ['/risansi/admin/revenue',    'revenue-admin'],
  ['/risansi/admin/outstanding', 'outstanding-admin'],
  ['/risansi/admin/pumps',      'pumps-admin'],
  ['/risansi/admin/complaints', 'complaints-admin'],
  ['/risansi/admin/reps',       'reps-admin'],
  ['/risansi/admin/bugs',       'bugs-admin'],
  ['/risansi/exhibitions',      'exhibitions'],
  ['/risansi/compete',          'compete'],
  ['/risansi/complaints',       'complaints'],
  ['/risansi/clients',          'client360'],
  ['/risansi/pipeline',         'pipeline'],
  ['/risansi/field',            'field'],
  ['/risansi/visits',           'field'],   // visit report/coverage routes belong to Field Activity
  ['/risansi/revenue',          'revenue'],
  ['/risansi/registry',         'registry'],
  ['/risansi',                  'dash'],
];

function deriveActive(pathname: string): string {
  for (const [path, id] of PATH_TO_ID) {
    // Exact match always wins. Prefix match (sub-routes) applies to every
    // entry EXCEPT the dashboard root — otherwise '/risansi' would light up
    // for every '/risansi/*' page.
    if (pathname === path) return id;
    if (path !== '/risansi' && pathname.startsWith(path + '/')) return id;
  }
  return '';
}

// ── Component ─────────────────────────────────────────────────

export function Sidebar({ active, role, user, alerts = {}, pendingCount = 0 }: SidebarProps) {
  const pathname = usePathname();
  const resolvedActive = active ?? deriveActive(pathname);

  const isAdmin    = role === 'admin' || role === 'sysadmin';
  const isSysAdmin = role === 'sysadmin';
  // Staff get the two screens they are allowed to open. Showing them the rest
  // greyed out or clickable-then-refused teaches people the portal is broken
  // for them; proxy.ts enforces the same list on the way in.
  const isStaffRole = role === 'staff';
  const salesNav = isStaffRole
    ? SALES_NAV.filter(i => i.id === 'client360' || i.id === 'complaints')
    : SALES_NAV;

  return (
    <aside style={ASIDE}>
      {/* Brand */}
      <div style={LOGO_CARD}>
        <div style={{ background: '#fff', borderRadius: 8, padding: '6px 10px', display: 'inline-flex', alignItems: 'center' }}>
          <img src="/logo.png" alt="Risansi Industries Ltd" style={{ height: '40px', width: 'auto', objectFit: 'contain', display: 'block' }} />
        </div>
      </div>

      {/* GROUP 1: Sales — all roles. Staff see two of these. */}
      <NavGroup label={isStaffRole ? 'Complaints' : 'Sales'}>
        {salesNav.map((item) => (
          <NavLink
            key={item.id}
            item={item}
            isActive={item.id === resolvedActive}
            badge={item.alertKey ? alerts[item.alertKey] : undefined}
          />
        ))}
      </NavGroup>

      {/* GROUP 2: Admin — admin / sysadmin only */}
      {isAdmin && (
        <NavGroup label="Admin">
          {ADMIN_NAV.map((item) => (
            <NavLink
              key={item.id}
              item={item}
              isActive={item.id === resolvedActive}
            />
          ))}
        </NavGroup>
      )}

      {/* GROUP 3: System Admin — sysadmin only */}
      {isSysAdmin && (
        <div style={{
          borderTop: '1px solid rgba(255,255,255,0.08)',
          marginTop: 12,
          paddingTop: 12,
        }}>
          <div style={{
            fontSize: 10, fontWeight: 600,
            color: '#00B4D8',
            textTransform: 'uppercase' as const,
            letterSpacing: '0.12em',
            padding: '0 0 6px 16px',
          }}>
            System Admin
          </div>
          <div style={{ padding: '0 8px 4px' }}>
            <NavLink
              item={SYSADMIN_ITEM}
              isActive={resolvedActive === 'access'}
              badge={pendingCount > 0 ? pendingCount : undefined}
            />
            {SYSADMIN_NAV.map(item => (
              <NavLink
                key={item.id}
                item={item}
                isActive={item.id === resolvedActive}
              />
            ))}
          </div>
        </div>
      )}

      {/* User */}
      <UserMenu name={user.name} email={user.email} role={user.role} />
    </aside>
  );
}

// ── Sub-components ────────────────────────────────────────────

function NavGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ padding: '0 8px 4px' }}>
      <div style={GROUP_LABEL}>{label}</div>
      {children}
    </div>
  );
}

function NavLink({ item, isActive, badge }: {
  item: NavItem;
  isActive: boolean;
  badge?: number;
}) {
  const { href, label, Icon } = item;
  return (
    <Link href={href} style={{ textDecoration: 'none', display: 'block' }}>
      <div style={{
        ...LINK_BASE,
        color:      isActive ? '#FFFFFF' : '#B8C9E8',
        background: isActive ? '#1A5CB8' : 'transparent',
      }}>
        {isActive && <span style={ACTIVE_BAR} />}
        <Icon />
        <span style={{ flex: 1 }}>{label}</span>
        {badge != null && (
          <span style={{
            ...BADGE,
            background: item.isAlert ? 'var(--neg-fill)' : 'rgba(255,255,255,0.12)',
          }}>{badge}</span>
        )}
      </div>
    </Link>
  );
}

// ── Styles ─────────────────────────────────────────────────────

const ASIDE: CSSProperties = {
  width: 240, flexShrink: 0,
  background: 'var(--brand-navy)', color: '#B8C9E8',
  display: 'flex', flexDirection: 'column',
  padding: 0, paddingBottom: 18,
  borderRight: '1px solid rgba(255,255,255,0.06)',
  height: '100%', overflowX: 'hidden', overflowY: 'auto',
};

const LOGO_CARD: CSSProperties = {
  display: 'flex', alignItems: 'center', padding: '16px 16px 12px',
};

const GROUP_LABEL: CSSProperties = {
  margin: '20px 0 6px 8px', fontSize: 10,
  textTransform: 'uppercase', letterSpacing: '0.12em',
  color: '#00B4D8', fontWeight: 600,
};

const LINK_BASE: CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 10,
  padding: '7px 10px', borderRadius: 5,
  fontSize: 13.5, fontWeight: 500, letterSpacing: '0.01em',
  position: 'relative', cursor: 'pointer',
};

const ACTIVE_BAR: CSSProperties = {
  position: 'absolute', left: -8, top: 6, bottom: 6,
  width: 3, borderRadius: 2, background: '#00B4D8',
};

const BADGE: CSSProperties = {
  color: '#fff', padding: '1px 6px', borderRadius: 8,
  fontSize: 10, fontFamily: 'var(--font-mono)',
};

// ── Icons ─────────────────────────────────────────────────────

const ic = (path: React.ReactNode) => () => (
  <svg width={15} height={15} viewBox="0 0 16 16" fill="none"
       stroke="currentColor" strokeWidth={1.5}
       strokeLinecap="round" strokeLinejoin="round">
    {path}
  </svg>
);

function IcDash()     { return ic(<><rect x="2" y="2" width="5" height="6" rx="1"/><rect x="9" y="2" width="5" height="4" rx="1"/><rect x="2" y="10" width="5" height="4" rx="1"/><rect x="9" y="8" width="5" height="6" rx="1"/></>)(); }
function IcCal()      { return ic(<><rect x="2" y="3" width="12" height="11" rx="1.5"/><path d="M5 2v2M11 2v2M2 7h12"/></>)(); }
function IcClient()   { return ic(<><path d="M2 14V6l6-3 6 3v8"/><path d="M6 14V9h4v5"/></>)(); }
function IcMap()      { return ic(<><path d="M2 4l4-1 4 1 4-1v9l-4 1-4-1-4 1z"/><path d="M6 3v10M10 4v10"/></>)(); }
function IcPipeline() { return ic(<path d="M3 4h10M4 8h8M5 12h6"/>)(); }
function IcTasks()    { return ic(<><path d="M6 4h8M6 8h8M6 12h8"/><path d="M2.5 4l1 1 1.5-1.5M2.5 8l1 1 1.5-1.5M2.5 12l1 1 1.5-1.5"/></>)(); }
function IcTower()    { return ic(<><path d="M2 14V8l6-5 6 5v6"/><circle cx="8" cy="9" r="1.5"/></>)(); }
function IcBag()      { return ic(<><path d="M3 6h10l-1 8H4z"/><path d="M6 6V4a2 2 0 0 1 4 0v2"/></>)(); }
function IcPump()     { return ic(<path d="M8 2c2.6 3 4 5.2 4 7.2a4 4 0 0 1-8 0c0-2 1.4-4.2 4-7.2z"/>)(); }
function IcList()     { return ic(<><path d="M3 4h10M3 8h10M3 12h6"/></>)(); }
function IcUser()     { return ic(<><circle cx="8" cy="6" r="3"/><path d="M2 14c0-3 2.7-5 6-5s6 2 6 5"/></>)(); }
function IcKey()      { return ic(<><circle cx="6.5" cy="9.5" r="3.5"/><path d="M10 6l4-4M12 4l2 2M10 8l1.5-1.5"/></>)(); }
function IcClipboard(){ return ic(<><rect x="3" y="3" width="10" height="11" rx="1.5"/><path d="M6 3V2h4v1M5.5 7h5M5.5 10h3"/></>)(); }
function IcGear()     { return ic(<><circle cx="8" cy="8" r="2"/><path d="M8 1v2M8 13v2M1 8h2M13 8h2M3 3l1.5 1.5M11.5 11.5L13 13M13 3l-1.5 1.5M4.5 11.5L3 13"/></>)(); }
function IcAlert()    { return ic(<><path d="M8 2 1.5 13.5h13z"/><path d="M8 6.5v3M8 11.5h.01"/></>)(); }
function IcBug()      { return ic(<><path d="M5.5 6.5a2.5 2.5 0 0 1 5 0v3a2.5 2.5 0 0 1-5 0z"/><path d="M8 4V2.5M6 4.8 4.6 3.4M10 4.8l1.4-1.4M5.3 8H2.8M10.7 8h2.5M5.3 11 3.9 12.4M10.7 11l1.4 1.4"/></>)(); }
function IcTeam()     { return ic(<><circle cx="5.5" cy="6" r="2.3"/><circle cx="11" cy="6.5" r="1.9"/><path d="M1.5 13.5c0-2.3 1.8-3.8 4-3.8s4 1.5 4 3.8"/><path d="M10.5 10c2 0 4 1.3 4 3.5"/></>)(); }
function IcUndo()     { return ic(<><path d="M2.5 7.5A5.5 5.5 0 1 1 4 12"/><path d="M2 4v3.5h3.5"/></>)(); }
