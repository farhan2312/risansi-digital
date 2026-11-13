"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight, ChevronDown, ExternalLink, FileSpreadsheet, Search, UserRound } from "lucide-react";

import PageHeader from "../../components/ui/PageHeader";
import { browserViewUrl } from "../commercial/ClientPriceRefModal";
import { listClientPriceRefs, type ClientPriceRef } from "../../services/clientPriceRefService";
import {
  DRIVE_GROUP_LABEL,
  boiTotal,
  finalBoi,
  finalPa,
  formatInr,
  isDriveGroup,
  type QuotationVersionInfo,
} from "../../lib/commercial";
import { discountOf } from "../../lib/commercial-offer";
import type { ClientQuoteHistory, ClientQuoteHit } from "../../lib/client-quotes";
import { getClientQuotes, searchClientQuotes } from "../../services/clientQuotesService";
// shadcn/ui (user, 2026-11-13: the new look, branch select-shadcn).
import { Badge } from "@/components/shadcn/badge";
import { Button } from "@/components/shadcn/button";
import { Card } from "@/components/shadcn/card";
import { Input } from "@/components/shadcn/input";
import { cn } from "@/lib/utils";

// Client Quoted Prices (sidebar): search a client, see every price quoted to
// them — the portal's quotations with each version's frozen per-tag prices
// (sent to the client, or internal), and the client's SharePoint price
// reference files. Read-only.

const SEARCH_DEBOUNCE_MS = 300;

