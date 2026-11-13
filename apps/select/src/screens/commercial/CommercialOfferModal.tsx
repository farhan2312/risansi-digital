"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { FileSpreadsheet, Printer, X } from "lucide-react";
import { buttonVariants } from "@/components/shadcn/button";

import TechDocEditor, { DocHeaderEditor, DocScopeEditor, DocTagPicker } from "../../components/reports/TechDocEditor";
import { visibleTags } from "../../lib/tech-doc";
import { DRIVE_GROUP_LABEL, type DriveGroup, type QuoteFx } from "../../lib/commercial";
import {
  EMPTY_OFFER_CONFIG,
  OFFER_EXTRAS,
  buildOffer,
  buildOfferHtml,
  isGearedGroup,
  pickedOutOfScope,
  pickedScope,
  type CommercialOfferData,
  type OfferConfig,
  type OfferSheet,
  type OfferTag,
  discountFields,
  discountOf,
} from "../../lib/commercial-offer";
import { downloadOfferExcel } from "../../lib/commercial-offer-excel";
import { printHtml } from "../../lib/enquiry-print";
import PrintPageSizeSelect, { usePrintPageSize } from "../../components/reports/PrintPageSize";
import { getCommercialOffer, saveCommercialOfferConfig } from "../../services/commercialOfferService";

// The Commercial Offer sheet of one drive group (lib/commercial-offer.ts).
//  - From the Commercial Summary: the saved prices, editable — optional rows,
//    rename / edit / remove / add rows, scope lines — saved per enquiry and
//    group (projects.commercial_offer_config). Prices themselves never change.
//  - From a quotation version: that version's prices and the sheet edits frozen
//    with it, read-only.
// The preview is the exact HTML that prints.

// shadcn/ui buttons (user, 2026-11-13). A plain overlay, not a Radix Dialog: it prints
// through printHtml's hidden iframe and opens inside QuotationPanel's SnapshotModal.
const btn = buttonVariants({ variant: "outline" });
const btnPrimary = buttonVariants();

