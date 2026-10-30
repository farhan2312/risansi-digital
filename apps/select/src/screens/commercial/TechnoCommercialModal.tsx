"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import PrintPageSizeSelect, { usePrintPageSize } from "../../components/reports/PrintPageSize";
import TechDocEditor, { DocHeaderEditor, DocScopeEditor, DocTagPicker } from "../../components/reports/TechDocEditor";
import { DRIVE_GROUP_LABEL, type DriveGroup, type QuoteFx } from "../../lib/commercial";
import {
  EMPTY_OFFER_CONFIG,
  OFFER_EXTRAS,
  buildOffer,
  isGearedGroup,
  pickedOutOfScope,
  pickedScope,
  type CommercialOfferData,
  type OfferConfig,
  type OfferSheet,
  type OfferTag,
} from "../../lib/commercial-offer";
import { printHtml } from "../../lib/enquiry-print";
import {
  EMPTY_TECH_DOC_CONFIG,
  TECH_DOC_SECTIONS,
  buildTechDoc,
  techDocExtrasFor,
  techDocSheet,
  techDocGroupOf,
  visibleTags,
  type TechDocConfig,
  type TechDocData,
} from "../../lib/tech-doc";
import {
  IN_TECHNICAL,
  TECHNO_COMMERCIAL_TITLE,
  buildTechnoCommercialHtml,
  downloadTechnoCommercialExcel,
} from "../../lib/techno-commercial";
import { getCommercialOffer, saveCommercialOfferConfig } from "../../services/commercialOfferService";
import { getEnquiryDocument, saveEnquiryDocumentConfig } from "../../services/enquiryDocumentService";

// The Techno-Commercial Offer of one drive group (lib/techno-commercial.ts):
// the Technical Data Sheet and the Commercial Offer as one sheet. Its rows
// are the two documents' own: adding, removing, renaming or editing a row
// here changes the Technical Data Sheet (technical part) or the Commercial
// Offer (commercial part and the header) for this enquiry, and the other way
// round. Prices are the Commercial Summary's saved ones and never change.

const btn =
  "inline-flex items-center gap-1.5 rounded-lg border border-line bg-paper px-3 py-1.5 text-[12.5px] font-semibold text-fg-2 hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-50";
const btnPrimary =
  "inline-flex items-center gap-1.5 rounded-lg bg-accent px-3.5 py-1.5 text-[12.5px] font-semibold text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50";
const partTitle = "text-[11.5px] font-semibold tracking-[0.09em] text-fg-3 uppercase";

