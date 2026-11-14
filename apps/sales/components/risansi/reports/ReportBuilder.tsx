'use client';

// Building a report.
//
// Three columns: the tables and their fields on the left, the page itself in
// the middle, and the selected card's contents on the right. Everything is
// held in this component until Save, so nothing a person tries is written
// anywhere until they say so — and until they do, Discard really does put it
// back the way it was.
//
// WHY A SEPARATE SCREEN FROM THE VIEWER
//
// Because the two have opposite jobs. A reader changes the filters and the
// report must not change; an author changes the filters and the report must.
// The page filter bar here edits the page's SAVED filters — the position
// every reader will open on — which is the same control doing the opposite
// thing, and that is not something to put behind a mode toggle on one screen.
//
// WHAT THE CARDS SHOW WHILE YOU BUILD
//
// Real figures, under your own scope, re-queried as you change them. A
// builder that draws fake bars until you press Run teaches nothing about
// whether the card is worth keeping.

import { useEffect, useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  MAX_PAGES, MAX_VISUALS_PER_PAGE, VISUAL_META,
  type ReportDoc, type ReportPage, type Visual, type VisualType,
  type Agg, type Grain,
} from '@/lib/custom-analytics/types';
import { fieldOf } from '@/lib/custom-analytics/model';
import {
  addToWell, addVisual, bestWell, changeDataset, changeType, duplicate, moveChip,
  moveTo, moveWithin, newId, newVisual, removeAt, resizeTo, setAgg, setGrain, suggestType, tidy,
  type Well,
} from '@/lib/custom-analytics/build';
import { emptyPage } from '@/lib/custom-analytics/doc';
import { DATASET_BY_ID } from '@/lib/custom-analytics/model';
import { saveReport } from '@/app/actions/risansi-reports';
import { DataPanel } from './DataPanel';
import { WellsPanel, type ChipDrag } from './WellsPanel';
import { GridCanvas } from './GridCanvas';
import { FilterBar, type FilterOptions } from './FilterBar';
import { ShareDialog } from './ShareDialog';

const UNDO_DEPTH = 40;

