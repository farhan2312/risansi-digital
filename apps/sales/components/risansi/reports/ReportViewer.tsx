'use client';

// Reading a saved report.
//
// Pages across the top, one filter bar under them, and the cards laid out on
// the twelve-column grid the document saved them on. Clicking a category on
// any card filters every other card on the page.
//
// WHAT THE READER CANNOT DO HERE
//
// Change the report. Filters and the cross-filter are reading positions, held
// in this component and never written back, so somebody poking about in a
// report shared with them cannot alter what its author saved. Taking a copy
// is the way to make it yours, and that is a separate report with your name
// on it.
//
// WHOSE NUMBERS THESE ARE
//
// The reader's. Every query runs under the scope of whoever has the page
// open, not the author's — so a manager and one of their reps open the same
// report and correctly see different totals. That is enforced server-side in
// runReportVisual; nothing here could widen it even if it tried.

import { useState, useTransition, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import type { ReportDoc, PageFilters } from '@/lib/custom-analytics/types';
import type { CrossFilter } from '@/lib/custom-analytics/engine';
import { DATASET_BY_ID } from '@/lib/custom-analytics/model';
import { pinReport, copyReport } from '@/app/actions/risansi-reports';
import { VisualCard, type PickedCategory } from './VisualCard';
import { FilterBar, type FilterOptions } from './FilterBar';
import { ShareDialog } from './ShareDialog';
import { downloadReportSheet } from './download';

export interface ReportViewerProps {
  id: number;
  title: string;
  description: string | null;
  ownerName: string | null;
  mine: boolean;
  canBuild: boolean;
  pinned: boolean;
  doc: ReportDoc;
  options: FilterOptions;
  /** Who it is shared with. Only ever populated for the owner. */
  shares: number[];
}

export function ReportViewer(p: ReportViewerProps) {
  const router = useRouter();
  const [tab, setTab] = useState(0);
  const [cross, setCross] = useState<CrossFilter | null>(null);
  const [pinned, setPinned] = useState(p.pinned);
  const [shareOpen, setShareOpen] = useState(false);
  const [shares, setShares] = useState(p.shares);
  const [exporting, setExporting] = useState<string | null>(null);
  // Kept apart from `note`: "shared with three people" in the red box reads
  // as something having gone wrong.
  const [flash, setFlash] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const [note, setNote] = useState<string | null>(null);

  // Filter overrides, per page. A page the reader has not touched reads from
  // the document, so re-opening a report shows what its author saved.
  const [overrides, setOverrides] = useState<Record<string, PageFilters>>({});

  const pages = p.doc.pages.length ? p.doc.pages : [];
  const page = pages[Math.min(tab, pages.length - 1)];
  const saved = page?.filters ?? {};
  const filters = page ? overrides[page.id] ?? saved : {};

  const crossLabel = useMemo(() => {
    if (!cross) return null;
    const ds = DATASET_BY_ID.get(cross.dataset);
    const f = ds?.fields.find(x => x.id === cross.field);
    return `${f?.label ?? cross.field}: ${cross.label ?? cross.value}`;
  }, [cross]);

  const pick = (c: PickedCategory) => {
    // Clicking the same value again clears it — a filter you set by clicking
    // should come off the same way, or the only way out is the chip and
    // somebody will not find it.
    setCross(prev =>
      prev && prev.dataset === c.dataset && prev.field === c.field && prev.value === c.value
        ? null
        : { dataset: c.dataset, field: c.field, grain: c.grain, value: c.value,
            common: c.common, label: c.label, sourceVisual: c.sourceVisual });
  };

  const togglePin = () => start(async () => {
    const want = !pinned;
    const r = await pinReport(want ? p.id : null);
    if (r.ok) { setPinned(want); router.refresh(); }
    else setNote(r.error);
  });

  /**
   * The page, or one card of it, as a workbook.
   *
   * The filters and the cross-filter go with it, so what arrives is what is
   * on screen — except that it is not folded into "Other" and not paged at
   * fifty rows, which is the whole reason for wanting it in Excel.
   */
  const download = (visualId?: string) => {
    if (!page) return;
    setExporting(visualId ?? 'page');
    void (async () => {
      const err = await downloadReportSheet({
        id: p.id, pageId: page.id, visualId, filters, cross,
      });
      setExporting(null);
      if (err) setNote(err);
    })();
  };

  const makeCopy = () => start(async () => {
    const r = await copyReport(p.id);
    if (r.ok) router.push(`/risansi/reports/${r.data.id}`);
    else setNote(r.error);
  });

  return (
    <div style={{ padding: '18px 22px 40px', display: 'flex', flexDirection: 'column', gap: 12 }}>
      <header style={{ display: 'flex', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 600, color: 'var(--fg)' }}>{p.title}</h1>
          <div style={{ fontSize: 11.5, color: 'var(--fg-3)', marginTop: 3 }}>
            {p.description && <span>{p.description} · </span>}
            {p.mine ? 'Yours' : `Shared by ${p.ownerName ?? 'a colleague'}`}
            {' · '}
            <span title="Every figure here is computed against the accounts you can see, not the author's.">
              your own figures
            </span>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
          <button type="button" onClick={togglePin} disabled={busy}
            title={pinned ? 'Stop showing this first on the Reports page' : 'Show this first on the Reports page'}
            style={{ ...BTN, borderColor: pinned ? 'var(--accent-line)' : 'var(--line)',
                     color: pinned ? 'var(--accent)' : 'var(--fg-2)' }}>
            {pinned ? '★ Pinned' : '☆ Pin'}
          </button>
          <button type="button" onClick={() => download()} disabled={!page || exporting === 'page'}
            style={BTN}
            title="This page as an Excel workbook, one sheet per card, with every row rather than the top fifteen">
            {exporting === 'page' ? 'Building…' : 'Excel'}
          </button>
          {p.mine && (
            <button type="button" onClick={() => setShareOpen(true)} style={BTN}
              title="Who else can read this report">
              Share{shares.length ? ` (${shares.length})` : ''}
            </button>
          )}
          {p.canBuild && (
            <button type="button" onClick={makeCopy} disabled={busy} style={BTN}
              title="A report of your own, starting from this one. The original is untouched.">
              Make a copy
            </button>
          )}
          {/* Only the owner, and only because the save would refuse anyway:
              the button is absent rather than present and failing. */}
          {p.mine && p.canBuild && (
            <Link href={`/risansi/reports/${p.id}/edit`}
              style={{ ...BTN, textDecoration: 'none', display: 'inline-block' }}
              title="Change the cards, the pages and the filters this report opens on">
              Edit
            </Link>
          )}
        </div>
      </header>

      {note && (
        <div role="alert" style={{ fontSize: 12, color: 'var(--neg)', background: 'var(--neg-soft)',
                                   border: '1px solid var(--neg)', borderRadius: 5, padding: '6px 10px' }}>
          {note}
        </div>
      )}

      {flash && (
        <div role="status" style={{ fontSize: 12, color: 'var(--fg-2)', background: 'var(--accent-soft)',
                                    border: '1px solid var(--accent-line)', borderRadius: 5,
                                    padding: '6px 10px', display: 'flex', gap: 8 }}>
          <span style={{ flex: 1 }}>{flash}</span>
          <button type="button" onClick={() => setFlash(null)}
            style={{ background: 'none', border: 'none', color: 'var(--fg-3)', cursor: 'pointer',
                     fontFamily: 'inherit', fontSize: 12 }}>✕</button>
        </div>
      )}

      {pages.length > 1 && (
        <nav style={{ display: 'flex', gap: 2, borderBottom: '1px solid var(--line)', flexWrap: 'wrap' }}>
          {pages.map((pg, i) => (
            <button key={pg.id} type="button" onClick={() => { setTab(i); setCross(null); }}
              style={{
                background: 'none', border: 'none', borderBottom: `2px solid ${i === tab ? 'var(--accent)' : 'transparent'}`,
                padding: '6px 12px', fontSize: 12.5, cursor: 'pointer', fontFamily: 'inherit',
                color: i === tab ? 'var(--fg)' : 'var(--fg-3)', fontWeight: i === tab ? 600 : 400,
              }}>
              {pg.name}
            </button>
          ))}
        </nav>
      )}

      {page && (
        <FilterBar value={filters} saved={saved} options={p.options}
          onChange={f => setOverrides(o => ({ ...o, [page.id]: f }))} />
      )}

      {cross && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 11, color: 'var(--fg-3)' }}>Everything below is filtered to</span>
          <button type="button" onClick={() => setCross(null)}
            title="Click to remove this filter"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'var(--accent-soft)',
                     border: '1px solid var(--accent-line)', borderRadius: 999, padding: '3px 10px',
                     fontSize: 11.5, color: 'var(--fg)', cursor: 'pointer', fontFamily: 'inherit' }}>
            {crossLabel}<span style={{ color: 'var(--fg-3)' }}>✕</span>
          </button>
        </div>
      )}

      {!page ? (
        <Blank>This report has no pages yet.</Blank>
      ) : !page.visuals.length ? (
        <Blank>Nothing on this page yet.</Blank>
      ) : (
        <div className="rpt-grid">
          {page.visuals.map(v => (
            <div key={v.id} style={{
              gridColumn: `${v.layout.x + 1} / span ${v.layout.w}`,
              gridRow: `${v.layout.y + 1} / span ${v.layout.h}`,
              minWidth: 0, minHeight: 0,
            }}>
              <VisualCard visual={v} filters={filters} cross={cross} onPick={pick}
                actions={
                  <button type="button"
                    onClick={e => { e.stopPropagation(); download(v.id); }}
                    disabled={exporting === v.id}
                    title="Just this card, as a sheet"
                    aria-label="Export this card to Excel"
                    style={{ background: 'none', border: 'none', padding: '0 2px', cursor: 'pointer',
                             color: 'var(--fg-4)', fontSize: 11, fontFamily: 'inherit' }}>
                    {exporting === v.id ? '…' : '⤓'}
                  </button>
                } />
            </div>
          ))}
        </div>
      )}

      {shareOpen && (
        <ShareDialog
          reportId={p.id} title={p.title} initial={shares}
          onClose={() => setShareOpen(false)}
          onDone={(message, picked) => {
            setShares(picked);
            setShareOpen(false);
            setFlash(message);
            router.refresh();
          }} />
      )}
    </div>
  );
}

function Blank({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ padding: 40, textAlign: 'center', color: 'var(--fg-3)', fontSize: 13,
                  background: 'var(--bg-paper)', border: '1px dashed var(--line-strong)', borderRadius: 8 }}>
      {children}
    </div>
  );
}

const BTN: React.CSSProperties = {
  background: 'var(--bg-paper)', border: '1px solid var(--line)', borderRadius: 5,
  padding: '5px 11px', fontSize: 12, color: 'var(--fg-2)', cursor: 'pointer', fontFamily: 'inherit',
};
