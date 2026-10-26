"use client";

import { useState } from "react";
import type { KpiCard, KpiTone } from "@/lib/kpis";
import { useUrlTable } from "./url-table";

const TONE: Record<KpiTone, { dot: string; ring: string }> = {
  neutral: { dot: "bg-primary", ring: "ring-primary/40" },
  pending: { dot: "bg-amber-500", ring: "ring-amber-400/60" },
  part: { dot: "bg-sky-500", ring: "ring-sky-400/60" },
  done: { dot: "bg-emerald-500", ring: "ring-emerald-400/60" },
  danger: { dot: "bg-rose-500", ring: "ring-rose-400/60" },
};

/** A sum (e.g. ECs) with no params to set: shown, not clickable. A sum that sets params (EC Open) is a filter like any card. */
const readOnly = (c: KpiCard) => !!c.measure && Object.keys(c.params).length === 0;

/**
 * A row of small summary cards under the filter bar. A card whose params the
 * URL already carries is on; clicking it clears them, clicking another sets
 * its own (and clears the rest of the strip's).
 */
export function KpiStrip({ cards }: { cards: KpiCard[] }) {
  const { get, setParams } = useUrlTable();
  // The card just clicked shows on at once; the page follows when it loads.
  const [asked, setAsked] = useState<string | null>(null);
  const keys = [...new Set(cards.flatMap((c) => Object.keys(c.params)))];
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
  if (groups.some((g) => g.name)) {
    // Compact cards, each department's under its name; the departments wrap
    // onto a second row (or more) rather than squeezing or scrolling.
    return (
      <div data-url-dim className="mb-3 flex flex-wrap items-stretch gap-x-3 gap-y-2.5">
        {groups.map((g, i) => (
          <div
            key={g.name ?? i}
            className="flex min-w-0 flex-col gap-1"
            style={{ flexGrow: g.cards.length, flexBasis: `${g.cards.length * 5.6}rem` }}
          >
            {g.name && <span className="px-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{g.name}</span>}
            <div className="flex flex-1 items-stretch gap-1.5">
              <KpiStripRow cards={g.cards} keys={keys} shown={shown} onPick={setAsked} setParams={setParams} compact />
            </div>
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
  const size = compact ? "min-w-[4rem] flex-1 basis-0 rounded-lg px-1.5 py-1.5" : "min-w-[7.5rem] rounded-xl px-3 py-2";
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
              <span className={`font-display ${countCls} font-bold tabular-nums leading-tight text-foreground`}>{c.count}</span>
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
              setParams(on ? clear : { ...clear, ...c.params });
            }}
            className={`group flex ${size} flex-col items-start justify-between border bg-surface text-left shadow-sm transition-all hover:-translate-y-px hover:shadow ${
              on ? `border-transparent ring-2 ${tone.ring}` : "border-card-border"
            }`}
          >
            <span className={`flex items-start gap-1.5 ${labelCls} font-medium text-muted`}>
              <span className={`mt-[0.3em] h-1.5 w-1.5 shrink-0 rounded-full ${tone.dot}`} aria-hidden />
              {c.label}
            </span>
            <span className={`font-display ${countCls} font-bold tabular-nums leading-tight text-foreground`}>{c.count}</span>
          </button>
        );
      })}
    </div>
  );
}
