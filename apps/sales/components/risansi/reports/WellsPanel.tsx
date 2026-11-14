'use client';

// The right-hand panel: everything about the one card you have selected.
//
// WHY THE WELLS ARE NAMED THE WAY THEY ARE
//
// Not "Category", "Series", "Legend", "Values" — those are the names a tool
// uses when it expects you to have used the tool before. "Axis", "Legend",
// "Group by" and "Numbers" each carry a sentence underneath saying what they
// do to the picture, and that sentence is the documentation this feature has.
//
// WHAT IT REFUSES TO DO
//
// Nothing silently. A number dropped on a stacking chart that already has a
// legend replaces the one there rather than being ignored; a type change that
// cannot keep a field says so; changing the card's table names every field
// the new table does not have. The one thing the panel will not accept is a
// category from another table, because the card groups rows of its own table
// and there is no honest answer to give.
//
// MOVING A FIELD
//
// Chips drag: from the axis to the legend, from a legend to the columns of a
// table, or onto the strip at the top to take it off the card. The ✕ does the
// same thing for anybody who would rather click, and is what keyboard users
// have — a drag-only gesture is a gesture some people do not have.

import { useState } from 'react';
import {
  VISUAL_META, VISUAL_TYPES, GRAINS, GRAIN_LABEL, AGG_LABEL,
  type Visual, type VisualType, type Agg, type Grain, type FieldRef, type ValueRef,
} from '@/lib/custom-analytics/types';
import { DATASETS, DATASET_BY_ID, fieldOf, aggsFor } from '@/lib/custom-analytics/model';
import {
  WELL_LABEL, WELL_HINT, wellsFor, maxValuesFor, problems,
  combinableDatasets, combinedInfo, type Well,
} from '@/lib/custom-analytics/build';
import { DRAG_TYPE, type FieldDrag } from './DataPanel';

/** A chip already on the card, being moved. Distinct from a field being added. */
export const CHIP_DRAG = 'application/x-risansi-chip';
export interface ChipDrag { from: Well; index: number; dataset: string; field: string }

export interface WellsPanelProps {
  visual: Visual | null;
  onChangeType: (t: VisualType) => void;
  onChangeDataset: (ds: string) => void;
  onDropField: (well: Well, dataset: string, field: string) => void;
  onMoveChip: (d: ChipDrag, to: Well) => void;
  onRemove: (well: Well, i: number) => void;
  onGrain: (well: Well, i: number, g: Grain) => void;
  onAgg: (i: number, agg: Agg) => void;
  onMove: (well: 'dims' | 'values', i: number, delta: number) => void;
  onPatch: (patch: Partial<Visual>) => void;
  onDelete: () => void;
  onDuplicate: () => void;
}

