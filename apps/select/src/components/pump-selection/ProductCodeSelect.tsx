"use client";

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { addProductPump, listProductPumps, type ProductPump } from "../../services/productPumpService";
import { control, hint, hintError } from "./formStyles";

type Props = {
  value: string;
  /** Called with the picked product code and its pump type. */
  onChange: (productCode: string, pumpType: string) => void;
  invalid?: boolean;
};

/** Dropdown height cap (px); it opens upward when there's less room below. */
const LIST_MAX_H = 300;
/** Options rendered at once — the full list is ~550 codes; typing narrows it. */
const SHOW_MAX = 100;

// Case-, space- and punctuation-insensitive, so "rtoh v6" finds RTOHV6OF….
const squash = (s: string) => s.toUpperCase().replace(/[^A-Z0-9.]/g, "");

/**
 * Pump product code picker backed by product_pump. The list is small, so it
 * is fetched once and filtered as the user types. A code that isn't in the
 * master can be added ("+ Add", stored as PCP) so it is there for everyone.
 */
const ProductCodeSelect = ({ value, onChange, invalid }: Props) => {
  const [all, setAll] = useState<ProductPump[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [text, setText] = useState(value);
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState(false);
  const [active, setActive] = useState(0);
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState("");
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const listId = useId();

  useEffect(() => {
    let cancelled = false;
    listProductPumps()
      .then((rows) => !cancelled && setAll(rows))
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, []);

  // Follow the saved value (restored tag) while not editing.
  useEffect(() => {
    if (!open) setText(value);
  }, [value, open]);

  // The list floats above the page (the step card clips overflow).
  const [pos, setPos] = useState<{ left: number; width: number; top?: number; bottom?: number } | null>(null);
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const r = inputRef.current?.getBoundingClientRect();
      if (!r) return;
      const below = window.innerHeight - r.bottom;
      setPos(
        below < LIST_MAX_H + 16 && r.top > below
          ? { left: r.left, width: r.width, bottom: window.innerHeight - r.top + 4 }
          : { left: r.left, width: r.width, top: r.bottom + 4 },
      );
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);

  // Close on a click outside; unsaved typing goes back to the saved value.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!wrapRef.current?.contains(t) && !listRef.current?.contains(t)) {
        setOpen(false);
        setText(value);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open, value]);

  const matches = useMemo(() => {
    if (!all) return [];
    // Each typed word must appear somewhere in the code, in any order, so
    // "rtohv6 8185" finds RTOHV6OF8185AABN.
    const words = typed ? text.split(/\s+/).map(squash).filter(Boolean) : [];
    if (words.length === 0) return all;
    // Codes that start with the first word first, then the rest.
    const starts: ProductPump[] = [];
    const contains: ProductPump[] = [];
    for (const p of all) {
      const s = squash(p.productCode);
      if (!words.every((w) => s.includes(w))) continue;
      (s.startsWith(words[0]) ? starts : contains).push(p);
    }
    return [...starts, ...contains];
  }, [all, text, typed]);
  const shown = matches.slice(0, SHOW_MAX);

  // "+ Add" when the typed code isn't in the list exactly. Offered only for a
  // whole code typed without spaces: "rtohv6 8185" is a search, not a new code.
  const typedCode = text.trim().toUpperCase();
  const exact = !!all?.some((p) => p.productCode.toUpperCase() === typedCode);
  const canAdd = !!all && typed && typedCode.length >= 3 && !/\s/.test(typedCode) && !exact;
  const addIndex = shown.length; // the Add row sits after the matches

  useEffect(() => {
    setActive(0);
    setAddError("");
  }, [text]);

  const pick = (p: ProductPump) => {
    onChange(p.productCode, p.pumpType);
    setText(p.productCode);
    setTyped(false);
    setOpen(false);
  };

  const add = async () => {
    setAdding(true);
    setAddError("");
    try {
      const row = await addProductPump(typedCode);
      setAll((list) =>
        list && !list.some((p) => p.productCode === row.productCode)
          ? [...list, row].sort((a, b) => a.productCode.localeCompare(b.productCode))
          : list,
      );
      pick(row);
    } catch (e) {
      const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setAddError(msg || "Couldn't add the product code. Try again.");
    } finally {
      setAdding(false);
    }
  };

  return (
    <div ref={wrapRef} className="relative flex flex-col gap-1.5">
      <input
        ref={inputRef}
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-invalid={invalid || undefined}
        className={`${control} font-mono`}
        placeholder={all ? `Search ${all.length} pump product codes…` : "Loading product codes…"}
        value={text}
        onFocus={(e) => {
          setTyped(false);
          setOpen(true);
          e.currentTarget.select();
        }}
        onChange={(e) => {
          setText(e.target.value);
          setTyped(true);
          setOpen(true);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setOpen(true);
            setActive((a) => Math.min(a + 1, Math.max(shown.length + (canAdd ? 1 : 0) - 1, 0)));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === "Enter") {
            if (!open) return;
            if (canAdd && active === addIndex) {
              e.preventDefault();
              if (!adding) void add();
              return;
            }
            if (!shown[active]) return;
            e.preventDefault();
            pick(shown[active]);
          } else if (e.key === "Escape") {
            setOpen(false);
            setText(value);
          }
        }}
      />

      {open && pos && typeof document !== "undefined" && createPortal(
        <ul
          ref={listRef}
          id={listId}
          role="listbox"
          style={{ position: "fixed", left: pos.left, width: pos.width, top: pos.top, bottom: pos.bottom, maxHeight: LIST_MAX_H }}
          className="z-[60] overflow-y-auto rounded-lg border border-line bg-paper py-1 shadow-[0_12px_32px_rgba(10,22,40,0.18)]"
        >
          {!all && !failed && <li className="px-3 py-2 text-[12.5px] text-fg-3">Loading…</li>}
          {failed && <li className="px-3 py-2 text-[12.5px] text-neg">Couldn&apos;t load the product codes.</li>}
          {all && shown.length === 0 && !canAdd && (
            <li className="px-3 py-2 text-[12.5px] text-fg-3">No product code matches &ldquo;{text}&rdquo;.</li>
          )}
          {shown.map((p, i) => (
            <li
              key={p.productCode}
              role="option"
              aria-selected={i === active}
              // mousedown, not click, so the input's outside-click close doesn't win.
              onMouseDown={(e) => {
                e.preventDefault();
                pick(p);
              }}
              onMouseEnter={() => setActive(i)}
              className={`flex cursor-pointer items-center justify-between gap-3 px-3 py-1.5 font-mono text-[13px] ${
                i === active ? "bg-accent-soft text-accent" : "text-fg"
              } ${p.productCode === value ? "font-semibold" : ""}`}
            >
              <span className="truncate">{p.productCode}</span>
              <span className="shrink-0 font-sans text-[11px] text-fg-3">{p.pumpType}</span>
            </li>
          ))}
          {canAdd && (
            <li
              role="option"
              aria-selected={active === addIndex}
              onMouseDown={(e) => {
                e.preventDefault();
                if (!adding) void add();
              }}
              onMouseEnter={() => setActive(addIndex)}
              className={`cursor-pointer border-t border-line px-3 py-1.5 text-[13px] font-semibold ${
                active === addIndex ? "bg-accent-soft text-accent" : "text-fg"
              }`}
            >
              {adding ? "Adding…" : "+ Add"} <span className="font-mono">{typedCode}</span>
              <span className="ml-1 font-normal text-fg-3">to the pump product list (PCP)</span>
            </li>
          )}
          {matches.length > SHOW_MAX && (
            <li className="border-t border-line px-3 py-1.5 text-[12px] text-fg-3">
              {matches.length - SHOW_MAX} more — keep typing to narrow the list.
            </li>
          )}
        </ul>,
        document.body,
      )}

      {addError && <span className={hintError}>{addError}</span>}
      {open && canAdd && shown.length === 0 && (
        <span className={hint}>Not in the list — add it and it will be available for future selections.</span>
      )}
      {failed && !open && <span className={hintError}>Couldn&apos;t load the product codes — reload to try again.</span>}
    </div>
  );
};

export default ProductCodeSelect;