export function ReportBuilder({ id, title: title0, description: description0, doc: doc0, options, shares: shares0 }: {
  id: number;
  title: string;
  description: string | null;
  doc: ReportDoc;
  options: FilterOptions;
  shares: number[];
}) {
  const router = useRouter();
  const [doc, setDoc] = useState<ReportDoc>(doc0);
  const [title, setTitle] = useState(title0);
  const [description, setDescription] = useState(description0 ?? '');
  const [tab, setTab] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [panelDataset, setPanelDataset] = useState('revenue');
  const [history, setHistory] = useState<ReportDoc[]>([]);
  const [mark, setMark] = useState(() => JSON.stringify({ t: title0, d: description0 ?? '', doc: doc0 }));
  const [note, setNote] = useState<string | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [shares, setShares] = useState(shares0);
  const [busy, start] = useTransition();

  const i = Math.min(tab, Math.max(0, doc.pages.length - 1));
  const page: ReportPage | undefined = doc.pages[i];
  const selected = page?.visuals.find(v => v.id === selectedId) ?? null;

  const now = useMemo(
    () => JSON.stringify({ t: title, d: description, doc }),
    [title, description, doc],
  );
  const dirty = now !== mark;

  // ── editing ─────────────────────────────────────────────────

  const apply = (next: ReportDoc) => {
    setHistory(h => [...h, doc].slice(-UNDO_DEPTH));
    setDoc(next);
  };
  const onPage = (fn: (p: ReportPage) => ReportPage) =>
    apply({ ...doc, pages: doc.pages.map((p, j) => (j === i ? fn(p) : p)) });
  const onVisuals = (fn: (vs: Visual[]) => Visual[]) =>
    onPage(p => ({ ...p, visuals: fn(p.visuals) }));
  /** One card, then re-settled: a change can make a card taller. */
  const onCard = (cardId: string, fn: (v: Visual) => Visual) =>
    onVisuals(vs => vs.map(v => (v.id === cardId ? fn(v) : v)));
  const onSelected = (fn: (v: Visual) => Visual) => {
    if (selectedId) onCard(selectedId, fn);
  };

  const undo = () => {
    if (!history.length) return;
    setDoc(history[history.length - 1]);
    setHistory(h => h.slice(0, -1));
  };

  const addCard = (type: VisualType) => {
    if ((page?.visuals.length ?? 0) >= MAX_VISUALS_PER_PAGE) {
      setNote(`A page holds ${MAX_VISUALS_PER_PAGE} cards. Start another page.`);
      return;
    }
    const v = newVisual(type, panelDataset);
    onVisuals(vs => addVisual(vs, v));
    setSelectedId(v.id);
  };

  /**
   * A field clicked rather than dragged.
   *
   * With a card selected it goes to whichever well suits it. With nothing
   * selected it starts a card — a column chart for a category, a line for a
   * date, a KPI for a number — because the alternative is a click that does
   * nothing and no way to tell why.
   */
  const clickField = (dataset: string, field: string) => {
    const f = fieldOf(dataset, field);
    if (!f) return;
    if (selected) {
      const well = bestWell(selected, f);
      if (!well) { setNote(`A ${VISUAL_META[selected.type].label.toLowerCase()} has nowhere to put that.`); return; }
      onSelected(v => addToWell(v, well, dataset, field));
      return;
    }
    const v = newVisual(suggestType(f), dataset);
    const well = bestWell(v, f) ?? 'values';
    onVisuals(vs => addVisual(vs, addToWell(v, well, dataset, field)));
    setSelectedId(v.id);
  };

  const dropOnWell = (well: Well, dataset: string, field: string) =>
    onSelected(v => addToWell(v, well, dataset, field));

  const dropOnCard = (cardId: string, dataset: string, field: string) => {
    const target = page?.visuals.find(v => v.id === cardId);
    const f = fieldOf(dataset, field);
    if (!target || !f) return;
    setSelectedId(cardId);
    const well = bestWell(target, f);
    if (well) onCard(cardId, v => addToWell(v, well, dataset, field));
  };

  const removeCard = (cardId?: string) => {
    const target = cardId ?? selectedId;
    if (!target) return;
    onVisuals(vs => vs.filter(v => v.id !== target));
    if (target === selectedId) setSelectedId(null);
  };

  /**
   * The card, on a different table.
   *
   * Whatever the new table does not have is named rather than left to be
   * noticed. Undo puts it back, which is why this does not stop to ask —
   * a confirmation dialog on an action with a working undo is a dialog
   * people learn to click through.
   */
  const switchDataset = (ds: string) => {
    if (!selected || !ds || ds === selected.dataset) return;
    const r = changeDataset(selected, ds);
    onSelected(() => r.visual);
    const name = DATASET_BY_ID.get(ds)?.label ?? ds;
    setNote(r.dropped.length
      ? `Now on ${name}. ${r.dropped.join(', ')} ${r.dropped.length === 1 ? 'is' : 'are'} not on that table, so ${r.dropped.length === 1 ? 'it was' : 'they were'} taken off. Ctrl+Z puts it back.`
      : `Now on ${name}.`);
  };

  const chipTo = (d: ChipDrag, to: Well) =>
    onSelected(v => moveChip(v, d.from, d.index, to, d.dataset, d.field));

  const duplicateCard = () => {
    if (!selectedId) return;
    const r = duplicate(page?.visuals ?? [], selectedId);
    onVisuals(() => r.visuals);
    if (r.id) setSelectedId(r.id);
  };

  // ── pages ───────────────────────────────────────────────────

  const addPage = () => {
    if (doc.pages.length >= MAX_PAGES) { setNote(`A report holds ${MAX_PAGES} pages.`); return; }
    const p = emptyPage(doc.pages.length);
    apply({ ...doc, pages: [...doc.pages, p] });
    setTab(doc.pages.length);
    setSelectedId(null);
  };

  const deletePage = () => {
    if (doc.pages.length <= 1) { setNote('A report needs at least one page.'); return; }
    if (!window.confirm(`Delete the page “${page?.name}” and the ${page?.visuals.length ?? 0} cards on it?`)) return;
    apply({ ...doc, pages: doc.pages.filter((_, j) => j !== i) });
    setTab(Math.max(0, i - 1));
    setSelectedId(null);
  };

  /** A page's worth of cards, copied, with fresh ids throughout. */
  const copyPage = () => {
    if (!page) return;
    if (doc.pages.length >= MAX_PAGES) { setNote(`A report holds ${MAX_PAGES} pages.`); return; }
    const copy: ReportPage = {
      id: newId('p'),
      name: `${page.name} (copy)`.slice(0, 60),
      filters: { ...page.filters },
      visuals: page.visuals.map(v => ({ ...v, id: newId('v'), layout: { ...v.layout } })),
    };
    apply({ ...doc, pages: [...doc.pages.slice(0, i + 1), copy, ...doc.pages.slice(i + 1)] });
    setTab(i + 1);
    setSelectedId(null);
  };

  const movePage = (delta: number) => {
    const j = i + delta;
    if (j < 0 || j >= doc.pages.length) return;
    const pages = [...doc.pages];
    [pages[i], pages[j]] = [pages[j], pages[i]];
    apply({ ...doc, pages });
    setTab(j);
  };

  // ── saving ──────────────────────────────────────────────────

  const save = (then?: 'view') => start(async () => {
    const snapshot = now;
    const r = await saveReport({ id, title, description, doc });
    if (!r.ok) { setNote(r.error); return; }
    // Marked against the snapshot that was sent, not against the current
    // state: anything typed while the request was in flight is still unsaved.
    setMark(snapshot);
    setNote(null);
    router.refresh();
    if (then === 'view') router.push(`/risansi/reports/${id}`);
  });

  const discard = () => {
    if (dirty && !window.confirm('Throw away the changes since the last save?')) return;
    setDoc(doc0);
    setTitle(title0);
    setDescription(description0 ?? '');
    setHistory([]);
    setMark(JSON.stringify({ t: title0, d: description0 ?? '', doc: doc0 }));
    setSelectedId(null);
  };

  const leave = () => {
    if (dirty && !window.confirm('Leave without saving? The changes will be lost.')) return;
    router.push(`/risansi/reports/${id}`);
  };

  // The browser's own guard, for a closed tab or a typed URL. It cannot be
  // worded by us and does not need to be — it only has to fire.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  // Ctrl/Cmd+Z and Ctrl/Cmd+S, because a builder without them is a builder
  // people are frightened to drag things in.
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const typing = el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName);
      if (!(e.ctrlKey || e.metaKey)) return;
      if (e.key === 'z' && !typing) { e.preventDefault(); undo(); }
      if (e.key === 's') { e.preventDefault(); save(); }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
    // Re-bound whenever the document changes so undo and save act on the
    // current state rather than the state at mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, history, title, description, now]);

  // ── render ──────────────────────────────────────────────────

  return (
    <div style={{ padding: '14px 18px 40px', display: 'flex', flexDirection: 'column', gap: 10 }}>
      <header style={{ display: 'flex', alignItems: 'flex-start', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 220, display: 'flex', flexDirection: 'column', gap: 4 }}>
          <input value={title} onChange={e => setTitle(e.target.value)} maxLength={120}
            placeholder="Report title"
            style={{ background: 'transparent', border: '1px solid transparent', borderRadius: 5,
                     padding: '2px 4px', margin: '-2px -4px', fontSize: 19, fontWeight: 600,
                     color: 'var(--fg)', fontFamily: 'inherit' }} />
          <input value={description} onChange={e => setDescription(e.target.value)} maxLength={500}
            placeholder="A line about what this report is for (optional)"
            style={{ background: 'transparent', border: '1px solid transparent', borderRadius: 5,
                     padding: '2px 4px', margin: '-2px -4px', fontSize: 12,
                     color: 'var(--fg-3)', fontFamily: 'inherit' }} />
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0 }}>
          <span style={{ fontSize: 11, color: dirty ? 'var(--warn)' : 'var(--fg-4)' }}>
            {dirty ? 'Unsaved changes' : 'Saved'}
          </span>
          <button type="button" onClick={undo} disabled={!history.length} style={BTN}
                  title="Undo the last change (Ctrl+Z)">Undo</button>
          <button type="button" onClick={discard} disabled={!dirty || busy} style={BTN}>Discard</button>
          <button type="button" onClick={() => save()} disabled={!dirty || busy}
            style={{ ...BTN, background: dirty ? 'var(--accent-fill)' : 'var(--bg-paper)',
                     color: dirty ? '#fff' : 'var(--fg-3)', borderColor: dirty ? 'transparent' : 'var(--line)' }}
            title="Save (Ctrl+S)">{busy ? 'Saving…' : 'Save'}</button>
          <button type="button" onClick={() => setShareOpen(true)} style={BTN}
                  title="Who else can read this report">
            Share{shares.length ? ` (${shares.length})` : ''}
          </button>
          <button type="button" onClick={leave} style={BTN} title="Back to reading it">Done</button>
        </div>
      </header>

      {note && (
        <div role="alert" style={{ fontSize: 12, color: 'var(--warn-strong, var(--warn))',
                                   background: 'var(--warn-soft)', border: '1px solid var(--warn)',
                                   borderRadius: 5, padding: '6px 10px' }}>
          {note}
          <button type="button" onClick={() => setNote(null)}
            style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer',
                     float: 'right', fontFamily: 'inherit', fontSize: 12 }}>✕</button>
        </div>
      )}

      <nav style={{ display: 'flex', gap: 2, borderBottom: '1px solid var(--line)',
                    alignItems: 'flex-end', flexWrap: 'wrap' }}>
        {doc.pages.map((pg, j) => (
          <button key={pg.id} type="button" onClick={() => { setTab(j); setSelectedId(null); }}
            style={{
              background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit',
              borderBottom: `2px solid ${j === i ? 'var(--accent)' : 'transparent'}`,
              padding: '6px 12px', fontSize: 12.5,
              color: j === i ? 'var(--fg)' : 'var(--fg-3)', fontWeight: j === i ? 600 : 400,
            }}>
            {pg.name}
            <span style={{ color: 'var(--fg-4)', fontWeight: 400 }}> · {pg.visuals.length}</span>
          </button>
        ))}
        <button type="button" onClick={addPage} style={{ ...TAB_ICON }} title="Add a page">+ Page</button>
        <span style={{ flex: 1 }} />
        {page && (
          <>
            <input
              value={page.name} maxLength={60}
              onChange={e => onPage(p => ({ ...p, name: e.target.value }))}
              title="Rename this page"
              style={{ background: 'var(--bg)', border: '1px solid var(--line)', borderRadius: 5,
                       padding: '3px 7px', fontSize: 11.5, color: 'var(--fg)', fontFamily: 'inherit',
                       width: 150, marginBottom: 3 }} />
            <button type="button" onClick={() => movePage(-1)} disabled={i === 0} style={TAB_ICON} title="Move this page left">←</button>
            <button type="button" onClick={() => movePage(1)} disabled={i >= doc.pages.length - 1} style={TAB_ICON} title="Move this page right">→</button>
            <button type="button" onClick={copyPage} style={TAB_ICON}
                    title="A copy of this page, cards and all">Duplicate page</button>
            <button type="button" onClick={deletePage} style={{ ...TAB_ICON, color: 'var(--neg)' }}
                    title="Delete this page">Delete page</button>
          </>
        )}
      </nav>

      {page && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          <FilterBar value={page.filters} saved={page.filters} options={options}
                     onChange={f => onPage(p => ({ ...p, filters: f }))} />
          <span style={{ fontSize: 10.5, color: 'var(--fg-4)' }}>
            These are the filters this page opens on. A reader can change them for
            themselves without changing the report.
          </span>
        </div>
      )}

      {/* Twelve columns and two panels do not fit on a phone, and squeezing
          them would put every card in a 40px-wide box. It scrolls sideways
          instead, which at least stays usable on a tablet held wide. */}
      <div style={{ overflowX: 'auto' }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', minWidth: 940 }}>
        <div style={{ width: 218, flexShrink: 0 }}>
          <DataPanel
            dataset={panelDataset} onDataset={setPanelDataset}
            onField={clickField} onAddCard={addCard}
            cardDataset={selected?.dataset ?? null} />
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          {page && page.visuals.length ? (
            <>
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 5 }}>
                <button type="button" onClick={() => onVisuals(tidy)} style={{ ...BTN, fontSize: 11 }}
                        title="Close the vertical gaps, keeping the order">Tidy up</button>
              </div>
              <GridCanvas
                visuals={page.visuals}
                selectedId={selectedId}
                filters={page.filters}
                onSelect={setSelectedId}
                onMove={(cardId, x, y) => onVisuals(vs => moveTo(vs, cardId, x, y))}
                onResize={(cardId, w, h) => onVisuals(vs => resizeTo(vs, cardId, w, h))}
                onDelete={removeCard}
                onDropField={dropOnCard}
              />
            </>
          ) : (
            <div style={{ padding: '46px 24px', textAlign: 'center', background: 'var(--bg-paper)',
                          border: '1px dashed var(--line-strong)', borderRadius: 8 }}>
              <p style={{ margin: 0, fontSize: 13.5, color: 'var(--fg-2)' }}>This page is empty.</p>
              <p style={{ margin: '6px 0 0', fontSize: 12, color: 'var(--fg-3)', lineHeight: 1.6 }}>
                Click a field on the left and a card appears with it on.
                Or pick a card shape first, then fill it.
              </p>
            </div>
          )}
        </div>

        <div style={{ width: 252, flexShrink: 0 }}>
          <WellsPanel
            visual={selected}
            onChangeType={t => onSelected(v => changeType(v, t))}
            onChangeDataset={switchDataset}
            onDropField={dropOnWell}
            onMoveChip={chipTo}
            onRemove={(well, j) => onSelected(v => removeAt(v, well, j))}
            onGrain={(well, j, g: Grain) => onSelected(v => setGrain(v, well, j, g))}
            onAgg={(j, a: Agg) => onSelected(v => setAgg(v, j, a))}
            onMove={(well, j, d) => onSelected(v => moveWithin(v, well, j, d))}
            onPatch={patch => onSelected(v => ({ ...v, ...patch }))}
            onDelete={() => removeCard()}
            onDuplicate={duplicateCard} />
        </div>
      </div>
      </div>

      {shareOpen && (
        <ShareDialog
          reportId={id} title={title} initial={shares}
          onClose={() => setShareOpen(false)}
          onDone={(message, picked) => { setShares(picked); setShareOpen(false); setNote(message); }} />
      )}
    </div>
  );
}

const BTN: React.CSSProperties = {
  background: 'var(--bg-paper)', border: '1px solid var(--line)', borderRadius: 5,
  padding: '5px 11px', fontSize: 12, color: 'var(--fg-2)', cursor: 'pointer', fontFamily: 'inherit',
};

const TAB_ICON: React.CSSProperties = {
  background: 'none', border: 'none', padding: '4px 7px', fontSize: 11.5,
  color: 'var(--fg-3)', cursor: 'pointer', fontFamily: 'inherit', marginBottom: 2,
};