const SAVE_DELAY_MS = 700;

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
  const [techConfig, setTechConfig] = useState<TechDocConfig>(EMPTY_TECH_DOC_CONFIG);
  const [offerConfig, setOfferConfig] = useState<OfferConfig>(EMPTY_OFFER_CONFIG);
  const [loadError, setLoadError] = useState("");
  const [mode, setMode] = useState<"preview" | "edit">("preview");
  const [showPicker, setShowPicker] = useState(false);
  const [saveState, setSaveState] = useState<"" | "saving" | "saved" | "error">("");
  const [printing, setPrinting] = useState(false);
  const [pageSize, setPageSize] = usePrintPageSize();
  const timers = useRef<{ tech?: ReturnType<typeof setTimeout>; offer?: ReturnType<typeof setTimeout> }>({});

  useEffect(() => {
    let cancelled = false;
    Promise.all([getEnquiryDocument(projectId), getCommercialOffer(projectId)])
      .then(([t, o]) => {
        if (cancelled) return;
        setTech(t);
        setOffer(o);
        setTechConfig(t.configs[group] ?? EMPTY_TECH_DOC_CONFIG);
        setOfferConfig(o.configs[group] ?? EMPTY_OFFER_CONFIG);
      })
      .catch(() => !cancelled && setLoadError("Couldn't load the Techno-Commercial Offer."));
    return () => {
      cancelled = true;
    };
  }, [projectId, group]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  useEffect(
    () => () => {
      clearTimeout(timers.current.tech);
      clearTimeout(timers.current.offer);
    },
    [],
  );

  // Applied at once, saved to the document it belongs to shortly after.
  const save = (which: "tech" | "offer", run: () => Promise<unknown>) => {
    setSaveState("saving");
    clearTimeout(timers.current[which]);
    timers.current[which] = setTimeout(() => {
      run()
        .then(() => setSaveState("saved"))
        .catch(() => setSaveState("error"));
    }, SAVE_DELAY_MS);
  };
  const updateTech = (next: TechDocConfig) => {
    setTechConfig(next);
    save("tech", () => saveEnquiryDocumentConfig(projectId, group, next));
  };
  const updateOffer = (next: OfferConfig) => {
    setOfferConfig(next);
    save("offer", () => saveCommercialOfferConfig(projectId, group, next));
  };
  const toggle = <C extends { extras: string[]; hidden: string[] }>(config: C, key: string, update: (c: C) => void) => {
    const on = config.extras.includes(key);
    update({
      ...config,
      extras: on ? config.extras.filter((k) => k !== key) : [...config.extras, key],
      hidden: on ? config.hidden : config.hidden.filter((k) => k !== key),
    });
  };

  const geared = isGearedGroup(group);
  const sheets = useMemo(() => {
    if (!tech || !offer) return null;
    const offerSheet: OfferSheet = {
      projectCode: offer.projectCode,
      header: {
        clientName: offer.clientName,
        enquiry: offer.enquiry,
        quotation: offerConfig.erpText || offer.erpNumbers?.[group] || "",
        hidden: offerConfig.headerHidden ?? [],
      },
      tags: visibleTags(tags, offerConfig),
      config: offerConfig,
      geared,
      driveGroup: group,
      group: offer.mixed ? group : undefined,
      fx,
    };
    return { tech: techDocSheet({ ...tech, configs: { ...tech.configs, [group]: techConfig } }, group), offer: offerSheet };
  }, [tech, offer, techConfig, offerConfig, group, tags, fx, geared]);

  const html = useMemo(
    () =>
      sheets
        ? buildTechnoCommercialHtml(sheets.tech, sheets.offer, typeof window !== "undefined" ? `${window.location.origin}/logo.png` : "/logo.png")
        : "",
    [sheets],
  );
  // Every tag of the group (technical, then any only the offer has), to
  // choose which ones the sheet prints. A tag left off goes from both parts.
  const allTags = useMemo(() => {
    const list = (tech?.tags ?? []).filter((t) => techDocGroupOf(t) === group).map((t) => ({ tagId: t.tagId, tagName: t.tagName }));
    for (const t of tags) if (!list.some((x) => x.tagId === t.tagId)) list.push({ tagId: t.tagId, tagName: t.tagName });
    return list;
  }, [tech, tags, group]);
  const hiddenTags = [...new Set([...(techConfig.hiddenTags ?? []), ...(offerConfig.hiddenTags ?? [])])];
  const setHiddenTags = (next: string[]) => {
    updateTech({ ...techConfig, hiddenTags: next });
    updateOffer({ ...offerConfig, hiddenTags: next });
  };
  const empty = !sheets || (sheets.tech.tags.length === 0 && sheets.offer.tags.length === 0);

  const customised =
    techConfig.hidden.length +
      Object.keys(techConfig.labels).length +
      Object.keys(techConfig.values).length +
      techConfig.custom.length +
      offerConfig.hidden.length +
      Object.keys(offerConfig.labels).length +
      Object.keys(offerConfig.values).length +
      offerConfig.custom.length >
      0 ||
    !!offerConfig.erpText ||
    !!offerConfig.scopeText ||
    !!offerConfig.outOfScopeText ||
    hiddenTags.length > 0 ||
    (offerConfig.headerHidden?.length ?? 0) > 0;
  const resetAll = () => {
    updateTech({ ...EMPTY_TECH_DOC_CONFIG, extras: techConfig.extras });
    // The picked scope items are kept; typed scope lines go.
    updateOffer({
      ...offerConfig,
      hidden: [],
      labels: {},
      values: {},
      custom: [],
      erpText: undefined,
      headerHidden: [],
      scopeText: "",
      outOfScopeText: "",
      hiddenTags: [],
    });
  };

  const handlePrint = async () => {
    if (!html) return;
    setPrinting(true);
    try {
      await printHtml(html, pageSize);
    } finally {
      setPrinting(false);
    }
  };

  const techExtras = sheets ? techDocExtrasFor(sheets.tech.tags) : [];
  const offerExtras = OFFER_EXTRAS.filter((f) => !IN_TECHNICAL.has(f.key));

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
              {offer ? `${offer.projectCode} · ${offer.clientName}` : "Loading…"} · Technical Data Sheet + Commercial Offer
            </p>
            {unsavedPrices && (
              <p className="mt-0.5 text-[12px] text-warn">Some prices on the page aren&apos;t saved yet — save them to see them here.</p>
            )}
          </div>
          <button type="button" className={btn} onClick={onClose}>
            Close
          </button>
        </header>

        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden p-4">
          {loadError && <p className="text-[13px] text-neg">{loadError}</p>}
          {!sheets && !loadError && <p className="py-8 text-center text-[13px] text-fg-3">Loading…</p>}

          {sheets && tech && offer && (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <div className="inline-flex rounded-lg border border-line bg-sunk p-0.5" role="tablist">
                  {(["preview", "edit"] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      role="tab"
                      aria-selected={mode === m}
                      onClick={() => setMode(m)}
                      className={`rounded-md px-3 py-1 text-[12.5px] font-semibold ${
                        mode === m ? "bg-paper text-fg shadow-sm" : "text-fg-3 hover:text-fg"
                      }`}
                    >
                      {m === "preview" ? "Preview" : "Edit rows"}
                    </button>
                  ))}
                </div>
                <button type="button" className={btn} onClick={() => setShowPicker((v) => !v)} aria-expanded={showPicker}>
                  {showPicker ? "Hide parameters" : "Add parameters"}
                  {techConfig.extras.length + offerConfig.extras.length > 0 && (
                    <span className="rounded-full bg-accent-soft px-1.5 text-[11px] text-accent">
                      {techConfig.extras.length + offerConfig.extras.length}
                    </span>
                  )}
                </button>
                {customised && (
                  <button
                    type="button"
                    onClick={resetAll}
                    className="rounded-lg px-2 py-1.5 text-[12px] font-semibold text-neg hover:bg-[var(--neg-soft)]"
                    title="Undo every removal, rename, edited value, manual row and header change on both parts"
                  >
                    Reset edits
                  </button>
                )}
                <span className="text-[12px] text-fg-3">
                  {saveState === "saving"
                    ? "Saving…"
                    : saveState === "saved"
                      ? "Saved for this enquiry"
                      : saveState === "error"
                        ? "Couldn't save — the changes still apply for now"
                        : "Edits here also change the Technical Data Sheet / Commercial Offer of this enquiry. Prices never change."}
                </span>
              </div>

              <DocTagPicker tags={allTags} hidden={hiddenTags} onChange={setHiddenTags} />

              {showPicker && (
                <div className="grid max-h-[40vh] grid-cols-1 gap-4 overflow-y-auto rounded-lg border border-line bg-sunk p-3 sm:grid-cols-2 lg:grid-cols-3">
                  {TECH_DOC_SECTIONS.map((section) => {
                    const fields = techExtras.filter((f) => f.section === section);
                    if (fields.length === 0) return null;
                    return (
                      <fieldset key={section} className="min-w-0">
                        <legend className="mb-1.5 text-[11px] font-semibold tracking-[0.08em] text-fg-3 uppercase">{section}</legend>
                        <div className="flex flex-col gap-1">
                          {fields.map((f) => (
                            <label key={f.key} className="flex cursor-pointer items-center gap-2 text-[12.5px] text-fg">
                              <input
                                type="checkbox"
                                checked={techConfig.extras.includes(f.key)}
                                onChange={() => toggle(techConfig, f.key, updateTech)}
                                className="h-3.5 w-3.5 accent-[var(--brand-blue)]"
                              />
                              {f.label}
                            </label>
                          ))}
                        </div>
                      </fieldset>
                    );
                  })}
                  {offerExtras.length > 0 && (
                    <fieldset className="min-w-0">
                      <legend className="mb-1.5 text-[11px] font-semibold tracking-[0.08em] text-fg-3 uppercase">Commercial Offer</legend>
                      <div className="flex flex-col gap-1">
                        {offerExtras.map((f) => (
                          <label key={f.key} className="flex cursor-pointer items-center gap-2 text-[12.5px] text-fg">
                            <input
                              type="checkbox"
                              checked={offerConfig.extras.includes(f.key)}
                              onChange={() => toggle(offerConfig, f.key, updateOffer)}
                              className="h-3.5 w-3.5 accent-[var(--brand-blue)]"
                            />
                            {f.label(geared)}
                          </label>
                        ))}
                        <span className="text-[11.5px] text-fg-3">VFD, Strainer, PRV and Other items appear on their own when a tag has that price.</span>
                      </div>
                    </fieldset>
                  )}
                </div>
              )}

              {mode === "edit" ? (
                <div className="flex min-h-0 flex-col gap-4 overflow-y-auto pr-1">
                  <DocHeaderEditor
                    hidden={offerConfig.headerHidden ?? []}
                    onHiddenChange={(next) => updateOffer({ ...offerConfig, headerHidden: next as OfferConfig["headerHidden"] })}
                    fields={[
                      { key: "client", label: "Client Name", value: "", auto: offer.clientName },
                      { key: "enquiry", label: "Enquiry No. & Date", value: "", auto: offer.enquiry },
                      {
                        key: "quotation",
                        label: "Quotation No. & Date",
                        value: offerConfig.erpText ?? "",
                        auto: offer.erpNumbers?.[group] ?? "",
                        onChange: (v) => updateOffer({ ...offerConfig, erpText: v }),
                      },
                    ]}
                  />
                  <DocScopeEditor
                    scope={offerConfig.scopeText ?? ""}
                    out={offerConfig.outOfScopeText ?? ""}
                    autoScope={pickedScope(offerConfig, group)}
                    autoOut={pickedOutOfScope(offerConfig)}
                    onChange={(l) => updateOffer({ ...offerConfig, scopeText: l.scope, outOfScopeText: l.out })}
                  />
                  <p className={partTitle}>Technical part (Technical Data Sheet)</p>
                  <TechDocEditor
                    tags={sheets.tech.tags}
                    blocks={buildTechDoc(sheets.tech.tags, techConfig, { includeHidden: true })}
                    config={techConfig}
                    onChange={updateTech}
                  />
                  <p className={partTitle}>Commercial part (Commercial Offer)</p>
                  <TechDocEditor
                    tags={sheets.offer.tags}
                    blocks={buildOffer(sheets.offer.tags, offerConfig, geared, { includeHidden: true, fx }).map((b) => ({
                      ...b,
                      rows: b.rows.filter((r) => !IN_TECHNICAL.has(r.key)),
                    }))}
                    config={offerConfig}
                    onChange={updateOffer}
                    valueHint="Saved price"
                  />
                </div>
              ) : (
                <iframe title={TECHNO_COMMERCIAL_TITLE} srcDoc={html} className="min-h-[62vh] w-full flex-1 rounded-lg border border-line bg-white" />
              )}
            </>
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
