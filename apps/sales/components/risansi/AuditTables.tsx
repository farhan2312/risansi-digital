'use client';

// The audit page's summary tables, as client islands.
//
// Everything on the Logins / Activity / Changes / Exhibitions tabs is one page
// of a long trail and sorts in SQL. These four are the opposite: each one is a
// complete, already-aggregated set — every person active in the window, every
// page they opened, every session — handed over as a plain array. There is no
// second page to be wrong about, so the sort belongs in memory, where it costs
// a click instead of a round trip.
//
// The cells print strings the server already formatted (durations, dates), and
// each column sorts on the number or the ISO date underneath rather than on
// "2h 05m", which as text would put 2 hours below 45 minutes.

import type { CSSProperties } from 'react';
import Link from 'next/link';
import { Tag } from '@/components/risansi';
import { useTableSort, SortTH } from '@/components/risansi/SortTH';
import { MobileSort } from '@/components/risansi/MobileSort';
import type { SortableColumn } from '@/lib/risansi-table-sort';
import type { OverallData } from '@/lib/risansi-audit-overall';

// ── Row shapes ─────────────────────────────────────────────────
//
// Pre-formatted on the server, which is what keeps the duration and date
// helpers in one place instead of copied into the browser bundle.

export interface UsageUserRow {
  email: string;
  role: string | null;
  total: number; totalLabel: string;
  sessions: number;
  pages: number;
  lastActive: string | null; lastActiveLabel: string;
}

export interface UsagePageRow {
  path: string;
  label: string;
  total: number; totalLabel: string;
  hits: number;
}

export interface UsageSessionRow {
  key: string;
  started: string | null; startedLabel: string;
  active: number; activeLabel: string;
  span: number; spanLabel: string;
}

// ── Who is doing the work (the Overall tab) ────────────────────

// What each column means, on hover. Written out because every one of these
// has been asked about, and "Sessions" in particular is not what it sounds like.
export const COL_HELP: Record<string, string> = {
  Hours:
    'Time with the portal actually in front of them, in the chosen window. Counted only while the tab is visible and there has been a click, key or scroll in the last 60 seconds; a tab left open in the background counts nothing. Summed across all pages.',
  Sessions:
    'How many separate browser tabs or windows they opened the portal in, in the chosen window. A session starts when a tab first loads the portal and ends when that tab is closed — so someone who works in three tabs, or closes and reopens the browser, counts several sessions in one sitting. It is a count of openings, not of working days.',
  Days:
    'Calendar days (Indian time) on which they did anything in the portal, in the chosen window. The window is whole days ending today — "7 days" is today and the six before it — so this can never exceed the window.',
  Records:
    'Things they created, changed or deleted in the chosen window — clients, visits, opportunities, actions, complaints, uploads. One count per saved change, from the audit log. Reading pages does not count.',
  'Clients owned':
    'Clients where they are the primary rep, as it stands today. Not windowed: it is the size of their book, the denominator the other columns should be read against.',
  'Last seen':
    'The most recent day they did anything in the portal, regardless of the window.',
};

type PersonRow = OverallData['people'][number];

const PEOPLE_COLS: SortableColumn<PersonRow>[] = [
  { key: 'name',         kind: 'text' },
  { key: 'role',         kind: 'text' },
  { key: 'zone',         kind: 'text' },
  { key: 'hours',        kind: 'number' },
  { key: 'sessions',     kind: 'number' },
  { key: 'days',         kind: 'number' },
  { key: 'records',      kind: 'number' },
  { key: 'clientsOwned', kind: 'number' },
  // Already 'YYYY-MM-DD' out of the query, and a person who has never been
  // seen has null here — which sinks to the bottom either way rather than
  // pretending to be the oldest date on record.
  { key: 'lastSeen',     kind: 'date' },
];

/**
 * Everyone, measured against the size of their book.
 *
 * The default order is the one the query chose, and a third click puts it back:
 * several of the reasons to open this table (who is quiet over a large book)
 * are visible in that order and in no other.
 */
