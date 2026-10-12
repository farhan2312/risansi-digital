"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { addMedia, searchMedia } from "../../services/mediaListService";
import { control, hint, hintError } from "./formStyles";

type Props = {
  value: string;
  onChange: (value: string) => void;
};

/** Wait this long after the last keystroke before searching. */
const DEBOUNCE_MS = 250;
/** Dropdown height cap (px); it opens upward when there's less room below. */
const LIST_MAX_H = 300;

/**
 * Media / Application picker backed by the media_list reference table
 * (industry + media only). Type to search - the server is asked once typing
 * pauses. When nothing matches exactly, "Add …" puts the typed media into the
 * shared list so it shows up for everyone afterwards.
 */
const MediaSelect = ({ value, onChange }: Props) => {
  const [text, setText] = useState(value);
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [active, setActive] = useState(0);
  const [adding, setAdding] = useState(false);
  // True once the user types; until then (just focused) the list shows the
  // whole media list from the top rather than only the saved name.
  const [typed, setTyped] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  // The list floats above the page (the step card clips overflow), placed
  // under the input - or above it near the bottom of the window.
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
  const listId = useId();

  // Follow the saved value (restored tag, cleared form) while not editing.
  useEffect(() => {
    if (!open) setText(value);
  }, [value, open]);

  // Debounced server search for what's typed (empty = the first names A-Z).
  const query = typed ? text.trim() : "";
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    const t = setTimeout(() => {
      setLoading(true);
      setFailed(false);
      searchMedia(query, controller.signal)
        .then((rows) => {
          setResults(rows);
          setActive(0);
        })
        .catch((err) => {
          if (controller.signal.aborted || err?.code === "ERR_CANCELED") return;
          setFailed(true);
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(t);
      controller.abort();
    };
  }, [query, open]);

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

  const exact = results.some((r) => r.toLowerCase() === query.toLowerCase());
  const canAdd = query.length > 0 && !exact && !loading;
  // Options in keyboard order: search results, then the Add row.
  const items: { kind: "pick" | "add"; label: string }[] = [
    ...results.map((r) => ({ kind: "pick" as const, label: r })),
    ...(canAdd ? [{ kind: "add" as const, label: query }] : []),
  ];

  const pick = (media: string) => {
    onChange(media);
    setText(media);
    setTyped(false);
    setOpen(false);
  };

  const add = async (media: string) => {
    setAdding(true);
    try {
      await addMedia(media);
    } catch {
      // Still use it for this enquiry; it just won't be in the shared list.
    } finally {
      setAdding(false);
    }
    pick(media);
  };

  const choose = (i: number) => {
    const item = items[i];
    if (!item) return;
    if (item.kind === "pick") pick(item.label);
    else void add(item.label);
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
        className={control}
        placeholder="Search media / application…"
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
            setActive((a) => Math.min(a + 1, Math.max(items.length - 1, 0)));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === "Enter") {
            if (!open) return;
            e.preventDefault();
            choose(active);
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
          {loading && results.length === 0 && <li className="px-3 py-2 text-[12.5px] text-fg-3">Searching…</li>}
          {!loading && failed && <li className="px-3 py-2 text-[12.5px] text-neg">Couldn&apos;t search the media list.</li>}
          {!loading && !failed && items.length === 0 && (
            <li className="px-3 py-2 text-[12.5px] text-fg-3">Type to search…</li>
          )}
          {items.map((item, i) => (
            <li
              key={`${item.kind}:${item.label}`}
              role="option"
              aria-selected={i === active}
              // mousedown, not click, so the input's outside-click close doesn't win.
              onMouseDown={(e) => {
                e.preventDefault();
                choose(i);
              }}
              onMouseEnter={() => setActive(i)}
              className={`cursor-pointer px-3 py-1.5 text-[13px] ${
                i === active ? "bg-accent-soft text-accent" : "text-fg"
              } ${item.kind === "add" ? "border-t border-line font-semibold" : ""} ${
                item.kind === "pick" && item.label === value ? "font-semibold" : ""
              }`}
            >
              {item.kind === "add" ? (
                <span>
                  {adding ? "Adding…" : "+ Add"} &ldquo;{item.label}&rdquo;
                  <span className="ml-1 font-normal text-fg-3">to the media list</span>
                </span>
              ) : (
                item.label
              )}
            </li>
          ))}
        </ul>,
        document.body,
      )}

      {failed && !open && <span className={hintError}>Couldn&apos;t load the media list — try again.</span>}
      {open && canAdd && results.length === 0 && (
        <span className={hint}>No match — add it and it will be available for future selections.</span>
      )}
    </div>
  );
};

export default MediaSelect;
