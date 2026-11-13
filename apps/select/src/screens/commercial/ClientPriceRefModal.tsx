"use client";

import { useEffect, useState } from "react";

import { ExternalLink, FileSpreadsheet, Search } from "lucide-react";

import { listClientPriceRefs, type ClientPriceRef } from "../../services/clientPriceRefService";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/shadcn/dialog";
import { Input } from "@/components/shadcn/input";
import { buttonVariants } from "@/components/shadcn/button";

// "Client Price Ref" viewer on the Commercial Summary: the client's old pump
// price reference files (Excel on SharePoint). Read-only — each file opens in
// SharePoint in a new tab; nothing is downloaded or changed. With no search it
// lists the enquiry client's files; typing searches every file by file name,
// client name or code (including files not matched to a sales client).

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

  // A Radix Dialog: nothing opens on top of it (each file opens in a new tab). Escape, the X
  // or a click outside close it, as before.
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="lg" className="max-h-[85vh] max-w-[820px]" onInteractOutside={() => {}}>
        <DialogHeader>
          <DialogTitle>Client Price Reference</DialogTitle>
          <DialogDescription className="truncate">
            {clientName || "—"}
            {clientCode ? ` · ${clientCode}` : ""} · past price sheets on SharePoint (view only)
          </DialogDescription>
        </DialogHeader>

        <div className="shrink-0 border-b border-border bg-muted/40 px-5 py-3">
          <Input
            type="search"
            icon={<Search />}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by file name, client name or code, e.g. athani or A037"
            aria-label="Search price reference files"
          />
          <p className="mt-1.5 text-[11.5px] text-muted-foreground">
            {searching
              ? "Showing files of any client whose file name, client name or code matches."
              : clientCode
                ? "Showing this client's files. Search to look through every client's files."
                : "This enquiry has no client code, so there's no linked client — search by name instead."}
          </p>
        </div>

        <DialogBody className="min-h-[160px] p-0">
          {rows === null && <p className="px-5 py-6 text-center text-[13px] text-muted-foreground">Loading…</p>}
          {failed && <p className="px-5 py-6 text-center text-[13px] text-destructive">Couldn&apos;t load the reference files.</p>}
          {rows && !failed && rows.length === 0 && (
            <p className="px-5 py-6 text-center text-[13px] text-muted-foreground">
              {searching ? "No file matches that search." : clientCode ? "No price reference files for this client." : ""}
            </p>
          )}
          {rows && rows.length > 0 && (
            <ul className="divide-y divide-border">
              {rows.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-3 px-5 py-2.5 hover:bg-muted/50">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <FileSpreadsheet className="size-4 shrink-0 text-success" aria-hidden="true" />
                    <div className="min-w-0">
                      <p className="truncate font-mono text-[12.5px] text-foreground" title={r.fileName}>
                        {r.fileName}
                      </p>
                      <p className="text-[11.5px] text-muted-foreground">
                        {fmtDate(r.fileDate)}
                        {searching && (r.clientName ? ` · ${r.clientName}` : " · not linked to a sales client")}
                      </p>
                    </div>
                  </div>
                  <a
                    href={browserViewUrl(r.url)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={buttonVariants({ variant: "outline", size: "sm" })}
                    title="Opens in Excel for the web, in a new tab"
                  >
                    Open <ExternalLink />
                  </a>
                </li>
              ))}
            </ul>
          )}
          {rows && rows.length === 100 && (
            <p className="px-5 py-2 text-center text-[11.5px] text-muted-foreground">Showing the first 100 — narrow the search.</p>
          )}
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