export function WellsPanel(p: WellsPanelProps) {
  // Set while one of this card's own chips is in the air, so the strip that
  // takes a field off the card is only offered when there is one to take off.
  const [carrying, setCarrying] = useState<ChipDrag | null>(null);
  const [overBin, setOverBin] = useState(false);

  const v = p.visual;
  if (!v) {
    return (
      <aside style={PANEL}>
        <h3 style={H3}>No card selected</h3>
        <p style={{ margin: 0, fontSize: 11.5, color: 'var(--fg-3)', lineHeight: 1.5 }}>
          Click a card to change it, or add one from the left. Clicking a field with
          nothing selected starts a new card with that field on it.
        </p>
      </aside>
    );
  }

  const meta = VISUAL_META[v.type];
  const home = v.dataset;
  const issues = problems(v);
  const combined = combinedInfo(v);
  const borrowable = combinableDatasets(v);

  const chipProps = (d: ChipDrag) => ({
    draggable: true,
    onDragStart: (e: React.DragEvent) => {
      e.dataTransfer.setData(CHIP_DRAG, JSON.stringify(d));
      e.dataTransfer.effectAllowed = 'move';
      setCarrying(d);
    },
    onDragEnd: () => { setCarrying(null); setOverBin(false); },
  });

  return (
    <aside style={{ display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 }}>
      {carrying && (
        <div
          onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setOverBin(true); }}
          onDragLeave={() => setOverBin(false)}
          onDrop={e => {
            e.preventDefault();
            setOverBin(false);
            const d = carrying;
            setCarrying(null);
            if (d) p.onRemove(d.from, d.index);
          }}
          style={{
            border: `1px dashed ${overBin ? 'var(--neg)' : 'var(--line-strong)'}`,
            background: overBin ? 'var(--neg-soft)' : 'var(--bg-paper)',
            borderRadius: 7, padding: '9px 10px', textAlign: 'center',
            fontSize: 11.5, color: overBin ? 'var(--neg)' : 'var(--fg-3)',
          }}>
          Drop here to take it off the card
        </div>
      )}

      <section style={PANEL}>
        <h3 style={H3}>Card</h3>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
          {VISUAL_TYPES.map(t => (
            <button key={t} type="button" onClick={() => p.onChangeType(t)}
              title={t === v.type ? undefined : `Draw this as a ${VISUAL_META[t].label.toLowerCase()}`}
              style={{
                ...CHIP,
                background: t === v.type ? 'var(--accent-fill)' : 'var(--bg)',
                color: t === v.type ? '#fff' : 'var(--fg-2)',
                borderColor: t === v.type ? 'transparent' : 'var(--line)',
              }}>
              {VISUAL_META[t].label}
            </button>
          ))}
        </div>

        <label style={LABEL}>
          Built on
          <select value={home ?? ''} onChange={e => p.onChangeDataset(e.target.value)} style={INPUT}
                  title="The table this card groups and counts rows of">
            {!home && <option value="">Pick a table…</option>}
            {DATASETS.map(d => <option key={d.id} value={d.id}>{d.label}</option>)}
          </select>
          <span style={{ fontSize: 10, color: 'var(--fg-4)', fontWeight: 400 }}>
            Shared categories travel to the new table; anything it does not have
            is dropped and named.
          </span>
        </label>

        <label style={LABEL}>
          Title
          <input
            value={v.title ?? ''} placeholder="(named after what it shows)"
            onChange={e => p.onPatch({ title: e.target.value || undefined })}
            style={INPUT} />
        </label>
      </section>

      {!!issues.length && (
        <section style={{ ...PANEL, borderColor: 'var(--warn)', background: 'var(--warn-soft)' }}>
          <h3 style={{ ...H3, color: 'var(--warn-strong, var(--warn))' }}>Not drawing yet</h3>
          <ul style={{ margin: 0, paddingLeft: 15, display: 'flex', flexDirection: 'column', gap: 3 }}>
            {issues.map(i => <li key={i} style={{ fontSize: 11.5, color: 'var(--fg-2)' }}>{i}</li>)}
          </ul>
        </section>
      )}

      {wellsFor(v.type).map(well => (
        <Zone key={well} well={well} visual={v}
              onDrop={p.onDropField} onMoveChip={p.onMoveChip} carrying={carrying}>
          {well === 'axis' || well === 'split' ? (
            v[well]
              ? <Chip ref0={v[well]!} home={home} well={well} i={0}
                      onRemove={p.onRemove} onGrain={p.onGrain}
                      drag={chipProps({ from: well, index: 0, dataset: home ?? '', field: v[well]!.field })} />
              : <Hollow />
          ) : well === 'dims' ? (
            (v.dims ?? []).length
              ? (v.dims ?? []).map((d, i) => (
                  <Chip key={`${d.field}-${i}`} ref0={d} home={home} well="dims" i={i}
                        n={(v.dims ?? []).length} onRemove={p.onRemove}
                        onGrain={p.onGrain} onMove={p.onMove}
                        drag={chipProps({ from: 'dims', index: i, dataset: home ?? '', field: d.field })} />
                ))
              : <Hollow />
          ) : (
            <>
              {v.values.length
                ? v.values.map((val, i) => (
                    <ValueChip key={`${val.dataset ?? ''}${val.field}-${i}`} val={val} home={home} i={i}
                               n={v.values.length} onRemove={p.onRemove}
                               onAgg={p.onAgg} onMove={p.onMove}
                               drag={chipProps({ from: 'values', index: i,
                                                 dataset: val.dataset ?? home ?? '', field: val.field })} />
                  ))
                : <Hollow />}

              {/* A number from another table. Only the tables that still line
                  up with this card's categories are offered, so the well
                  cannot be used to build a card the engine will refuse. */}
              {!!borrowable.length && v.values.length < maxValuesFor(v) && (
                <select
                  value="" style={{ ...INPUT, fontSize: 11, color: 'var(--fg-3)' }}
                  title="Put a number from another table on this card. They are matched on whatever the two share."
                  onChange={e => {
                    const [ds, field] = e.target.value.split('|');
                    if (ds && field) p.onDropField('values', ds, field);
                  }}>
                  <option value="">＋ a number from another table…</option>
                  {borrowable.map(ds => {
                    const d = DATASET_BY_ID.get(ds)!;
                    return (
                      <optgroup key={ds} label={d.label}>
                        {d.fields.filter(f => f.kind !== 'dim').map(f => (
                          <option key={f.id} value={`${ds}|${f.id}`}>{f.label}</option>
                        ))}
                      </optgroup>
                    );
                  })}
                </select>
              )}

              {combined && (combined.on.length ? (
                <p style={NOTE}>
                  Matched on {combined.on.join(' and ')} — one row per{' '}
                  {combined.on.join(' and ').toLowerCase()}, with each table&apos;s own
                  figure against it.
                </p>
              ) : !combined.refused.length ? (
                <p style={NOTE}>
                  Two tables, and nothing to line them up on: this card is not broken
                  down by anything, so each figure is its own table&apos;s total.
                </p>
              ) : null)}
              {combined?.refused.map(r => (
                <p key={`${r.dataset}-${r.dim}`} style={{ ...NOTE, color: 'var(--neg)' }}>
                  {r.dataset} cannot be split by {r.dim}. The two tables only line up
                  on {r.only}.
                </p>
              ))}

              {meta.splitCollapsesValues && v.split && (
                <p style={NOTE}>
                  One number at a time while there is a legend: several numbers and a
                  legend cannot share one scale.
                </p>
              )}
              {v.values.length >= maxValuesFor(v) && !(meta.splitCollapsesValues && v.split) && (
                <p style={NOTE}>
                  {maxValuesFor(v) === 1
                    ? 'This card shows one number. Dropping another replaces it.'
                    : `Up to ${maxValuesFor(v)} numbers. Dropping another replaces the oldest.`}
                </p>
              )}
            </>
          )}

          {well === 'dims' && (v.dims ?? []).length >= meta.maxDims && (
            <p style={NOTE}>Up to {meta.maxDims} columns. Dropping another replaces the oldest.</p>
          )}
        </Zone>
      ))}

      {(meta.topN > 0 || (meta.wells.includes('split') && v.split)) && (
        <section style={PANEL}>
          <h3 style={H3}>Options</h3>
          {meta.topN > 0 && (
            <label style={LABEL}>
              Show the top
              <input type="number" min={1} max={200} value={v.topN ?? meta.topN}
                onChange={e => {
                  const n = Number(e.target.value);
                  p.onPatch({ topN: Number.isInteger(n) && n > 0 ? Math.min(200, n) : undefined });
                }}
                style={{ ...INPUT, width: 70 }} />
              <span style={{ fontSize: 10.5, color: 'var(--fg-4)', fontWeight: 400 }}>
                Everything else is added together as “Other”. A date axis is never folded —
                a month is not top or other, it is just a month.
              </span>
            </label>
          )}
          {meta.wells.includes('split') && v.split && (v.type === 'column' || v.type === 'bar' || v.type === 'area') && (
            <label style={{ ...LABEL, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <input type="checkbox" checked={!!v.stacked}
                     onChange={e => p.onPatch({ stacked: e.target.checked || undefined })} />
              Stack the parts on top of each other
            </label>
          )}
        </section>
      )}

      <section style={PANEL}>
        <div style={{ display: 'flex', gap: 6 }}>
          <button type="button" onClick={p.onDuplicate} style={BTN}
                  title="Another card just like this one, to change one thing on">Duplicate</button>
          <button type="button" onClick={p.onDelete}
                  style={{ ...BTN, color: 'var(--neg)', borderColor: 'var(--line)' }}>Remove card</button>
        </div>
        <p style={{ ...NOTE, marginTop: 7 }}>
          With a card selected: arrow keys nudge it, shift and an arrow resizes it,
          Delete removes it.
        </p>
      </section>
    </aside>
  );
}

