"use client";

import { useEffect, useState } from "react";

import { listClientPriceRefs, type ClientPriceRef } from "../../services/clientPriceRefService";

// "Client Price Ref" viewer on the Commercial Summary: the client's old pump
// price reference files (Excel on SharePoint). Read-only — each file opens in
// SharePoint in a new tab; nothing is downloaded or changed. With no search it
// lists the enquiry client's files; typing searches every file by name
// (including files not matched to a sales client).

const SEARCH_DEBOUNCE_MS = 300;

/** A plain SharePoint file link downloads the .xlsx. SharePoint's own "open in
 *  the browser" form — "/:x:/r/<path>?web=1" (x = Excel) — opens it in Excel
 *  for the web in the tab instead. The stored link is kept as-is. */
export const browserViewUrl = (url: string): string => {
  try {
    const u = new URL(url);
    if (u.hostname.endsWith(".sharepoint.com") && /\.xls[xmb]?$/i.test(u.pathname) && !u.pathname.startsWith("/:")) {
      u.pathname = `/:x:/r${u.pathname}`;
    }
    u.searchParams.set("web", "1");
    return u.toString();
  } catch {
    return url;
  }
};

const fmtDate = (iso: string | null) =>
  iso ? new Date(iso + "T00:00:00").toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";

export default function ClientPriceRefModal({
  clientCode,
  clientName,
  onClose,
}: {
  clientCode: string | null;
  clientName: string | null;
  onClose: () => void;
}) {
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<ClientPriceRef[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setQuery(search.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // The client's own files, or — while searching — any file by name.
  const searching = query.length > 0;
  useEffect(() => {
    if (!searching && !clientCode) {
      setRows([]);
      return;
    }
    const controller = new AbortController();
    setRows(null);
    setFailed(false);
    listClientPriceRefs(searching ? { q: query } : { clientCode: clientCode ?? "" }, controller.signal)
      .then(setRows)
      .catch((e) => {
        if (controller.signal.aborted || e?.code === "ERR_CANCELED") return;
        setFailed(true);
        setRows([]);
      });
    return () => controller.abort();
  }, [query, searching, clientCode]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" onClick={onClose}>
      <div
        className="flex max-h-[85vh] w-full max-w-[820px] flex-col overflow-hidden rounded-xl border border-line bg-paper"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-3 border-b border-line px-4 py-3">
          <div className="min-w-0">
            <h3 className="text-[15px] font-semibold text-fg">Client Price Reference</h3>
            <p className="truncate text-[12.5px] text-fg-3">
              {clientName || "—"}
              {clientCode ? ` · ${clientCode}` : ""} · past price sheets on SharePoint (view only)
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-line px-3 py-1.5 text-[12.5px] font-semibold text-fg-2 hover:border-accent hover:text-accent"
          >
            Close
          </button>
        </header>

        <div className="border-b border-line px-4 py-2.5">
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search all files by name, e.g. athani or A037"
            className="w-full rounded-lg border border-line bg-paper px-3 py-2 text-[13px] text-fg outline-none focus:border-accent focus:ring-2 focus:ring-accent-soft"
            aria-label="Search price reference files"
          />
          <p className="mt-1 text-[11.5px] text-fg-3">
            {searching
              ? "Showing files from any client whose name matches."
              : clientCode
                ? "Showing this client's files. Search to look through every client's files."
                : "This enquiry has no client code, so there's no linked client — search by name instead."}
          </p>
        </div>

        <div className="min-h-[160px] overflow-y-auto">
          {rows === null && <p className="px-4 py-6 text-center text-[13px] text-fg-3">Loading…</p>}
          {failed && <p className="px-4 py-6 text-center text-[13px] text-neg">Couldn&apos;t load the reference files.</p>}
          {rows && !failed && rows.length === 0 && (
            <p className="px-4 py-6 text-center text-[13px] text-fg-3">
              {searching ? "No file name matches that search." : clientCode ? "No price reference files for this client." : ""}
            </p>
          )}
          {rows && rows.length > 0 && (
            <ul className="divide-y divide-line">
              {rows.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate font-mono text-[12.5px] text-fg" title={r.fileName}>
                      {r.fileName}
                    </p>
                    <p className="text-[11.5px] text-fg-3">
                      {fmtDate(r.fileDate)}
                      {searching && (r.clientName ? ` · ${r.clientName}` : " · not linked to a sales client")}
                    </p>
                  </div>
                  <a
                    href={browserViewUrl(r.url)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="shrink-0 rounded-lg border border-line px-3 py-1.5 text-[12.5px] font-semibold text-accent hover:border-accent"
                    title="Opens in Excel for the web, in a new tab"
                  >
                    Open ↗
                  </a>
                </li>
              ))}
            </ul>
          )}
          {rows && rows.length === 100 && (
            <p className="px-4 py-2 text-center text-[11.5px] text-fg-3">Showing the first 100 — narrow the search.</p>
          )}
        </div>
      </div>
    </div>
  );
}
