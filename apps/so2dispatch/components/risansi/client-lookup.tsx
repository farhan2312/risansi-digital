"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, Search, UserPlus, X } from "lucide-react";
import {
  createOrderFromClientAction,
  searchClientsAction,
} from "@/app/risansi/orders/actions";
import type { MarketIntellClient } from "@/lib/market-intell";

const DEBOUNCE_MS = 300;
const MIN_CHARS = 2;

/**
 * Debounced type-ahead over the Market Intell client directory. Picking a
 * result's "Add" creates a new SO pre-filled with that client's details.
 * The directory is read-only — nothing here writes to Market Intell.
 */
export function ClientLookup({
  onSelect,
  label = "New order from client directory",
}: {
  // When given, picking a client hands it back instead of creating an order —
  // used by the New order form to prefill its Client section.
  onSelect?: (client: MarketIntellClient) => void;
  label?: string;
} = {}) {
  const router = useRouter();
  const [term, setTerm] = useState("");
  const [results, setResults] = useState<MarketIntellClient[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [addingCode, setAddingCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Guards against an older, slower response overwriting a newer one.
  const requestId = useRef(0);

  useEffect(() => {
    const q = term.trim();
    setError(null);

    if (q.length < MIN_CHARS) {
      setResults(null);
      setSearching(false);
      return;
    }

    setSearching(true);
    const id = ++requestId.current;
    const timer = setTimeout(async () => {
      const res = await searchClientsAction(q);
      if (id !== requestId.current) return; // a newer keystroke won
      setSearching(false);
      if (!res.ok) {
        setError(res.error);
        setResults([]);
        return;
      }
      setResults(res.clients);
    }, DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [term]);

  async function add(client: MarketIntellClient) {
    // Prefill mode: hand the client back, don't create anything.
    if (onSelect) {
      onSelect(client);
      setTerm("");
      setResults(null);
      setError(null);
      return;
    }
    setAddingCode(client.code);
    setError(null);
    const res = await createOrderFromClientAction(client.code);
    setAddingCode(null);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    // Clear the search and reveal the new order in the list.
    setTerm("");
    setResults(null);
    router.refresh();
  }

  function clear() {
    setTerm("");
    setResults(null);
    setError(null);
  }

  return (
    // Tinted + labelled so it reads as "create an order" rather than another
    // filter for the table below it.
    <div className="mb-3 rounded-xl border border-primary/25 bg-primary/[0.04] p-3 shadow-sm">
      <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-primary">
        <UserPlus className="h-3.5 w-3.5" />
        {label}
      </div>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-primary/70" />
        <input
          type="search"
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          placeholder={
            onSelect
              ? "Search client code or name to fill these details…"
              : "Search client code or name to create an order…"
          }
          aria-label="Search client directory by code or name to create an order"
          className="h-10 w-full rounded-lg border border-primary/30 bg-surface pl-9 pr-9 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
        />
        {searching ? (
          <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-primary" />
        ) : (
          term !== "" && (
            <button
              type="button"
              onClick={clear}
              aria-label="Clear search"
              className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground transition-colors hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          )
        )}
      </div>

      {error && (
        <p role="alert" className="mt-2 text-xs text-danger">
          {error}
        </p>
      )}

      {term.trim().length > 0 && term.trim().length < MIN_CHARS && (
        <p className="mt-2 text-xs text-muted">
          Type at least {MIN_CHARS} characters to search.
        </p>
      )}

      {results && results.length === 0 && !searching && !error && (
        <p className="mt-2 text-xs text-muted">
          No clients match &ldquo;{term.trim()}&rdquo;.
        </p>
      )}

      {results && results.length > 0 && (
        <div className="mt-2 max-h-80 overflow-y-auto rounded-lg border border-primary/25 bg-surface">
          <table className="w-full min-w-[900px] text-sm">
            <thead className="sticky top-0 bg-primary/[0.06]">
              <tr className="text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                <th className="px-3 py-2">Client Code</th>
                <th className="px-3 py-2">Client Name</th>
                <th className="px-3 py-2">Market Type</th>
                <th className="px-3 py-2">Zone</th>
                <th className="px-3 py-2">Rep</th>
                <th className="px-3 py-2">Client Type</th>
                <th className="px-3 py-2">Industry</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-card-border">
              {results.map((c) => (
                <tr key={c.code} className="text-foreground">
                  <td className="px-3 py-2 whitespace-nowrap font-medium">
                    {c.code}
                  </td>
                  <td className="px-3 py-2">{c.legal_name ?? "—"}</td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {c.market_type ?? "—"}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {c.zone ?? "—"}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {c.rep_name ?? "—"}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {c.client_type ?? "—"}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {c.industry ?? "—"}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap text-right">
                    <button
                      type="button"
                      onClick={() => add(c)}
                      disabled={addingCode !== null}
                      className="inline-flex h-8 items-center gap-1 rounded-lg bg-primary px-3 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {addingCode === c.code ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Plus className="h-3.5 w-3.5" />
                      )}
                      {onSelect ? "Use" : "Add"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
