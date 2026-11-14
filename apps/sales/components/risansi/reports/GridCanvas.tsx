'use client';

// The canvas: the cards on the twelve-column grid, draggable and resizable.
//
// HOW THE GEOMETRY IS WORKED OUT
//
// The grid itself is CSS — twelve equal columns, 44px rows, a 10px gap, all
// declared in globals.css. Rather than hard-coding those numbers here and
// hoping the two never drift, the pitch is read back off the element with
// getComputedStyle when a drag starts. If somebody changes the row height in
// the stylesheet, dragging still lands where the card appears to land.
//
// WHILE A DRAG IS RUNNING
//
// Nothing is committed. The card follows the pointer as a ghost and the
// document is left alone until the pointer comes up, so a drag that ends
// outside the window, or on Escape, changes nothing. Cards do not re-query
// while being moved, because their visual has not changed.

import { useRef, useState } from 'react';
import { GRID_COLS, type Layout, type Visual, type PageFilters } from '@/lib/custom-analytics/types';
import { VisualCard } from './VisualCard';
import { DRAG_TYPE, type FieldDrag } from './DataPanel';

type Mode = 'move' | 'size';

export function GridCanvas({
  visuals, selectedId, filters, onSelect, onMove, onResize, onDelete, onDropField,
}: {
  visuals: Visual[];
  selectedId: string | null;
  filters: PageFilters;
  onSelect: (id: string | null) => void;
  onMove: (id: string, x: number, y: number) => void;
  onResize: (id: string, w: number, h: number) => void;
  onDelete: (id: string) => void;
  /** A field dragged from the panel onto a card, rather than onto a well. */
  onDropField: (id: string, dataset: string, field: string) => void;
}) {
  const boxRef = useRef<HTMLDivElement | null>(null);
  const [ghost, setGhost] = useState<{ id: string; mode: Mode; layout: Layout } | null>(null);
  const [overId, setOverId] = useState<string | null>(null);

  const clamp = (n: number, lo: number, hi: number) => Math.min(Math.max(n, lo), hi);

  function begin(e: React.PointerEvent, v: Visual, mode: Mode) {
    if (e.button !== 0) return;
    const box = boxRef.current;
    if (!box) return;
    e.preventDefault();
    e.stopPropagation();
    onSelect(v.id);

    const rect = box.getBoundingClientRect();
    const cs = getComputedStyle(box);
    const colGap = parseFloat(cs.columnGap) || 0;
    const rowGap = parseFloat(cs.rowGap) || 0;
    const rowH = parseFloat(cs.gridAutoRows) || 44;
    const colPitch = (rect.width + colGap) / GRID_COLS;
    const rowPitch = rowH + rowGap;

    const start = v.layout;
    const x0 = e.clientX, y0 = e.clientY;
    let last = start;

    const compute = (ev: PointerEvent): Layout => {
      const dx = Math.round((ev.clientX - x0) / colPitch);
      const dy = Math.round((ev.clientY - y0) / rowPitch);
      return mode === 'move'
        ? { ...start, x: clamp(start.x + dx, 0, GRID_COLS - start.w), y: Math.max(0, start.y + dy) }
        : { ...start,
            w: clamp(start.w + dx, 2, GRID_COLS - start.x),
            h: clamp(start.h + dy, 2, 40) };
    };

    const move = (ev: PointerEvent) => {
      last = compute(ev);
      setGhost({ id: v.id, mode, layout: last });
    };
    const finish = (commit: boolean) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      window.removeEventListener('keydown', key);
      setGhost(null);
      if (!commit) return;
      if (mode === 'move') {
        if (last.x !== start.x || last.y !== start.y) onMove(v.id, last.x, last.y);
      } else if (last.w !== start.w || last.h !== start.h) {
        onResize(v.id, last.w, last.h);
      }
    };
    const up = () => finish(true);
    const cancel = () => finish(false);
    const key = (ev: KeyboardEvent) => { if (ev.key === 'Escape') finish(false); };

    setGhost({ id: v.id, mode, layout: start });
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
    window.addEventListener('keydown', key);
  }

  // A card being dragged is drawn where the pointer has it, not where the
  // document still says it is.
  const layoutOf = (v: Visual) => (ghost?.id === v.id ? ghost.layout : v.layout);

  /**
   * The same moves from the keyboard.
   *
   * A builder whose only gesture is a drag is a builder some people cannot
   * use at all, and fiddly for everybody else — nudging a card one column is
   * a thing a pointer is bad at. Arrows move, shift and an arrow resizes,
   * Delete removes, Escape lets go.
   */
  function onKey(e: React.KeyboardEvent, v: Visual) {
    const l = v.layout;
    if (e.key === 'Escape') {
      onSelect(null);
      (e.currentTarget as HTMLElement).blur();
      return;
    }
    if (e.key === 'Delete') {
      e.preventDefault();
      onDelete(v.id);
      return;
    }
    const step: Record<string, [number, number]> = {
      ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1],
    };
    const d = step[e.key];
    if (!d) return;
    e.preventDefault();
    if (e.shiftKey) onResize(v.id, l.w + d[0], l.h + d[1]);
    else onMove(v.id, l.x + d[0], l.y + d[1]);
  }

  return (
    <div
      ref={boxRef}
      className="rpt-grid-build"
      onClick={() => onSelect(null)}
      style={{ minHeight: 240, alignContent: 'start' }}
    >
      {visuals.map(v => {
        const l = layoutOf(v);
        const dragging = ghost?.id === v.id;
        return (
          <div key={v.id}
            tabIndex={0}
            role="group"
            aria-label={v.title || v.type}
            onKeyDown={e => onKey(e, v)}
            onFocus={() => onSelect(v.id)}
            onDragOver={e => {
              if (!e.dataTransfer.types.includes(DRAG_TYPE)) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = 'copy';
              setOverId(v.id);
            }}
            onDragLeave={() => setOverId(c => (c === v.id ? null : c))}
            onDrop={e => {
              setOverId(null);
              const raw = e.dataTransfer.getData(DRAG_TYPE);
              if (!raw) return;
              e.preventDefault();
              try {
                const d = JSON.parse(raw) as FieldDrag;
                if (d?.dataset && d?.field) onDropField(v.id, d.dataset, d.field);
              } catch { /* not one of ours */ }
            }}
            style={{
              gridColumn: `${l.x + 1} / span ${l.w}`,
              gridRow: `${l.y + 1} / span ${l.h}`,
              minWidth: 0, minHeight: 0, position: 'relative',
              zIndex: dragging ? 5 : undefined,
              opacity: dragging ? 0.85 : 1,
              outline: overId === v.id ? '2px solid var(--accent)' : undefined,
              outlineOffset: 1,
              transition: dragging ? 'none' : 'opacity 120ms',
            }}
          >
            <VisualCard
              visual={v}
              filters={filters}
              cross={null}
              onPick={null}
              selected={selectedId === v.id}
              onSelect={() => onSelect(v.id)}
              actions={
                <button
                  type="button"
                  onPointerDown={e => begin(e, v, 'move')}
                  title="Drag to move this card"
                  aria-label="Move card"
                  style={{
                    background: 'none', border: 'none', padding: '0 2px', cursor: 'grab',
                    color: 'var(--fg-4)', fontSize: 12, lineHeight: 1, fontFamily: 'inherit',
                    touchAction: 'none',
                  }}
                >⠿</button>
              }
            />
            <span
              onPointerDown={e => begin(e, v, 'size')}
              title="Drag to resize"
              style={{
                position: 'absolute', right: 1, bottom: 1, width: 14, height: 14,
                cursor: 'nwse-resize', touchAction: 'none',
                borderRight: '2px solid var(--line-strong)',
                borderBottom: '2px solid var(--line-strong)',
                borderBottomRightRadius: 5,
              }}
            />
          </div>
        );
      })}

      {/* Where the card will land, drawn under it. */}
      {ghost && (
        <div aria-hidden style={{
          gridColumn: `${ghost.layout.x + 1} / span ${ghost.layout.w}`,
          gridRow: `${ghost.layout.y + 1} / span ${ghost.layout.h}`,
          border: '1px dashed var(--accent)', borderRadius: 6,
          background: 'var(--accent-soft)', pointerEvents: 'none',
        }} />
      )}
    </div>
  );
}
