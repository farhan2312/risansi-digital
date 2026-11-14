'use client';

// One card on a report page: the frame, the query, and the right renderer.
//
// Every card runs its own visual. They go out in parallel on mount, so a page
// of ten cards is one wave rather than ten round trips in a queue, and a card
// that fails says so in its own frame instead of taking the page down.
//
// THE LOADING RULE
//
// `loading` is derived, not stored: the card keeps the request key alongside
// the result it got, and anything whose key is not the current one is stale.
// That is why there is no setState at the top of the effect — a card re-runs
// whenever the page filters or the cross-filter change, and a stored flag
// would need clearing in both directions and would be wrong in one of them.

import { useEffect, useState, useMemo } from 'react';
import { runReportVisual } from '@/app/actions/risansi-reports';
import { VISUAL_META, type Visual, type PageFilters, type Grain } from '@/lib/custom-analytics/types';
import type { CrossFilter, RunResult } from '@/lib/custom-analytics/engine';
import { fieldOf, type Format } from '@/lib/custom-analytics/model';
import { formatOf, labelOf, defaultTitle } from '@/lib/custom-analytics/fmt';
import { problems, combinedInfo } from '@/lib/custom-analytics/build';
import {
  normalise, Kpi, Columns, Bars, Lines, DonutChart, Treemap, DataTable, Matrix,
  Empty, TruncNote, type SeriesDef, type TableCol,
} from './Charts';

export interface PickedCategory {
  dataset: string;
  field: string;
  grain?: Grain;
  value: string;
  label: string;
  common?: string;
  sourceVisual: string;
}

export interface VisualCardProps {
  visual: Visual;
  filters: PageFilters;
  cross: CrossFilter | null;
  /** Null in the viewer's read-only chrome; set when a click can filter. */
  onPick: ((p: PickedCategory) => void) | null;
  /** Chrome shown in the card header by the builder (select, remove…). */
  actions?: React.ReactNode;
  /** The builder marks the selected card. */
  selected?: boolean;
  onSelect?: () => void;
}

