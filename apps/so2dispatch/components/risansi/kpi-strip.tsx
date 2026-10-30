"use client";

import { useState } from "react";
import { KPI_PICKED, pickedValue, type KpiCard, type KpiTone } from "@/lib/kpis";
import { useUrlTable } from "./url-table";

const TONE: Record<KpiTone, { dot: string; ring: string; bar: string; on: string }> = {
  neutral: { dot: "bg-primary", ring: "ring-primary/40", bar: "bg-primary", on: "bg-primary/[0.07]" },
  pending: { dot: "bg-amber-500", ring: "ring-amber-400/60", bar: "bg-amber-400", on: "bg-amber-50 dark:bg-amber-500/10" },
  part: { dot: "bg-sky-500", ring: "ring-sky-400/60", bar: "bg-sky-500", on: "bg-sky-50 dark:bg-sky-500/10" },
  done: { dot: "bg-emerald-500", ring: "ring-emerald-400/60", bar: "bg-emerald-500", on: "bg-emerald-50 dark:bg-emerald-500/10" },
  danger: { dot: "bg-rose-500", ring: "ring-rose-400/60", bar: "bg-rose-500", on: "bg-rose-50 dark:bg-rose-500/10" },
};

/** The card's count — and, when it has one, its second figure (the pumps those SOs hold). */
function Count({ c, className }: { c: KpiCard; className: string }) {
  if (!c.also) return <span className={className}>{c.count}</span>;
  return (
    <span className={`${className} flex flex-wrap items-baseline gap-x-1.5`}>
      <span>
        {c.count}
        <span className="ml-0.5 text-[10px] font-semibold text-muted">SO{c.count === 1 ? "" : "s"}</span>
      </span>
      <span className="text-[0.8em]">
        {c.also.count}
        <span className="ml-0.5 text-[10px] font-semibold text-muted">{c.also.label}</span>
      </span>
    </span>
  );
}

/** A sum (e.g. ECs) with no params to set: shown, not clickable. A sum that sets params (EC Open) is a filter like any card. */
const readOnly = (c: KpiCard) => !!c.measure && Object.keys(c.params).length === 0;

/**
 * A row of small summary cards under the filter bar. A card whose params the
 * URL already carries is on; clicking it clears them, clicking another sets
 * its own (and clears the rest of the strip's). `panels` (the dashboard):
 * each group in its own titled panel, its cards as even cells.
 */
