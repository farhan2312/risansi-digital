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
    <div className="form-group">
      <label>Find client</label>
      {picked ? (
        <div className="client-picked">
          <div className="client-picked-main">
            <span className="client-picked-code">{picked.code}</span>
            <span className="client-picked-name">{picked.legal_name}</span>
            <span className="client-picked-industry">{picked.industry || "-"}</span>
          </div>
          <button type="button" className="client-change-btn" onClick={handleClearPick}>
            Change
          </button>
        </div>
      ) : (
        <>
          <input value={query} placeholder="Type client code or client name..." onChange={(e) => setQuery(e.target.value)} />
          <p className="modal-hint">{hint}</p>
        </>
      )}

      {!picked && (searching || searchError || showNoMatch || results.length > 0) && (
        <div className="client-results">
          {searching && <div className="client-results-msg">Searching...</div>}
          {searchError && <div className="client-results-msg client-results-error">{searchError}</div>}
          {showNoMatch && <div className="client-results-msg">No client matches that code or name.</div>}
          {!searching &&
            results.map((row) => (
              <div className="client-result" key={row.code}>
                <div className="client-result-main">
                  <span className="client-result-code">{row.code}</span>
                  <span className="client-result-name">{row.legal_name}</span>
                  <span className="client-result-industry">{row.industry || "-"}</span>
                </div>
                <button type="button" className="client-select-btn" onClick={() => handleSelect(row)}>
                  Select
                </button>
              </div>
            ))}
        </div>
      )}
    </div>
  );
}
