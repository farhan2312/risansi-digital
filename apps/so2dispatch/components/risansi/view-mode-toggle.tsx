"use client";

import { useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { Columns2, Table2 } from "lucide-react";
import { VIEW_MODE_COOKIE, viewModeOf, type ViewMode } from "@/lib/view-mode";

// The cookie as a tiny store: every toggle on the screen (sidebar, phone sheet) reads it alike.
const listeners = new Set<() => void>();
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};
const read = (): ViewMode =>
  viewModeOf(document.cookie.match(new RegExp(`(?:^|; )${VIEW_MODE_COOKIE}=([^;]*)`))?.[1]);

/** Table view or Split view, from the profile menu: a cookie, then the page drawn again. */
export function ViewModeToggle({ large = false }: { large?: boolean }) {
  const router = useRouter();
  const mode = useSyncExternalStore(subscribe, read, () => "table" as ViewMode);

  function toggle() {
    const next: ViewMode = mode === "split" ? "table" : "split";
    document.cookie = `${VIEW_MODE_COOKIE}=${next}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
    listeners.forEach((fn) => fn());
    router.refresh();
  }

  const split = mode === "split";
  const Icon = split ? Columns2 : Table2;
  return (
    <button
      type="button"
      onClick={toggle}
      title="Split view: the SO list on the left, one SO upright on the right"
      className={`flex w-full items-center justify-between text-sm text-sidebar-foreground transition-colors hover:bg-sidebar-hover ${
        large ? "rounded-xl px-3 py-3" : "rounded-lg px-3 py-2"
      }`}
    >
      <span className={`flex items-center ${large ? "gap-3" : "gap-2.5"}`}>
        <Icon className={large ? "h-5 w-5" : "h-4 w-4"} />
        {split ? "Split view" : "Table view"}
      </span>
      <span className={`relative h-5 w-10 rounded-full transition-colors ${split ? "bg-primary" : "bg-white/20"}`} aria-hidden>
        <span
          className={`absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white transition-transform ${
            split ? "translate-x-[18px]" : "translate-x-0.5"
          }`}
        />
      </span>
    </button>
  );
}
