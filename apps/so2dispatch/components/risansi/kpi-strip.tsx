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
  const isOn = (c: KpiCard) => !c.measure && Object.entries(c.params).every(([k, v]) => (get(k) || null) === v);
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
    return (
      <div className="mb-3 flex flex-wrap gap-x-4 gap-y-3">
        {groups.map((g, i) => (
          <div key={g.name ?? i} className="min-w-0">
            {g.name && <p className="mb-1 px-0.5 text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground">{g.name}</p>}
            <KpiStripRow cards={g.cards} keys={keys} shown={shown} onPick={setAsked} setParams={setParams} />
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
}: {
  cards: KpiCard[];
  keys: string[];
  shown: string | null;
  onPick: (key: string) => void;
  setParams: (changes: Record<string, string | string[] | null>) => void;
  className?: string;
}) {
  const setAsked = onPick;
  return (
    <div className={`flex flex-wrap gap-2 ${className}`}>
      {cards.map((c) => {
        const on = shown === c.key;
        const tone = TONE[c.tone ?? "neutral"];
        // A sum (e.g. ECs) is a figure to read, not a filter.
        if (c.measure) {
          return (
            <div key={c.key} className="flex min-w-[7.5rem] flex-col items-start rounded-xl border border-dashed border-card-border bg-surface px-3 py-2 shadow-sm">
              <span className="flex items-center gap-1.5 text-[11px] font-medium text-muted">
                <span className={`h-1.5 w-1.5 rounded-full ${tone.dot}`} aria-hidden />
                {c.label}
              </span>
              <span className="font-display text-xl font-bold tabular-nums leading-tight text-foreground">{c.count}</span>
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
            className={`group flex min-w-[7.5rem] flex-col items-start rounded-xl border bg-surface px-3 py-2 text-left shadow-sm transition-all hover:-translate-y-px hover:shadow ${
              on ? `border-transparent ring-2 ${tone.ring}` : "border-card-border"
            }`}
          >
            <span className="flex items-center gap-1.5 text-[11px] font-medium text-muted">
              <span className={`h-1.5 w-1.5 rounded-full ${tone.dot}`} aria-hidden />
              {c.label}
            </span>
            <span className="font-display text-xl font-bold tabular-nums leading-tight text-foreground">{c.count}</span>
          </button>
        );
      })}
    </div>
  );
}
