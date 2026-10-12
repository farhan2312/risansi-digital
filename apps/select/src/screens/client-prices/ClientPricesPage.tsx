"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

import PageHeader from "../../components/ui/PageHeader";
import { browserViewUrl } from "../commercial/ClientPriceRefModal";
import {
  DRIVE_GROUP_LABEL,
  boiTotal,
  formatInr,
  isDriveGroup,
  type QuotationVersionInfo,
} from "../../lib/commercial";
import type { ClientQuoteHistory, ClientQuoteHit } from "../../lib/client-quotes";
import { getClientQuotes, searchClientQuotes } from "../../services/clientQuotesService";

// Client Quoted Prices (sidebar): search a client, see every price quoted to
// them — the portal's quotations with each version's frozen per-tag prices
// (sent to the client, or internal), and the client's SharePoint price
// reference files. Read-only.

const SEARCH_DEBOUNCE_MS = 300;

const inputCls =
  "w-full rounded-lg border border-line bg-paper px-3 py-2 text-[13px] text-fg outline-none placeholder:text-fg-4 focus:border-accent focus:ring-2 focus:ring-accent-soft";

const fmtDate = (iso: string | null) =>
  iso ? new Date(iso.length === 10 ? `${iso}T00:00:00` : iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";

const PriceIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M6 3h12M6 8h12M6 13h3a6 6 0 0 0 0-12M6 13l9 8" />
  </svg>
);