// ── a well, as a drop target ──────────────────────────────────

function Zone({ well, visual, onDrop, onMoveChip, carrying, children }: {
  well: Well; visual: Visual;
  onDrop: (well: Well, dataset: string, field: string) => void;
  onMoveChip: (d: ChipDrag, to: Well) => void;
  carrying: ChipDrag | null;
  children: React.ReactNode;
}) {
  const [over, setOver] = useState(false);
  // A chip already in this well has nowhere to go here.
  const takes = !carrying || carrying.from !== well;

  return (
    <section
      onDragOver={e => {
        const t = e.dataTransfer.types;
        if (!t.includes(DRAG_TYPE) && !t.includes(CHIP_DRAG)) return;
        if (t.includes(CHIP_DRAG) && !takes) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = t.includes(CHIP_DRAG) ? 'move' : 'copy';
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={e => {
        setOver(false);
        const chip = e.dataTransfer.getData(CHIP_DRAG);
        if (chip) {
          e.preventDefault();
          // Stopped here so the remove strip does not also see this drop.
          e.stopPropagation();
          try {
            const d = JSON.parse(chip) as ChipDrag;
            if (d && takes) onMoveChip(d, well);
          } catch { /* not one of ours */ }
          return;
        }
        const raw = e.dataTransfer.getData(DRAG_TYPE);
        if (!raw) return;
        e.preventDefault();
        e.stopPropagation();
        try {
          const d = JSON.parse(raw) as FieldDrag;
          if (d?.dataset && d?.field) onDrop(well, d.dataset, d.field);
        } catch { /* a drag from somewhere else; nothing to do */ }
      }}
      style={{
        ...PANEL,
        borderColor: over ? 'var(--accent)' : 'var(--line)',
        background: over ? 'var(--accent-soft)' : 'var(--bg-paper)',
      }}
    >
      <h3 style={H3}>{WELL_LABEL[well]}</h3>
      <p style={{ margin: '0 0 6px', fontSize: 10.5, color: 'var(--fg-4)', lineHeight: 1.4 }}>
        {well === 'axis' && visual.type === 'matrix' ? 'One row per value of this.'
          : well === 'split' && visual.type === 'matrix' ? 'One column per value of this.'
          : WELL_HINT[well]}
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>{children}</div>
    </section>
  );
}

function Hollow() {
  return (
    <div style={{ border: '1px dashed var(--line-strong)', borderRadius: 5, padding: '6px 8px',
                  fontSize: 11, color: 'var(--fg-4)', textAlign: 'center' }}>
      Click or drag a field here
    </div>
  );
}

// ── chips ─────────────────────────────────────────────────────

type DragHandlers = {
  draggable: boolean;
  onDragStart: (e: React.DragEvent) => void;
  onDragEnd: () => void;
};

function Chip({ ref0, home, well, i, n, onRemove, onGrain, onMove, drag }: {
  ref0: FieldRef; home: string | null; well: Well; i: number; n?: number;
  onRemove: (well: Well, i: number) => void;
  onGrain: (well: Well, i: number, g: Grain) => void;
  onMove?: (well: 'dims' | 'values', i: number, delta: number) => void;
  drag: DragHandlers;
}) {
  const f = home ? fieldOf(home, ref0.field) : null;
  return (
    <div style={CHIP_ROW} {...drag}>
      <span aria-hidden style={GRIP} title="Drag to another well, or off the card">⠿</span>
      <span style={CHIP_NAME} title={f?.hint ?? f?.label ?? ref0.field}>
        {f?.label ?? ref0.field}
      </span>
      {f?.date && (
        <select value={ref0.grain ?? 'month'} style={MINI}
                onChange={e => onGrain(well, i, e.target.value as Grain)}
                title="How the dates are bucketed">
          {GRAINS.map(g => <option key={g} value={g}>{GRAIN_LABEL[g]}</option>)}
        </select>
      )}
      {onMove && n && n > 1 && <Reorder onMove={d => onMove('dims', i, d)} first={i === 0} last={i === n - 1} />}
      <Remove onClick={() => onRemove(well, i)} />
    </div>
  );
}

function ValueChip({ val, home, i, n, onRemove, onAgg, onMove, drag }: {
  val: ValueRef; home: string | null; i: number; n: number;
  onRemove: (well: Well, i: number) => void;
  onAgg: (i: number, agg: Agg) => void;
  onMove: (well: 'dims' | 'values', i: number, delta: number) => void;
  drag: DragHandlers;
}) {
  const ds = val.dataset ?? home ?? '';
  const f = fieldOf(ds, val.field);
  const aggs = f ? aggsFor(f) : [];
  return (
    <div style={CHIP_ROW} {...drag}>
      <span aria-hidden style={GRIP} title="Drag to another well, or off the card">⠿</span>
      <span style={CHIP_NAME} title={f?.hint ?? f?.label ?? val.field}>
        {val.dataset && (
          <span style={{ color: 'var(--fg-4)' }}>
            {DATASET_BY_ID.get(val.dataset)?.label ?? val.dataset} ·{' '}
          </span>
        )}
        {f?.label ?? val.field}
      </span>
      {!!aggs.length && (
        <select value={val.agg ?? aggs[0]} style={MINI}
                onChange={e => onAgg(i, e.target.value as Agg)}
                title="How the rows are rolled up">
          {aggs.map(a => <option key={a} value={a}>{AGG_LABEL[a]}</option>)}
        </select>
      )}
      {n > 1 && <Reorder onMove={d => onMove('values', i, d)} first={i === 0} last={i === n - 1} />}
      <Remove onClick={() => onRemove('values', i)} />
    </div>
  );
}

function Reorder({ onMove, first, last }: { onMove: (d: number) => void; first: boolean; last: boolean }) {
  return (
    <span style={{ display: 'inline-flex', flexShrink: 0 }}>
      <button type="button" onClick={() => onMove(-1)} disabled={first} style={ICON} title="Move up">↑</button>
      <button type="button" onClick={() => onMove(1)} disabled={last} style={ICON} title="Move down">↓</button>
    </span>
  );
}

function Remove({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} style={{ ...ICON, color: 'var(--fg-3)' }}
            title="Take this off the card">✕</button>
  );
}

// ── styles ────────────────────────────────────────────────────

const PANEL: React.CSSProperties = {
  background: 'var(--bg-paper)', border: '1px solid var(--line)', borderRadius: 7, padding: '9px 10px',
};

const H3: React.CSSProperties = {
  margin: '0 0 7px', fontSize: 10, fontWeight: 600, letterSpacing: '0.08em',
  textTransform: 'uppercase', color: 'var(--fg-3)',
};

const CHIP: React.CSSProperties = {
  border: '1px solid var(--line)', borderRadius: 999, padding: '2.5px 8px',
  fontSize: 10.5, cursor: 'pointer', fontFamily: 'inherit',
};

const CHIP_ROW: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 4, background: 'var(--bg)',
  border: '1px solid var(--line)', borderRadius: 5, padding: '3px 4px 3px 5px', minWidth: 0,
};

