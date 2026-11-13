'use client';

// The Reports landing page: what you have, what was sent to you, and four
// places to start.
//
// Templates are first for anybody with nothing saved, because a blank report
// builder is the worst possible first screen for this feature — the people it
// is for do not know what a measure is, and they should not have to. Opening
// a finished Sales overview and changing the date range teaches more in ten
// seconds than any empty canvas.

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { TEMPLATES } from '@/lib/custom-analytics/templates';
import { createFromTemplate, deleteReport, pinReport } from '@/app/actions/risansi-reports';
import type { ReportSummary } from '@/app/actions/risansi-reports';

type Tab = 'mine' | 'shared' | 'templates';

export function ReportsHome({ mine, shared, canBuild }: {
  mine: ReportSummary[]; shared: ReportSummary[]; canBuild: boolean;
}) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [note, setNote] = useState<string | null>(null);
  // Somebody with nothing saved lands on the templates, which is the only
  // tab that can tell them what this is for.
  const [tab, setTab] = useState<Tab>(mine.length ? 'mine' : shared.length ? 'shared' : 'templates');

  const pinnedFirst = (rs: ReportSummary[]) =>
    [...rs].sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned));

  const use = (key: string) => start(async () => {
    const r = await createFromTemplate(key);
    if (r.ok) router.push(`/risansi/reports/${r.data.id}`);
    else setNote(r.error);
  });

  const remove = (r: ReportSummary) => start(async () => {
    if (!window.confirm(`Delete "${r.title}"? Anybody it was shared with loses it too. This cannot be undone.`)) return;
    const res = await deleteReport(r.id);
    if (res.ok) router.refresh(); else setNote(res.error);
  });

  const pin = (r: ReportSummary) => start(async () => {
    const res = await pinReport(r.pinned ? null : r.id);
    if (res.ok) router.refresh(); else setNote(res.error);
  });

  return (
    <div style={{ padding: '18px 22px 40px', display: 'flex', flexDirection: 'column', gap: 14 }}>
      <header>
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 600, color: 'var(--fg)' }}>Reports</h1>
        <p style={{ margin: '4px 0 0', fontSize: 12.5, color: 'var(--fg-3)', maxWidth: 640 }}>
          Build a report once and read it every month. Every figure is computed against
          the accounts you can see, so a report shared with you shows your own numbers,
          not the author&apos;s.
        </p>
      </header>

      {note && (
        <div role="alert" style={{ fontSize: 12, color: 'var(--neg)', background: 'var(--neg-soft)',
                                   border: '1px solid var(--neg)', borderRadius: 5, padding: '6px 10px' }}>
          {note}
        </div>
      )}

      <nav style={{ display: 'flex', gap: 2, borderBottom: '1px solid var(--line)' }}>
        {([['mine', `Mine${mine.length ? ` (${mine.length})` : ''}`],
           ['shared', `Shared with me${shared.length ? ` (${shared.length})` : ''}`],
           ['templates', 'Start from a template']] as [Tab, string][]).map(([t, label]) => (
          <button key={t} type="button" onClick={() => setTab(t)}
            style={{
              background: 'none', border: 'none', fontFamily: 'inherit', cursor: 'pointer',
              borderBottom: `2px solid ${tab === t ? 'var(--accent)' : 'transparent'}`,
              padding: '7px 13px', fontSize: 12.5,
              color: tab === t ? 'var(--fg)' : 'var(--fg-3)', fontWeight: tab === t ? 600 : 400,
            }}>{label}</button>
        ))}
      </nav>

      {tab === 'mine' && (
        mine.length
          ? <Grid>{pinnedFirst(mine).map(r => (
              <Card key={r.id} r={r} mine busy={busy} onPin={() => pin(r)} onDelete={() => remove(r)} />
            ))}</Grid>
          : <Blank>
              Nothing saved yet.{' '}
              {canBuild
                ? <button type="button" onClick={() => setTab('templates')} style={LINK}>Start from a template</button>
                : 'Reports built by your colleagues will appear under “Shared with me”.'}
            </Blank>
      )}

      {tab === 'shared' && (
        shared.length
          ? <Grid>{pinnedFirst(shared).map(r => (
              <Card key={r.id} r={r} mine={false} busy={busy} onPin={() => pin(r)} />
            ))}</Grid>
          : <Blank>Nobody has shared a report with you.</Blank>
      )}

      {tab === 'templates' && (
        canBuild ? (
          <Grid>
            {TEMPLATES.map(t => (
              <div key={t.key} style={CARD}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 17 }} aria-hidden>{t.icon}</span>
                  <h2 style={{ margin: 0, fontSize: 14, fontWeight: 600, color: 'var(--fg)' }}>{t.title}</h2>
                </div>
                <p style={{ margin: 0, fontSize: 12, color: 'var(--fg-3)' }}>{t.description}</p>
                <ul style={{ margin: 0, paddingLeft: 16, display: 'flex', flexDirection: 'column', gap: 2 }}>
                  {t.answers.map(a => (
                    <li key={a} style={{ fontSize: 11.5, color: 'var(--fg-2)' }}>{a}</li>
                  ))}
                </ul>
                <div style={{ marginTop: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <button type="button" onClick={() => use(t.key)} disabled={busy}
                    style={{ ...BTN, background: 'var(--accent-fill)', color: '#fff', borderColor: 'transparent' }}>
                    Use this
                  </button>
                  <span style={{ fontSize: 10.5, color: 'var(--fg-4)' }}>
                    {t.doc.pages.length} {t.doc.pages.length === 1 ? 'page' : 'pages'},{' '}
                    {t.doc.pages.reduce((n, p) => n + p.visuals.length, 0)} cards
                  </span>
                </div>
              </div>
            ))}
          </Grid>
        ) : (
          <Blank>
            Building reports is for sales reps and above. You can open and read
            anything a colleague shares with you.
          </Blank>
        )
      )}
    </div>
  );
}

