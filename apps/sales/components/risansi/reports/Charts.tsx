'use client';

// The nine visuals a report can hold, drawn by hand.
//
// No chart library: this app has never had one, and the Executive Review's
// charts set the house style already — a figure on every mark, colours from
// the tokens so both themes hold, and the exact number in the title attribute
// of anything that shows a rounded one.
//
// Every renderer takes the SAME normalised shape, whatever the engine
// returned. The pivoting from the engine's long rows (one per d0 × d1) into
// categories and series happens once, in normalise(), rather than nine times
// with nine chances to order the legend differently.
//
// CLICKING. A category is clickable when it can become a cross-filter: a real
// value on a real dimension. "Other" never is — it is a bucket this page
// invented, not a value in the database, so there is nothing to filter on.

import { useState, type CSSProperties, type ReactNode } from 'react';
import { OTHER, type Grain, type Visual } from '@/lib/custom-analytics/types';
import type { Row, Cell } from '@/lib/custom-analytics/engine';
import { compact, exact, bucketLabel, tick } from '@/lib/custom-analytics/fmt';
import type { Format } from '@/lib/custom-analytics/model';
// The arithmetic — the pivot, the treemap layout, the pivot's totals — lives
// in lib/custom-analytics/shape.ts so a script can assert on it. Arithmetic
// inside a component is arithmetic nobody tests.
import {
  normalise, squarify, shapeMatrix, col, SERIES,
  type Normalised, type Cat, type SeriesDef,
} from '@/lib/custom-analytics/shape';

export { normalise, SERIES };
export type { Normalised, Cat, SeriesDef };

const soft = (c: string, pct = 28) => `color-mix(in oklab, ${c} ${pct}%, transparent)`;

// ── shared bits ───────────────────────────────────────────────

export type OnPick = (raw: string, label: string) => void;

const LEGEND: CSSProperties = {
  display: 'flex', gap: 10, flexWrap: 'wrap', fontSize: 10,
  color: 'var(--fg-3)', marginTop: 8,
};

export function Legend({ items }: { items: { label: string; colour: string }[] }) {
  if (!items.length) return null;
  return (
    <div style={LEGEND}>
      {items.map(it => (
        <span key={it.label} style={{ whiteSpace: 'nowrap' }}>
          <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2,
                         background: it.colour, marginRight: 4, verticalAlign: 'middle' }} />
          {it.label}
        </span>
      ))}
    </div>
  );
}

/** A clickable category, or a plain one. Keyboard-reachable either way. */
function Pickable({ cat, onPick, children, style }: {
  cat: Cat; onPick?: OnPick; children: ReactNode; style?: CSSProperties;
}) {
  const can = !!onPick && cat.clickable;
  if (!can) return <div style={style}>{children}</div>;
  return (
    <div
      role="button" tabIndex={0}
      onClick={() => onPick!(cat.raw!, cat.label)}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPick!(cat.raw!, cat.label); } }}
      style={{ ...style, cursor: 'pointer' }}
      title={`${cat.label} — click to filter this page`}
    >{children}</div>
  );
}

const NUM: CSSProperties = {
  fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums',
  fontSize: 11, color: 'var(--fg)', textAlign: 'right',
};

export function Empty({ note }: { note?: string }) {
  return (
    <div style={{ flex: 1, display: 'grid', placeItems: 'center', color: 'var(--fg-4)',
                  fontSize: 12, padding: 20, textAlign: 'center' }}>
      {note ?? 'Nothing in this range.'}
    </div>
  );
}

// ── KPI ───────────────────────────────────────────────────────

export function Kpi({ value, format, label }: { value: Cell; format: Format; label?: string }) {
  const n = typeof value === 'number' ? value : value == null ? null : Number(value);
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 2, minWidth: 0 }}>
      <div title={n == null ? undefined : exact(format, n)}
           style={{ fontFamily: 'var(--font-mono)', fontSize: 28, lineHeight: 1.05,
                    letterSpacing: '-0.02em', fontVariantNumeric: 'tabular-nums',
                    color: 'var(--fg)', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {n == null ? '—' : compact(format, n)}
      </div>
      {label && <div style={{ fontSize: 11, color: 'var(--fg-3)' }}>{label}</div>}
    </div>
  );
}

// ── columns (vertical) ────────────────────────────────────────

