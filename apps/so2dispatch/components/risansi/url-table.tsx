"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight, Loader2, Search, X } from "lucide-react";

/** One request per typing pause, not one per keystroke. */
const DEBOUNCE_MS = 300;

/**
 * URL-backed table state. The server reads these params to fetch one page, so
 * every control here writes to the query string rather than to local state —
 * that's what makes search, filters and paging act on the whole table instead
 * of on the rows already in the browser.
 */
export function useUrlTable() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();
  // Depend on the serialized query, not the object: useSearchParams returns a
  // fresh instance on every render, which would give setParams a new identity
  // each time and restart any effect that lists it as a dependency.
  const qs = params?.toString() ?? "";

  const setParams = useCallback(
    (changes: Record<string, string | string[] | null>, resetPage = true) => {
      const next = new URLSearchParams(qs);
      for (const [key, value] of Object.entries(changes)) {
        const flat = Array.isArray(value) ? value.join(",") : value;
        if (flat === null || flat === "") next.delete(key);
        else next.set(key, flat);
      }
      // Any change other than paging itself puts the user back on page 1 —
      // otherwise a narrower search can land them past the last page.
      if (resetPage) next.delete("page");
      const nextQs = next.toString();
      startTransition(() => {
        router.replace(nextQs ? `${pathname}?${nextQs}` : pathname, {
          scroll: false,
        });
      });
    },
    [qs, pathname, router]
  );

  return {
    pending,
    get: (key: string) => params?.get(key) ?? "",
    getList: (key: string) =>
      (params?.get(key) ?? "")
        .split(",")
        .map((v) => v.trim())
        .filter(Boolean),
    setParams,
    setPage: (page: number, key = "page") =>
      setParams({ [key]: page <= 1 ? null : String(page) }, false),
  };
}

/**
 * Search box bound to a URL param. Typing is debounced so each keystroke isn't
 * a server round-trip, and the value is kept locally in between so the input
 * never lags behind the user.
 */
export function UrlSearchInput({
  paramKey = "q",
  placeholder = "Search…",
  className = "",
}: {
  paramKey?: string;
  placeholder?: string;
  className?: string;
}) {
  const { get, setParams, pending } = useUrlTable();
  const urlValue = get(paramKey);
  const [value, setValue] = useState(urlValue);
  const dirty = useRef(false);

  // Adopt external changes (back button, "Clear all") only while the user
  // isn't mid-edit.
  useEffect(() => {
    if (!dirty.current) setValue(urlValue);
  }, [urlValue]);

  // Held in a ref so the debounce timer restarts only when the typed value
  // changes — never because a re-render handed us a new setParams.
  const commit = useRef(setParams);
  commit.current = setParams;

  useEffect(() => {
    if (!dirty.current) return;
    const timer = setTimeout(() => {
      dirty.current = false;
      commit.current({ [paramKey]: value.trim() || null });
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [value, paramKey]);

  return (
    <div className={`relative w-full sm:max-w-xs ${className}`}>
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <input
        type="search"
        value={value}
        onChange={(e) => {
          dirty.current = true;
          setValue(e.target.value);
        }}
        placeholder={placeholder}
        className="h-10 w-full rounded-lg border border-input-border bg-surface pl-9 pr-9 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-ring/20"
      />
      {pending && (
        <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />
      )}
    </div>
  );
}

/**
 * Pager bound to the `page` param — or `paramKey`, when one page carries two
 * lists that page independently. Mirrors the look of the in-memory one.
 */
export function UrlPagination({
  page,
  totalPages,
  from,
  to,
  total,
  paramKey = "page",
}: {
  page: number;
  totalPages: number;
  from: number;
  to: number;
  total: number;
  paramKey?: string;
}) {
  const { setPage, pending } = useUrlTable();
  // The URL update is a transition, so this component doesn't re-render
  // until the server responds. Track the clicked page locally so the chip
  // highlights immediately and the wait is visible, not silent.
  const [target, setTarget] = useState<number | null>(null);
  useEffect(() => {
    setTarget(null); // the server caught up
  }, [page]);

  if (total === 0) return null;
  const shown = target ?? page;

  const stepClass =
    "inline-flex h-8 w-8 items-center justify-center rounded-lg border border-input-border text-foreground transition-colors hover:bg-background disabled:cursor-not-allowed disabled:opacity-50";

  // A short window around the current page, so 40 pages don't render 40 chips.
  const windowStart = Math.max(1, Math.min(shown - 2, totalPages - 4));
  const windowEnd = Math.min(totalPages, Math.max(shown + 2, 5));
  const pages: number[] = [];
  for (let p = windowStart; p <= windowEnd; p++) pages.push(p);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-card-border px-4 py-3 text-sm text-muted">
      <span className="inline-flex items-center gap-2">
        {pending ? (
          <>Loading page {shown}…</>
        ) : (
          <>
            Showing {from}–{to} of {total}
          </>
        )}
      </span>
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => {
            setTarget(shown - 1);
            setPage(shown - 1, paramKey);
          }}
          disabled={shown <= 1}
          aria-label="Previous page"
          className={stepClass}
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        {pages.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => {
              setTarget(p);
              setPage(p, paramKey);
            }}
            aria-current={p === shown ? "page" : undefined}
            className={`inline-flex h-8 min-w-8 items-center justify-center rounded-lg px-2 text-sm font-medium transition-colors ${
              p === shown
                ? "bg-primary text-primary-foreground"
                : "border border-input-border text-foreground hover:bg-background"
            }`}
          >
            {p === shown && pending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              p
            )}
          </button>
        ))}
        <button
          type="button"
          onClick={() => {
            setTarget(shown + 1);
            setPage(shown + 1, paramKey);
          }}
          disabled={shown >= totalPages}
          aria-label="Next page"
          className={stepClass}
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

/** A row of chips that set a single-value URL param (status tabs, categories). */
export function UrlTabs({
  paramKey,
  options,
  fallback,
}: {
  paramKey: string;
  options: { value: string; label: string; count?: number }[];
  fallback: string;
}) {
  const { get, setParams, pending } = useUrlTable();
  const urlActive = get(paramKey) || fallback;
  // Same trick as the pager: reflect the click before the data lands.
  const [target, setTarget] = useState<string | null>(null);
  useEffect(() => {
    setTarget(null);
  }, [urlActive]);
  const active = target ?? urlActive;
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => {
        const on = o.value === active;
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => {
              setTarget(o.value);
              setParams({ [paramKey]: o.value === fallback ? null : o.value });
            }}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
              on
                ? "bg-primary text-primary-foreground"
                : "border border-input-border bg-surface text-foreground hover:bg-background"
            }`}
          >
            {o.label}
            {on && pending && (
              <Loader2 className="h-3 w-3 animate-spin" />
            )}
            {o.count !== undefined && (
              <span className={on ? "opacity-80" : "text-muted-foreground"}>
                {o.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/** Clears every table param at once. */
export function UrlClearFilters({ keys }: { keys: string[] }) {
  const { setParams, get, getList } = useUrlTable();
  const anyActive = keys.some((k) => (get(k) || getList(k).length > 0) !== false && get(k) !== "");
  if (!anyActive) return null;
  return (
    <button
      type="button"
      onClick={() =>
        setParams(Object.fromEntries(keys.map((k) => [k, null])))
      }
      className="inline-flex items-center gap-1 rounded-lg border border-input-border px-2.5 py-1 text-xs font-medium text-foreground transition-colors hover:bg-background"
    >
      <X className="h-3.5 w-3.5" />
      Clear all
    </button>
  );
}