export function KpiStrip({ cards, panels = false }: { cards: KpiCard[]; panels?: boolean }) {
  const { get, setParams } = useUrlTable();
  // The card just clicked shows on at once; the page follows when it loads.
  const [asked, setAsked] = useState<string | null>(null);
  // Clicking a card names it too (KPI_PICKED): the cards then count without its filter.
  const keys = [...new Set([...cards.flatMap((c) => Object.keys(c.params)), KPI_PICKED])];
  const isOn = (c: KpiCard) => !readOnly(c) && Object.entries(c.params).every(([k, v]) => (get(k) || null) === v);
  const onKey = cards.find(isOn)?.key ?? null;
  const [seen, setSeen] = useState(onKey);
  if (seen !== onKey) {
    setSeen(onKey);
    setAsked(null);
  }
  const shown = asked ?? onKey;
  if (cards.length === 0) return null;
  // Cards with a group sit under its heading, groups side by side.
  const groups: { name: string | undefined; cards: KpiCard[] }[] = [];
  for (const c of cards) {
    const last = groups[groups.length - 1];
    if (last && last.name === c.group) last.cards.push(c);
    else groups.push({ name: c.group, cards: [c] });
  }
  if (panels) {
    const pick = (c: KpiCard, on: boolean) => {
      const clear = Object.fromEntries(keys.map((k) => [k, null]));
      setAsked(on ? "__none" : c.key);
      setParams(on ? clear : { ...clear, ...c.params, [KPI_PICKED]: pickedValue(c.params) });
    };
    return (
      <div data-url-dim className="mb-4 flex flex-wrap items-stretch gap-3">
        {groups.map((g, i) => (
          <section
            key={g.name ?? i}
            // A panel as wide as its cells need, the row's spare width shared out —
            // but never stretched past roomy cells when it ends up alone on a row.
            style={{ flexGrow: g.cards.length, flexBasis: `${g.cards.length * 5.75}rem`, maxWidth: `${g.cards.length * 11}rem` }}
            className="min-w-0 rounded-2xl border border-card-border bg-surface p-2.5 shadow-sm"
          >
            <h3 className="px-1.5 pb-2 text-[11px] font-semibold uppercase tracking-wider text-muted">{g.name || "Overview"}</h3>
            <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${g.cards.length}, minmax(0, 1fr))` }}>
              {g.cards.map((c) => {
                const on = shown === c.key;
                const tone = TONE[c.tone ?? "neutral"];
                const ro = readOnly(c);
                const body = (
                  <>
                    <span className={`absolute inset-y-2 left-0 w-[3px] rounded-r-full ${tone.bar} ${ro ? "opacity-40" : ""}`} aria-hidden />
                    <span className="line-clamp-2 min-h-[2.1em] text-[11px] font-medium leading-tight text-muted">{c.label}</span>
                    <Count c={c} className="mt-1 font-display text-[1.35rem] font-bold leading-none tabular-nums text-foreground" />
                  </>
                );
                const cell = "relative flex min-w-0 flex-col justify-between rounded-xl px-3 py-2 text-left";
                return ro ? (
                  <div key={c.key} title={`${c.label}: a total, not a filter`} className={`${cell} bg-background/60`}>
                    {body}
                  </div>
                ) : (
                  <button
                    key={c.key}
                    type="button"
                    aria-pressed={on}
                    title={on ? "Click to clear" : `Show only: ${c.label}`}
                    onClick={() => pick(c, on)}
                    className={`${cell} transition-colors ${on ? `${tone.on} ring-2 ${tone.ring}` : "bg-background/60 hover:bg-background"}`}
                  >
                    {body}
                  </button>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    );
  }
  if (groups.some((g) => g.name)) {
    // Every card the same size; a department's cards together, a little
    // more space between departments, wrapping onto as many rows as needed.
    return (
      <div data-url-dim className="mb-3 flex flex-wrap items-stretch gap-x-4 gap-y-1.5">
        {groups.map((g, i) => (
          <div key={g.name ?? i} className="flex flex-wrap items-stretch gap-1.5">
            <KpiStripRow cards={g.cards} keys={keys} shown={shown} onPick={setAsked} setParams={setParams} compact />
          </div>
        ))}
      </div>
    );
  }
  return <KpiStripRow cards={cards} keys={keys} shown={shown} onPick={setAsked} setParams={setParams} className="mb-3" />;
}

function KpiStripRow({
  cards,
  keys,
  shown,
  onPick,
  setParams,
  className = "",
  compact = false,
}: {
  /** Small cards that share one row. */
  compact?: boolean;
  cards: KpiCard[];
  keys: string[];
  shown: string | null;
  onPick: (key: string) => void;
  setParams: (changes: Record<string, string | string[] | null>) => void;
  className?: string;
}) {
  const setAsked = onPick;
  // Compact: the cards share the row evenly, labels may wrap.
  const size = compact ? "min-h-[4.25rem] w-[6.5rem] shrink-0 rounded-lg px-2 py-1.5" : "min-w-[7.5rem] rounded-xl px-3 py-2";
  const labelCls = compact ? "text-[10.5px] leading-tight" : "text-[11px]";
  const countCls = compact ? "text-lg" : "text-xl";
  return (
    <div data-url-dim className={compact ? "contents" : `flex flex-wrap gap-2 ${className}`}>
      {cards.map((c) => {
        const on = shown === c.key;
        const tone = TONE[c.tone ?? "neutral"];
        // A sum with nothing to set (e.g. all ECs) is a figure to read, not a filter.
        if (readOnly(c)) {
          return (
            <div key={c.key} className={`flex ${size} flex-col items-start justify-between border border-dashed border-card-border bg-surface shadow-sm`}>
              <span className={`flex items-start gap-1.5 ${labelCls} font-medium text-muted`}>
                <span className={`mt-[0.3em] h-1.5 w-1.5 shrink-0 rounded-full ${tone.dot}`} aria-hidden />
                {c.label}
              </span>
              <Count c={c} className={`font-display ${countCls} font-bold tabular-nums leading-tight text-foreground`} />
            </div>
          );
        }
        return (
          <button
            key={c.key}
            type="button"
            aria-pressed={on}
            onClick={() => {
              const clear = Object.fromEntries(keys.map((k) => [k, null]));
              setAsked(on ? "__none" : c.key);
              setParams(on ? clear : { ...clear, ...c.params, [KPI_PICKED]: pickedValue(c.params) });
            }}
            className={`group flex ${size} flex-col items-start justify-between border bg-surface text-left shadow-sm transition-all hover:-translate-y-px hover:shadow ${
              on ? `border-transparent ring-2 ${tone.ring}` : "border-card-border"
            }`}
          >
            <span className={`flex items-start gap-1.5 ${labelCls} font-medium text-muted`}>
              <span className={`mt-[0.3em] h-1.5 w-1.5 shrink-0 rounded-full ${tone.dot}`} aria-hidden />
              {c.label}
            </span>
            <Count c={c} className={`font-display ${countCls} font-bold tabular-nums leading-tight text-foreground`} />
          </button>
        );
      })}
    </div>
  );
}