export function Columns({ n, onPick, stacked }: { n: Normalised; onPick?: OnPick; stacked?: boolean }) {
  if (!n.cats.length) return <Empty />;
  const stack = stacked || n.isSplit;
  const max = Math.max(
    ...n.cats.map(c => stack ? c.total : Math.max(...c.parts.map(p => p.value ?? 0), 0)), 1);
  const many = n.cats.length > 10;

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div style={{ flex: 1, display: 'flex', alignItems: 'flex-end', gap: many ? 3 : 8, minHeight: 90 }}>
        {n.cats.map(c => (
          <Pickable key={c.label} cat={c} onPick={onPick}
            style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column',
                     alignItems: 'center', justifyContent: 'flex-end', gap: 3, height: '100%' }}>
            {!many && (
              <span style={{ fontSize: 9.5, fontWeight: 600, fontFamily: 'var(--font-mono)',
                             color: 'var(--fg-2)', whiteSpace: 'nowrap' }}>
                {stack ? compact(n.formats[0], c.total) : compact(n.formats[0], c.parts[0]?.value)}
              </span>
            )}
            {stack ? (
              <div style={{ width: '100%', flex: 1, display: 'flex', flexDirection: 'column',
                            justifyContent: 'flex-end', maxHeight: '100%' }}>
                {c.parts.map((p, j) => (p.value ?? 0) > 0 ? (
                  <div key={p.key} title={`${c.label} · ${p.label}: ${exact(n.formats[j], p.value)}`}
                       style={{ height: `${((p.value ?? 0) / max) * 100}%`, background: p.colour,
                                minHeight: 2, borderTop: j === 0 ? undefined : '1px solid var(--bg-paper)' }} />
                ) : null)}
              </div>
            ) : (
              <div style={{ width: '100%', flex: 1, display: 'flex', gap: 2, alignItems: 'flex-end' }}>
                {c.parts.map((p, j) => (
                  <div key={p.key} title={`${c.label} · ${p.label}: ${exact(n.formats[j], p.value)}`}
                       style={{ flex: 1, height: `${Math.max(((p.value ?? 0) / max) * 100, p.value ? 1.5 : 0)}%`,
                                background: soft(p.colour), borderTop: `3px solid ${p.colour}`,
                                borderRadius: '2px 2px 0 0' }} />
                ))}
              </div>
            )}
            <span style={{ fontSize: 10, color: 'var(--fg-3)', whiteSpace: 'nowrap',
                           overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100%' }}>
              {tick(c.label, many ? 7 : 11)}
            </span>
          </Pickable>
        ))}
      </div>
      <Legend items={n.legend} />
    </div>
  );
}

// ── bars (horizontal) ─────────────────────────────────────────

export function Bars({ n, onPick }: { n: Normalised; onPick?: OnPick }) {
  if (!n.cats.length) return <Empty />;
  const stack = n.isSplit;
  const max = Math.max(...n.cats.map(c => stack ? c.total : Math.max(...c.parts.map(p => p.value ?? 0), 0)), 1);

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflowY: 'auto' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {n.cats.map(c => (
          <Pickable key={c.label} cat={c} onPick={onPick}
            style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ width: 96, flexShrink: 0, fontSize: 11, color: 'var(--fg-2)',
                           overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                  title={c.label}>{c.label}</span>
            <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: stack ? 'row' : 'column',
                          gap: stack ? 0 : 2, height: stack ? 16 : undefined,
                          background: 'var(--bg-sunk)', borderRadius: 3, overflow: 'hidden' }}>
              {c.parts.map((p, j) => (
                <div key={p.key} title={`${c.label} · ${p.label}: ${exact(n.formats[j], p.value)}`}
                     style={stack
                       ? { width: `${((p.value ?? 0) / max) * 100}%`, background: p.colour }
                       : { width: `${Math.max(((p.value ?? 0) / max) * 100, p.value ? 0.5 : 0)}%`,
                           height: Math.max(14 - (c.parts.length - 1) * 2, 6), background: p.colour, borderRadius: 3 }} />
              ))}
            </div>
            <span style={{ ...NUM, width: 74, flexShrink: 0 }}
                  title={exact(n.formats[0], stack ? c.total : c.parts[0]?.value)}>
              {compact(n.formats[0], stack ? c.total : c.parts[0]?.value)}
            </span>
          </Pickable>
        ))}
      </div>
      <Legend items={n.legend} />
    </div>
  );
}