export function VisualCard({ visual, filters, cross, onPick, actions, selected, onSelect }: VisualCardProps) {
  const [page, setPage] = useState(0);
  const [sort, setSort] = useState<{ key: string; dir: 'asc' | 'desc' } | null>(null);

  // The request, as a string, so the effect has one stable dependency — and
  // built from ONLY what the engine reads.
  //
  // Keying it on the whole visual was wrong in a way that is invisible until
  // you watch the network tab: dragging a card changes its layout, settling
  // changes the layout of every card it pushed, and typing a title changes a
  // string the query has never seen. All three re-ran the query. A page of
  // ten cards nudged one column was ten aggregations nobody asked for, and
  // naming a card was one per keystroke.
  //
  // So: type, table, wells and top-N, which are the query. Not the title,
  // not `stacked`, not the layout. The cosmetic parts of a cross-filter go
  // the same way — re-labelling a chip is not a reason to re-run anything.
  const req = useMemo(() => JSON.stringify({
    v: {
      t: visual.type, d: visual.dataset, a: visual.axis, s: visual.split,
      m: visual.dims, n: visual.values, top: visual.topN,
    },
    f: filters, p: page, s: sort,
    x: cross ? { d: cross.dataset, f: cross.field, g: cross.grain, v: cross.value, c: cross.common } : null,
  }), [visual.type, visual.dataset, visual.axis, visual.split, visual.dims, visual.values,
       visual.topN, filters, page, sort, cross]);

  const [got, setGot] = useState<{ key: string; result: RunResult } | null>(null);

  // What is still missing, answered here rather than by the server. The
  // engine refuses an unfinished card with the same words, but only after a
  // round trip — and a card being built is unfinished most of the time, so
  // that is a query per keystroke to be told something this file already
  // knows.
  const unfinished = problems(visual);

  useEffect(() => {
    if (unfinished.length) return;
    let alive = true;
    void (async () => {
      const result = await runReportVisual(
        visual, filters, cross ?? undefined,
        { page, sortKey: sort?.key, sortDir: sort?.dir },
      ).catch((): RunResult => ({ ok: false, error: 'Could not reach the server.' }));
      if (alive) setGot({ key: req, result });
    })();
    return () => { alive = false; };
    // Everything read inside is already encoded in `req`, so the effect re-runs
    // exactly when the ANSWER would change. Depending on the objects as well
    // would re-run it whenever the parent re-rendered.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [req]);

  const result = got?.key === req ? got.result : null;
  const stale = got !== null && got.key !== req;

  const meta = VISUAL_META[visual.type];
  const series = useMemo<SeriesDef[]>(
    () => (visual.values ?? []).slice(0, meta.maxValues).map((v, i) => ({
      key: `m${i}`, label: labelOf(visual.dataset, v), format: formatOf(visual.dataset, v),
    })),
    [visual.values, visual.dataset, meta.maxValues],
  );

  const combined = combinedInfo(visual);
  const axisField = visual.axis ? fieldOf(visual.dataset ?? '', visual.axis.field) : null;
  const splitField = visual.split ? fieldOf(visual.dataset ?? '', visual.split.field) : null;
  const heading = visual.title || defaultTitle(visual);

  return (
    <section
      onClick={onSelect}
      style={{
        background: 'var(--bg-paper)',
        border: `1px solid ${selected ? 'var(--accent)' : 'var(--line)'}`,
        boxShadow: selected ? '0 0 0 1px var(--accent)' : undefined,
        borderRadius: 'var(--radius, 6px)',
        padding: 12, display: 'flex', flexDirection: 'column', gap: 8,
        height: '100%', minHeight: 0, overflow: 'hidden',
        opacity: stale ? 0.55 : 1, transition: 'opacity 120ms',
      }}
    >
      <header style={{ display: 'flex', alignItems: 'flex-start', gap: 8, flexShrink: 0 }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <h3 style={{ margin: 0, fontSize: 11, fontWeight: 600, letterSpacing: '0.07em',
                       textTransform: 'uppercase', color: 'var(--fg-3)',
                       overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
              title={heading}>{heading}</h3>
        </div>
        {actions}
      </header>

      {unfinished.length ? (
        <Unfinished list={unfinished} />
      ) : !result ? (
        <Skeleton type={visual.type} />
      ) : !result.ok ? (
        <Empty note={result.error ?? 'Could not load this visual.'} />
      ) : (
        <Body
          visual={visual} result={result} series={series}
          axis={axisField ? { isDate: !!axisField.date, grain: visual.axis?.grain, field: axisField.id, label: axisField.label, common: axisField.common } : null}
          split={splitField ? { isDate: !!splitField.date, grain: visual.split?.grain, field: splitField.id, label: splitField.label, common: splitField.common } : null}
          page={page} setPage={setPage} sort={sort} setSort={setSort} onPick={onPick}
        />
      )}

      {(combined || (result?.ok && (result.truncated || result.ignoredFilters?.length))) && (
        <footer style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
          {combined && (
            combined.on.length ? (
              <span style={{ fontSize: 10, color: 'var(--fg-4)' }}
                    title="Two tables on one card. They are lined up on the categories they share, so each row carries both tables' own figure for it.">
                Two tables, matched on {combined.on.join(' and ').toLowerCase()}
              </span>
            ) : (
              <span style={{ fontSize: 10, color: 'var(--fg-4)' }}
                    title="Nothing to line the two tables up on, because the card is not broken down by anything. Each figure is its own table's total.">
                Two tables, each its own total
              </span>
            )
          )}
          {result?.truncated && <TruncNote visual={visual} />}
          {!!result?.ignoredFilters?.length && (
            <span style={{ fontSize: 10, color: 'var(--warn)' }}
                  title="This table has no column the filter could be applied to, so it was left out rather than quietly ignored.">
              ⚠ {result.ignoredFilters.join(', ')} {result.ignoredFilters.length === 1 ? 'filter does' : 'filters do'} not apply here
            </span>
          )}
        </footer>
      )}
    </section>
  );
}

// ── the body, per type ────────────────────────────────────────

interface DimInfo { isDate: boolean; grain?: Grain; field: string; label: string; common?: string }

function Body({ visual, result, series, axis, split, page, setPage, sort, setSort, onPick }: {
  visual: Visual; result: RunResult; series: SeriesDef[];
  axis: DimInfo | null; split: DimInfo | null;
  page: number; setPage: (p: number) => void;
  sort: { key: string; dir: 'asc' | 'desc' } | null;
  setSort: (s: { key: string; dir: 'asc' | 'desc' } | null) => void;
  onPick: ((p: PickedCategory) => void) | null;
}) {
  const rows = result.rows ?? [];
  const ds = visual.dataset ?? '';

  const pickAxis = onPick && axis
    ? (value: string, label: string) => onPick({
        dataset: ds, field: axis.field, grain: axis.grain, value, label,
        common: axis.common, sourceVisual: visual.id,
      })
    : undefined;
  const pickSplit = onPick && split
    ? (value: string, label: string) => onPick({
        dataset: ds, field: split.field, grain: split.grain, value, label,
        common: split.common, sourceVisual: visual.id,
      })
    : undefined;

  const sortBy = (key: string) =>
    setSort(sort?.key === key ? { key, dir: sort.dir === 'desc' ? 'asc' : 'desc' } : { key, dir: 'desc' });

  switch (visual.type) {
    case 'kpi':
      return <Kpi value={rows[0]?.m0 ?? null} format={series[0]?.format ?? 'num'} label={series[0]?.label} />;

    case 'column':
    case 'bar':
    case 'line':
    case 'area':
    case 'donut':
    case 'treemap': {
      const n = normalise(rows, series, axis, !!visual.split);
      if (visual.type === 'column') return <Columns n={n} onPick={pickAxis} stacked={visual.stacked} />;
      if (visual.type === 'bar')    return <Bars n={n} onPick={pickAxis} />;
      if (visual.type === 'line')   return <Lines n={n} onPick={pickAxis} />;
      if (visual.type === 'area')   return <Lines n={n} area onPick={pickAxis} />;
      if (visual.type === 'donut')  return <DonutChart n={n} onPick={pickAxis} />;
      return <Treemap n={n} onPick={pickAxis} />;
    }

    case 'matrix':
      return (
        <Matrix
          rows={rows} format={series[0]?.format ?? 'num'}
          rowLabel={axis?.label ?? 'Rows'} colLabel={split?.label ?? 'Columns'}
          rowDate={axis?.isDate} colDate={split?.isDate}
          rowGrain={axis?.grain} colGrain={split?.grain}
          onPickRow={pickAxis} onPickCol={pickSplit}
        />
      );

    case 'table': {
      const dimCols: TableCol[] = (visual.dims ?? []).slice(0, 4).map((d, i) => {
        const f = fieldOf(ds, d.field);
        return {
          key: `d${i}`, label: f?.label ?? d.field, format: 'text' as Format,
          isDim: true, grain: d.grain, isDate: !!f?.date,
        };
      });
      const valCols: TableCol[] = series.map(s => ({
        key: s.key, label: s.label, format: s.format, isDim: false,
      }));
      return (
        <DataTable
          rows={rows} cols={[...dimCols, ...valCols]} total={result.total}
          page={page} onPage={setPage}
          sortKey={sort?.key} sortDir={sort?.dir} onSort={sortBy}
          onPick={onPick ? (c, raw, label) => {
            const i = Number(c.key.slice(1));
            const ref = (visual.dims ?? [])[i];
            const f = ref ? fieldOf(ds, ref.field) : null;
            if (!ref || !f) return;
            onPick({ dataset: ds, field: ref.field, grain: ref.grain, value: raw, label,
                     common: f.common, sourceVisual: visual.id });
          } : undefined}
        />
      );
    }

    default:
      return <Empty note="This card has a type this version does not draw." />;
  }
}

/**
 * A card that cannot be drawn yet, saying so in the words of whatever is
 * missing.
 *
 * It appears in the viewer too, where it is not actionable — but "this card
 * is not finished" is still the honest thing to show a reader, and better
 * than the blank frame or the server's "Add a number to this visual", which
 * reads like an instruction to somebody who cannot act on it.
 */
function Unfinished({ list }: { list: string[] }) {
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center',
                  gap: 4, padding: '4px 2px' }}>
      <span style={{ fontSize: 11.5, color: 'var(--fg-3)' }}>This card is not finished.</span>
      {list.map(x => (
        <span key={x} style={{ fontSize: 10.5, color: 'var(--fg-4)' }}>· {x}</span>
      ))}
    </div>
  );
}

// ── waiting ───────────────────────────────────────────────────

/**
 * Shaped roughly like what is coming, so the page does not jump when it lands.
 *
 * `.shimmer` is the app's own skeleton class from globals.css rather than a
 * new animation: the route-level loading.tsx files already use it, so a
 * report page waiting looks like every other page waiting.
 */
function Skeleton({ type }: { type: Visual['type'] }) {
  if (type === 'kpi') {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center' }}>
        <div className="shimmer" style={{ height: 30, width: '70%' }} />
      </div>
    );
  }
  if (type === 'table' || type === 'matrix') {
    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 5, minHeight: 80 }}>
        {[0, 1, 2, 3, 4, 5].map(i => (
          <div key={i} className="shimmer" style={{ height: 14, opacity: 1 - i * 0.13 }} />
        ))}
      </div>
    );
  }
  return (
    <div style={{ flex: 1, display: 'flex', alignItems: 'flex-end', gap: 6, minHeight: 90 }}>
      {[55, 80, 40, 95, 65, 30].map((h, i) => (
        <div key={i} className="shimmer" style={{ height: `${h}%`, flex: 1 }} />
      ))}
    </div>
  );
}
