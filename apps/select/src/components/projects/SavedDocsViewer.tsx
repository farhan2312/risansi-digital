"use client";

import { useMemo, useState } from "react";
import { FileX, Printer } from "lucide-react";

import { Button } from "@/components/shadcn/button";
import PrintPageSizeSelect, { usePrintPageSize } from "../reports/PrintPageSize";
import { DRIVE_GROUP_LABEL } from "../../lib/commercial";
import { buildOfferHtml } from "../../lib/commercial-offer";
import { printHtml } from "../../lib/enquiry-print";
import type { SavedDocs } from "../../lib/saved-docs";
import { buildSpareQuoteHtml } from "../../lib/spare-quote-doc";
import { buildTechDocHtml, techDocGroupLabel, type TechDocGroup } from "../../lib/tech-doc";
import { TECHNO_COMMERCIAL_TITLE, buildTechnoCommercialHtml } from "../../lib/techno-commercial";

// The saved documents, read-only, on Review and on Pump Docs / Spare Docs: a toggle
// between Technical, Commercial and Techno-Commercial for a pump (per drive group), or
// the quotation for a spare. They can be printed, not edited.

export type SavedDocKind = "technical" | "commercial" | "techno";
const DOCS: { key: SavedDocKind; label: string }[] = [
  { key: "technical", label: "Technical" },
  { key: "commercial", label: "Commercial" },
  { key: "techno", label: TECHNO_COMMERCIAL_TITLE },
];

export default function SavedDocsViewer({ docs, initialDoc = "technical" }: { docs: SavedDocs; /** Opens on this one. */ initialDoc?: SavedDocKind }) {
  const isSpare = docs.orderType === "spare";
  const [activeGroup, setActiveGroup] = useState<TechDocGroup | null>(null);
  const [doc, setDoc] = useState<SavedDocKind>(initialDoc);
  const [printing, setPrinting] = useState(false);
  const [pageSize, setPageSize] = usePrintPageSize();

  const current = docs.groups.find((g) => g.group === activeGroup) ?? docs.groups[0] ?? null;
  const html = useMemo(() => {
    const logo = `${window.location.origin}/logo.png`;
    if (isSpare) return docs.spare ? buildSpareQuoteHtml(docs.spare, logo) : "";
    if (!current) return "";
    if (doc === "technical") return current.tech ? buildTechDocHtml(current.tech, logo) : "";
    if (doc === "commercial") return current.offer ? buildOfferHtml(current.offer, logo) : "";
    return current.tech && current.offer ? buildTechnoCommercialHtml(current.tech, current.offer, logo) : "";
  }, [isSpare, docs.spare, current, doc]);

  const emptyText = isSpare
    ? "The quotation has no saved version yet. Use Save Version on the Quotation page."
    : doc === "technical"
      ? "No saved version yet. Use Save Version on the Technical Data Sheet."
      : doc === "commercial"
        ? "No saved version yet. Use Save Version on the Commercial page."
        : "It needs both the Technical and the Commercial saved version.";

  const handlePrint = async () => {
    setPrinting(true);
    try {
      await printHtml(html, pageSize);
    } finally {
      setPrinting(false);
    }
  };

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        {!isSpare && (
          <div className="inline-flex h-8 flex-wrap items-center rounded-md bg-muted p-0.5 ring-1 ring-border ring-inset" role="tablist" aria-label="Document">
            {DOCS.map((d) => (
              <button
                key={d.key}
                type="button"
                role="tab"
                aria-selected={doc === d.key}
                onClick={() => setDoc(d.key)}
                className={`inline-flex h-7 items-center rounded-[5px] px-3 text-[12.5px] font-medium transition-[color,background-color,box-shadow] outline-none focus-visible:ring-[3px] focus-visible:ring-ring/30 ${
                  doc === d.key ? "bg-card text-foreground shadow-[0_1px_2px_rgba(15,23,42,0.1)]" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {d.label}
              </button>
            ))}
          </div>
        )}
        {docs.groups.length > 1 && (
          <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Drive system">
            {docs.groups.map((g) => (
              <button
                key={g.group}
                type="button"
                role="tab"
                aria-selected={g.group === current?.group}
                onClick={() => setActiveGroup(g.group)}
                className={`inline-flex h-8 items-center rounded-md border px-3 text-[12.5px] font-medium transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/30 ${
                  g.group === current?.group
                    ? "border-primary/30 bg-primary/8 text-primary"
                    : "border-border bg-card text-muted-foreground hover:border-input hover:text-foreground"
                }`}
              >
                {g.group === "NONE" ? techDocGroupLabel(g.group) : DRIVE_GROUP_LABEL[g.group]}
              </button>
            ))}
          </div>
        )}
        <span className="ml-auto flex flex-wrap items-center gap-2">
          <PrintPageSizeSelect value={pageSize} onChange={setPageSize} />
          <Button variant="outline" disabled={!html || printing} onClick={() => void handlePrint()}>
            <Printer /> {printing ? "Preparing…" : "Print / Save as PDF"}
          </Button>
        </span>
      </div>
      {html ? (
        <iframe
          title={isSpare ? "Quotation" : DOCS.find((d) => d.key === doc)?.label}
          srcDoc={html}
          className="min-h-[62vh] w-full flex-1 rounded-md border border-border bg-white"
        />
      ) : (
        <p className="flex flex-col items-center gap-2 rounded-md border border-dashed border-border bg-muted/30 px-4 py-10 text-center text-[13px] text-muted-foreground">
          <FileX className="size-5 text-muted-foreground/70" />
          {emptyText}
        </p>
      )}
    </>
  );
}