// ── line and area ─────────────────────────────────────────────

export function Lines({ n, area, onPick }: { n: Normalised; area?: boolean; onPick?: OnPick }) {
  if (n.cats.length < 2) return <Empty note={n.cats.length ? 'One period only — a line needs two.' : undefined} />;
  const W = 100, H = 100;
  const max = Math.max(...n.cats.flatMap(c => c.parts.map(p => p.value ?? 0)), 1);
  const min = Math.min(...n.cats.flatMap(c => c.parts.map(p => p.value ?? 0)), 0);
  const span = max - min || 1;
  const x = (i: number) => (i / (n.cats.length - 1)) * W;
  const y = (v: number) => H - ((v - min) / span) * H;
  const seriesCount = n.cats[0].parts.length;

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div style={{ flex: 1, position: 'relative', minHeight: 100 }}>
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img"
             style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', overflow: 'visible' }}>
          {[0, 0.5, 1].map(f => (
            <line key={f} x1={0} x2={W} y1={H * f} y2={H * f}
                  stroke="var(--line)" strokeWidth={0.4} vectorEffect="non-scaling-stroke" />
          ))}
          {Array.from({ length: seriesCount }, (_, j) => {
            const pts = n.cats.map((c, i) => `${x(i)},${y(c.parts[j]?.value ?? min)}`).join(' ');
            const colour = n.cats[0].parts[j].colour;
            return (
              <g key={j}>
                {area && <polygon points={`0,${H} ${pts} ${W},${H}`} fill={soft(colour, 18)} />}
                <polyline points={pts} fill="none" stroke={colour} strokeWidth={2}
                          vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
              </g>
            );
          })}
        </svg>
        {/* Dots and tooltips in HTML: an SVG scaled non-uniformly would squash
            a circle into an ellipse and the hit area with it. */}
        <div style={{ position: 'absolute', inset: 0, display: 'flex' }}>
          {n.cats.map((c, i) => (
            <Pickable key={c.label} cat={c} onPick={onPick}
              style={{ flex: 1, position: 'relative' }}>
              <div title={`${c.label}\n${c.parts.map((p, j) => `${p.label}: ${exact(n.formats[j], p.value)}`).join('\n')}`}
                   style={{ position: 'absolute', inset: 0 }} />
              {c.parts.map(p => p.value == null ? null : (
                <span key={p.key} style={{
                  position: 'absolute', left: `${(i / (n.cats.length - 1)) * 100}%`,
                  top: `${y(p.value)}%`, width: 6, height: 6, marginLeft: -3, marginTop: -3,
                  borderRadius: '50%', background: p.colour, pointerEvents: 'none',
                }} />
              ))}
            </Pickable>
          ))}
        </div>
      </div>
      <div style={{ display: 'flex', marginTop: 4 }}>
        {n.cats.map((c, i) => (
          <span key={c.label} style={{
            flex: 1, fontSize: 9.5, color: 'var(--fg-3)', textAlign: 'center',
            whiteSpace: 'nowrap', overflow: 'hidden',
            // Every label on a long axis is unreadable, so thin them out.
            visibility: n.cats.length > 14 && i % Math.ceil(n.cats.length / 10) ? 'hidden' : undefined,
          }}>{tick(c.label, 9)}</span>
        ))}
      </div>
      <Legend items={n.legend} />
    </div>
  );
}

// ── donut ─────────────────────────────────────────────────────

