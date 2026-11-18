"use client";

import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import { PanelRightClose, PanelRightOpen } from "lucide-react";
import { setSplitPanelPrefs, useSplitPanelPrefs } from "./split-panel-prefs";

// Split view for the department pages (the profile menu's Table / Split
// switch): the SO list on the left, the SO picked on the right. A page lists
// its columns once (SplitCol); the table draws them across and the panel
// stands the same ones upright, so whatever the table shows, the panel does.

export type SplitCol<R> = {
  key: string;
  /** The label: the panel's row heading, and the table's unless `head` is given. */
  label: string;
  /** The table's heading, when it is more than the label (a sort header). */
  head?: ReactNode;
  thClass?: string;
  tdClass?: string;
  cell: (row: R) => ReactNode;
  /** Kept in the split view's narrow list (the SO's identity and state). */
  list?: boolean;
  /** Too wide for a label beside it (a list of items): the panel gives it the full width. */
  wide?: boolean;
};

/** One row upright: each column's label down the left, its cell beside it. */
export function Portrait<R>({ cols, row }: { cols: SplitCol<R>[]; row: R }) {
  const narrow = cols.filter((c) => !c.wide);
  const wide = cols.filter((c) => c.wide);
  return (
    <div className="space-y-3">
      {narrow.length > 0 && (
        <table className="portrait-grid text-sm" style={{ gridTemplateRows: `repeat(${narrow.length}, auto)` }}>
          <tbody>
            <tr>
              {narrow.map((c) => (
                <th key={c.key}>{c.label}</th>
              ))}
            </tr>
            <tr>
              {narrow.map((c) => (
                <td key={c.key} className="text-foreground">
                  {c.cell(row)}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      )}
      {wide.map((c) => (
        <div key={c.key}>
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted">{c.label}</div>
          <div className="overflow-x-auto rounded-lg border border-card-border p-2">{c.cell(row)}</div>
        </div>
      ))}
    </div>
  );
}

/**
 * The page's layout: in split view, the list and the panel side by side (the
 * panel stays in view as the page scrolls, and folds to a slim rail); in table
 * view, the list alone.
 */
export function SplitShell({
  split,
  list,
  panel,
  focusKey,
  focusLabel,
  title = "SO details",
}: {
  split: boolean;
  list: ReactNode;
  /** What the panel shows for the SO picked (null: nothing on this page). */
  panel: ReactNode;
  /** Changes when another SO is picked: the panel opens again, scrolled to its top. */
  focusKey?: string | null;
  /** The SO picked, written down the folded rail. */
  focusLabel?: string | null;
  title?: string;
}) {
  const prefs = useSplitPanelPrefs();
  const box = useRef<HTMLElement | null>(null);
  const first = useRef(true);
  useEffect(() => {
    // Only on a pick, not on the first paint.
    if (first.current) {
      first.current = false;
      return;
    }
    if (prefs.collapsed) setSplitPanelPrefs({ collapsed: false });
    box.current?.scrollTo({ top: 0 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusKey]);
  if (!split) return <>{list}</>;
  return (
    <div className={`grid items-start gap-4 ${prefs.collapsed ? "grid-cols-[minmax(0,1fr)_2.75rem]" : "grid-cols-[minmax(0,3fr)_minmax(0,2fr)]"}`}>
      <div className="min-w-0">{list}</div>
      {prefs.collapsed ? (
        <aside className="sticky top-20 z-30 flex flex-col items-center gap-3 rounded-xl border border-card-border bg-surface py-3 shadow-sm">
          <button
            type="button"
            onClick={() => setSplitPanelPrefs({ collapsed: false })}
            title={`Expand the ${title} panel`}
            aria-label={`Expand the ${title} panel`}
            className="rounded-lg p-1.5 text-muted transition-colors hover:bg-background hover:text-foreground"
          >
            <PanelRightOpen className="h-4 w-4" />
          </button>
          {focusLabel && <span className="text-xs font-semibold text-foreground [writing-mode:vertical-rl]">{focusLabel}</span>}
        </aside>
      ) : (
        <aside
          ref={box}
          // Its own layer above the table (whose SO column is sticky too).
          className="sticky top-20 z-30 max-h-[calc(100vh-6rem)] overflow-y-auto rounded-xl border border-card-border bg-surface shadow-sm"
        >
          <div className="sticky top-0 z-10 flex items-center justify-between gap-2 rounded-t-xl border-b border-card-border bg-surface px-4 py-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted">
              {title}
              {focusLabel ? <span className="ml-2 normal-case tracking-normal text-foreground">{focusLabel}</span> : null}
            </span>
            <button
              type="button"
              onClick={() => setSplitPanelPrefs({ collapsed: true })}
              title={`Collapse the ${title} panel`}
              aria-label={`Collapse the ${title} panel`}
              className="rounded-lg p-1.5 text-muted transition-colors hover:bg-background hover:text-foreground"
            >
              <PanelRightClose className="h-4 w-4" />
            </button>
          </div>
          <div className="space-y-4 p-4">{panel ?? <p className="text-sm text-muted">No SO on this page.</p>}</div>
        </aside>
      )}
    </div>
  );
}

/**
 * The SO's ECs in the panel, with a row of EC chips (always, even for one EC) to look at one at a time
 * (the others fold away) or all of them. Give it `key` = the SO, so picking
 * another SO starts again on All.
 */
export function EcFocus<E>({
  ecs,
  keyOf,
  labelOf,
  children,
}: {
  ecs: E[];
  keyOf: (ec: E) => string;
  labelOf: (ec: E) => string;
  children: (ec: E) => ReactNode;
}) {
  const [picked, setPicked] = useState<string | null>(null);
  const shown = picked && ecs.some((e) => keyOf(e) === picked) ? ecs.filter((e) => keyOf(e) === picked) : ecs;
  const chip = (on: boolean) =>
    `inline-flex h-7 items-center rounded-full border px-3 text-xs font-semibold transition-colors ${
      on ? "border-primary bg-primary text-primary-foreground" : "border-input-border bg-surface text-foreground hover:bg-background"
    }`;
  return (
    <>
      {ecs.length > 0 && (
        <div role="tablist" aria-label="ECs" className="sticky top-11 z-[5] -mx-4 flex flex-wrap gap-1.5 border-b border-card-border bg-surface/95 px-4 py-2 backdrop-blur">
          <button type="button" role="tab" aria-selected={shown === ecs} onClick={() => setPicked(null)} className={chip(shown === ecs)}>
            All ECs ({ecs.length})
          </button>
          {ecs.map((e) => {
            const on = shown !== ecs && keyOf(e) === picked;
            return (
              <button key={keyOf(e)} type="button" role="tab" aria-selected={on} onClick={() => setPicked(keyOf(e))} className={chip(on)}>
                EC {labelOf(e)}
              </button>
            );
          })}
        </div>
      )}
      {shown.map((e) => (
        <Fragment key={keyOf(e)}>{children(e)}</Fragment>
      ))}
    </>
  );
}

/** A heading inside the panel: a part of the SO (its ECs, one EC). */
export function PanelSection({ title, aside, children }: { title: ReactNode; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-card-border p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">{title}</h3>
        {aside}
      </div>
      {children}
    </section>
  );
}
