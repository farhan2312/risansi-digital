"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import TechDocEditor, { DocHeaderEditor } from "../../components/reports/TechDocEditor";
import { DRIVE_GROUP_LABEL, type DriveGroup } from "../../lib/commercial";
import {
  EMPTY_OFFER_CONFIG,
  OFFER_EXTRAS,
  buildOffer,
  buildOfferHtml,
  isGearedGroup,
  type CommercialOfferData,
  type OfferConfig,
  type OfferSheet,
  type OfferTag,
} from "../../lib/commercial-offer";
import { downloadOfferExcel } from "../../lib/commercial-offer-excel";
import { printHtml } from "../../lib/enquiry-print";
import { getCommercialOffer, saveCommercialOfferConfig } from "../../services/commercialOfferService";

// The Commercial Offer sheet of one drive group (lib/commercial-offer.ts).
//  - From the Commercial Summary: the saved prices, editable — optional rows,
//    rename / edit / remove / add rows, scope lines — saved per enquiry and
//    group (projects.commercial_offer_config). Prices themselves never change.
//  - From a quotation version: that version's prices and the sheet edits frozen
//    with it, read-only.
// The preview is the exact HTML that prints.

const btn =
  "inline-flex items-center gap-1.5 rounded-lg border border-line bg-paper px-3 py-1.5 text-[12.5px] font-semibold text-fg-2 hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-50";
const btnPrimary =
  "inline-flex items-center gap-1.5 rounded-lg bg-accent px-3.5 py-1.5 text-[12.5px] font-semibold text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50";