const fmtDate = (iso: string | null) =>
  iso ? new Date(iso.length === 10 ? `${iso}T00:00:00` : iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";

/** A small uppercase list heading. */
const groupCls = "text-[11px] font-medium tracking-wide text-muted-foreground uppercase";

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
  // SharePoint price files whose file name (or client) matches the search.
  const [fileHits, setFileHits] = useState<ClientPriceRef[] | null>(null);
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
      setFileHits(null);
      return;
    }
    const controller = new AbortController();
    setSearchError(false);
    setFileHits(null);
    searchClientQuotes(query, controller.signal)
      .then(setHits)
      .catch((e) => {
        if (controller.signal.aborted || e?.code === "ERR_CANCELED") return;
        setSearchError(true);
        setHits([]);
      });
    listClientPriceRefs({ q: query }, controller.signal)
      .then(setFileHits)
      .catch((e) => {
        if (controller.signal.aborted || e?.code === "ERR_CANCELED") return;
        setFileHits([]);
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
    <div className="min-h-full bg-background">
      <div className="flex w-full flex-col gap-4 px-4 pt-4 pb-10 sm:px-6 min-[1101px]:px-0">
        <PageHeader
          icon={<PriceIcon />}
          title="Client Quoted Prices"
          subtitle="Search a client to see every price quoted to them — portal quotations and their past price sheets"
        />

        <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[340px_1fr]">
          {/* Search */}
          <Card className="flex flex-col overflow-hidden lg:sticky lg:top-4">
            <div className="border-b border-border p-3">
              <Input
                type="search"
                icon={<Search />}
                placeholder="Client name, code or file name, e.g. mawana"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                aria-label="Search clients and price files"
                autoFocus
              />
            </div>
            <div className="max-h-[65vh] overflow-y-auto">
              {!query && <p className="px-4 py-6 text-center text-[12.5px] text-muted-foreground">Type to search clients.</p>}
              {query && hits === null && <p className="px-4 py-6 text-center text-[12.5px] text-muted-foreground">Searching…</p>}
              {searchError && <p className="px-4 py-6 text-center text-[12.5px] font-medium text-destructive">Couldn&apos;t search right now.</p>}
              {hits && hits.length === 0 && !searchError && fileHits?.length === 0 && (
                <p className="px-4 py-6 text-center text-[12.5px] text-muted-foreground">No client or price file matches.</p>
              )}
              {query && hits && hits.length > 0 && <p className={cn(groupCls, "px-4 pt-3 pb-1")}>Clients</p>}
              {hits && hits.length > 0 && (
                <ul className="divide-y divide-border">
                  {hits.map((h) => {
                    const active = client?.clientCode === h.clientCode && client?.clientName === h.clientName;
                    return (
                      <li key={`${h.clientCode ?? ""}|${h.clientName}`}>
                        <button
                          type="button"
                          onClick={() => setClient(h)}
                          aria-current={active || undefined}
                          className={cn(
                            "flex w-full items-start gap-2.5 border-l-2 px-4 py-2.5 text-left transition-colors hover:bg-muted/60",
                            active ? "border-l-primary bg-primary/[0.06]" : "border-l-transparent",
                          )}
                        >
                          <UserRound className={cn("mt-0.5 size-3.5 shrink-0", active ? "text-primary" : "text-muted-foreground")} />
                          <span className="min-w-0">
                            <span className="block text-[13px] font-medium text-foreground">{h.clientName}</span>
                            <span className="block text-[11.5px] text-muted-foreground">
                              {[h.clientCode, h.quotations ? `${h.quotations} quotation${h.quotations === 1 ? "" : "s"}` : null, h.files ? `${h.files} price file${h.files === 1 ? "" : "s"}` : null]
                                .filter(Boolean)
                                .join(" · ")}
                            </span>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
              {/* Price files by file name (or client) — open in SharePoint, or pick the linked client. */}
              {query && fileHits && fileHits.length > 0 && (
                <>
                  <p className={cn(groupCls, "border-t border-border px-4 pt-3 pb-1")}>Price files ({fileHits.length === 100 ? "first 100" : fileHits.length})</p>
                  <ul className="divide-y divide-border">
                    {fileHits.map((f) => (
                      <li key={f.id} className="flex items-center justify-between gap-2 px-4 py-2">
                        <div className="flex min-w-0 items-start gap-2">
                          <FileSpreadsheet className="mt-0.5 size-3.5 shrink-0 text-success" />
                          <div className="min-w-0">
                            <a
                              href={browserViewUrl(f.url)}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="block truncate font-mono text-[12px] text-primary hover:underline"
                              title={`${f.fileName} — opens in Excel for the web`}
                            >
                              {f.fileName}
                            </a>
                            <span className="text-[11.5px] text-muted-foreground">
                              {fmtDate(f.fileDate)}
                              {f.clientName ? ` · ${f.clientName}` : " · not linked to a client"}
                            </span>
                          </div>
                        </div>
                        {f.clientCode && (
                          <Button
                            variant="link"
                            size="sm"
                            className="h-6 shrink-0 px-0 text-[11.5px]"
                            onClick={() =>
                              setClient({ clientCode: f.clientCode, clientName: f.clientName ?? f.clientCode ?? "—", quotations: 0, files: 0 })
                            }
                            title="Show this client's quoted prices"
                          >
                            Client <ArrowRight />
                          </Button>
                        )}
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          </Card>

          {/* History */}
          <section className="flex min-w-0 flex-col gap-4">
            {!client && (
              <Card className="flex flex-col items-center gap-2 p-10 text-center">
                <span className="flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
                  <Search className="size-4" />
                </span>
                <p className="text-[13px] text-muted-foreground">Pick a client to see their quoted prices.</p>
              </Card>
            )}
            {client && historyError && <Card className="p-6 text-[13px] font-medium text-destructive">Couldn&apos;t load this client&apos;s prices.</Card>}
            {client && !history && !historyError && <Card className="p-8 text-center text-[13px] text-muted-foreground">Loading…</Card>}
            {history && <History history={history} sentOnly={sentOnly} onSentOnly={setSentOnly} />}
          </section>
        </div>
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
      <Card className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold text-foreground">{history.client.name}</h2>
          <p className="text-[12px] text-muted-foreground">
            {[history.client.code, `${history.quotations.length} quotation${history.quotations.length === 1 ? "" : "s"}`, `${history.files.length} price file${history.files.length === 1 ? "" : "s"}`]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
        <label className="flex cursor-pointer items-center gap-2 text-[12.5px] text-foreground select-none">
          <input
            type="checkbox"
            checked={sentOnly}
            onChange={(e) => onSentOnly(e.target.checked)}
            className="size-3.5 rounded border-input accent-[var(--sc-primary)]"
          />
          Saved versions only
        </label>
      </Card>

      {/* Portal quotations */}
      <div className="flex flex-col gap-3">
        <h3 className={groupCls}>Quoted from the portal</h3>
        {history.quotations.length === 0 && <Card className="p-4 text-[12.5px] text-muted-foreground">No portal quotation for this client yet.</Card>}
        {history.quotations.map((q) => {
          const versions = [...q.info.versions]
            .filter((v) => !sentOnly || v.track === "client")
            .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
          return (
            <Card key={q.info.id} className="overflow-hidden">
              <header className="flex flex-wrap items-start justify-between gap-2 border-b border-border bg-muted/40 px-4 py-3">
                <div className="min-w-0">
                  {q.info.erpNumber && <p className="font-mono text-[13px] font-semibold break-all text-foreground">Quotation No.: {q.info.erpNumber}</p>}
                  <p className={cn("font-mono break-all", q.info.erpNumber ? "text-[11.5px] text-muted-foreground" : "text-[13px] font-semibold text-foreground")}>
                    Quotation No. (System): {q.info.number}
                  </p>
                  <p className="text-[12px] text-muted-foreground">
                    {fmtDate(q.info.quoteDate)} · TSM {q.info.tsmName ?? "—"}
                    {isDriveGroup(q.info.driveGroup) ? ` · ${DRIVE_GROUP_LABEL[q.info.driveGroup]}` : ""}
                  </p>
                </div>
                <Button variant="outline" size="sm" asChild>
                  <Link href={`/commercial?projectId=${q.projectId}`} title={q.enquiryName}>
                    <span className="font-mono">{q.projectCode}</span> <ArrowRight />
                  </Link>
                </Button>
              </header>
              {versions.length === 0 ? (
                <p className="px-4 py-3 text-[12.5px] text-muted-foreground">No version saved yet.</p>
              ) : (
                <div className="flex flex-col divide-y divide-border">
                  {versions.map((v) => (
                    <VersionRow key={v.id} v={v} />
                  ))}
                </div>
              )}
            </Card>
          );
        })}
      </div>

      {/* SharePoint files */}
      <div className="flex flex-col gap-2">
        <h3 className={groupCls}>Past price sheets (SharePoint)</h3>
        {history.files.length === 0 ? (
          <Card className="p-4 text-[12.5px] text-muted-foreground">No price reference files for this client.</Card>
        ) : (
          <Card className="overflow-hidden">
            <ul className="divide-y divide-border">
              {history.files.map((f) => (
                <li key={f.id} className="flex items-center justify-between gap-3 px-4 py-2.5 transition-colors hover:bg-muted/50">
                  <div className="flex min-w-0 items-start gap-2">
                    <FileSpreadsheet className="mt-0.5 size-3.5 shrink-0 text-success" />
                    <div className="min-w-0">
                      <p className="truncate font-mono text-[12.5px] text-foreground" title={f.fileName}>
                        {f.fileName}
                      </p>
                      <p className="text-[11.5px] text-muted-foreground">{fmtDate(f.fileDate)}</p>
                    </div>
                  </div>
                  <Button variant="outline" size="sm" asChild className="shrink-0">
                    <a href={browserViewUrl(f.url)} target="_blank" rel="noopener noreferrer">
                      Open <ExternalLink />
                    </a>
                  </Button>
                </li>
              ))}
            </ul>
          </Card>
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
  // The version's discount: P&A / BOI shown after it, like its unit price and sub-total.
  const discount = discountOf(v.snapshot.offer);
  const th = "py-2 pr-2 font-medium";
  return (
    <div className="px-4 py-2.5">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex w-full flex-wrap items-center gap-2 text-left">
        <Badge tone={sent ? "success" : "neutral"} dot={sent}>
          {sent ? `Client V${v.version} · sent` : `Internal V${v.version}${v.live ? " · live" : ""}`}
        </Badge>
        <span className="text-[12px] text-muted-foreground">{fmtDate(v.createdAt)}</span>
        <span className="text-[12px] text-muted-foreground">
          · {tags.length} tag{tags.length === 1 ? "" : "s"}
        </span>
        <span className="ml-auto font-mono text-[13px] font-semibold text-foreground tabular-nums">{formatInr(v.snapshot.grandTotal)}</span>
        <ChevronDown className={cn("size-3.5 text-muted-foreground transition-transform", open && "rotate-180")} aria-hidden="true" />
      </button>
      {open && (
        <div className="mt-2 overflow-x-auto rounded-md border border-border">
          <table className="w-full min-w-[640px] text-[12.5px]">
            <thead>
              <tr className="border-b border-border bg-muted/60 text-left text-[11px] tracking-wide text-muted-foreground uppercase">
                <th className={cn(th, "pl-3")}>Tag</th>
                <th className={th}>Product code / model</th>
                <th className={cn(th, "text-right")}>Qty</th>
                <th className={cn(th, "text-right")}>P&amp;A</th>
                <th className={cn(th, "text-right")}>BOI</th>
                <th className={cn(th, "text-right")}>Unit price</th>
                <th className="py-2 pr-3 text-right font-medium">Sub-total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {tags.map((t, i) => (
                <tr key={i} className="transition-colors hover:bg-muted/40">
                  <td className="py-1.5 pr-2 pl-3 font-medium text-foreground">{t.tagName}</td>
                  <td className="py-1.5 pr-2 font-mono text-[11.5px] text-muted-foreground">{t.productCode ?? t.model ?? "—"}</td>
                  <td className="py-1.5 pr-2 text-right font-mono tabular-nums">{t.quantity ?? "—"}</td>
                  <td className="py-1.5 pr-2 text-right font-mono tabular-nums">
                    {formatInr(finalPa(t.prices, discount))}
                    {discount.paPct > 0 && t.prices.paPrice !== null && (
                      <span className="block text-[11px] text-muted-foreground">
                        {formatInr(t.prices.paPrice)} −{discount.paPct}%
                      </span>
                    )}
                  </td>
                  <td className="py-1.5 pr-2 text-right font-mono tabular-nums">
                    {formatInr(finalBoi(t.prices, discount))}
                    {discount.boiPct > 0 && (
                      <span className="block text-[11px] text-muted-foreground">
                        {formatInr(boiTotal({ ...t.prices, others: t.prices.others ?? [] }))} −{discount.boiPct}%
                      </span>
                    )}
                  </td>
                  <td className="py-1.5 pr-2 text-right font-mono tabular-nums">{formatInr(t.unit)}</td>
                  <td className="py-1.5 pr-3 text-right font-mono font-semibold tabular-nums">{formatInr(t.sub)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {v.note && <p className="border-t border-border px-3 py-1.5 text-[12px] text-muted-foreground">Asked for: {v.note}</p>}
        </div>
      )}
    </div>
  );
}
