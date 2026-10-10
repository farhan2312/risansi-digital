'use client';

import { useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { useRouter } from 'next/navigation';
import { fmtCr } from '@/lib/risansi-utils';
import { EditOppDrawer, type EditableOpp } from './EditOppDrawer';
import { OppStageMoveModal } from './OppStageMoveModal';
import { DIRECT_WIN_CATEGORIES, type OppStage } from '@/lib/risansi-opportunity-fields';
import { stageHref } from '@/lib/risansi-stage-dashboard';
import { probabilityCardLabel } from '@/lib/risansi-probability-codes';

export interface KanbanOpp extends EditableOpp {
  value_cr:   number;
  probability: number | null;
  probability_code: string | null;
  eta_text:   string | null;
  rep_name:   string | null;
  tour_name:  string | null;
  can_edit?:  boolean;
  created_at?: string | null;   // ISO; cards sort newest-first within a column
  updated_at?: string | null;   // bumped on every edit; drives the server re-sync below
  so_sum_cr?: number | null;    // Σ of this opp's Sales Order values (Cr) — drives Won Open/Closed
}

const STAGES = ['Suspect', 'Prospect', 'Quoted', 'Negotiating', 'On Hold', 'Won', 'Lost', 'Dropped'] as const;

const STAGE_COLOR: Record<string, string> = {
  Suspect:     'var(--info)',
  Prospect:    '#5a86c2',
  Quoted:      '#c69347',
  Negotiating: 'var(--accent)',
  'On Hold':   'var(--purple)',
  Won:         'var(--pos)',
  Lost:        'var(--neg)',
  Dropped:     '#64748B',
};

// Friendlier column headers (timeframe hints / clarifications).
const STAGE_LABEL: Record<string, string> = {
  Suspect:  'Suspect (1-2 years +)',
  Prospect: 'Prospect (6 months +)',
};

// Remembers which stage columns the user chose to show, so the choice survives
// the server navigations that remount this board (e.g. changing a filter).
const COLS_KEY = 'risansi.kanban.cols';

export function OpportunityKanban({ initialOpps, stageTotals, usdRate = 86, filterQuery = '' }: {
  initialOpps: KanbanOpp[];
  /** ₹ per $1 from the settings page — drives the USD sub-text on money fields. */
  usdRate?: number;
  /** The board's active filters, serialised, so a stage page opens with the same scope. */
  filterQuery?: string;
  /** True per-stage count + value (uncapped), for honest column headers. The
   *  closed columns load at most 200 cards, so their own card sums undercount. */
  stageTotals?: Record<string, { count: number; valueCr: number }>;
}) {
  const router = useRouter();
  const [opps, setOpps]           = useState(initialOpps);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [dragId, setDragId]       = useState<string | null>(null);
  const [overStage, setOverStage] = useState<string | null>(null);
  const [editOpp, setEditOpp]     = useState<KanbanOpp | null>(null);

  // Deep link: /risansi/pipeline?client=CODE&opp=123 opens that opportunity.
  // Client 360 links here rather than reproducing the drawer, so there is one
  // place an opportunity is read and edited instead of two that drift.
  const searchParams = useSearchParams();
  const deepOppId = searchParams.get('opp');
  useEffect(() => {
    if (!deepOppId) return;
    const match = opps.find(o => String(o.id) === deepOppId);
    // Only if it is on this board. A stale link, or one to an opportunity the
    // active filters exclude, should leave the board alone rather than opening
    // an empty drawer.
    if (match) setEditOpp(match);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deepOppId, opps.length]);
  // One modal for every destination now, so the board no longer decides which
  // form a stage needs — the catalogue does.
  const [moving, setMoving] = useState<{ opp: KanbanOpp; to: OppStage; previousStage: string } | null>(null);
  const [notice, setNotice]       = useState('');
  // Per-column card filter (client id / name). Keyed by stage so each column's
  // search box filters only its own cards, not the rest of the board.
  const [colSearch, setColSearch] = useState<Record<string, string>>({});
  // Which stage columns to render (all by default). The picker top-right hides /
  // shows columns; the choice is persisted to localStorage.
  const [visibleStages, setVisibleStages] = useState<string[]>([...STAGES]);
  const [pickerOpen, setPickerOpen] = useState(false);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(COLS_KEY);
      if (!saved) return;
      const arr = JSON.parse(saved);
      if (!Array.isArray(arr)) return;
      const valid = STAGES.filter(s => arr.includes(s));
      if (valid.length > 0) setVisibleStages(valid);   // never end up with zero columns
    } catch { /* ignore malformed / unavailable storage */ }
  }, []);

  const toggleStage = (stage: string) => {
    setVisibleStages(prev => {
      // Rebuild from canonical STAGES order so re-shown columns land back in place.
      const next = prev.includes(stage)
        ? prev.filter(s => s !== stage)
        : STAGES.filter(s => s === stage || prev.includes(s));
      if (next.length === 0) return prev;              // keep at least one column
      try { localStorage.setItem(COLS_KEY, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  };

  const showAllStages = () => {
    setVisibleStages([...STAGES]);
    try { localStorage.removeItem(COLS_KEY); } catch { /* ignore */ }
  };

  const shownStages = STAGES.filter(s => visibleStages.includes(s));
  const allShown = shownStages.length === STAGES.length;

  // Sync from server when the underlying data actually changes (e.g. after create/edit).
  // Keyed on id+stage+updated_at: updated_at is bumped by every edit (updateOpportunity /
  // saveQuotedDetails / stage change), so a field edit that leaves the stage untouched
  // still re-syncs — without that, saved edits didn't show on reopen. Unrelated renders
  // (same updated_at) still don't clobber optimistic drag state.
  const signature = initialOpps.map(o => `${o.id}:${o.stage}:${o.updated_at ?? ''}`).join('|');
  useEffect(() => {
    setOpps(initialOpps);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  const handleDrop = (oppId: string, newStage: string) => {
    const current = opps.find(o => o.id === oppId);
    if (!current || current.stage === newStage) return;
    // Ownership guard (server also enforces). This used to `return` in silence,
    // so a card the user couldn't move simply did nothing when dropped — which
    // is indistinguishable from a broken board. Say why.
    if (current.can_edit === false) {
      setNotice('You can only move opportunities for clients you own or cover. Ask an admin to add you to this one.');
      setTimeout(() => setNotice(''), 5000);
      return;
    }

    // Quoted is still the gateway to Negotiating, On Hold and Lost — you cannot
    // lose a deal you never quoted. Won is the exception: a rate contract or a
    // repeat order is priced already, which is the whole reason for that jump.
    const quoted = ['Quoted', 'Negotiating', 'On Hold'].includes(current.stage);
    const directWin = newStage === 'Won'
      && current.stage === 'Prospect'
      && DIRECT_WIN_CATEGORIES.includes(String(current.opportunity_category ?? ''));

    if (['Negotiating', 'On Hold', 'Lost'].includes(newStage) && !quoted) {
      setNotice('Move this card through Quoted first.');
      setTimeout(() => setNotice(''), 4000);
      return;
    }
    if (newStage === 'Won' && !quoted && !directWin) {
      setNotice('Only an Against Rate Contract or Repeat Order can go straight to Won.');
      setTimeout(() => setNotice(''), 5000);
      return;
    }

    // Every destination that asks for something opens the one move form. The
    // card moves optimistically so the board does not appear to ignore the drag.
    if (['Quoted', 'Negotiating', 'On Hold', 'Won', 'Lost', 'Dropped', 'Suspect'].includes(newStage)) {
      const previousStage = current.stage;
      setOpps(p => p.map(o => (o.id === oppId ? { ...o, stage: newStage } : o)));
      setMoving({ opp: { ...current, stage: newStage }, to: newStage as OppStage, previousStage });
      return;
    }

    updateStage(oppId, newStage);
  };

  const updateStage = async (oppId: string, newStage: string) => {
    const prev = opps;
    setOpps(p => p.map(o => (o.id === oppId ? { ...o, stage: newStage } : o)));
    setSaveState('saving');

    try {
      const res = await fetch(`/api/risansi/opportunities/${oppId}/stage`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stage: newStage }),
      });
      if (!res.ok) {
        // Surface what the server actually said. A bare "failed" is why an
        // "Invalid stage" rejection on On Hold looked like the board was broken
        // rather than like a bug with a name.
        const body = await res.json().catch(() => null);
        throw new Error(body?.error || `Move failed (${res.status})`);
      }
      setSaveState('saved');
      setTimeout(() => setSaveState('idle'), 2000);
      router.refresh();
    } catch (err) {
      setOpps(prev); // revert
      setSaveState('error');
      setNotice(err instanceof Error ? err.message : 'Move failed');
      setTimeout(() => { setSaveState('idle'); setNotice(''); }, 5000);
    }
  };

  // Cards within a column are ordered by creation date, newest first, so the
  // most recently raised opportunity sits at the top of its stage.
  const createdMs = (o: KanbanOpp) => (o.created_at ? new Date(o.created_at).getTime() : 0);
  const byStage: Record<string, KanbanOpp[]> = {};
  for (const s of STAGES) byStage[s] = opps.filter(o => o.stage === s).sort((a, b) => createdMs(b) - createdMs(a));

  return (
    <div>
      {/* Top bar: save state (left) + column picker (right) */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, minHeight: 26, marginBottom: 4 }}>
        <span style={{
          fontSize: 11, fontStyle: 'italic',
          color: saveState === 'saved' ? 'var(--pos)' : saveState === 'error' ? 'var(--neg)' : 'var(--fg-3)',
        }}>
          {saveState === 'saving' && 'Saving…'}
          {saveState === 'saved'  && '✓ Saved'}
          {saveState === 'error'  && '⚠ Failed — try again'}
        </span>

        <div style={{ position: 'relative' }}>
          <button
            type="button"
            onClick={() => setPickerOpen(o => !o)}
            aria-haspopup="true" aria-expanded={pickerOpen}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              height: 26, padding: '0 10px', fontSize: 11, fontFamily: 'inherit',
              background: 'var(--bg-paper)', color: 'var(--fg-2)',
              border: '1px solid var(--line-strong)', borderRadius: 5, cursor: 'pointer',
            }}
          >
            <span aria-hidden>▤</span> Columns
            {!allShown && (
              <span style={{
                fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--accent)',
                background: 'var(--accent-soft)', borderRadius: 3, padding: '1px 4px',
              }}>{shownStages.length}/{STAGES.length}</span>
            )}
          </button>

          {pickerOpen && (
            <>
              {/* click-away backdrop */}
              <div onClick={() => setPickerOpen(false)}
                style={{ position: 'fixed', inset: 0, zIndex: 40 }} />
              <div style={{
                position: 'absolute', top: 'calc(100% + 4px)', right: 0, zIndex: 41,
                minWidth: 210, padding: 6, background: 'var(--bg-paper)',
                border: '1px solid var(--line-strong)', borderRadius: 8,
                boxShadow: '0 10px 30px rgba(0,0,0,0.18)',
              }}>
                <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--fg-3)', padding: '4px 8px 6px' }}>
                  Show columns
                </div>
                {STAGES.map(stage => {
                  const on   = visibleStages.includes(stage);
                  const only = on && shownStages.length === 1;   // can't hide the last one
                  return (
                    <label key={stage} style={{
                      display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px',
                      fontSize: 12, borderRadius: 5, color: 'var(--fg)',
                      cursor: only ? 'not-allowed' : 'pointer', opacity: only ? 0.55 : 1,
                    }}>
                      <input type="checkbox" checked={on} disabled={only}
                        onChange={() => toggleStage(stage)}
                        style={{ cursor: only ? 'not-allowed' : 'pointer' }} />
                      <span aria-hidden style={{ width: 8, height: 8, borderRadius: 2, background: STAGE_COLOR[stage], flexShrink: 0 }} />
                      <span>{STAGE_LABEL[stage] ?? stage}</span>
                    </label>
                  );
                })}
                {!allShown && (
                  <button type="button" onClick={showAllStages}
                    style={{
                      width: '100%', marginTop: 4, padding: '6px 8px', fontSize: 11, fontFamily: 'inherit',
                      background: 'none', color: 'var(--accent)', border: 'none',
                      borderTop: '1px solid var(--line)', cursor: 'pointer', textAlign: 'left',
                    }}>
                    Show all columns
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      <div className="r-kanban" style={{ display: 'grid', gridTemplateColumns: `repeat(${shownStages.length}, minmax(0, 1fr))`, gap: 10 }}>
        {shownStages.map(stage => {
          const items = byStage[stage] ?? [];
          const q = (colSearch[stage] ?? '').trim().toLowerCase();
          const filtered = q
            ? items.filter(o =>
                (o.client_code ?? '').toLowerCase().includes(q) ||
                (o.client_name ?? '').toLowerCase().includes(q))
            : items;
          // Prefer the true (uncapped) stage total from the server; fall back to
          // the loaded cards. The closed columns load ≤200 cards, so their own
          // card sum undercounts — this is what made WON read ₹5.2 Cr of ₹15 Cr.
          const trueTotal = stageTotals?.[stage]?.valueCr ?? items.reduce((s, o) => s + o.value_cr, 0);
          const trueCount = stageTotals?.[stage]?.count ?? items.length;
          const truncated = trueCount > items.length;
          const color = STAGE_COLOR[stage];
          const isOver = overStage === stage;
          return (
            <div
              key={stage}
              onDragOver={e => { e.preventDefault(); setOverStage(stage); }}
              onDragLeave={() => setOverStage(s => (s === stage ? null : s))}
              onDrop={e => {
                e.preventDefault();
                setOverStage(null);
                if (dragId) handleDrop(dragId, stage);
                setDragId(null);
              }}
              style={{
                background: isOver ? 'var(--bg-elev)' : 'var(--bg-paper)',
                border: isOver ? '1px dashed var(--accent)' : '1px solid var(--line)',
                borderRadius: 6, display: 'flex', flexDirection: 'column',
                transition: 'background 120ms, border-color 120ms',
              }}
            >
              <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--line)' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  {/* The column title opens that stage's dashboard — its KPIs,
                      charts and the full list — carrying the board's filters. */}
                  <a
                    href={stageHref(stage, new URLSearchParams(filterQuery))}
                    className="risansi-bracket-link"
                    title={`Open the ${stage} dashboard`}
                    style={{
                      fontSize: 11, fontWeight: 500, color, textTransform: 'uppercase',
                      letterSpacing: '0.06em', textDecoration: 'none', display: 'inline-flex',
                      alignItems: 'center', gap: 4, padding: '2px 5px', margin: '-2px -5px',
                      borderRadius: 4, border: '1px solid transparent',
                    }}
                  >
                    {STAGE_LABEL[stage] ?? stage}
                    <span aria-hidden style={{ fontSize: 9, opacity: 0.65 }}>▸</span>
                  </a>
                  <span style={{ fontSize: 11, color: 'var(--fg-3)', fontFamily: 'var(--font-mono)' }}>
                    {q ? `${filtered.length}/${items.length}` : (truncated ? `${items.length} of ${trueCount}` : trueCount)}
                  </span>
                </div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--fg)', marginTop: 4 }}>
                  {trueTotal > 0 ? fmtCr(trueTotal) : '—'}
                </div>
                {items.length > 0 && (
                  <input
                    type="search"
                    value={colSearch[stage] ?? ''}
                    onChange={e => setColSearch(s => ({ ...s, [stage]: e.target.value }))}
                    placeholder="Filter id / name…"
                    aria-label={`Filter ${stage} by client id or name`}
                    style={{
                      width: '100%', marginTop: 8, padding: '5px 8px', fontSize: 11,
                      fontFamily: 'inherit', background: 'var(--bg-sunk)', color: 'var(--fg)',
                      border: '1px solid var(--line-strong)', borderRadius: 4, outline: 'none',
                    }}
                  />
                )}
              </div>
              {/* Cards scroll within each column so a huge column (e.g. Quoted) stays
                  usable instead of ballooning the whole board. Header/total stay fixed. */}
              <div style={{ padding: 8, display: 'flex', flexDirection: 'column', gap: 8, flex: 1, minHeight: 60, maxHeight: '48vh', overflowY: 'auto' }}>
                {filtered.map(opp => {
                  const isWon  = opp.stage === 'Won';
                  const isLost = opp.stage === 'Lost';
                  const canEdit = opp.can_edit !== false;
                  const canDrag = canEdit && !isWon && !isLost;
                  return (
                  <div
                    key={opp.id}
                    draggable={canDrag}
                    onDragStart={() => { if (canDrag) setDragId(opp.id); }}
                    onDragEnd={() => { setDragId(null); setOverStage(null); }}
                    onClick={() => setEditOpp(opp)}
                    style={{
                      position: 'relative',
                      background: isWon ? 'var(--won-bg)' : isLost ? 'var(--bg-sunk)' : 'var(--bg-elev)',
                      border: '1px solid var(--line)',
                      borderLeft: `3px solid ${isWon ? 'var(--pos)' : isLost ? '#9CA3AF' : STAGE_COLOR[opp.stage] ?? 'var(--line)'}`,
                      borderRadius: 4, padding: 10, cursor: 'pointer',
                      opacity: dragId === opp.id ? 0.4 : !canEdit ? 0.85 : isLost ? 0.75 : 1,
                    }}
                  >
                    {/* The red "Blocked" badge that used to sit here reported a
                        card whose own rep was a stranger to the client. An
                        opportunity has no rep of its own any more — it belongs
                        to the client's owner — so the state cannot arise and
                        the only thing left to say is whether you may edit. */}
                    {!canEdit && !isWon && !isLost && (
                      <div
                        title="View only — assigned to another rep"
                        style={{ position: 'absolute', top: 6, right: 6, fontSize: 11, color: 'var(--fg-3)', opacity: 0.6 }}
                      >
                        👁
                      </div>
                    )}
                    <div style={{ fontSize: 10, color: 'var(--fg-3)', fontFamily: 'var(--font-mono)', display: 'flex', justifyContent: 'space-between', gap: 6, marginBottom: 4 }}>
                      <span style={{ flexShrink: 0 }}>{opp.client_code}</span>
                      <span title={opp.tour_name ? `Tour: ${opp.tour_name}` : 'No tour assigned'} style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'right' }}>{opp.tour_name || '—'}</span>
                    </div>
                    <div style={{ fontSize: 12, fontWeight: 500, lineHeight: 1.3, marginBottom: 4, color: 'var(--fg)', overflowWrap: 'anywhere' }}>{opp.client_name}</div>
                    <div style={{ fontSize: 11, color: 'var(--fg-2)', marginBottom: 6, lineHeight: 1.35, overflowWrap: 'anywhere' }}>{opp.product}</div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 6, flexWrap: 'wrap' }}>
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 700, color: 'var(--brand-blue)' }}>
                        {opp.value_cr ? `₹${(opp.value_cr * 100).toFixed(1)}L` : '—'}
                      </span>
                      {/* The odds and what they are: "90% (code 1)". A card
                          used to show a bare percentage the stage had guessed,
                          which is why opening it showed nothing — there was no
                          code behind the number. Unrated says so, because an
                          unrated quote is weighted at zero. */}
                      <span style={{ fontSize: 10, color: opp.probability_code ? 'var(--fg-3)' : 'var(--warn-strong, var(--warn))' }}>
                        {probabilityCardLabel(opp.probability_code) || (!isWon && !isLost ? 'no probability' : '')}
                        {opp.eta_text ? ` · ${opp.eta_text}` : ''}
                      </span>
                    </div>
                    {isWon && (() => {
                      const finalCr = opp.final_value_cr != null ? parseFloat(String(opp.final_value_cr)) : (opp.value_cr || 0);
                      const soSum   = opp.so_sum_cr != null ? Number(opp.so_sum_cr) : 0;
                      const closed  = finalCr > 0 && soSum >= finalCr;
                      return (
                        <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 4 }}>
                          <div style={{ fontSize: 10, color: 'var(--pos)' }}>
                            🎉 Won
                            {opp.final_value_cr ? ` · ₹${(parseFloat(String(opp.final_value_cr)) * 100).toFixed(1)}L` : ''}
                            {opp.po_number ? ` · ${opp.po_number}` : ''}
                          </div>
                          <span style={{
                            alignSelf: 'flex-start', fontSize: 9.5, fontWeight: 700, padding: '1px 7px', borderRadius: 999,
                            background: closed ? 'rgba(6,95,70,0.14)' : 'rgba(179,114,10,0.16)',
                            color: closed ? 'var(--pos-strong)' : '#9a6208',
                          }}>
                            {closed ? 'Closed' : `Open · ₹${(Math.max(0, finalCr - soSum) * 100).toFixed(1)}L in hand`}
                          </span>
                        </div>
                      );
                    })()}
                    {isLost && (
                      <div style={{ marginTop: 6, fontSize: 10, color: 'var(--neg)' }}>
                        ❌ Lost{opp.lost_to_competitor ? ` · ${opp.lost_to_competitor}` : ''}
                      </div>
                    )}
                    {!isWon && !isLost && opp.auto_created && (
                      <div style={{ marginTop: 5, display: 'inline-block', fontSize: 9, fontWeight: 600, padding: '1px 5px', borderRadius: 4, background: 'var(--accent-soft)', color: 'var(--brand-blue)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                        ⚡ Auto
                      </div>
                    )}
                  </div>
                  );
                })}
                {filtered.length === 0 && (
                  <div style={{ fontSize: 10, color: 'var(--fg-3)', textAlign: 'center', padding: 20 }}>
                    {q ? 'No matches' : isOver ? 'Drop here' : 'No opps'}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {editOpp && <EditOppDrawer opp={editOpp} canEdit={editOpp.can_edit !== false} usdRate={usdRate} onClose={() => setEditOpp(null)} />}

      {moving && (
        <OppStageMoveModal
          opp={{ ...moving.opp, stage: moving.previousStage }}
          target={moving.to}
          usdRate={usdRate}
          onCancel={() => {
            // Put the card back where it came from — the move never happened.
            setOpps(p => p.map(o => (o.id === moving.opp.id ? { ...o, stage: moving.previousStage } : o)));
            setMoving(null);
          }}
          onDone={() => setMoving(null)}
        />
      )}

      {notice && (
        <div style={{
          position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)', zIndex: 500,
          padding: '10px 16px', borderRadius: 8, fontSize: 13, fontWeight: 500,
          background: 'var(--warn-soft)', color: 'var(--warn)', border: '1px solid var(--warn)',
          boxShadow: '0 8px 24px rgba(0,0,0,0.18)',
        }}>
          {notice}
        </div>
      )}
    </div>
  );
}
