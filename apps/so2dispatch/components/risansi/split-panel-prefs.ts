"use client";

import { useSyncExternalStore } from "react";

// The split view's right panel, as the viewer left it: pinned (it stays in
// view as the page scrolls) and / or collapsed (a slim rail). Kept in the
// browser; every split view reads the same.

export type SplitPanelPrefs = { pinned: boolean; collapsed: boolean };

const KEY = "so2d_split_panel";
const DEFAULT: SplitPanelPrefs = { pinned: true, collapsed: false };
const listeners = new Set<() => void>();
let cached: SplitPanelPrefs | null = null;

function read(): SplitPanelPrefs {
  if (cached) return cached;
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "null") as Partial<SplitPanelPrefs> | null;
    cached = { pinned: v?.pinned ?? DEFAULT.pinned, collapsed: v?.collapsed ?? DEFAULT.collapsed };
  } catch {
    cached = DEFAULT;
  }
  return cached;
}

export function setSplitPanelPrefs(patch: Partial<SplitPanelPrefs>) {
  cached = { ...read(), ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(cached));
  } catch {
    // Private mode and the like: kept for this visit only.
  }
  listeners.forEach((fn) => fn());
}

export function useSplitPanelPrefs(): SplitPanelPrefs {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    read,
    () => DEFAULT
  );
}