export function DonutChart({ n, onPick }: { n: Normalised; onPick?: OnPick }) {
  const slices = n.cats.map((c, i) => ({ cat: c, value: c.parts[0]?.value ?? 0, colour: col(i) }))
                       .filter(s => s.value > 0);
  if (!slices.length) return <Empty />;
  const total = slices.reduce((a, s) => a + s.value, 0);
  const fmt = n.formats[0];
  const r = 42, c = 50, circ = 2 * Math.PI * r;

  // Each slice's start summed from the ones before it rather than carried in
  // a counter: nothing is mutated while rendering, so the arcs do not depend
  // on the order React happens to evaluate them in. A donut folds to eight
  // slices, so the quadratic sum is eight additions at worst.
  const arcs = slices.map((s, i) => ({
    ...s,
    frac: s.value / total,
    start: slices.slice(0, i).reduce((a, x) => a + x.value, 0) / total,
  }));

  return (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', minHeight: 0 }}>
      <svg width={128} height={128} viewBox="0 0 100 100" role="img" aria-label="share of total"
           style={{ flexShrink: 0 }}>
        <circle cx={c} cy={c} r={r} fill="none" stroke="var(--bg-sunk)" strokeWidth={13} />
        {arcs.map(s => (
          <circle key={s.cat.label} cx={c} cy={c} r={r} fill="none" stroke={s.colour} strokeWidth={13}
                  strokeDasharray={`${s.frac * circ} ${circ - s.frac * circ}`}
                  strokeDashoffset={-s.start * circ}
                  transform={`rotate(-90 ${c} ${c})`}>
            <title>{`${s.cat.label}: ${exact(fmt, s.value)} · ${Math.round(s.frac * 100)}%`}</title>
          </circle>
        ))}
        <text x={c} y={c - 1} textAnchor="middle"
              style={{ fontSize: 9, fontWeight: 700, fill: 'var(--fg)', fontFamily: 'var(--font-mono)' }}>
          {compact(fmt, total)}
        </text>
        <text x={c} y={c + 9} textAnchor="middle"
              style={{ fontSize: 5.5, fill: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: 0.5 }}>total</text>
      </svg>
      <div style={{ flex: 1, minWidth: 150, display: 'flex', flexDirection: 'column', gap: 4, overflowY: 'auto', maxHeight: '100%' }}>
        {slices.map(s => (
          <Pickable key={s.cat.label} cat={s.cat} onPick={onPick}
            style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 11.5 }}>
            <span style={{ width: 9, height: 9, borderRadius: 2, background: s.colour, flexShrink: 0 }} />
            <span style={{ flex: 1, color: 'var(--fg-2)', overflow: 'hidden',
                           textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={s.cat.label}>{s.cat.label}</span>
            <span style={{ ...NUM, width: 'auto' }} title={exact(fmt, s.value)}>{compact(fmt, s.value)}</span>
            <span style={{ width: 32, textAlign: 'right', fontSize: 10.5, color: 'var(--fg-3)',
                           fontFamily: 'var(--font-mono)' }}>{Math.round((s.value / total) * 100)}%</span>
          </Pickable>
        ))}
      </div>
    </div>
  );
}

// ── treemap ───────────────────────────────────────────────────

