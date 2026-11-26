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
function Count({ c, className, reserve = false }: { c: KpiCard; className: string; reserve?: boolean }) {
  // One block at the card's foot: the figure, and under it how many CV holds.
  // reserve: another card of the strip has that line, so this one keeps its
  // room too — every figure then sits on the same line.
  return (
    <span className="flex flex-col items-start">
      <CountFigures c={c} className={className} />
      {/* Held by Central Visibility: counted in the card (its status is its own), said here. */}
      {c.heldCount ? (
        <span className="mt-0.5 block text-[10px] font-semibold leading-tight text-rose-600 dark:text-rose-400">
          {c.heldCount} on CV hold
        </span>
      ) : reserve ? (
        <span className="mt-0.5 block text-[10px] leading-tight" aria-hidden>&nbsp;</span>
      ) : null}
    </span>
  );
}

/** Rupees as the cards show them: ₹1.23 Cr, ₹45.6 L, or in full below a lakh. */
function inr(n: number): string {
  if (n >= 1e7) return `₹${(n / 1e7).toFixed(2)} Cr`;
  if (n >= 1e5) return `₹${(n / 1e5).toFixed(2)} L`;
  return `₹${n.toLocaleString("en-IN")}`;
}

function CountFigures({ c, className }: { c: KpiCard; className: string }) {
  if (c.money) return <span className={className} title={`₹${c.count.toLocaleString("en-IN")}`}>{inr(c.count)}</span>;
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
export function KpiStrip({ cards, panels = false, merged = false }: { cards: KpiCard[]; panels?: boolean; merged?: boolean }) {
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
  // Any card saying how many CV holds: every card keeps room for that line.
  const reserve = cards.some((c) => !!c.heldCount);
  if (cards.length === 0) return null;
  // Cards with a group sit under its heading, groups side by side.
  const groups: { name: string | undefined; cards: KpiCard[] }[] = [];
  for (const c of cards) {
    const last = groups[groups.length - 1];
    if (last && last.name === c.group) last.cards.push(c);
    else groups.push({ name: c.group, cards: [c] });
  }
  // merged (the Orders page): every group in one strip, its heading over its
  // figures, a hairline between figures and a clear gap from one group to the
  // next.
  // Every strip but the Dashboard's panels takes this look (the Orders page and every department page).
  if (merged || !panels) {
    const pick = (c: KpiCard, on: boolean) => {
      const clear = Object.fromEntries(keys.map((k) => [k, null]));
      setAsked(on ? "__none" : c.key);
      setParams(on ? clear : { ...clear, ...c.params, [KPI_PICKED]: pickedValue(c.params) });
    };
    const TEXT: Record<KpiTone, string> = {
      neutral: "text-foreground",
      pending: "text-amber-600 dark:text-amber-400",
      part: "text-sky-700 dark:text-sky-300",
      done: "text-emerald-700 dark:text-emerald-400",
      danger: "text-rose-600 dark:text-rose-400",
    };
    return (
      <div data-url-dim className="mb-4 overflow-hidden rounded-2xl border border-card-border bg-surface shadow-sm">
        <div className="flex flex-wrap items-stretch">
          {groups.map((g, gi) => (
            <div key={g.name ?? gi} className="flex items-stretch">
              {/* A clear gap, and a hairline, between one department and the next. */}
              {gi > 0 && <span className="mx-3 my-3 w-px bg-card-border" aria-hidden />}
              <section className="flex flex-col py-2.5 pr-1">
                {g.name && <h3 className="px-3 pb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[#2F5496]/80 dark:text-sky-300">{g.name}</h3>}
                <div className="flex flex-1 items-stretch divide-x divide-card-border">
                  {g.cards.map((c) => {
                    const on = shown === c.key;
                    const tone = c.tone ?? "neutral";
                    const ro = readOnly(c);
                    const body = (
                      <>
                        <span className="block whitespace-nowrap text-[11.5px] font-medium text-muted">{c.label}</span>
                        <Count c={c} reserve={reserve} className={`mt-1 font-sans text-[1.3rem] font-semibold leading-none tracking-tight tabular-nums ${TEXT[tone]}`} />
                      </>
                    );
                    const cell = "flex min-w-[6.5rem] flex-col justify-between px-3 py-1 text-left";
                    return ro ? (
                      <div key={c.key} title={`${c.label}: a total, not a filter`} className={cell}>
                        {body}
                      </div>
                    ) : (
                      <button
                        key={c.key}
                        type="button"
                        aria-pressed={on}
                        title={on ? "Click to clear" : `Show only: ${c.label}`}
                        onClick={() => pick(c, on)}
                        className={`${cell} rounded-lg transition-colors ${on ? `${TONE[tone].on} ring-2 ring-inset ${TONE[tone].ring}` : "hover:bg-background"}`}
                      >
                        {body}
                      </button>
                    );
                  })}
                </div>
              </section>
            </div>
          ))}
        </div>
      </div>
    );
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
            className="min-w-0 overflow-hidden rounded-2xl border border-card-border bg-surface shadow-sm"
          >
            {/* The department as a navy band, as the department board's headings. */}
            <h3 className="relative overflow-hidden bg-gradient-to-r from-[#1F3864] to-[#2F5496] px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-white">
              <span className="pointer-events-none absolute -right-4 -top-6 h-14 w-14 rounded-full bg-white/[0.08]" aria-hidden />
              {g.name || "Overview"}
            </h3>
            <div className="grid gap-1.5 p-2" style={{ gridTemplateColumns: `repeat(${g.cards.length}, minmax(0, 1fr))` }}>
              {g.cards.map((c) => {
                const on = shown === c.key;
                const tone = TONE[c.tone ?? "neutral"];
                const ro = readOnly(c);
                const body = (
                  <>
                    <span className={`absolute inset-x-0 top-0 h-[3px] ${tone.bar} ${ro ? "opacity-40" : ""}`} aria-hidden />
                    <span className="line-clamp-2 min-h-[2.1em] text-[11px] font-medium leading-tight text-muted">{c.label}</span>
                    <Count c={c} reserve={reserve} className="mt-1 font-display text-[1.35rem] font-bold leading-none tabular-nums text-foreground" />
                  </>
                );
                const cell = "relative flex min-w-0 flex-col justify-between overflow-hidden rounded-xl border border-card-border px-3 pb-2 pt-2.5 text-left";
                return ro ? (
                  <div key={c.key} title={`${c.label}: a total, not a filter`} className={`${cell} bg-[#1F3864]/[0.03] dark:bg-white/[0.03]`}>
                    {body}
                  </div>
                ) : (
                  <button
                    key={c.key}
                    type="button"
                    aria-pressed={on}
                    title={on ? "Click to clear" : `Show only: ${c.label}`}
                    onClick={() => pick(c, on)}
                    className={`${cell} transition ${on ? `${tone.on} ring-2 ${tone.ring}` : "bg-surface hover:-translate-y-px hover:shadow-md"}`}
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
            <KpiStripRow cards={g.cards} keys={keys} shown={shown} onPick={setAsked} setParams={setParams} reserve={reserve} compact />
          </div>
        ))}
      </div>
    );
  }
  return <KpiStripRow cards={cards} keys={keys} shown={shown} onPick={setAsked} setParams={setParams} reserve={reserve} className="mb-3" />;
}

function KpiStripRow({
  cards,
  keys,
  shown,
  onPick,
  setParams,
  className = "",
  compact = false,
  reserve = false,
}: {
  /** Some card of the strip says how many CV holds: every card keeps that line's room. */
  reserve?: boolean;
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
              <Count c={c} reserve={reserve} className={`font-display ${countCls} font-bold tabular-nums leading-tight text-foreground`} />
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
            <Count c={c} reserve={reserve} className={`font-display ${countCls} font-bold tabular-nums leading-tight text-foreground`} />
          </button>
        );
      })}
    </div>
  );
}