export default function ClientPricesPage() {
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<ClientQuoteHit[] | null>(null);
  const [searchError, setSearchError] = useState(false);
  const [client, setClient] = useState<ClientQuoteHit | null>(null);
  const [history, setHistory] = useState<ClientQuoteHistory | null>(null);
  const [historyError, setHistoryError] = useState(false);
  const [sentOnly, setSentOnly] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setQuery(search.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    if (!query) {
      setHits(null);
      return;
    }
    const controller = new AbortController();
    setSearchError(false);
    searchClientQuotes(query, controller.signal)
      .then(setHits)
      .catch((e) => {
        if (controller.signal.aborted || e?.code === "ERR_CANCELED") return;
        setSearchError(true);
        setHits([]);
      });
    return () => controller.abort();
  }, [query]);

  useEffect(() => {
    if (!client) return;
    let cancelled = false;
    setHistory(null);
    setHistoryError(false);
    getClientQuotes(client)
      .then((h) => !cancelled && setHistory(h))
      .catch(() => !cancelled && setHistoryError(true));
    return () => {
      cancelled = true;
    };
  }, [client]);

  return (
    <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-5 px-4 py-5 sm:px-6">
      <PageHeader
        icon={<PriceIcon />}
        title="Client Quoted Prices"
        subtitle="Search a client to see every price quoted to them — portal quotations and their past price sheets"
      />

      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[320px_1fr]">
        {/* Search */}
        <section className="flex flex-col rounded-xl border border-line bg-paper">
          <div className="border-b border-line p-3">
            <input
              type="search"
              className={inputCls}
              placeholder="Client name or code, e.g. mawana"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search clients"
              autoFocus
            />
          </div>
          <div className="max-h-[65vh] overflow-y-auto">
            {!query && <p className="px-4 py-6 text-center text-[12.5px] text-fg-3">Type to search clients.</p>}
            {query && hits === null && <p className="px-4 py-6 text-center text-[12.5px] text-fg-3">Searching…</p>}
            {searchError && <p className="px-4 py-6 text-center text-[12.5px] text-neg">Couldn&apos;t search right now.</p>}
            {hits && hits.length === 0 && !searchError && (
              <p className="px-4 py-6 text-center text-[12.5px] text-fg-3">No client with quoted prices matches.</p>
            )}
            {hits && hits.length > 0 && (
              <ul className="divide-y divide-line">
                {hits.map((h) => {
                  const active = client?.clientCode === h.clientCode && client?.clientName === h.clientName;
                  return (
                    <li key={`${h.clientCode ?? ""}|${h.clientName}`}>
                      <button
                        type="button"
                        onClick={() => setClient(h)}
                        className={`flex w-full flex-col items-start gap-0.5 px-4 py-2.5 text-left hover:bg-sunk ${active ? "bg-accent-soft" : ""}`}
                      >
                        <span className="text-[13px] font-semibold text-fg">{h.clientName}</span>
                        <span className="text-[11.5px] text-fg-3">
                          {[h.clientCode, h.quotations ? `${h.quotations} quotation${h.quotations === 1 ? "" : "s"}` : null, h.files ? `${h.files} price file${h.files === 1 ? "" : "s"}` : null]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </section>

        {/* History */}
        <section className="flex min-w-0 flex-col gap-4">
          {!client && (
            <div className="rounded-xl border border-line bg-paper p-8 text-center text-[13px] text-fg-3">
              Pick a client to see their quoted prices.
            </div>
          )}
          {client && historyError && (
            <div className="rounded-xl border border-line bg-paper p-6 text-[13px] text-neg">Couldn&apos;t load this client&apos;s prices.</div>
          )}
          {client && !history && !historyError && (
            <div className="rounded-xl border border-line bg-paper p-8 text-center text-[13px] text-fg-3">Loading…</div>
          )}
          {history && <History history={history} sentOnly={sentOnly} onSentOnly={setSentOnly} />}
        </section>
      </div>
    </div>
  );
}

function History({
  history,
  sentOnly,
  onSentOnly,
}: {
  history: ClientQuoteHistory;
  sentOnly: boolean;
  onSentOnly: (v: boolean) => void;
}) {
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-paper px-4 py-3">
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold text-fg">{history.client.name}</h2>
          <p className="text-[12px] text-fg-3">
            {[history.client.code, `${history.quotations.length} quotation${history.quotations.length === 1 ? "" : "s"}`, `${history.files.length} price file${history.files.length === 1 ? "" : "s"}`]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
        <label className="flex cursor-pointer items-center gap-2 text-[12.5px] text-fg-2">
          <input
            type="checkbox"
            checked={sentOnly}
            onChange={(e) => onSentOnly(e.target.checked)}
            className="h-3.5 w-3.5 accent-[var(--brand-blue)]"
          />
          Sent to client only
        </label>
      </div>

      {/* Portal quotations */}
      <div className="flex flex-col gap-3">
        <h3 className="text-[11.5px] font-semibold tracking-[0.09em] text-fg-3 uppercase">Quoted from the portal</h3>
        {history.quotations.length === 0 && (
          <p className="rounded-xl border border-line bg-paper p-4 text-[12.5px] text-fg-3">No portal quotation for this client yet.</p>
        )}
        {history.quotations.map((q) => {
          const versions = [...q.info.versions]
            .filter((v) => !sentOnly || v.track === "client")
            .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
          return (
            <article key={q.info.id} className="rounded-xl border border-line bg-paper">
              <header className="flex flex-wrap items-start justify-between gap-2 border-b border-line px-4 py-3">
                <div className="min-w-0">
                  <p className="font-mono text-[13px] font-semibold break-all text-fg">{q.info.number}</p>
                  {q.info.erpNumber && <p className="font-mono text-[11.5px] break-all text-fg-2">ERP: {q.info.erpNumber}</p>}
                  <p className="text-[12px] text-fg-3">
                    {fmtDate(q.info.quoteDate)} · TSM {q.info.tsmName ?? "—"}
                    {isDriveGroup(q.info.driveGroup) ? ` · ${DRIVE_GROUP_LABEL[q.info.driveGroup]}` : ""}
                  </p>
                </div>
                <Link
                  href={`/commercial?projectId=${q.projectId}`}
                  className="rounded-lg border border-line px-3 py-1.5 text-[12px] font-semibold text-accent hover:border-accent"
                  title={q.enquiryName}
                >
                  {q.projectCode} →
                </Link>
              </header>
              {versions.length === 0 ? (
                <p className="px-4 py-3 text-[12.5px] text-fg-3">Not sent to the client yet.</p>
              ) : (
                <div className="flex flex-col divide-y divide-line">
                  {versions.map((v) => (
                    <VersionRow key={v.id} v={v} />
                  ))}
                </div>
              )}
            </article>
          );
        })}
      </div>

      {/* SharePoint files */}
      <div className="flex flex-col gap-2">
        <h3 className="text-[11.5px] font-semibold tracking-[0.09em] text-fg-3 uppercase">Past price sheets (SharePoint)</h3>
        {history.files.length === 0 ? (
          <p className="rounded-xl border border-line bg-paper p-4 text-[12.5px] text-fg-3">No price reference files for this client.</p>
        ) : (
          <ul className="divide-y divide-line rounded-xl border border-line bg-paper">
            {history.files.map((f) => (
              <li key={f.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                <div className="min-w-0">
                  <p className="truncate font-mono text-[12.5px] text-fg" title={f.fileName}>
                    {f.fileName}
                  </p>
                  <p className="text-[11.5px] text-fg-3">{fmtDate(f.fileDate)}</p>
                </div>
                <a
                  href={browserViewUrl(f.url)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="shrink-0 rounded-lg border border-line px-3 py-1.5 text-[12.5px] font-semibold text-accent hover:border-accent"
                >
                  Open ↗
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}

/** One quotation version: badge, date, total; expands to its per-tag prices. */
function VersionRow({ v }: { v: QuotationVersionInfo }) {
  const [open, setOpen] = useState(false);
  const sent = v.track === "client";
  const tags = useMemo(() => v.snapshot.tags ?? [], [v]);
  return (
    <div className="px-4 py-2.5">
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex w-full flex-wrap items-center gap-2 text-left">
        <span
          className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
            sent ? "bg-[var(--pos-soft)] text-pos" : "bg-sunk text-fg-2"
          }`}
        >
          {sent ? `Client V${v.version} · sent` : `Internal V${v.version}${v.live ? " · live" : ""}`}
        </span>
        <span className="text-[12px] text-fg-3">{fmtDate(v.createdAt)}</span>
        <span className="text-[12px] text-fg-3">
          · {tags.length} tag{tags.length === 1 ? "" : "s"}
        </span>
        <span className="ml-auto font-mono text-[13px] font-semibold text-fg">{formatInr(v.snapshot.grandTotal)}</span>
        <span className="text-fg-3" aria-hidden="true">
          {open ? "▴" : "▾"}
        </span>
      </button>
      {open && (
        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[640px] text-[12.5px]">
            <thead>
              <tr className="border-b border-line text-left text-[11px] font-semibold tracking-[0.05em] text-fg-3 uppercase">
                <th className="py-1.5 pr-2">Tag</th>
                <th className="py-1.5 pr-2">Product code / model</th>
                <th className="py-1.5 pr-2 text-right">Qty</th>
                <th className="py-1.5 pr-2 text-right">P&amp;A</th>
                <th className="py-1.5 pr-2 text-right">BOI</th>
                <th className="py-1.5 pr-2 text-right">Unit price</th>
                <th className="py-1.5 text-right">Sub-total</th>
              </tr>
            </thead>
            <tbody>
              {tags.map((t, i) => (
                <tr key={i} className="border-b border-line last:border-b-0">
                  <td className="py-1.5 pr-2 font-semibold text-fg">{t.tagName}</td>
                  <td className="py-1.5 pr-2 font-mono text-[11.5px] text-fg-2">{t.productCode ?? t.model ?? "—"}</td>
                  <td className="py-1.5 pr-2 text-right font-mono">{t.quantity ?? "—"}</td>
                  <td className="py-1.5 pr-2 text-right font-mono">{formatInr(t.prices.paPrice)}</td>
                  <td className="py-1.5 pr-2 text-right font-mono">{formatInr(boiTotal({ ...t.prices, others: t.prices.others ?? [] }))}</td>
                  <td className="py-1.5 pr-2 text-right font-mono">{formatInr(t.unit)}</td>
                  <td className="py-1.5 text-right font-mono font-semibold">{formatInr(t.sub)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {v.note && <p className="mt-1.5 text-[12px] text-fg-2">Asked for: {v.note}</p>}
        </div>
      )}
    </div>
  );
}