/** The layout is squarify() in shape.ts; this draws what it returns. */
export function Treemap({ n, onPick }: { n: Normalised; onPick?: OnPick }) {
  const items = n.cats.map((c, i) => ({ cat: c, value: c.parts[0]?.value ?? 0, colour: col(i) }))
                      .filter(s => s.value > 0)
                      .sort((a, b) => b.value - a.value);
  if (!items.length) return <Empty />;
  const fmt = n.formats[0];
  const total = items.reduce((a, s) => a + s.value, 0);

  const tiles = squarify(items.map(s => s.value / total), { x: 0, y: 0, w: 100, h: 100 });

  return (
    <div style={{ flex: 1, position: 'relative', minHeight: 120 }}>
      {tiles.map((t, i) => {
        const s = items[i];
        const showLabel = t.w > 13 && t.h > 11;
        return (
          <Pickable key={s.cat.label} cat={s.cat} onPick={onPick}
            style={{ position: 'absolute', left: `${t.x}%`, top: `${t.y}%`,
                     width: `${t.w}%`, height: `${t.h}%`, padding: 1 }}>
            <div title={`${s.cat.label}: ${exact(fmt, s.value)} · ${Math.round((s.value / total) * 100)}%`}
                 style={{ width: '100%', height: '100%', background: soft(s.colour, 55),
                          border: `1px solid ${s.colour}`, borderRadius: 3, overflow: 'hidden',
                          padding: 4, display: 'flex', flexDirection: 'column', gap: 1 }}>
              {showLabel && (
                <>
                  <span style={{ fontSize: 10.5, color: 'var(--fg)', fontWeight: 500,
                                 overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {s.cat.label}
                  </span>
                  <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--fg-2)' }}>
                    {compact(fmt, s.value)}
                  </span>
                </>
              )}
            </div>
          </Pickable>
        );
      })}
    </div>
  );
}

// ── table ─────────────────────────────────────────────────────

export interface TableCol { key: string; label: string; format: Format; isDim: boolean; grain?: Grain; isDate?: boolean }

export function DataTable({ rows, cols, total, page, onPage, sortKey, sortDir, onSort, onPick }: {
  rows: Row[]; cols: TableCol[]; total?: number;
  page: number; onPage: (p: number) => void;
  sortKey?: string; sortDir?: 'asc' | 'desc';
  onSort: (key: string) => void;
  onPick?: (col: TableCol, raw: string, label: string) => void;
}) {
  if (!rows.length) return <Empty />;
  const PAGE = 50;
  const from = page * PAGE + 1;
  const to = page * PAGE + rows.length;
  const pages = total ? Math.ceil(total / PAGE) : 1;

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11.5 }}>
          <thead>
            <tr>
              {cols.map(c => (
                <th key={c.key} onClick={() => onSort(c.key)}
                    title="Sort by this column"
                    style={{
                      position: 'sticky', top: 0, zIndex: 1, background: 'var(--bg-elev)',
                      padding: '6px 8px', textAlign: c.isDim ? 'left' : 'right',
                      fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em',
                      color: sortKey === c.key ? 'var(--fg)' : 'var(--fg-3)', fontWeight: 600,
                      borderBottom: '1px solid var(--line)', cursor: 'pointer', whiteSpace: 'nowrap',
                    }}>
                  {c.label}
                  {sortKey === c.key && <span style={{ marginLeft: 4 }}>{sortDir === 'asc' ? '▲' : '▼'}</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} style={{ borderBottom: '1px solid var(--line-2)' }}>
                {cols.map(c => {
                  const v = r[c.key];
                  if (c.isDim) {
                    const raw = v == null ? null : String(v);
                    const label = raw === null ? '(none)'
                      : c.isDate ? bucketLabel(c.grain, raw) : raw;
                    const can = !!onPick && raw !== null && raw !== OTHER;
                    return (
                      <td key={c.key} style={{ padding: '5px 8px', color: 'var(--fg-2)', maxWidth: 260,
                                               overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {can ? (
                          <button type="button" onClick={() => onPick!(c, raw!, label)}
                                  title={`${label} — click to filter this page`}
                                  style={{ background: 'none', border: 'none', padding: 0, font: 'inherit',
                                           color: 'var(--fg-2)', cursor: 'pointer', textAlign: 'left',
                                           maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis',
                                           whiteSpace: 'nowrap', display: 'block' }}>
                            {label}
                          </button>
                        ) : label}
                      </td>
                    );
                  }
                  return (
                    <td key={c.key} style={{ ...NUM, padding: '5px 8px' }} title={exact(c.format, v)}>
                      {exact(c.format, v)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {total != null && total > PAGE && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingTop: 6, fontSize: 11, color: 'var(--fg-3)' }}>
          <span>{from.toLocaleString('en-IN')}–{to.toLocaleString('en-IN')} of {total.toLocaleString('en-IN')}</span>
          <span style={{ flex: 1 }} />
          <Pager label="Previous" disabled={page === 0} onClick={() => onPage(page - 1)} />
          <Pager label="Next" disabled={page + 1 >= pages} onClick={() => onPage(page + 1)} />
        </div>
      )}
    </div>
  );
}

function Pager({ label, disabled, onClick }: { label: string; disabled: boolean; onClick: () => void }) {
  return (
    <button type="button" disabled={disabled} onClick={onClick}
      style={{ background: 'var(--bg-paper)', border: '1px solid var(--line)', borderRadius: 4,
               padding: '2px 9px', fontSize: 11, color: disabled ? 'var(--fg-4)' : 'var(--fg-2)',
               cursor: disabled ? 'default' : 'pointer' }}>{label}</button>
  );
}

// ── matrix ────────────────────────────────────────────────────

/**
 * A pivot, with the totals the database computed.
 *
 * The engine marks a grouped-away dimension '__total' rather than null, so a
 * genuinely blank category and a total line are told apart here instead of
 * being guessed at.
 */
export function Matrix({ rows, format, rowLabel, colLabel, rowDate, colDate, rowGrain, colGrain, onPickRow, onPickCol }: {
  rows: Row[]; format: Format; rowLabel: string; colLabel: string;
  rowDate?: boolean; colDate?: boolean; rowGrain?: Grain; colGrain?: Grain;
  onPickRow?: OnPick; onPickCol?: OnPick;
}) {
  const m = shapeMatrix(rows, rowDate, colDate);
  const { rowKeys: rk, colKeys: ck, max, grand } = m;
  if (!rk.length) return <Empty />;

  const k = (v: string | null) => v ?? '\u0000null';
  const lbl = (v: string | null, isDate?: boolean, grain?: Grain) =>
    v === null ? '(none)' : isDate ? bucketLabel(grain, v) : v;

  const head: CSSProperties = {
    position: 'sticky', top: 0, zIndex: 1, background: 'var(--bg-elev)', padding: '6px 8px',
    fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--fg-3)',
    fontWeight: 600, borderBottom: '1px solid var(--line)', whiteSpace: 'nowrap',
  };
  const pick = (on: OnPick | undefined, v: string | null, label: string) =>
    on && v !== null && v !== OTHER
      ? { onClick: () => on(v, label), style: { cursor: 'pointer' }, title: `${label} — click to filter this page` }
      : {};

  return (
    <div style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
      <table style={{ borderCollapse: 'collapse', fontSize: 11.5, minWidth: '100%' }}>
        <thead>
          <tr>
            <th style={{ ...head, textAlign: 'left', left: 0, zIndex: 2, position: 'sticky' }}>
              {rowLabel} <span style={{ color: 'var(--fg-4)' }}>/ {colLabel}</span>
            </th>
            {ck.map(c => (
              <th key={k(c)} style={{ ...head, textAlign: 'right' }} {...pick(onPickCol, c, lbl(c, colDate, colGrain))}>
                {lbl(c, colDate, colGrain)}
              </th>
            ))}
            <th style={{ ...head, textAlign: 'right', color: 'var(--fg-2)' }}>Total</th>
          </tr>
        </thead>
        <tbody>
          {rk.map(r => (
            <tr key={k(r)} style={{ borderBottom: '1px solid var(--line-2)' }}>
              <td style={{ padding: '5px 8px', color: 'var(--fg-2)', position: 'sticky', left: 0,
                           background: 'var(--bg-paper)', whiteSpace: 'nowrap', maxWidth: 220,
                           overflow: 'hidden', textOverflow: 'ellipsis' }}
                  {...pick(onPickRow, r, lbl(r, rowDate, rowGrain))}>
                {lbl(r, rowDate, rowGrain)}
              </td>
              {ck.map(c => {
                const v = m.cell(r, c);
                return (
                  <td key={k(c)} title={v == null ? '' : exact(format, v)}
                      style={{ ...NUM, padding: '5px 8px',
                               // Shaded by size: a 12-column pivot of bare numbers
                               // is a wall, and the shading is what makes it legible.
                               background: v ? `color-mix(in oklab, var(--accent) ${Math.round((Math.abs(v) / max) * 22)}%, transparent)` : undefined }}>
                    {v == null ? '' : compact(format, v)}
                  </td>
                );
              })}
              <td style={{ ...NUM, padding: '5px 8px', fontWeight: 600, borderLeft: '1px solid var(--line)' }}
                  title={exact(format, m.rowTotal(r))}>
                {compact(format, m.rowTotal(r))}
              </td>
            </tr>
          ))}
          <tr style={{ borderTop: '1px solid var(--line-strong)' }}>
            <td style={{ padding: '5px 8px', fontWeight: 600, color: 'var(--fg)', position: 'sticky',
                         left: 0, background: 'var(--bg-paper)' }}>Total</td>
            {ck.map(c => (
              <td key={k(c)} style={{ ...NUM, padding: '5px 8px', fontWeight: 600 }}
                  title={exact(format, m.colTotal(c))}>
                {compact(format, m.colTotal(c))}
              </td>
            ))}
            <td style={{ ...NUM, padding: '5px 8px', fontWeight: 700, borderLeft: '1px solid var(--line)' }}
                title={exact(format, grand)}>{compact(format, grand)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

// ── the "this is folded" note ─────────────────────────────────

export function TruncNote({ visual }: { visual: Visual }) {
  const [open, setOpen] = useState(false);
  const cap = visual.topN ?? null;
  return (
    <button type="button" onClick={() => setOpen(o => !o)}
      style={{ background: 'none', border: 'none', padding: 0, fontSize: 10,
               color: 'var(--fg-3)', cursor: 'pointer', textAlign: 'left' }}>
      {open
        ? `Everything outside the top ${cap ?? 'few'} is added together as "Other". The total is right; the list is shortened.`
        : 'Showing the top few · why?'}
    </button>
  );
}
