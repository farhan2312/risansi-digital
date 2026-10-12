"use client";

import { useEffect, useState } from "react";

/** Returns `value` only after it has stopped changing for `delayMs` — so a
 * keystroke-driven search fires one request per pause instead of one per
 * character. */
export function useDebouncedValue<T>(value: T, delayMs = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(id);
  }, [value, delayMs]);
  return debounced;
}
