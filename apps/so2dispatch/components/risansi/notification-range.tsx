"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { useUrlTable } from "./url-table";

export type NotificationRange = "3d" | "7d" | "all";

const OPTIONS: { value: NotificationRange; label: string }[] = [
  { value: "3d", label: "Last 3 days" },
  { value: "7d", label: "Last 7 days" },
  { value: "all", label: "All time" },
];

/**
 * How far back the feed reaches. Switches at once; the feed follows when it
 * has loaded, back on its first page.
 */
export function NotificationRangeToggle({ value, fallback }: { value: NotificationRange; fallback: NotificationRange }) {
  const { setParams, pending } = useUrlTable();
  const [asked, setAsked] = useState<NotificationRange | null>(null);
  const [seen, setSeen] = useState(value);
  if (seen !== value) {
    setSeen(value);
    setAsked(null);
  }
  const shown = asked ?? value;
  return (
    <div role="group" aria-label="How far back" className="inline-flex h-9 items-center rounded-lg border border-input-border bg-surface p-0.5">
      {OPTIONS.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={shown === o.value}
          onClick={() => {
            if (shown === o.value) return;
            setAsked(o.value);
            setParams({ range: o.value === fallback ? null : o.value, npage: null });
          }}
          className={`inline-flex h-full items-center gap-1.5 rounded-md px-3 text-sm font-semibold transition-colors ${
            shown === o.value ? "bg-primary text-primary-foreground" : "text-muted hover:text-foreground"
          }`}
        >
          {o.label}
          {shown === o.value && pending && asked === o.value && <Loader2 className="h-3 w-3 animate-spin" />}
        </button>
      ))}
    </div>
  );
}