export default function CommercialOfferModal({
  projectId,
  group,
  tags,
  version,
  unsavedPrices,
  onClose,
}: {
  projectId: string;
  group: DriveGroup;
  tags: OfferTag[];
  /** Read-only view of a quotation version: its label and frozen edits. */
  version?: { label: string; config: OfferConfig };
  /** The Commercial Summary has unsaved prices (not in the sheet). */
  unsavedPrices?: boolean;
  onClose: () => void;
}) {
  const editable = !version;
  const [data, setData] = useState<CommercialOfferData | null>(null);
  const [loadError, setLoadError] = useState("");
  const [config, setConfig] = useState<OfferConfig>(version?.config ?? EMPTY_OFFER_CONFIG);
  const [mode, setMode] = useState<"preview" | "edit">("preview");
  const [showPicker, setShowPicker] = useState(false);
  const [saveState, setSaveState] = useState<"" | "saving" | "saved" | "error">("");
  const [printing, setPrinting] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    getCommercialOffer(projectId)
      .then((d) => {
        if (cancelled) return;
        setData(d);
        if (editable) setConfig(d.configs[group] ?? EMPTY_OFFER_CONFIG);
      })
      .catch(() => !cancelled && setLoadError("Couldn't load the Commercial Offer."));
    return () => {
      cancelled = true;
    };
  }, [projectId, group, editable]);

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
    !!config.quotationText ||
    !!config.erpText ||
    (config.headerHidden?.length ?? 0) > 0;

  const geared = isGearedGroup(group);
  const sheet: OfferSheet | null = useMemo(() => {
    if (!data) return null;
    const q = data.quotations[group] ?? "";
    return {
      projectCode: data.projectCode,
      header: {
        clientName: data.clientName,
        enquiry: data.enquiry,
        // Typed on the sheet's header wins over the automatic line.
        quotation: config.quotationText || (q && version ? `${q} (${version.label})` : q),
        erp: config.erpText || data.erpNumbers?.[group] || undefined,
        hidden: config.headerHidden ?? [],
      },
      tags,
      config,
      geared,
      driveGroup: group,
      group: data.mixed ? group : undefined,
      versionLabel: version?.label,
    };
  }, [data, group, tags, config, geared, version]);
  const html = useMemo(
    () => (sheet ? buildOfferHtml(sheet, typeof window !== "undefined" ? `${window.location.origin}/logo.png` : "/logo.png") : ""),
    [sheet],
  );

  const handlePrint = async () => {
    if (!html) return;
    setPrinting(true);
    try {
      await printHtml(html);
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
              Commercial Offer
              <span className="ml-2 text-[13px] font-normal text-fg-3">
                {DRIVE_GROUP_LABEL[group]}
                {version ? ` · ${version.label}` : ""}
              </span>
            </h3>
            <p className="text-[12.5px] text-fg-3">
              {data ? `${data.projectCode} · ${data.clientName}` : "Loading…"} · {tags.length} tag{tags.length === 1 ? "" : "s"}
              {version ? " · as saved in this version (read-only)" : " · saved prices from the Commercial Summary"}
            </p>
            {unsavedPrices && editable && (
              <p className="mt-0.5 text-[12px] text-warn">Some prices on the page aren&apos;t saved yet — save them to see them here.</p>
            )}
          </div>
          <button type="button" className={btn} onClick={onClose}>
            Close
          </button>
        </header>

        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden p-4">
          {loadError && <p className="text-[13px] text-neg">{loadError}</p>}
          {!data && !loadError && <p className="py-8 text-center text-[13px] text-fg-3">Loading…</p>}

          {data && (
            <>
              {editable && (
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
                    {config.extras.length > 0 && (
                      <span className="rounded-full bg-accent-soft px-1.5 text-[11px] text-accent">{config.extras.length}</span>
                    )}
                  </button>
                  {customised && (
                    <button
                      type="button"
                      onClick={() => update({ ...EMPTY_OFFER_CONFIG, extras: config.extras })}
                      className="rounded-lg px-2 py-1.5 text-[12px] font-semibold text-neg hover:bg-[var(--neg-soft)]"
                      title="Undo every removal, rename, edited value, manual row and scope change"
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
                          : "Edits change this sheet only, never the saved prices."}
                  </span>
                </div>
              )}

              {editable && showPicker && (
                <div className="flex flex-wrap gap-x-5 gap-y-1.5 rounded-lg border border-line bg-sunk p-3">
                  {OFFER_EXTRAS.map((f) => (
                    <label key={f.key} className="flex cursor-pointer items-center gap-2 text-[12.5px] text-fg">
                      <input
                        type="checkbox"
                        checked={config.extras.includes(f.key)}
                        onChange={() => toggleExtra(f.key)}
                        className="h-3.5 w-3.5 accent-[var(--brand-blue)]"
                      />
                      {f.label(geared)}
                    </label>
                  ))}
                  <span className="w-full text-[11.5px] text-fg-3">
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
                      { key: "enquiry", label: "Enquiry No. & Date", value: "", auto: data.enquiry },
                      {
                        key: "quotation",
                        label: "Quotation No. & Date",
                        value: config.quotationText ?? "",
                        auto: data.quotations[group] ?? "",
                        onChange: (v) => update({ ...config, quotationText: v }),
                      },
                      {
                        key: "erp",
                        label: "Quotation No. & Date (ERP)",
                        value: config.erpText ?? "",
                        auto: data.erpNumbers?.[group] ?? "",
                        onChange: (v) => update({ ...config, erpText: v }),
                      },
                    ]}
                  />
                  <TechDocEditor
                    tags={tags}
                    blocks={buildOffer(tags, config, geared, { includeHidden: true })}
                    config={config}
                    onChange={update}
                    valueHint="Saved price"
                  />
                </div>
              ) : (
                <iframe title="Commercial Offer" srcDoc={html} className="min-h-[62vh] w-full flex-1 rounded-lg border border-line bg-white" />
              )}
            </>
          )}
        </div>

        <footer className="flex flex-wrap justify-end gap-2 border-t border-line px-4 py-3">
          <button type="button" className={btnPrimary} onClick={handlePrint} disabled={!sheet || printing || tags.length === 0}>
            {printing ? "Preparing…" : "Print / Save as PDF"}
          </button>
          <button
            type="button"
            className={btn}
            onClick={() => sheet && downloadOfferExcel(sheet)}
            disabled={!sheet || tags.length === 0}
          >
            Download Excel
          </button>
        </footer>
      </div>
    </div>
  );
}
