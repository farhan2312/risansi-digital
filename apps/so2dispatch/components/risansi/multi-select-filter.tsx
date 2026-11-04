"use client";

import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, X } from "lucide-react";

/**
 * What a filter shows: the choice just made, at once, until the page — which
 * filters on the server — comes back with it. Without this a tick waits for
 * the reload. When the value from the page changes, it takes over again.
 */
export function useShownValue<T>(value: T, key: string): [T, (next: T) => void] {
  const [shown, setShown] = useState({ key, value });
  if (shown.key !== key) {
    // The page caught up (or moved on): follow it.
    setShown({ key, value });
    return [value, (next) => setShown({ key, value: next })];
  }
  return [shown.value, (next) => setShown({ key, value: next })];
}

/** A filter's button: small, so a long row of filters takes little room. */
export const filterChip = (active: boolean) =>
  `inline-flex h-8 items-center gap-1 whitespace-nowrap rounded-lg border px-2.5 text-[13px] transition-colors ${
    active
      ? "border-primary/40 bg-primary/[0.06] text-foreground"
      : "border-input-border bg-surface text-foreground hover:bg-background"
  }`;

/** How many are picked, beside the filter's name. */
export function FilterCount({ n }: { n: number }) {
  return (
    <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground">
      {n}
    </span>
  );
}

/**
 * A dropdown filter that accepts several values at once — the table's built-in
 * facets are single-select, so anything needing "these three zones" uses this.
 * Selecting nothing means no filtering at all.
 */