export default function CommercialOfferModal({
  projectId,
  group,
  tags,
  version,
  unsavedPrices,
  fx,
  readOnly = false,
  onClose,
}: {
  projectId: string;
  group: DriveGroup;
  tags: OfferTag[];
  /** Read-only view of a quotation version: its label and frozen edits. */
  version?: { label: string; config: OfferConfig };
  /** The Commercial Summary has unsaved prices (not in the sheet). */
  unsavedPrices?: boolean;
  /** Quote in USD: the sheet's prices converted at this fixed rate. */
  fx?: QuoteFx;
  /** View only - for someone who may not work on this enquiry. */
  readOnly?: boolean;
  onClose: () => void;
}) {
  const editable = !version && !readOnly;
  const [data, setData] = useState<CommercialOfferData | null>(null);
  const [loadError, setLoadError] = useState("");
  const [config, setConfig] = useState<OfferConfig>(version?.config ?? EMPTY_OFFER_CONFIG);
  const [mode, setMode] = useState<"preview" | "edit">("preview");
  const [showPicker, setShowPicker] = useState(false);
  const [saveState, setSaveState] = useState<"" | "saving" | "saved" | "error">("");
  const [printing, setPrinting] = useState(false);
  const [pageSize, setPageSize] = usePrintPageSize();
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    getCommercialOffer(projectId)
      .then((d) => {
        if (cancelled) return;
        setData(d);
        if (!version) setConfig(d.configs[group] ?? EMPTY_OFFER_CONFIG);
      })
      .catch(() => !cancelled && setLoadError("Couldn't load the Commercial Offer."));
    return () => {
      cancelled = true;
    };
  }, [projectId, group, version]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  useEffect(() => () => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
  }, []);

  // Applied at once, saved shortly after (no request per keystroke).
  const update = (next: OfferConfig) => {
    if (!editable) return;
    setConfig(next);
    setSaveState("saving");
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      saveCommercialOfferConfig(projectId, group, next)
        .then(() => setSaveState("saved"))
        .catch(() => setSaveState("error"));
    }, 700);
  };
  const toggleExtra = (key: string) => {
    const on = config.extras.includes(key);
    update({
      ...config,
      extras: on ? config.extras.filter((k) => k !== key) : [...config.extras, key],
      hidden: on ? config.hidden : config.hidden.filter((k) => k !== key),
    });
  };
  const customised =
    config.hidden.length +
      Object.keys(config.labels).length +
      Object.keys(config.values).length +
      config.custom.length >
      0 ||
    config.scope !== null ||
    config.outOfScope !== null ||
    config.scopeExtra.length > 0 ||
    !!config.enquiryText ||
    !!config.quotationText ||
    !!config.erpText ||
    !!config.scopeText ||
    !!config.outOfScopeText ||
    (config.headerHidden?.length ?? 0) > 0 ||
    (config.hiddenTags?.length ?? 0) > 0;
  // The tags this sheet prints (deselected ones left off; totals follow).
  const shownTags = useMemo(() => visibleTags(tags, config), [tags, config]);

  const geared = isGearedGroup(group);
  const sheet: OfferSheet | null = useMemo(() => {
    if (!data) return null;
    return {
      projectCode: data.projectCode,
      header: {
        clientName: data.clientName,
        enquiry: config.enquiryText || data.enquiry,
        // The ERP quotation no. (typed on the sheet's header wins); the
        // portal's own number is not on the sheet.
        quotation: config.erpText || data.erpNumbers?.[group] || "",
        hidden: config.headerHidden ?? [],
      },
      tags: shownTags,
      config,
      geared,
      driveGroup: group,
      group: data.mixed ? group : undefined,
      versionLabel: version?.label,
      fx,
    };
  }, [data, group, shownTags, config, geared, version, fx]);
  const html = useMemo(
    () => (sheet ? buildOfferHtml(sheet, typeof window !== "undefined" ? `${window.location.origin}/logo.png` : "/logo.png") : ""),
    [sheet],
  );

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
    <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-[1px]" role="dialog" aria-modal="true" onClick={onClose}>
      <div
        className="flex max-h-[94vh] w-full max-w-[1100px] flex-col overflow-hidden rounded-lg border border-border bg-card text-card-foreground shadow-[0_24px_64px_rgba(15,23,42,0.25)]"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
          <div className="min-w-0">
            <h3 className="text-[15px] font-semibold text-foreground">
              Commercial Offer
              <span className="ml-2 text-[13px] font-normal text-muted-foreground">
                {DRIVE_GROUP_LABEL[group]}
                {version ? ` · ${version.label}` : ""}
              </span>
            </h3>
            <p className="mt-0.5 text-[12.5px] text-muted-foreground">
              {data ? `${data.projectCode} · ${data.clientName}` : "Loading…"} · {tags.length} tag{tags.length === 1 ? "" : "s"}
              {version
                ? " · as saved in this version (read-only)"
                : readOnly
                  ? " · saved prices · view only (assigned to someone else)"
                  : " · saved prices from the Commercial Summary"}
            </p>
            {unsavedPrices && editable && (
              <p className="mt-0.5 text-[12px] font-medium text-warning">Some prices on the page aren&apos;t saved yet — save them to see them here.</p>
            )}
          </div>
          <button type="button" className={buttonVariants({ variant: "ghost", size: "icon" })} onClick={onClose} aria-label="Close" title="Close">
            <X className="size-4" />
          </button>
        </header>

        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden px-5 py-4">
          {loadError && <p className="rounded-md border border-destructive/25 bg-destructive/8 px-3 py-2 text-[12.5px] font-medium text-destructive">{loadError}</p>}
          {!data && !loadError && <p className="py-8 text-center text-[13px] text-muted-foreground">Loading…</p>}

          {data && (
            <>
              {editable && (
                <div className="flex flex-wrap items-center gap-2">
                  <div className="inline-flex h-8 items-center rounded-md bg-muted p-0.5 ring-1 ring-border ring-inset" role="tablist">
                    {(["preview", "edit"] as const).map((m) => (
                      <button
                        key={m}
                        type="button"
                        role="tab"
                        aria-selected={mode === m}
                        onClick={() => setMode(m)}
                        className={`inline-flex h-7 items-center rounded-[5px] px-3 text-[12.5px] font-medium transition-colors ${
                          mode === m ? "bg-card text-foreground shadow-[0_1px_2px_rgba(15,23,42,0.1)]" : "text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        {m === "preview" ? "Preview" : "Edit rows"}
                      </button>
                    ))}
                  </div>
                  <button type="button" className={btn} onClick={() => setShowPicker((v) => !v)} aria-expanded={showPicker}>
                    {showPicker ? "Hide parameters" : "Add parameters"}
                    {config.extras.length > 0 && (
                      <span className="rounded-full bg-primary/10 px-1.5 text-[11px] font-semibold text-primary">{config.extras.length}</span>
                    )}
                  </button>
                  {customised && (
                    <button
                      type="button"
                      onClick={() => update({ ...EMPTY_OFFER_CONFIG, extras: config.extras, ...discountFields(discountOf(config)) })}
                      className={buttonVariants({ variant: "ghost-destructive", size: "sm" })}
                      title="Undo every removal, rename, edited value, manual row and scope change"
                    >
                      Reset edits
                    </button>
                  )}
                  <span className="text-[12px] text-muted-foreground">
                    {saveState === "saving"
                      ? "Saving…"
                      : saveState === "saved"
                        ? "Saved for this enquiry"
                        : saveState === "error"
                          ? "Couldn't save — the changes still apply for now"
                          : "Edits change this sheet only, never the saved prices."}
                  </span>
                </div>
              )}

              {editable && (
                <DocTagPicker
                  tags={tags}
                  hidden={config.hiddenTags ?? []}
                  onChange={(next) => update({ ...config, hiddenTags: next })}
                />
              )}

              {editable && showPicker && (
                <div className="flex flex-wrap gap-x-5 gap-y-1.5 rounded-md border border-border bg-muted/50 p-3">
                  {OFFER_EXTRAS.map((f) => (
                    <label key={f.key} className="flex cursor-pointer items-center gap-2 text-[12.5px] text-foreground">
                      <input
                        type="checkbox"
                        checked={config.extras.includes(f.key)}
                        onChange={() => toggleExtra(f.key)}
                        className="h-3.5 w-3.5 accent-[var(--sc-primary)]"
                      />
                      {f.label(geared)}
                    </label>
                  ))}
                  <span className="w-full text-[11.5px] text-muted-foreground">
                    VFD, Strainer, PRV and Other items appear on their own when a tag has that price.
                  </span>
                </div>
              )}

              {editable && mode === "edit" ? (
                <div className="flex min-h-0 flex-col gap-4 overflow-y-auto pr-1">
                  <DocHeaderEditor
                    hidden={config.headerHidden ?? []}
                    onHiddenChange={(next) => update({ ...config, headerHidden: next as OfferConfig["headerHidden"] })}
                    fields={[
                      { key: "client", label: "Client Name", value: "", auto: data.clientName },
                      {
                        key: "enquiry",
                        label: "Enquiry No. & Date",
                        value: config.enquiryText ?? "",
                        auto: data.enquiry,
                        onChange: (v) => update({ ...config, enquiryText: v }),
                      },
                      {
                        key: "quotation",
                        label: "Quotation No. & Date",
                        value: config.erpText ?? "",
                        auto: data.erpNumbers?.[group] ?? "",
                        onChange: (v) => update({ ...config, erpText: v }),
                      },
                    ]}
                  />
                  <DocScopeEditor
                    scope={config.scopeText ?? ""}
                    out={config.outOfScopeText ?? ""}
                    autoScope={pickedScope(config, group)}
                    autoOut={pickedOutOfScope(config)}
                    onChange={(l) => update({ ...config, scopeText: l.scope, outOfScopeText: l.out })}
                  />
                  <TechDocEditor
                    tags={shownTags}
                    blocks={buildOffer(shownTags, config, geared, { includeHidden: true, fx })}
                    config={config}
                    onChange={update}
                    valueHint="Saved price"
                  />
                </div>
              ) : (
                <iframe title="Commercial Offer" srcDoc={html} className="min-h-[62vh] w-full flex-1 rounded-md border border-border bg-white" />
              )}
            </>
          )}
        </div>

        <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-border bg-muted/40 px-5 py-3">
          <PrintPageSizeSelect value={pageSize} onChange={setPageSize} />
          <button type="button" className={btnPrimary} onClick={handlePrint} disabled={!sheet || printing || shownTags.length === 0}>
            <Printer />
            {printing ? "Preparing…" : "Print / Save as PDF"}
          </button>
          <button
            type="button"
            className={btn}
            onClick={() => sheet && downloadOfferExcel(sheet)}
            disabled={!sheet || shownTags.length === 0}
          >
            <FileSpreadsheet />
            Download Excel
          </button>
        </footer>
      </div>
    </div>
  );
}
