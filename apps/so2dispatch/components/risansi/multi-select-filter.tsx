"use client";

import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, X } from "lucide-react";

/**
 * A dropdown filter that accepts several values at once — the table's built-in
 * facets are single-select, so anything needing "these three zones" uses this.
 * Selecting nothing means no filtering at all.
 */
export function MultiSelectFilter({
  label,
  options,
  selected,
  onChange,
  allLabel,
  group,
}: {
  label: string;
  options: string[];
  selected: string[];
  onChange: (next: string[]) => void;
  /** What it reads with nothing picked; "All <label>s" by default. */
  allLabel?: string;
  /** A second set of options under its own sub-heading, with its own values. */
  group?: { heading: string; options: string[]; selected: string[]; onChange: (next: string[]) => void };
}) {
  const [open, setOpen] = useState(false);
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

  function toggle(option: string) {
    onChange(
      selected.includes(option)
        ? selected.filter((v) => v !== option)
        : [...selected, option]
    );
  }

  const picked = [...selected, ...(group?.selected ?? [])];
  const summary =
    picked.length === 0
      ? (allLabel ?? `All ${label.toLowerCase()}s`)
      : picked.length === 1
        ? picked[0]
        : selected.length && group?.selected.length
          ? `${selected.join(", ")} + ${group.selected.join(", ")}`
          : `${picked.length} selected`;
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
        className={`inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-sm transition-colors ${
          picked.length > 0
            ? "border-primary/40 bg-primary/[0.06] text-foreground"
            : "border-input-border bg-surface text-foreground hover:bg-background"
        }`}
      >
        <span className="text-muted">{label}:</span>
        <span className="max-w-[16rem] truncate font-medium">{summary}</span>
        <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
      </button>

      {open && (
        <div className="absolute left-0 z-30 mt-1.5 max-h-72 w-56 overflow-y-auto rounded-lg border border-card-border bg-surface py-1 shadow-lg">
          {options.length === 0 ? (
            <p className="px-3 py-2 text-sm text-muted">No values.</p>
          ) : (
            <>
              {picked.length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    onChange([]);
                    group?.onChange([]);
                  }}
                  className="mb-1 flex w-full items-center gap-1.5 border-b border-card-border px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:text-foreground"
                >
                  <X className="h-3.5 w-3.5" />
                  Clear selection
                </button>
              )}
              {options.map((option) => row(option, selected.includes(option), () => toggle(option)))}
              {group && (
                <>
                  <p className="mt-1 border-t border-card-border px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-muted">
                    {group.heading}
                  </p>
                  {group.options.map((option) =>
                    row(option, group.selected.includes(option), () =>
                      group.onChange(
                        group.selected.includes(option)
                          ? group.selected.filter((v) => v !== option)
                          : [...group.selected, option]
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
  selected,
  onChange,
  disabled = false,
}: {
  label: string;
  allLabel: string;
  options: { value: string; label: string }[];
  selected: string | null;
  onChange: (next: string | null) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
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
        className={`inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
          current
            ? "border-primary/40 bg-primary/[0.06] text-foreground"
            : "border-input-border bg-surface text-foreground hover:bg-background"
        }`}
      >
        <span className="text-muted">{label}:</span>
        <span className="font-medium">{current?.label ?? allLabel}</span>
        <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
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
