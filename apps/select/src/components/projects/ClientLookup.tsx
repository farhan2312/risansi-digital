"use client";

import { useEffect, useRef, useState } from "react";
import { useDebouncedValue } from "../../hooks/useDebouncedValue";
import { searchClients, type ClientLookupRow } from "../../services/clientsService";

// Shorter than the typical typing cadence, long enough that a full client name
// costs one request rather than one per keystroke.
const SEARCH_DEBOUNCE_MS = 300;
const MIN_QUERY = 2;

/**
 * "Find client" search against the client master (Market Intell, read-only).
 * Picking a row hands it to `onSelect` so the form can fill Client Name, Client
 * code and Industry; those fields stay editable. Used by Create and Edit
 * Enquiry. Remount (via `key`) to reset it for a different enquiry.
 */
export default function ClientLookup({
  active = true,
  hint = "Searches the client master. Pick a result to prefill the fields below, or just fill them in manually.",
  onSelect,
}: {
  /** False while the surrounding modal is closed - no searching then. */
  active?: boolean;
  hint?: string;
  onSelect: (row: ClientLookupRow) => void;
}) {
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebouncedValue(query, SEARCH_DEBOUNCE_MS);
  const [results, setResults] = useState<ClientLookupRow[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  // Set once a row is picked, so the picked row's summary replaces the result
  // list instead of the list reappearing under the (now filled) fields.
  const [picked, setPicked] = useState<ClientLookupRow | null>(null);
  const reqId = useRef(0);

  // Fire one search per typing pause. `reqId` drops out-of-order responses so
  // a slow earlier request cannot overwrite the newest results.
  useEffect(() => {
    const q = debouncedQuery.trim();
    if (!active || picked || q.length < MIN_QUERY) {
      setResults([]);
      setSearching(false);
      setSearchError("");
      return;
    }
    const id = ++reqId.current;
    setSearching(true);
    setSearchError("");
    searchClients(q)
      .then((rows) => {
        if (id !== reqId.current) return;
        setResults(rows);
        setSearching(false);
      })
      .catch(() => {
        if (id !== reqId.current) return;
        setResults([]);
        setSearching(false);
        setSearchError("Client lookup is unavailable right now.");
      });
  }, [debouncedQuery, active, picked]);

  const handleSelect = (row: ClientLookupRow) => {
    setPicked(row);
    setResults([]);
    setQuery("");
    onSelect(row);
  };

  // Clearing the pick leaves the fields as they are (still editable) and lets
  // the search box work again.
  const handleClearPick = () => {
    setPicked(null);
    setQuery("");
  };

  const showNoMatch =
    !searching && !searchError && !picked && debouncedQuery.trim().length >= MIN_QUERY && results.length === 0;

  return (
    <div className="flex flex-col">
      <span className="mb-1.5 text-[12px] font-semibold text-fg-2">Find client</span>
      {picked ? (
        <div className="flex items-center gap-3 rounded-lg border border-[color-mix(in_srgb,var(--pos)_35%,transparent)] bg-[var(--pos-soft)] px-3 py-2.5">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-pos text-white" aria-hidden>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
              <path d="M5 12.5l4.5 4.5L19 7.5" />
            </svg>
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13.5px] font-semibold text-fg">{picked.legal_name}</div>
            <div className="truncate text-[11.5px] text-fg-3">
              <span className="font-mono">{picked.code}</span>
              {picked.industry ? ` · ${picked.industry}` : ""}
            </div>
          </div>
          <button
            type="button"
            className="rounded-md px-2.5 py-1 text-[12.5px] font-semibold text-accent transition hover:bg-paper"
            onClick={handleClearPick}
          >
            Change
          </button>
        </div>
      ) : (
        <>
          <div className="relative">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-fg-3" aria-hidden>
              <circle cx="11" cy="11" r="6.5" />
              <path d="m20 20-4-4" />
            </svg>
            <input
              value={query}
              placeholder="Search by client code or name…"
              onChange={(e) => setQuery(e.target.value)}
              className="h-10 w-full rounded-lg border border-line-strong bg-paper pr-3 pl-9 text-[14px] text-fg outline-none transition placeholder:text-fg-4 hover:border-fg-3 focus:border-accent focus:ring-4 focus:ring-accent-soft"
            />
          </div>
          <span className="mt-1.5 text-[11.5px] leading-snug text-fg-3">{hint}</span>
        </>
      )}

      {!picked && (searching || searchError || showNoMatch || results.length > 0) && (
        <div className="mt-2 max-h-[240px] overflow-y-auto rounded-lg border border-line bg-paper shadow-[0_8px_24px_rgba(10,22,40,0.08)]">
          {searching && <div className="px-3 py-2.5 text-[12.5px] text-fg-3">Searching…</div>}
          {searchError && <div className="px-3 py-2.5 text-[12.5px] text-neg">{searchError}</div>}
          {showNoMatch && <div className="px-3 py-2.5 text-[12.5px] text-fg-3">No client matches that code or name.</div>}
          {!searching &&
            results.map((row) => (
              <button
                type="button"
                key={row.code}
                onClick={() => handleSelect(row)}
                className="flex w-full items-center gap-3 border-b border-line px-3 py-2.5 text-left transition last:border-b-0 hover:bg-accent-soft"
              >
                <span className="shrink-0 rounded-md bg-elev px-1.5 py-0.5 font-mono text-[11px] text-fg-2">{row.code}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-semibold text-fg">{row.legal_name}</span>
                  <span className="block truncate text-[11.5px] text-fg-3">
                    {[row.industry, row.market_type, row.zone].filter(Boolean).join(" · ") || "—"}
                  </span>
                </span>
                <span className="text-[12px] font-semibold text-accent">Select</span>
              </button>
            ))}
        </div>
      )}
    </div>
  );
}
