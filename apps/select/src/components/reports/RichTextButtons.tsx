"use client";

import { useRef, useState } from "react";
import { Bold, Highlighter } from "lucide-react";

import { BOLD_MARK, HIGHLIGHT_MARK } from "../../lib/rich-text";

// B / Highlight on a document's Edit rows (user, 2026-11-23): marks the selected text of
// the box being edited as **bold** or ==highlighted== (nothing selected: the whole box);
// pressed again on marked text, takes the mark off. The documents print the marks
// (lib/rich-text.ts). The buttons don't take the focus, so the selection stays.

const TEXT_TYPES = new Set(["text", "search", "url", "tel", ""]);

/** Sets a React-controlled box's value as typing would, so its onChange runs. */
function typeInto(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

function toggleMark(el: HTMLInputElement | HTMLTextAreaElement, mark: string) {
  const v = el.value;
  let s = el.selectionStart ?? 0;
  let e = el.selectionEnd ?? v.length;
  if (s === e) {
    s = 0;
    e = v.length;
  }
  // The marks hug the words, not the spaces around them.
  while (s < e && /\s/.test(v[s])) s++;
  while (e > s && /\s/.test(v[e - 1])) e--;
  if (s === e) return;
  const n = mark.length;
  const sel = v.slice(s, e);
  let next: string;
  let from: number;
  let to: number;
  if (sel.length > 2 * n && sel.startsWith(mark) && sel.endsWith(mark)) {
    // The marks are inside the selection: off.
    next = v.slice(0, s) + sel.slice(n, -n) + v.slice(e);
    from = s;
    to = e - 2 * n;
  } else if (v.slice(s - n, s) === mark && v.slice(e, e + n) === mark) {
    // The marks are just around it: off.
    next = v.slice(0, s - n) + sel + v.slice(e + n);
    from = s - n;
    to = e - n;
  } else {
    next = v.slice(0, s) + mark + sel + mark + v.slice(e);
    from = s + n;
    to = e + n;
  }
  if (el.maxLength > 0 && next.length > el.maxLength) return;
  typeInto(el, next);
  el.setSelectionRange(from, to);
}

export default function RichTextButtons() {
  const [hint, setHint] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const apply = (mark: string) => {
    const el = document.activeElement;
    const box = el instanceof HTMLTextAreaElement || (el instanceof HTMLInputElement && TEXT_TYPES.has(el.type)) ? el : null;
    if (!box || box.disabled || box.readOnly) {
      setHint(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setHint(false), 3000);
      return;
    }
    setHint(false);
    toggleMark(box, mark);
  };
  const btn =
    "inline-flex h-7 items-center gap-1 rounded-md border border-border bg-card px-2 text-[12px] font-medium text-foreground shadow-xs transition-colors hover:bg-muted";
  return (
    <span className="inline-flex items-center gap-1.5" role="group" aria-label="Text style">
      <button
        type="button"
        className={btn}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => apply(BOLD_MARK)}
        title="Bold: select words in a box, then click (or type **text**). Click again to undo."
      >
        <Bold className="size-3.5" /> Bold
      </button>
      <button
        type="button"
        className={btn}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => apply(HIGHLIGHT_MARK)}
        title="Highlight: select words in a box, then click (or type ==text==). Click again to undo."
      >
        <Highlighter className="size-3.5 text-[#b59a00]" /> Highlight
      </button>
      {hint && <span className="text-[12px] text-warning">Click into a text box first, and select the words.</span>}
    </span>
  );
}
