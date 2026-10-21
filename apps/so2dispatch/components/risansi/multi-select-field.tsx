"use client";

import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { joinMulti, splitMulti } from "@/lib/order-schema";

/**
 * A form dropdown that takes several of its options: the choices show as
 * tags on the closed field; open, each is a tick box. The value is the
 * choices joined ("MTC, IIR"), as the field is stored.
 */
export function MultiSelectField({
  id,
  value,
  options,
  onChange,
  disabled,
  className = "",
}: {
  id?: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (next: string) => void;
  disabled?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const picked = splitMulti(value);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);
  const toggle = (v: string) => {
    const next = picked.includes(v) ? picked.filter((p) => p !== v) : [...picked, v];
    // Kept in the options' own order.
    onChange(joinMulti(options.map((o) => o.value).filter((o) => next.includes(o))));
  };
  return (
    <div ref={ref} className="relative">
      <button
        id={id}
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={`flex min-h-10 w-full items-center gap-1.5 rounded-[10px] border border-input-border bg-surface px-3 py-1.5 text-left text-[14px] text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-ring/20 disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
      >
        <span className="flex flex-1 flex-wrap gap-1">
          {picked.length === 0 ? (
            <span className="text-muted">—</span>
          ) : (
            picked.map((p) => (
              <span key={p} className="rounded-md bg-primary/10 px-1.5 py-0.5 text-xs font-semibold text-primary">
                {options.find((o) => o.value === p)?.label ?? p}
              </span>
            ))
          )}
        </span>
        <ChevronDown className="h-4 w-4 shrink-0 text-muted" />
      </button>
      {open && (
        <div role="listbox" aria-multiselectable="true" className="absolute left-0 right-0 z-30 mt-1 rounded-xl border border-card-border bg-surface p-1 shadow-lg">
          {options.map((o) => {
            const on = picked.includes(o.value);
            return (
              <button
                key={o.value}
                type="button"
                role="option"
                aria-selected={on}
                onClick={() => toggle(o.value)}
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm text-foreground hover:bg-background"
              >
                <span className={`flex h-4 w-4 items-center justify-center rounded border ${on ? "border-primary bg-primary text-primary-foreground" : "border-input-border"}`}>
                  {on && <Check className="h-3 w-3" />}
                </span>
                {o.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
