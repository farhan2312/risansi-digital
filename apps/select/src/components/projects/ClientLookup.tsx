"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Search } from "lucide-react";
import { Input } from "@/components/shadcn/input";
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
      <span className="mb-1.5 text-[12px] font-medium text-foreground">Find client</span>
      {picked ? (
        <div className="flex items-center gap-3 rounded-md border border-success/30 bg-success/8 px-3 py-2.5">
          <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-success text-white" aria-hidden>
            <Check className="size-3.5" strokeWidth={2.6} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13px] font-medium text-foreground">{picked.legal_name}</div>
            <div className="truncate text-[11.5px] text-muted-foreground">
              <span className="font-mono">{picked.code}</span>
              {picked.industry ? ` · ${picked.industry}` : ""}
            </div>
          </div>
          <button
            type="button"
            className="rounded-md px-2.5 py-1 text-[12.5px] font-medium text-primary transition-colors hover:bg-card"
            onClick={handleClearPick}
          >
            Change
          </button>
        </div>
      ) : (
        <>
          <Input
            value={query}
            icon={<Search />}
            placeholder="Search by client code or name…"
            onChange={(e) => setQuery(e.target.value)}
            className="h-9 text-[13px]"
          />
          <span className="mt-1.5 text-[11.5px] leading-snug text-muted-foreground">{hint}</span>
        </>
      )}

      {!picked && (searching || searchError || showNoMatch || results.length > 0) && (
        <div className="mt-2 max-h-[240px] overflow-y-auto rounded-md border border-border bg-card shadow-[0_8px_24px_rgba(15,23,42,0.08)]">
          {searching && <div className="px-3 py-2.5 text-[12.5px] text-muted-foreground">Searching…</div>}
          {searchError && <div className="px-3 py-2.5 text-[12.5px] text-destructive">{searchError}</div>}
          {showNoMatch && <div className="px-3 py-2.5 text-[12.5px] text-muted-foreground">No client matches that code or name.</div>}
          {!searching &&
            results.map((row) => (
              <button
                type="button"
                key={row.code}
                onClick={() => handleSelect(row)}
                className="group flex w-full items-center gap-3 border-b border-border px-3 py-2.5 text-left transition-colors last:border-b-0 hover:bg-muted"
              >
                <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground ring-1 ring-border ring-inset">{row.code}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium text-foreground">{row.legal_name}</span>
                  <span className="block truncate text-[11.5px] text-muted-foreground">
                    {[row.industry, row.market_type, row.zone].filter(Boolean).join(" · ") || "—"}
                  </span>
                </span>
                <span className="text-[12px] font-medium text-primary opacity-70 group-hover:opacity-100">Select</span>
              </button>
            ))}
        </div>
      )}
    </div>
  );
}
