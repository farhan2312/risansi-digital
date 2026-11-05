"use client";

import { useMemo, useState } from "react";

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

const btn =
  "inline-flex items-center gap-1.5 rounded-lg border border-line bg-paper px-3 py-1.5 text-[12.5px] font-semibold text-fg-2 hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-50";

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
          <div className="inline-flex flex-wrap rounded-lg border border-line bg-sunk p-0.5" role="tablist" aria-label="Document">
            {DOCS.map((d) => (
              <button
                key={d.key}
                type="button"
                role="tab"
                aria-selected={doc === d.key}
                onClick={() => setDoc(d.key)}
                className={`rounded-md px-3 py-1 text-[12.5px] font-semibold ${doc === d.key ? "bg-paper text-fg shadow-sm" : "text-fg-3 hover:text-fg"}`}
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
                className={`rounded-lg border px-3 py-1 text-[12.5px] font-semibold ${
                  g.group === current?.group ? "border-accent bg-accent-soft text-accent" : "border-line bg-paper text-fg-2 hover:border-accent"
                }`}
              >
                {g.group === "NONE" ? techDocGroupLabel(g.group) : DRIVE_GROUP_LABEL[g.group]}
              </button>
            ))}
          </div>
        )}
        <span className="ml-auto flex flex-wrap items-center gap-2">
          <PrintPageSizeSelect value={pageSize} onChange={setPageSize} />
          <button type="button" className={btn} disabled={!html || printing} onClick={() => void handlePrint()}>
            {printing ? "Preparing…" : "Print / Save as PDF"}
          </button>
        </span>
      </div>
      {html ? (
        <iframe title={isSpare ? "Quotation" : DOCS.find((d) => d.key === doc)?.label} srcDoc={html} className="min-h-[62vh] w-full flex-1 rounded-lg border border-line bg-white" />
      ) : (
        <p className="rounded-lg border border-dashed border-line px-4 py-10 text-center text-[13px] text-fg-3">{emptyText}</p>
      )}
    </>
  );
}