const GRIP: React.CSSProperties = {
  fontSize: 10, color: 'var(--fg-4)', cursor: 'grab', flexShrink: 0, lineHeight: 1,
};

const CHIP_NAME: React.CSSProperties = {
  flex: 1, minWidth: 0, fontSize: 11.5, color: 'var(--fg)',
  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
};

const MINI: React.CSSProperties = {
  background: 'var(--bg-paper)', border: '1px solid var(--line)', borderRadius: 4,
  fontSize: 10, color: 'var(--fg-2)', fontFamily: 'inherit', padding: '1px 2px', maxWidth: 92,
};

const ICON: React.CSSProperties = {
  background: 'none', border: 'none', padding: '0 3px', fontSize: 10,
  color: 'var(--fg-4)', cursor: 'pointer', fontFamily: 'inherit',
};

const LABEL: React.CSSProperties = {
  display: 'flex', flexDirection: 'column', gap: 3, fontSize: 10.5,
  color: 'var(--fg-3)', marginTop: 7, fontWeight: 600,
};

const INPUT: React.CSSProperties = {
  background: 'var(--bg)', border: '1px solid var(--line)', borderRadius: 5,
  padding: '4px 7px', fontSize: 11.5, color: 'var(--fg)', fontFamily: 'inherit',
  fontWeight: 400, width: '100%', boxSizing: 'border-box',
};

const BTN: React.CSSProperties = {
  background: 'var(--bg)', border: '1px solid var(--line)', borderRadius: 5,
  padding: '4px 10px', fontSize: 11.5, color: 'var(--fg-2)', cursor: 'pointer', fontFamily: 'inherit',
};

const NOTE: React.CSSProperties = {
  margin: '5px 0 0', fontSize: 10, color: 'var(--fg-4)', lineHeight: 1.45,
};
