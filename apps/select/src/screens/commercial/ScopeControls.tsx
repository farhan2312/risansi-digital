"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, Plus, RotateCcw } from "lucide-react";

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
import { buttonVariants } from "@/components/shadcn/button";
import { cn } from "@/lib/utils";

// Scope of supply / Out of scope pickers for the Commercial Offer sheet, shown
// on the Commercial Summary (per drive group). Saved in the group's offer
// config (projects.commercial_offer_config); the Commercial Offer prints them.

const btn = buttonVariants({ variant: "outline", size: "sm" });

/** The two lines as they will print. */
export function ScopeLines({ config, group }: { config: OfferConfig; group: string }) {
  const scope = offerScope(config, group);
  const out = offerOutOfScope(config);
  return (
    <div className="flex flex-col gap-1 text-[12.5px]">
      <p className="font-semibold text-[#c00000] italic">Scope of supply :- {scope || "—"}</p>
      <p className="text-muted-foreground italic">Out Of Scope :- {out || "—"}</p>
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
  const typed = !!config.scopeText || !!config.outOfScopeText;
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
        tone="text-foreground"
        pool={pool}
        selected={outScope}
        elsewhere={inScope}
        elsewhereLabel="in scope"
        changed={config.outOfScope !== null}
        onToggle={(i) => toggle("out", i)}
        onAdd={(i) => addItem("out", i)}
        onReset={() => reset("out")}
      />
      <span className="text-[11.5px] text-muted-foreground">Ticked items print on the sheet; an item is in one list or the other.</span>
      {typed && (
        // A line typed on a document prints instead of the ticked items.
        <span className="flex w-full flex-wrap items-center gap-2 rounded-md border border-warning/25 bg-warning/10 px-2.5 py-1.5 text-[12px] text-foreground">
          <b className="text-warning">
            {config.scopeText && config.outOfScopeText ? "Both lines are" : config.scopeText ? "Scope of supply is" : "Out of scope is"} typed
            on the document
          </b>
          — it prints instead of the ticked items.
          <button
            type="button"
            className="font-semibold text-primary hover:underline"
            onClick={() => onChange({ ...config, scopeText: "", outOfScopeText: "" })}
          >
            Restore picked items
          </button>
        </span>
      )}
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
        className={cn(btn, changed && "border-warning/60 bg-warning/5")}
        title={changed ? "Changed from the default" : undefined}
      >
        <span className={tone}>{label}</span>
        <span className="rounded-full bg-muted px-1.5 font-mono text-[11px] text-muted-foreground tabular-nums">{selected.length}</span>
        <ChevronDown className={cn("transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        // Absolute inside its own box, so inside a dialog it stays in the dialog's content.
        <div className="absolute left-0 z-[1100] mt-1 flex w-[340px] flex-col overflow-hidden rounded-md border border-border bg-popover text-popover-foreground shadow-[0_8px_28px_rgba(15,23,42,0.14)]">
          <div className="max-h-[300px] overflow-y-auto p-1.5">
            {pool.map((item) => {
              const on = selected.includes(item);
              const other = elsewhere.includes(item);
              return (
                <label
                  key={item}
                  className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-[12.5px] text-foreground hover:bg-muted"
                >
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={() => onToggle(item)}
                    className="size-3.5 accent-[var(--sc-primary)]"
                  />
                  <span className="min-w-0 flex-1">{item}</span>
                  {other && <span className="shrink-0 text-[10.5px] text-muted-foreground">{elsewhereLabel}</span>}
                </label>
              );
            })}
          </div>
          <div className="flex items-center gap-1.5 border-t border-border bg-muted/40 p-2">
            <input
              className="h-7 min-w-0 flex-1 rounded-md border border-input bg-card px-2 text-[12.5px] text-foreground shadow-xs outline-none transition-[box-shadow,border-color] placeholder:text-muted-foreground/80 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/25"
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
              <Plus /> Add
            </button>
          </div>
          {changed && (
            <button
              type="button"
              onClick={onReset}
              className="flex items-center gap-1.5 border-t border-border px-3 py-1.5 text-left text-[12px] font-medium text-primary hover:bg-muted [&_svg]:size-3.5"
            >
              <RotateCcw /> Reset to default
            </button>
          )}
        </div>
      )}
    </div>
  );
}