export function MultiSelectFilter({
  label,
  options,
  selected: selectedProp,
  onChange: onChangeProp,
  allLabel,
  group,
  searchable = false,
}: {
  label: string;
  options: string[];
  /** A search box over the options — for a long list (clients). */
  searchable?: boolean;
  selected: string[];
  onChange: (next: string[]) => void;
  /** What it reads with nothing picked; "All <label>s" by default. */
  allLabel?: string;
  /** A second set of options under its own sub-heading, with its own values. */
  group?: { heading: string; options: string[]; selected: string[]; onChange: (next: string[]) => void };
}) {
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState("");
  const wrapRef = useRef<HTMLDivElement>(null);
  // Ticks show the moment they are clicked, not when the page reloads.
  const [selected, setSelected] = useShownValue(selectedProp, selectedProp.join(""));
  const [groupSelected, setGroupSelected] = useShownValue(group?.selected ?? [], (group?.selected ?? []).join(""));
  const onChange = (next: string[]) => {
    setSelected(next);
    onChangeProp(next);
  };

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function toggle(option: string) {
    onChange(
      selected.includes(option)
        ? selected.filter((v) => v !== option)
        : [...selected, option]
    );
  }
  const changeGroup = (next: string[]) => {
    setGroupSelected(next);
    group?.onChange(next);
  };

  const picked = [...selected, ...groupSelected];
  const t = term.trim().toLowerCase();
  // Picked ones stay on top, so a search never hides what is already ticked.
  const shownOptions = !searchable
    ? options
    : [...selected.filter((o) => options.includes(o)), ...options.filter((o) => !selected.includes(o) && (!t || o.toLowerCase().includes(t))).slice(0, 200)];
  // The name alone until something is picked; hovering says what is.
  const hint = picked.length ? picked.join(", ") : (allLabel ?? `All ${label.toLowerCase()}s`);
  const row = (option: string, checked: boolean, onClick: () => void) => (
    <button
      key={option}
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-foreground transition-colors hover:bg-background"
    >
      <span
        className={`inline-flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
          checked ? "border-primary bg-primary text-primary-foreground" : "border-input-border"
        }`}
      >
        {checked && <Check className="h-3 w-3" />}
      </span>
      {option}
    </button>
  );

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={`${label} filter`}
        title={hint}
        className={filterChip(picked.length > 0)}
      >
        {picked.length === 1 ? (
          <>
            <span className="text-muted">{label}:</span>
            <span className="max-w-[9rem] truncate font-medium">{picked[0]}</span>
          </>
        ) : (
          <span className={picked.length ? "font-medium" : ""}>{label}</span>
        )}
        {picked.length > 1 && <FilterCount n={picked.length} />}
        <ChevronDown className="h-3 w-3 text-muted-foreground" />
      </button>

      {open && (
        <div className={`absolute left-0 z-30 mt-1.5 max-h-80 overflow-y-auto rounded-lg border border-card-border bg-surface py-1 shadow-lg ${searchable ? "w-80" : "w-56"}`}>
          {searchable && (
            <div className="sticky top-0 z-10 border-b border-card-border bg-surface px-2 pb-1.5 pt-1">
              <input
                autoFocus
                value={term}
                onChange={(e) => setTerm(e.target.value)}
                placeholder={`Search ${label.toLowerCase()}…`}
                className="h-8 w-full rounded-md border border-input-border bg-surface px-2.5 text-sm text-foreground focus:border-primary focus:outline-none"
              />
            </div>
          )}
          {options.length === 0 ? (
            <p className="px-3 py-2 text-sm text-muted">No values.</p>
          ) : (
            <>
              {picked.length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    onChange([]);
                    if (group) changeGroup([]);
                  }}
                  className="mb-1 flex w-full items-center gap-1.5 border-b border-card-border px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:text-foreground"
                >
                  <X className="h-3.5 w-3.5" />
                  Clear selection
                </button>
              )}
              {shownOptions.map((option) => row(option, selected.includes(option), () => toggle(option)))}
              {searchable && shownOptions.length === selected.length && t && (
                <p className="px-3 py-2 text-sm text-muted">No match.</p>
              )}
              {group && (
                <>
                  <p className="mt-1 border-t border-card-border px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-muted">
                    {group.heading}
                  </p>
                  {group.options.map((option) =>
                    row(option, groupSelected.includes(option), () =>
                      changeGroup(
                        groupSelected.includes(option)
                          ? groupSelected.filter((v) => v !== option)
                          : [...groupSelected, option]
                      )
                    )
                  )}
                </>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * The single-value sibling of the above, for filters where the values are
 * mutually exclusive (a department, a status). `null` means "not filtering",
 * shown as the `allLabel`. Disabled until the filter it depends on is set —
 * a status has no meaning without a department to apply it to.
 */
export function SingleSelectFilter({
  label,
  allLabel,
  options,
  selected: selectedProp,
  onChange: onChangeProp,
  disabled = false,
  showDefault = false,
  active,
}: {
  /** Whether it reads as narrowing the list, when its value alone does not say (Date, until a range is set). */
  active?: boolean;
  /** Nothing picked still means something (Date: SO date), so say it on the button. */
  showDefault?: boolean;
  label: string;
  allLabel: string;
  options: { value: string; label: string }[];
  selected: string | null;
  onChange: (next: string | null) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  // The choice shows at once, not when the page reloads.
  const [selected, setSelected] = useShownValue(selectedProp, selectedProp ?? " ");
  const onChange = (next: string | null) => {
    setSelected(next);
    onChangeProp(next);
  };
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // A disabled control must not keep a menu open from before it was disabled.
  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  const current = options.find((o) => o.value === selected) ?? null;

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={`${label} filter`}
        title={current?.label ?? allLabel}
        className={`${filterChip(active ?? !!current)} disabled:cursor-not-allowed disabled:opacity-50`}
      >
        {current || showDefault ? (
          <>
            <span className="text-muted">{label}:</span>
            <span className="max-w-[11rem] truncate font-medium">{current?.label ?? allLabel}</span>
          </>
        ) : (
          <span>{label}</span>
        )}
        <ChevronDown className="h-3 w-3 text-muted-foreground" />
      </button>

      {open && !disabled && (
        <div className="absolute left-0 z-30 mt-1.5 max-h-72 w-56 overflow-y-auto rounded-lg border border-card-border bg-surface py-1 shadow-lg">
          <button
            type="button"
            onClick={() => {
              onChange(null);
              setOpen(false);
            }}
            className="flex w-full items-center gap-2 border-b border-card-border px-3 py-1.5 text-left text-sm text-muted transition-colors hover:bg-background hover:text-foreground"
          >
            {allLabel}
          </button>
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => {
                onChange(option.value);
                setOpen(false);
              }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-foreground transition-colors hover:bg-background"
            >
              <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center">
                {option.value === selected && (
                  <Check className="h-3.5 w-3.5 text-primary" />
                )}
              </span>
              {option.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