// ── pieces ────────────────────────────────────────────────────

function Grid({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: 'grid', gap: 10,
                  gridTemplateColumns: 'repeat(auto-fill, minmax(255px, 1fr))' }}>
      {children}
    </div>
  );
}

function Card({ r, mine, busy, onPin, onDelete }: {
  r: ReportSummary; mine: boolean; busy: boolean;
  onPin: () => void; onDelete?: () => void;
}) {
  return (
    <div style={{ ...CARD, borderColor: r.pinned ? 'var(--accent-line)' : 'var(--line)' }}>
      <Link href={`/risansi/reports/${r.id}`}
        style={{ textDecoration: 'none', display: 'flex', flexDirection: 'column', gap: 4 }}>
        <h2 style={{ margin: 0, fontSize: 14, fontWeight: 600, color: 'var(--fg)' }}>
          {r.pinned && <span style={{ color: 'var(--accent)', marginRight: 5 }} title="Pinned">★</span>}
          {r.title}
        </h2>
        {r.description && (
          <p style={{ margin: 0, fontSize: 11.5, color: 'var(--fg-3)' }}>{r.description}</p>
        )}
      </Link>
      <div style={{ marginTop: 'auto', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 10.5, color: 'var(--fg-4)', flex: 1, minWidth: 0 }}>
          {mine
            ? `Changed ${when(r.updatedAt)}${r.shareCount ? ` · shared with ${r.shareCount}` : ''}`
            : `From ${r.ownerName ?? 'a colleague'} · ${when(r.updatedAt)}`}
        </span>
        <button type="button" onClick={onPin} disabled={busy} style={SMALL}
          title={r.pinned ? 'Unpin' : 'Pin this to the top'}>{r.pinned ? '★' : '☆'}</button>
        {onDelete && (
          <button type="button" onClick={onDelete} disabled={busy}
            style={{ ...SMALL, color: 'var(--neg)' }} title="Delete this report">Delete</button>
        )}
      </div>
    </div>
  );
}

function Blank({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ padding: '34px 20px', textAlign: 'center', color: 'var(--fg-3)', fontSize: 13,
                  background: 'var(--bg-paper)', border: '1px dashed var(--line-strong)', borderRadius: 8 }}>
      {children}
    </div>
  );
}

/** "today", "yesterday", "3 days ago", or the date once that stops meaning much. */
function when(iso: string): string {
  const t = new Date(iso.replace(' ', 'T'));
  if (Number.isNaN(t.getTime())) return iso.slice(0, 10);
  const days = Math.floor((Date.now() - t.getTime()) / 86400000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 14) return `${days} days ago`;
  return t.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: '2-digit' });
}

const CARD: React.CSSProperties = {
  background: 'var(--bg-paper)', border: '1px solid var(--line)', borderRadius: 7,
  padding: 13, display: 'flex', flexDirection: 'column', gap: 8, minHeight: 128,
};

const BTN: React.CSSProperties = {
  background: 'var(--bg-paper)', border: '1px solid var(--line)', borderRadius: 5,
  padding: '5px 11px', fontSize: 12, color: 'var(--fg-2)', cursor: 'pointer', fontFamily: 'inherit',
};

const SMALL: React.CSSProperties = {
  background: 'none', border: 'none', padding: '2px 5px', fontSize: 11,
  color: 'var(--fg-3)', cursor: 'pointer', fontFamily: 'inherit',
};

const LINK: React.CSSProperties = {
  background: 'none', border: 'none', padding: 0, fontSize: 13,
  color: 'var(--accent)', cursor: 'pointer', fontFamily: 'inherit', textDecoration: 'underline',
};
