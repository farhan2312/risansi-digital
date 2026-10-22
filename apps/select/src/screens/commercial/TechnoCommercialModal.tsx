"use client";

import { useEffect, useMemo, useState } from "react";

import PrintPageSizeSelect, { usePrintPageSize } from "../../components/reports/PrintPageSize";
import { DRIVE_GROUP_LABEL, type DriveGroup, type QuoteFx } from "../../lib/commercial";
import { EMPTY_OFFER_CONFIG, isGearedGroup, type CommercialOfferData, type OfferSheet, type OfferTag } from "../../lib/commercial-offer";
import { printHtml } from "../../lib/enquiry-print";
import { techDocSheet, type TechDocData } from "../../lib/tech-doc";
import { TECHNO_COMMERCIAL_TITLE, buildTechnoCommercialHtml, downloadTechnoCommercialExcel } from "../../lib/techno-commercial";
import { getCommercialOffer } from "../../services/commercialOfferService";
import { getEnquiryDocument } from "../../services/enquiryDocumentService";

// The Techno-Commercial Offer of one drive group (lib/techno-commercial.ts):
// the Technical Data Sheet and the Commercial Offer as one sheet. Read-only —
// rows, labels and the header are edited in each document's own pop-up and
// show up here as saved. Prices are the Commercial Summary's saved ones.

const btn =
  "inline-flex items-center gap-1.5 rounded-lg border border-line bg-paper px-3 py-1.5 text-[12.5px] font-semibold text-fg-2 hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-50";
const btnPrimary =
  "inline-flex items-center gap-1.5 rounded-lg bg-accent px-3.5 py-1.5 text-[12.5px] font-semibold text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50";

export default function TechnoCommercialModal({
  projectId,
  group,
  tags,
  fx,
  unsavedPrices,
  onClose,
}: {
  projectId: string;
  group: DriveGroup;
  /** The group's saved prices (as for the Commercial Offer). */
  tags: OfferTag[];
  fx?: QuoteFx;
  unsavedPrices?: boolean;
  onClose: () => void;
}) {
  const [tech, setTech] = useState<TechDocData | null>(null);
  const [offer, setOffer] = useState<CommercialOfferData | null>(null);
  const [loadError, setLoadError] = useState("");
  const [printing, setPrinting] = useState(false);
  const [pageSize, setPageSize] = usePrintPageSize();

  useEffect(() => {
    let cancelled = false;
    Promise.all([getEnquiryDocument(projectId), getCommercialOffer(projectId)])
      .then(([t, o]) => {
        if (cancelled) return;
        setTech(t);
        setOffer(o);
      })
      .catch(() => !cancelled && setLoadError("Couldn't load the Techno-Commercial Offer."));
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const sheets = useMemo(() => {
    if (!tech || !offer) return null;
    const config = offer.configs[group] ?? EMPTY_OFFER_CONFIG;
    const offerSheet: OfferSheet = {
      projectCode: offer.projectCode,
      header: {
        clientName: offer.clientName,
        enquiry: offer.enquiry,
        quotation: config.erpText || offer.erpNumbers?.[group] || "",
        hidden: config.headerHidden ?? [],
      },
      tags,
      config,
      geared: isGearedGroup(group),
      driveGroup: group,
      group: offer.mixed ? group : undefined,
      fx,
    };
    return { tech: techDocSheet(tech, group), offer: offerSheet };
  }, [tech, offer, group, tags, fx]);

  const html = useMemo(
    () =>
      sheets
        ? buildTechnoCommercialHtml(sheets.tech, sheets.offer, typeof window !== "undefined" ? `${window.location.origin}/logo.png` : "/logo.png")
        : "",
    [sheets],
  );
  const empty = !sheets || (sheets.tech.tags.length === 0 && sheets.offer.tags.length === 0);

  const handlePrint = async () => {
    if (!html) return;
    setPrinting(true);
    try {
      await printHtml(html, pageSize);
    } finally {
      setPrinting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" onClick={onClose}>
      <div
        className="flex max-h-[94vh] w-full max-w-[1100px] flex-col overflow-hidden rounded-xl border border-line bg-paper"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-3 border-b border-line px-4 py-3">
          <div className="min-w-0">
            <h3 className="text-[15px] font-semibold text-fg">
              {TECHNO_COMMERCIAL_TITLE}
              {offer?.mixed ? ` — ${DRIVE_GROUP_LABEL[group]}` : ""}
            </h3>
            <p className="text-[12.5px] text-fg-3">
              {offer ? `${offer.projectCode} · ${offer.clientName}` : "Loading…"} · Technical Data Sheet + Commercial Offer as saved
              (edit them in their own pop-ups)
            </p>
            {unsavedPrices && (
              <p className="mt-0.5 text-[12px] text-warn">Some prices on the page aren&apos;t saved yet — save them to see them here.</p>
            )}
          </div>
          <button type="button" className={btn} onClick={onClose}>
            Close
          </button>
        </header>

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden p-4">
          {loadError && <p className="text-[13px] text-neg">{loadError}</p>}
          {!sheets && !loadError && <p className="py-8 text-center text-[13px] text-fg-3">Loading…</p>}
          {sheets && (
            <iframe title={TECHNO_COMMERCIAL_TITLE} srcDoc={html} className="min-h-[66vh] w-full flex-1 rounded-lg border border-line bg-white" />
          )}
        </div>

        <footer className="flex flex-wrap justify-end gap-2 border-t border-line px-4 py-3">
          <PrintPageSizeSelect value={pageSize} onChange={setPageSize} />
          <button type="button" className={btnPrimary} onClick={handlePrint} disabled={empty || printing}>
            {printing ? "Preparing…" : "Print / Save as PDF"}
          </button>
          <button
            type="button"
            className={btn}
            onClick={() => sheets && downloadTechnoCommercialExcel(sheets.tech, sheets.offer)}
            disabled={empty}
          >
            Download Excel
          </button>
        </footer>
      </div>
    </div>
  );
}