export function AuditPeopleTable({ rows, print = false }: { rows: PersonRow[]; print?: boolean }) {
  const maxH = Math.max(...rows.map(r => r.hours), 0.1);
  const maxR = Math.max(...rows.map(r => r.records), 1);
  const { rows: shown, sortBy } = useTableSort(rows, PEOPLE_COLS);

  // In the PDF the headers are plain. There is nothing to click on paper, and
  // the global print stylesheet only hides real <button>s — these arrows are a
  // span, so they would have printed as faint clutter beside every label.
  const col = print ? () => ({ sortable: false as const }) : sortBy;

  const help = (h: string): CSSProperties => ({
    ...OV_TH,
    cursor: COL_HELP[h] ? 'help' : undefined,
    textDecoration: COL_HELP[h] ? 'underline dotted' : undefined,
    textUnderlineOffset: 3,
  });

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead>
          <tr style={{ background: 'var(--bg-elev)' }}>
            <SortTH {...col('name')} style={OV_TH}>Person</SortTH>
            <SortTH {...col('role')} style={OV_TH}>Role</SortTH>
            <SortTH {...col('zone')} style={OV_TH}>Zone</SortTH>
            <SortTH {...col('hours')} style={help('Hours')} align="right" title={COL_HELP.Hours}>Hours</SortTH>
            {/* The bar beside Hours. It draws the number in the column to its
                left, so it carries no order of its own. */}
            <th style={{ ...OV_TH, textAlign: 'right' }} />
            <SortTH {...col('sessions')} style={help('Sessions')} align="right" title={COL_HELP.Sessions}>Sessions</SortTH>
            <SortTH {...col('days')} style={help('Days')} align="right" title={COL_HELP.Days}>Days</SortTH>
            <SortTH {...col('records')} style={help('Records')} align="right" title={COL_HELP.Records}>Records</SortTH>
            {/* The bar beside Records. */}
            <th style={{ ...OV_TH, textAlign: 'right' }} />
            <SortTH {...col('clientsOwned')} style={help('Clients owned')} align="right" title={COL_HELP['Clients owned']}>Clients owned</SortTH>
            <SortTH {...col('lastSeen')} style={help('Last seen')} align="right" title={COL_HELP['Last seen']}>Last seen</SortTH>
          </tr>
        </thead>
        <tbody>
          {shown.map(p => {
            // A big book and no activity is the row worth seeing, so it is
            // coloured rather than left to be spotted by scanning two columns.
            const idle = p.hours < 0.5 && p.clientsOwned >= 25;
            // Three states, one tint each, in order of how much they matter.
            // Never signed in and quiet-with-a-large-book are the red ones;
            // dormant — signed in once, nothing in 30 days — is amber, because
            // it is a person drifting away rather than a person who never came.
            const tint = p.state === 'never' || idle ? 'var(--neg-soft)'
              : p.state === 'dormant' ? 'var(--warn-soft)'
              : undefined;
            return (
              <tr key={p.email} style={{ borderBottom: '1px solid var(--line-2)', background: tint }}>
                <td style={{ ...OV_TD, fontWeight: 500 }}>
                  {p.name}
                  {idle && <span style={{ fontSize: 10, color: 'var(--neg)', marginLeft: 7 }}>quiet, large book</span>}
                  {!idle && p.state === 'never' && <span style={{ fontSize: 10, color: 'var(--neg)', marginLeft: 7 }}>never signed in</span>}
                  {p.state === 'dormant' && <span style={{ fontSize: 10, color: 'var(--warn)', marginLeft: 7 }}>dormant</span>}
                </td>
                <td style={{ ...OV_TD, fontSize: 11, color: 'var(--fg-3)' }}>{p.role}</td>
                <td style={{ ...OV_TD, fontSize: 11, color: 'var(--fg-3)' }}>{p.zone || '—'}</td>
                <td style={{ ...OV_TD, textAlign: 'right', fontFamily: 'var(--font-mono)' }}>{p.hours || '—'}</td>
                <td style={{ ...OV_TD, width: 90 }}><MiniBar v={p.hours} max={maxH} colour="var(--accent)" /></td>
                <td style={{ ...OV_TD, textAlign: 'right', fontFamily: 'var(--font-mono)', color: 'var(--fg-3)' }}>{p.sessions || '—'}</td>
                <td style={{ ...OV_TD, textAlign: 'right', fontFamily: 'var(--font-mono)', color: 'var(--fg-3)' }}>{p.days || '—'}</td>
                <td style={{ ...OV_TD, textAlign: 'right', fontFamily: 'var(--font-mono)' }}>{p.records || '—'}</td>
                <td style={{ ...OV_TD, width: 90 }}><MiniBar v={p.records} max={maxR} colour="var(--pos)" /></td>
                <td style={{ ...OV_TD, textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: p.clientsOwned > 0 ? 600 : 400 }}>
                  {p.clientsOwned || '—'}
                </td>
                <td style={{ ...OV_TD, textAlign: 'right', fontSize: 11, color: p.lastSeen ? 'var(--fg-3)' : 'var(--neg)' }}>
                  {p.lastSeen ?? 'never'}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function MiniBar({ v, max, colour }: { v: number; max: number; colour: string }) {
  return (
    <div style={{ height: 7, background: 'var(--bg-sunk)', borderRadius: 3, overflow: 'hidden' }}>
      <div style={{ height: '100%', width: `${max > 0 ? Math.max((v / max) * 100, v > 0 ? 3 : 0) : 0}%`, background: colour }} />
    </div>
  );
}

// ── Usage & Time: everyone ─────────────────────────────────────

const USAGE_HELP: Record<string, string> = {
  'Active time': COL_HELP.Hours,
  Sessions: COL_HELP.Sessions,
  Pages: 'Distinct pages of the portal they opened in the window.',
  'Last active': COL_HELP['Last seen'],
};

// The labels are for the phone sort menu: this table is cards on a handset and
// the header row below is hidden, so the menu is the only way to reorder it there.
const USAGE_USER_COLS: SortableColumn<UsageUserRow>[] = [
  { key: 'email',      kind: 'text',   label: 'User' },
  { key: 'role',       kind: 'text',   label: 'Role' },
  // Seconds, not "1h 20m". The label is for reading; this is for ordering.
  { key: 'total',      kind: 'number', label: 'Active time' },
  { key: 'sessions',   kind: 'number', label: 'Sessions' },
  { key: 'pages',      kind: 'number', label: 'Pages' },
  { key: 'lastActive', kind: 'date',   label: 'Last active' },
];

export function UsageUsersTable({ rows, win }: { rows: UsageUserRow[]; win: string }) {
  const { rows: shown, sortBy, mobile } = useTableSort(rows, USAGE_USER_COLS);
  const link = (user: string) =>
    `/risansi/admin/audit?${new URLSearchParams({ tab: 'usage', win, user }).toString()}`;

  const th = (h: string): CSSProperties => ({
    ...TH,
    cursor: USAGE_HELP[h] ? 'help' : undefined,
    textDecoration: USAGE_HELP[h] ? 'underline dotted' : undefined,
    textUnderlineOffset: 3,
  });

  return (
    <>
    {/* Only shows on a phone, where the header row below is hidden. */}
    <div className="r-mobile-only" style={{ margin: '4px 0 8px' }}>
      <MobileSort {...mobile} />
    </div>
    <table className="r-cards" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
      <thead>
        <tr style={{ background: 'var(--bg-elev)' }}>
          <SortTH {...sortBy('email')} style={th('User')}>User</SortTH>
          <SortTH {...sortBy('role')} style={th('Role')}>Role</SortTH>
          <SortTH {...sortBy('total')} style={th('Active time')} title={USAGE_HELP['Active time']}>Active time</SortTH>
          <SortTH {...sortBy('sessions')} style={th('Sessions')} title={USAGE_HELP.Sessions}>Sessions</SortTH>
          <SortTH {...sortBy('pages')} style={th('Pages')} title={USAGE_HELP.Pages}>Pages</SortTH>
          <SortTH {...sortBy('lastActive')} style={th('Last active')} title={USAGE_HELP['Last active']}>Last active</SortTH>
        </tr>
      </thead>
      <tbody>
        {shown.length === 0 ? (
          <tr><td colSpan={6} style={EMPTY}>No activity recorded yet in this window. Data appears once users browse the portal.</td></tr>
        ) : shown.map((u, i) => (
          <tr key={u.email} style={{ borderBottom: i < shown.length - 1 ? '1px solid var(--line)' : 'none' }}>
            <td data-label="" style={{ ...TD, fontWeight: 500 }}>
              <Link href={link(u.email)} style={{ color: 'var(--accent)', textDecoration: 'none' }}>{u.email}</Link>
            </td>
            <td data-label="Role" style={TD}>
              {u.role ? <Tag kind={u.role === 'sysadmin' || u.role === 'admin' ? 'accent' : undefined}>{u.role}</Tag> : '—'}
            </td>
            <td data-label="Active time" style={{ ...MONO, color: 'var(--fg)', fontWeight: 600 }}>{u.totalLabel}</td>
            <td data-label="Sessions" style={MONO}>{u.sessions}</td>
            <td data-label="Pages" style={MONO}>{u.pages}</td>
            <td data-label="Last active" style={MONO}>{u.lastActiveLabel}</td>
          </tr>
        ))}
      </tbody>
    </table>
    </>
  );
}

// ── Usage & Time: one person ───────────────────────────────────

const USAGE_PAGE_COLS: SortableColumn<UsagePageRow>[] = [
  // The label, not the path: the column reads "Client 360 · detail", so A to Z
  // has to mean A to Z of what is on screen.
  { key: 'label', kind: 'text',   label: 'Page' },
  { key: 'total', kind: 'number', label: 'Active time' },
  { key: 'hits',  kind: 'number', label: 'Visits' },
];

export function UsagePagesTable({ rows }: { rows: UsagePageRow[] }) {
  const maxPage = Math.max(1, ...rows.map(p => p.total));
  const { rows: shown, sortBy, mobile } = useTableSort(rows, USAGE_PAGE_COLS);
  return (
    <>
    <div className="r-mobile-only" style={{ margin: '4px 0 8px' }}>
      <MobileSort {...mobile} />
    </div>
    <table className="r-cards" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
      <thead>
        <tr style={{ background: 'var(--bg-elev)' }}>
          <SortTH {...sortBy('label')} style={TH}>Page</SortTH>
          <SortTH {...sortBy('total')} style={TH}>Active time</SortTH>
          <SortTH {...sortBy('hits')} style={TH}>Visits</SortTH>
        </tr>
      </thead>
      <tbody>
        {shown.length === 0 ? <tr><td colSpan={3} style={EMPTY}>No page activity</td></tr> : shown.map((p, i) => (
          <tr key={p.path} style={{ borderBottom: i < shown.length - 1 ? '1px solid var(--line)' : 'none' }}>
            <td data-label="" style={{ ...TD, fontWeight: 500 }}>
              {p.label}
              <div style={{ height: 3, marginTop: 4, borderRadius: 2, background: 'var(--accent)', width: `${Math.round((p.total / maxPage) * 100)}%`, minWidth: 4, opacity: 0.5 }} />
            </td>
            <td data-label="Active time" style={{ ...MONO, color: 'var(--fg)' }}>{p.totalLabel}</td>
            <td data-label="Visits" style={MONO}>{p.hits}</td>
          </tr>
        ))}
      </tbody>
    </table>
    </>
  );
}

const USAGE_SESSION_COLS: SortableColumn<UsageSessionRow>[] = [
  { key: 'started', kind: 'date',   label: 'Started' },
  { key: 'active',  kind: 'number', label: 'Active time' },
  // Wall-clock between the first and last page view. Worked out on the server
  // so the column orders on seconds rather than on the printed "1h 04m".
  { key: 'span',    kind: 'number', label: 'Span' },
];

export function UsageSessionsTable({ rows }: { rows: UsageSessionRow[] }) {
  const { rows: shown, sortBy, mobile } = useTableSort(rows, USAGE_SESSION_COLS);
  return (
    <>
    <div className="r-mobile-only" style={{ margin: '4px 0 8px' }}>
      <MobileSort {...mobile} />
    </div>
    <table className="r-cards" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
      <thead>
        <tr style={{ background: 'var(--bg-elev)' }}>
          <SortTH {...sortBy('started')} style={TH}>Started</SortTH>
          <SortTH {...sortBy('active')} style={TH}>Active</SortTH>
          <SortTH {...sortBy('span')} style={TH}>Span</SortTH>
        </tr>
      </thead>
      <tbody>
        {shown.length === 0 ? <tr><td colSpan={3} style={EMPTY}>No sessions</td></tr> : shown.map((s, i) => (
          <tr key={s.key} style={{ borderBottom: i < shown.length - 1 ? '1px solid var(--line)' : 'none' }}>
            <td data-label="" style={MONO}>{s.startedLabel}</td>
            <td data-label="Active" style={{ ...MONO, color: 'var(--fg)' }}>{s.activeLabel}</td>
            <td data-label="Span" style={MONO}>{s.spanLabel}</td>
          </tr>
        ))}
      </tbody>
    </table>
    </>
  );
}

// ── Styles ─────────────────────────────────────────────────────
// Copied from the pages these tables were lifted out of, so the headers and
// cells look exactly as they did.

const TH: CSSProperties = { padding: '9px 12px', textAlign: 'left', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600, color: 'var(--fg-3)', borderBottom: '1px solid var(--line)', whiteSpace: 'nowrap' };
const TD: CSSProperties = { padding: '10px 12px', verticalAlign: 'middle' };
const MONO: CSSProperties = { ...TD, fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--fg-3)', whiteSpace: 'nowrap' };
const EMPTY: CSSProperties = { padding: '40px 0', textAlign: 'center', color: 'var(--fg-3)' };

const OV_TH: CSSProperties = { padding: '8px 10px', fontSize: 9.5, textTransform: 'uppercase', letterSpacing: '0.07em', fontWeight: 700, color: 'var(--fg-3)', borderBottom: '1px solid var(--line)', whiteSpace: 'nowrap', textAlign: 'left' };
const OV_TD: CSSProperties = { padding: '7px 10px', verticalAlign: 'middle', whiteSpace: 'nowrap' };
