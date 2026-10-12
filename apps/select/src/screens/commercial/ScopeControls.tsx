"use client";

import { useEffect, useRef, useState } from "react";

import {
  DEFAULT_OUT_OF_SCOPE_ITEMS,
  defaultScopeItems,
  offerOutOfScope,
  offerScope,
  outOfScopeItems,
  scopeItems,
  scopePool,
  type OfferConfig,
} from "../../lib/commercial-offer";

// Scope of supply / Out of scope pickers for the Commercial Offer sheet, shown
// on the Commercial Summary (per drive group). Saved in the group's offer
// config (projects.commercial_offer_config); the Commercial Offer prints them.

const btn =
  "inline-flex items-center gap-1.5 rounded-lg border border-line bg-paper px-3 py-1.5 text-[12.5px] font-semibold text-fg-2 hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-50";

/** The two lines as they will print. */
export function ScopeLines({ config, group }: { config: OfferConfig; group: string }) {
  const scope = offerScope(config, group);
  const out = offerOutOfScope(config);
  return (
    <div className="flex flex-col gap-1 text-[12.5px]">
      <p className="font-semibold text-[#c00000] italic">Scope of supply :- {scope || "—"}</p>
      <p className="text-fg-2 italic">Out Of Scope :- {out || "—"}</p>
    </div>
  );
}

/** Scope of supply / Out of scope as two multi-select dropdowns over one item
 *  pool: ticking an item in one list takes it out of the other. Selected items
 *  keep the pool's order on the sheet. */
export default function ScopeControls({
  config,
  group,
  onChange,
}: {
  config: OfferConfig;
  /** Drive group — picks the default scope (V-Belt has its own). */
  group: string;
  onChange: (next: OfferConfig) => void;
}) {
  const pool = scopePool(config, group);
  const inScope = scopeItems(config, group);
  const outScope = outOfScopeItems(config);
  const ordered = (set: Set<string>) => pool.filter((i) => set.has(i));

  const toggle = (list: "scope" | "out", item: string) => {
    const mine = new Set(list === "scope" ? inScope : outScope);
    const other = new Set(list === "scope" ? outScope : inScope);
    if (mine.has(item)) mine.delete(item);
    else {
      mine.add(item);
      other.delete(item);
    }
    onChange({
      ...config,
      scope: ordered(list === "scope" ? mine : other),
      outOfScope: ordered(list === "scope" ? other : mine),
    });
  };
  const addItem = (list: "scope" | "out", item: string) => {
    const name = item.trim().slice(0, 120);
    if (!name) return;
    const extra = pool.includes(name) ? config.scopeExtra : [...config.scopeExtra, name];
    const nextPool = [...new Set([...pool, name])];
    const mine = new Set([...(list === "scope" ? inScope : outScope), name]);
    const other = new Set((list === "scope" ? outScope : inScope).filter((i) => i !== name));
    const order = (set: Set<string>) => nextPool.filter((i) => set.has(i));
    onChange({
      ...config,
      scopeExtra: extra,
      scope: order(list === "scope" ? mine : other),
      outOfScope: order(list === "scope" ? other : mine),
    });
  };
  // Back to the format's default for this list; the other list drops anything
  // the default now claims.
  const reset = (list: "scope" | "out") => {
    const def = new Set(list === "scope" ? defaultScopeItems(group) : DEFAULT_OUT_OF_SCOPE_ITEMS);
    const other = (list === "scope" ? outScope : inScope).filter((i) => !def.has(i));
    onChange(
      list === "scope"
        ? { ...config, scope: null, outOfScope: other }
        : { ...config, outOfScope: null, scope: other },
    );
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <ScopeDropdown
        label="Scope of supply"
        tone="text-[#c00000]"
        pool={pool}
        selected={inScope}
        elsewhere={outScope}
        elsewhereLabel="out of scope"
        changed={config.scope !== null}
        onToggle={(i) => toggle("scope", i)}
        onAdd={(i) => addItem("scope", i)}
        onReset={() => reset("scope")}
      />
      <ScopeDropdown
        label="Out of scope"
        tone="text-fg-2"
        pool={pool}
        selected={outScope}
        elsewhere={inScope}
        elsewhereLabel="in scope"
        changed={config.outOfScope !== null}
        onToggle={(i) => toggle("out", i)}
        onAdd={(i) => addItem("out", i)}
        onReset={() => reset("out")}
      />
      <span className="text-[11.5px] text-fg-3">Ticked items print on the sheet; an item is in one list or the other.</span>
    </div>
  );
}

function ScopeDropdown({
  label,
  tone,
  pool,
  selected,
  elsewhere,
  elsewhereLabel,
  changed,
  onToggle,
  onAdd,
  onReset,
}: {
  label: string;
  tone: string;
  pool: string[];
  selected: string[];
  elsewhere: string[];
  elsewhereLabel: string;
  changed: boolean;
  onToggle: (item: string) => void;
  onAdd: (item: string) => void;
  onReset: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);
  const add = () => {
    if (!text.trim()) return;
    onAdd(text);
    setText("");
  };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={`${btn} ${changed ? "border-warn" : ""}`}
      >
        <span className={tone}>{label}</span>
        <span className="rounded-full bg-sunk px-1.5 text-[11px] text-fg-2">{selected.length}</span>
        <span aria-hidden="true">▾</span>
      </button>
      {open && (
        <div className="absolute left-0 z-20 mt-1 flex w-[340px] flex-col rounded-lg border border-line bg-paper shadow-[0_12px_32px_rgba(0,0,0,0.18)]">
          <div className="max-h-[300px] overflow-y-auto p-1.5">
            {pool.map((item) => {
              const on = selected.includes(item);
              const other = elsewhere.includes(item);
              return (
                <label
                  key={item}
                  className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-[12.5px] text-fg hover:bg-sunk"
                >
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={() => onToggle(item)}
                    className="h-3.5 w-3.5 accent-[var(--brand-blue)]"
                  />
                  <span className="min-w-0 flex-1">{item}</span>
                  {other && <span className="shrink-0 text-[10.5px] text-fg-4">{elsewhereLabel}</span>}
                </label>
              );
            })}
          </div>
          <div className="flex items-center gap-1.5 border-t border-line p-2">
            <input
              className="min-w-0 flex-1 rounded-md border border-line bg-paper px-2 py-1 text-[12.5px] text-fg outline-none focus:border-accent"
              placeholder="Add an item…"
              value={text}
              maxLength={120}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  add();
                }
              }}
            />
            <button type="button" className={btn} onClick={add} disabled={!text.trim()}>
              Add
            </button>
          </div>
          {changed && (
            <button
              type="button"
              onClick={onReset}
              className="border-t border-line px-3 py-1.5 text-left text-[12px] font-semibold text-accent hover:bg-sunk"
            >
              Reset to default
            </button>
          )}
        </div>
      )}
    </div>
  );
}
