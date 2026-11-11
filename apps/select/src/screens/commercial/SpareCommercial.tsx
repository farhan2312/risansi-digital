"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";

import ProductCodeSelect from "../../components/pump-selection/ProductCodeSelect";
import ConfirmModal from "../../components/ui/ConfirmModal";
import PageHeader from "../../components/ui/PageHeader";
import { SPARE_GROUP, formatInr, type CommercialSummary, type QuotationInfo, type TsmOption } from "../../lib/commercial";
import { printHtml } from "../../lib/enquiry-print";
import { OTHER_PART_SECTION, partListFor, type SparePumpKind } from "../../lib/spare-parts";
import { lineAmount, quoteDiscount, quoteSubtotal, spareQuoteProblem, type SpareDocEdits, type SpareModel, type SpareQuote } from "../../lib/spare-quote";
import {
  buildSpareQuoteHtml,
  downloadSpareQuoteExcel,
  spareDiscountAuto,
  spareDocModels,
  spareDocTerms,
  type SpareDocTerm,
  type SpareQuoteSheet,
} from "../../lib/spare-quote-doc";
import { SPARE_TERMS, SPARE_WARRANTY, SPARE_WARRANTY_HEADING, TERMS_MARKETS, WARRANTY_TERM, type SpareTerm, type TermsMarket } from "../../lib/spare-terms";
import { dotDate } from "../../lib/tech-doc";
import { setPricesReviewed } from "../../services/commercialService";
import { createQuotation, getQuotation, listTsmOptions } from "../../services/quotationService";
import { getSpareQuote, saveSpareDocEdits, saveSpareQuote } from "../../services/spareQuoteService";
import QuotationPanel from "./QuotationPanel";

// A spare order's Commercial page (lib/spare-quote.ts): no tags, no technical step
// and no scope of supply. Reference PO and the quotation first; then pump models,
// (code picked from the list or typed) and per model the parts quoted with quantity
// and unit price.

const btn =
  "inline-flex items-center gap-1.5 rounded-lg border border-line bg-paper px-3 py-1.5 text-[12.5px] font-semibold whitespace-nowrap text-fg-2 hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-50";
const btnPrimary =
  "inline-flex items-center gap-1.5 rounded-lg bg-accent px-3.5 py-1.5 text-[12.5px] font-semibold whitespace-nowrap text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50";
const inputCls =
  "w-full rounded-lg border border-line bg-paper px-2.5 py-2 text-[13px] text-fg outline-none focus:border-accent focus:ring-2 focus:ring-accent-soft disabled:cursor-not-allowed disabled:opacity-60";
const labelCls = "text-[11.5px] font-semibold text-fg-3";

type LineDraft = { partNo: string; partName: string; poNo: string; poDate: string; qty: string; unitPrice: string };
type ModelDraft = { id: string; code: string; pumpKind: SparePumpKind; lines: LineDraft[] };
type Draft = { hasPo: boolean; discountPct: string; note: string; termsMarket: TermsMarket; termsOff: string[]; models: ModelDraft[] };

const numText = (n: number | null) => (n === null ? "" : String(n));

const toDraft = (q: SpareQuote): Draft => ({
  hasPo: q.hasPo,
  discountPct: numText(q.discountPct),
  note: q.note,
  termsMarket: q.termsMarket,
  termsOff: q.termsOff,
  models: q.models.map((m) => ({
    id: m.id,
    code: m.productCode,
    pumpKind: m.pumpKind,
    lines: m.lines.map((l) => ({ partNo: l.partNo, partName: l.partName, poNo: l.poNo, poDate: l.poDate, qty: numText(l.qty), unitPrice: numText(l.unitPrice) })),
  })),
});

const parseAmount = (s: string): number | null => {
  const t = s.trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : null;
};

const toQuote = (d: Draft): SpareQuote => ({
  hasPo: d.hasPo,
  discountPct: parseAmount(d.discountPct),
  note: d.note.trim(),
  termsMarket: d.termsMarket,
  termsOff: [...d.termsOff].sort(),
  models: d.models.map(
    (m): SpareModel => ({
      id: m.id,
      productCode: m.code.trim(),
      pumpKind: m.pumpKind,
      lines: m.lines.map((l) => ({
        partNo: l.partNo,
        partName: l.partName,
        poNo: d.hasPo ? l.poNo.trim() : "",
        poDate: d.hasPo ? l.poDate : "",
        qty: parseAmount(l.qty),
        unitPrice: parseAmount(l.unitPrice),
      })),
    }),
  ),
});

const partKey = (p: { partNo: string; partName: string }) => `${p.partNo}|${p.partName}`;

export default function SpareCommercial({
  projectId,
  project,
  onReviewedChange,
}: {
  projectId: string;
  project: CommercialSummary["project"];
  onReviewedChange: (at: string | null) => void;
}) {
  const olderVersion = !project.isLatest;
  const [loadError, setLoadError] = useState("");
  const [head, setHead] = useState<{ enquiryNo: string; enquiryDate: string | null; clientName: string | null } | null>(null);
  const [saved, setSaved] = useState<SpareQuote | null>(null);
  const [docEdits, setDocEdits] = useState<SpareDocEdits>({});
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [justSaved, setJustSaved] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  const [pricesVersion, setPricesVersion] = useState(0);

  // The quotation, and what generating it needs.
  const [quotation, setQuotation] = useState<QuotationInfo | null>(null);
  const [quoteLoaded, setQuoteLoaded] = useState(false);
  const [clientTsm, setClientTsm] = useState<TsmOption | null>(null);
  const [tsmOptions, setTsmOptions] = useState<TsmOption[]>([]);
  const [tsmId, setTsmId] = useState("");
  const [erpSerial, setErpSerial] = useState("");
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState("");

  const [pickingFor, setPickingFor] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [preview, setPreview] = useState<SpareQuoteSheet | null>(null);
  const [reviewBusy, setReviewBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getSpareQuote(projectId)
      .then((d) => {
        if (cancelled) return;
        setHead({ enquiryNo: d.enquiryNo, enquiryDate: d.enquiryDate, clientName: d.clientName });
        setSaved(d.quote);
        setDraft(toDraft(d.quote));
        setDocEdits(d.docEdits);
      })
      .catch(() => !cancelled && setLoadError("Couldn't load the spare quotation."));
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const loadQuotation = useCallback(async () => {
    const q = await getQuotation(projectId, SPARE_GROUP);
    setQuotation(q.quotation);
    setClientTsm(q.clientTsm);
    if (!q.clientTsm && !q.quotation) setTsmOptions(await listTsmOptions().catch(() => []));
    setQuoteLoaded(true);
    return q.quotation;
  }, [projectId]);
  useEffect(() => {
    loadQuotation().catch(() => setLoadError("Couldn't load the quotation."));
  }, [loadQuotation]);

  const dirty = useMemo(() => Boolean(draft && saved && JSON.stringify(toQuote(draft)) !== JSON.stringify(saved)), [draft, saved]);
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  const update = (patch: Partial<Draft>) => {
    setDraft((d) => (d ? { ...d, ...patch } : d));
    setJustSaved(false);
  };
  const updateModel = (id: string, patch: Partial<ModelDraft>) => {
    setDraft((d) => (d ? { ...d, models: d.models.map((m) => (m.id === id ? { ...m, ...patch } : m)) } : d));
    setJustSaved(false);
  };
  const updateLine = (id: string, i: number, patch: Partial<LineDraft>) => {
    setDraft((d) =>
      d ? { ...d, models: d.models.map((m) => (m.id === id ? { ...m, lines: m.lines.map((l, j) => (j === i ? { ...l, ...patch } : l)) } : m)) } : d,
    );
    setJustSaved(false);
  };

  const save = async (): Promise<boolean> => {
    if (!draft) return false;
    if (draft.models.some((m) => !m.code.trim())) {
      setShowErrors(true);
      setSaveError("Every model needs its code before saving.");
      return false;
    }
    if ((parseAmount(draft.discountPct) ?? 0) > 100) {
      setSaveError("The discount can't be more than 100%.");
      return false;
    }
    setSaving(true);
    setSaveError("");
    try {
      const q = await saveSpareQuote(projectId, toQuote(draft));
      setSaved(q);
      setDraft(toDraft(q));
      setJustSaved(true);
      setShowErrors(false);
      setPricesVersion((n) => n + 1);
      return true;
    } catch (e) {
      setSaveError((e as { response?: { data?: { error?: string } } })?.response?.data?.error ?? "Couldn't save. Try again.");
      return false;
    } finally {
      setSaving(false);
    }
  };

  const generate = async () => {
    if (!draft) return;
    setGenerating(true);
    setGenerateError("");
    try {
      await saveSpareQuote(projectId, toQuote(draft)).then((q) => {
        setSaved(q);
        setDraft(toDraft(q));
      });
      await createQuotation(projectId, SPARE_GROUP, clientTsm ? undefined : Number(tsmId), erpSerial.trim());
      await loadQuotation();
    } catch (e) {
      setGenerateError((e as { response?: { data?: { error?: string } } })?.response?.data?.error ?? "Couldn't generate the quotation. Try again.");
    } finally {
      setGenerating(false);
    }
  };

  // A ticked term's wording, typed on the Terms card: kept with the document's edits
  // (the same as editing it on the document), saved as you type.
  const termTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [termSave, setTermSave] = useState<"" | "saving" | "saved" | "error">("");
  const editTermWording = (id: string, text: string | null) => {
    const terms = { ...docEdits.terms };
    if (text === null) delete terms[id];
    else terms[id] = text;
    const next: SpareDocEdits = { ...docEdits, terms };
    if (!Object.keys(terms).length) delete next.terms;
    setDocEdits(next);
    setTermSave("saving");
    if (termTimer.current) clearTimeout(termTimer.current);
    termTimer.current = setTimeout(() => {
      saveSpareDocEdits(projectId, next)
        .then(() => {
          setTermSave("saved");
          setPricesVersion((n) => n + 1);
        })
        .catch(() => setTermSave("error"));
    }, 600);
  };

  const toggleReviewed = async (reviewed: boolean) => {
    setReviewBusy(true);
    try {
      const res = await setPricesReviewed(projectId, reviewed);
      onReviewedChange(res.pricesReviewedAt);
    } finally {
      setReviewBusy(false);
    }
  };

  const openPreview = async () => {
    if (!saved || !head) return;
    const q = await loadQuotation().catch(() => quotation);
    setPreview({
      projectCode: head.enquiryNo,
      quote: saved,
      edits: docEdits,
      header: {
        clientName: head.clientName ?? "",
        enquiry: [head.enquiryNo, head.enquiryDate ? `Dt. ${dotDate(head.enquiryDate)}` : ""].filter(Boolean).join(", "),
        quotation: q ? `${q.erpNumber ?? q.number}, Dt. ${dotDate(q.quoteDate)}` : "",
        hidden: [],
      },
    });
  };

  // Stays editable after Save Version: Save again replaces the saved copy (user, 2026-11-11).
  const readOnly = olderVersion;
  const current = draft ? toQuote(draft) : null;
  const subtotal = current ? quoteSubtotal(current) : 0;
  const discount = current ? quoteDiscount(current) : 0;
  const sendBlock = saved
    ? (spareQuoteProblem(saved) ?? (project.versionNo > 0 && !project.pricesReviewedAt ? "Tick Prices reviewed first." : null))
    : null;

  const header = (
    <PageHeader
      icon={<PartsIcon />}
      title="Spare Quotation"
      subtitle={[project.code, project.name].filter(Boolean).join(" · ")}
      actions={
        <div className="flex flex-wrap items-center gap-2">
          {dirty && <span className="text-[12.5px] font-medium text-warn">Unsaved changes</span>}
          {termSave && (
            <span className={`text-[12.5px] font-medium ${termSave === "error" ? "text-neg" : "text-fg-3"}`}>
              {termSave === "saving" ? "Saving terms…" : termSave === "saved" ? "Terms saved" : "Couldn't save the terms"}
            </span>
          )}
          {justSaved && !dirty && <span className="text-[12.5px] font-medium text-pos">Saved</span>}
          {quotation && (
            <button type="button" className={btn} onClick={() => void openPreview()} disabled={dirty || !saved?.models.length} title={dirty ? "Save your changes first" : undefined}>
              Quotation document
            </button>
          )}
          {quotation && !readOnly && (
            <button type="button" className={btnPrimary} onClick={() => void save()} disabled={saving || !dirty}>
              {saving ? "Saving…" : "Save"}
            </button>
          )}
          <Link href="/projects" className={btn}>
            Back to Enquiries
          </Link>
        </div>
      }
    />
  );

  if (loadError || !draft || !quoteLoaded) {
    return (
      <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-5 px-4 py-5 sm:px-6">
        {header}
        <div className={`rounded-xl border border-line bg-paper p-6 text-center text-[13.5px] ${loadError ? "text-neg" : "text-fg-3"}`}>
          {loadError || "Loading…"}
        </div>
      </div>
    );
  }

  const poFields = (
    <>
    <label className="flex w-fit cursor-pointer items-center gap-2 text-[13px] font-semibold text-fg">
      <input type="checkbox" className="accent-accent" checked={draft.hasPo} onChange={(e) => update({ hasPo: e.target.checked })} />
      Reference PO
    </label>
    {draft.hasPo && <p className="text-[12.5px] text-fg-3">Each part&apos;s reference PO No. and date go in its row below.</p>}
    </>
  );

  return (
    <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-5 px-4 py-5 sm:px-6">
      {header}

      {olderVersion && (
        <p className="flex flex-wrap items-center gap-2 rounded-xl border border-accent bg-accent-soft px-3.5 py-2.5 text-[12.5px] text-fg-2">
          <span className="rounded-md bg-accent px-2 py-0.5 text-[11.5px] font-bold text-white">View only</span>
          This is an older version of the enquiry - nothing here can be changed. Work on the latest version from the Enquiries list.
        </p>
      )}

      {!quotation ? (
        <fieldset disabled={readOnly} className="m-0 flex min-w-0 flex-col gap-4 rounded-xl border border-line bg-paper p-4">
          <div>
            <h2 className="text-[14px] font-semibold text-fg">Generate the quotation</h2>
            <p className="text-[12.5px] text-fg-3">The TSM and serial are needed to generate. Models and parts come next (with each part&apos;s reference PO if you tick it).</p>
          </div>
          {poFields}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1">
              <span className={labelCls}>TSM <span className="text-neg">*</span></span>
              {clientTsm ? (
                <span className="py-2 text-[13px] font-semibold text-fg">
                  {clientTsm.name} ({clientTsm.initials})<span className="ml-1.5 font-normal text-fg-3">· the client&apos;s rep in sales</span>
                </span>
              ) : (
                <select className={inputCls} value={tsmId} aria-label="TSM" onChange={(e) => setTsmId(e.target.value)}>
                  <option value="">Pick the TSM</option>
                  {tsmOptions.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name} ({o.initials}){o.zone ? ` · ${o.zone}` : ""}
                    </option>
                  ))}
                </select>
              )}
            </div>
            <label className="flex flex-col gap-1">
              <span className={labelCls}>Quotation No. serial (ERP) <span className="text-neg">*</span></span>
              <input className={`${inputCls} font-mono uppercase`} value={erpSerial} maxLength={30} onChange={(e) => setErpSerial(e.target.value)} />
            </label>
          </div>
          {generateError && <p className="text-[12.5px] text-neg">{generateError}</p>}
          <div>
            <button type="button" className={btnPrimary} onClick={() => void generate()} disabled={generating || (!clientTsm && !tsmId) || !erpSerial.trim()}>
              {generating ? "Generating…" : "Generate quotation"}
            </button>
          </div>
        </fieldset>
      ) : (
        <>
          <QuotationPanel
            projectId={projectId}
            group={SPARE_GROUP}
            hasUnsavedPrices={dirty}
            pricesVersion={pricesVersion}
            onGenerate={() => {}}
            readOnly={olderVersion}
            sendBlock={sendBlock}
            onChanged={setQuotation}
          />

          <fieldset disabled={readOnly} className="m-0 flex min-w-0 flex-col gap-5 border-0 p-0">
            {project.versionNo > 0 && (
              <label className="flex cursor-pointer flex-wrap items-center gap-2.5 rounded-xl border border-line bg-paper px-4 py-3 text-[13px] text-fg-2">
                <input
                  type="checkbox"
                  className="accent-accent"
                  checked={Boolean(project.pricesReviewedAt)}
                  disabled={reviewBusy}
                  onChange={(e) => void toggleReviewed(e.target.checked)}
                />
                <span className="min-w-0 flex-1">
                  <b className="font-semibold text-fg">Prices reviewed</b> - I have checked the parts and prices copied from V{project.versionNo - 1}. Needed before Save Version.
                </span>
              </label>
            )}

            <section className="flex flex-col gap-3 rounded-xl border border-line bg-paper p-4">
              {poFields}
            </section>

            {draft.models.map((m, index) => (
              <ModelCard
                key={m.id}
                index={index}
                model={m}
                showErrors={showErrors}
                hasPo={draft.hasPo}
                onChange={(patch) => updateModel(m.id, patch)}
                onLineChange={(i, patch) => updateLine(m.id, i, patch)}
                onPickParts={() => setPickingFor(m.id)}
                onRemove={() => setRemoving(m.id)}
              />
            ))}

            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-paper px-4 py-3">
              <button
                type="button"
                className={btn}
                onClick={() =>
                  update({
                    models: [...draft.models, { id: crypto.randomUUID(), code: "", pumpKind: "PCP", lines: [] }],
                  })
                }
              >
                + Add model
              </button>
              <span className="text-[14px] text-fg-2">
                Total <b className="ml-1 font-mono text-fg">{formatInr(subtotal)}</b>
              </span>
            </div>

            <section className="flex flex-col gap-3 rounded-xl border border-line bg-paper p-4">
              <div className="flex flex-wrap items-end justify-end gap-x-6 gap-y-3">
                <label className="flex w-[130px] flex-col gap-1">
                  <span className={labelCls}>Discount %</span>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    step="any"
                    inputMode="decimal"
                    className={`${inputCls} text-right font-mono`}
                    value={draft.discountPct}
                    onChange={(e) => update({ discountPct: e.target.value })}
                  />
                </label>
                {discount > 0 && (
                  <span className="pb-2 text-[13px] text-fg-2">
                    Discount <b className="font-mono text-fg">-{formatInr(discount)}</b>
                  </span>
                )}
                <span className="pb-1.5 text-[14px] text-fg-2">
                  Grand total <b className="ml-1 font-mono text-[16px] text-fg">{formatInr(subtotal - discount)}</b>
                </span>
              </div>
              <label className="flex flex-col gap-1">
                <span className={labelCls}>Note</span>
                <textarea className={inputCls} rows={2} maxLength={2000} value={draft.note} onChange={(e) => update({ note: e.target.value })} />
              </label>
            </section>

            <TermsSection market={draft.termsMarket} off={draft.termsOff} edits={docEdits} onChange={update} onWording={editTermWording} />
            {saveError && <p className="text-[12.5px] font-medium text-neg">{saveError}</p>}
          </fieldset>
        </>
      )}

      {pickingFor &&
        (() => {
          const m = draft.models.find((x) => x.id === pickingFor);
          return m ? (
            <PartPicker
              model={m}
              onClose={() => setPickingFor(null)}
              onSave={(lines) => {
                updateModel(m.id, { lines });
                setPickingFor(null);
              }}
            />
          ) : null;
        })()}

      <ConfirmModal
        open={removing !== null}
        title="Remove this model?"
        description="The model and its parts leave the quotation when you save."
        confirmLabel="Remove model"
        tone="danger"
        onConfirm={() => {
          update({ models: draft.models.filter((m) => m.id !== removing) });
          setRemoving(null);
        }}
        onClose={() => setRemoving(null)}
      />

      {preview && <QuotePreview projectId={projectId} sheet={preview} readOnly={readOnly} onClose={() => setPreview(null)} onEdited={setDocEdits} />}
    </div>
  );
}

function ModelCard({
  index,
  model,
  hasPo,
  showErrors,
  onChange,
  onLineChange,
  onPickParts,
  onRemove,
}: {
  index: number;
  model: ModelDraft;
  /** Reference PO ticked: each part has its PO No. and date. */
  hasPo: boolean;
  showErrors: boolean;
  onChange: (patch: Partial<ModelDraft>) => void;
  onLineChange: (i: number, patch: Partial<LineDraft>) => void;
  onPickParts: () => void;
  onRemove: () => void;
}) {
  const subtotal = model.lines.reduce((s, l) => s + lineAmount({ qty: parseAmount(l.qty), unitPrice: parseAmount(l.unitPrice) }), 0);

  return (
    <section className="rounded-xl border border-line bg-paper">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
        <p className="text-[11.5px] font-semibold tracking-[0.08em] text-fg-3 uppercase">Model {index + 1}</p>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[13px] text-fg-2">
            Sub-total <b className="font-mono text-fg">{formatInr(subtotal)}</b>
          </span>
          <button type="button" className={`${btn} text-neg hover:text-neg`} onClick={onRemove}>
            Remove
          </button>
        </div>
      </header>

      <div className="flex max-w-[620px] flex-col gap-1 px-4 pt-3">
        <span className={labelCls}>Model code</span>
        <ProductCodeSelect freeText value={model.code} invalid={showErrors && !model.code.trim()} onChange={(code) => onChange({ code })} />
        {showErrors && !model.code.trim() && <span className="text-[11.5px] text-neg">Pick or type the model code.</span>}
      </div>

      <div className="flex flex-wrap items-center gap-3 px-4 py-3">
        <label className="flex items-center gap-2">
          <span className={labelCls}>Parts list</span>
          <select
            className={`${inputCls} w-auto`}
            value={model.pumpKind}
            onChange={(e) => onChange({ pumpKind: e.target.value === "MMP" || e.target.value === "OTHER" ? e.target.value : "PCP" })}
          >
            <option value="PCP">Screw Pump (PCP)</option>
            <option value="MMP">Rota Pump (MMP)</option>
            <option value="OTHER">Others (type the parts)</option>
          </select>
        </label>
        <button type="button" className={btn} onClick={onPickParts}>
          {model.pumpKind === "OTHER" ? (model.lines.length ? `Add parts (${model.lines.length})` : "Add parts") : model.lines.length ? `Select parts (${model.lines.length})` : "Select parts"}
        </button>
      </div>

      {model.lines.length > 0 && (
        <div className="overflow-x-auto border-t border-line">
          <table className={`w-full text-[13px] ${hasPo ? "min-w-[960px]" : "min-w-[640px]"}`}>
            <thead>
              <tr className="border-b border-line bg-sunk text-left text-[11px] font-semibold tracking-[0.05em] text-fg-3 uppercase">
                <th className="px-4 py-2">Part No.</th>
                <th className="px-4 py-2">Description (editable)</th>
                {hasPo && <th className="w-[160px] px-2 py-2">Ref. PO No.</th>}
                {hasPo && <th className="w-[150px] px-2 py-2">PO date</th>}
                <th className="w-[110px] px-2 py-2 text-right">Qty</th>
                <th className="w-[150px] px-2 py-2 text-right">Unit price (₹)</th>
                <th className="w-[140px] px-4 py-2 text-right">Amount</th>
                <th className="w-[44px]" aria-label="Remove" />
              </tr>
            </thead>
            <tbody>
              {model.lines.map((l, i) => {
                const qty = parseAmount(l.qty);
                const price = parseAmount(l.unitPrice);
                return (
                  <tr key={i} className="border-b border-line last:border-b-0">
                    <td className="px-4 py-1.5 font-mono text-fg-2">{l.partNo || "—"}</td>
                    <td className="px-2 py-1.5">
                      <input
                        className={`${inputCls} py-1.5`}
                        value={l.partName}
                        maxLength={200}
                        aria-label={`Description of part ${l.partNo || i + 1}`}
                        onChange={(e) => onLineChange(i, { partName: e.target.value })}
                      />
                    </td>
                    {hasPo && (
                      <td className="px-2 py-1.5">
                        <input
                          className={`${inputCls} py-1.5 ${showErrors && !l.poNo.trim() && l.poDate ? "border-neg" : ""}`}
                          value={l.poNo}
                          maxLength={120}
                          placeholder="e.g. 2025-26/106"
                          aria-label={`Reference PO No. of ${l.partName}`}
                          onChange={(e) => onLineChange(i, { poNo: e.target.value })}
                        />
                      </td>
                    )}
                    {hasPo && (
                      <td className="px-2 py-1.5">
                        <input
                          type="date"
                          className={`${inputCls} py-1.5 ${showErrors && l.poNo.trim() && !l.poDate ? "border-neg" : ""}`}
                          value={l.poDate}
                          aria-label={`Reference PO date of ${l.partName}`}
                          onChange={(e) => onLineChange(i, { poDate: e.target.value })}
                        />
                      </td>
                    )}
                    <td className="px-2 py-1.5">
                      <input
                        type="number"
                        min={0}
                        step="any"
                        inputMode="decimal"
                        className={`${inputCls} py-1.5 text-right font-mono`}
                        value={l.qty}
                        aria-label={`Quantity of ${l.partName}`}
                        onChange={(e) => onLineChange(i, { qty: e.target.value })}
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <input
                        type="number"
                        min={0}
                        step="any"
                        inputMode="decimal"
                        className={`${inputCls} py-1.5 text-right font-mono`}
                        value={l.unitPrice}
                        aria-label={`Unit price of ${l.partName}`}
                        onChange={(e) => onLineChange(i, { unitPrice: e.target.value })}
                      />
                    </td>
                    <td className="px-4 py-1.5 text-right font-mono text-fg">{formatInr(lineAmount({ qty, unitPrice: price }))}</td>
                    <td className="pr-3 text-right">
                      <button
                        type="button"
                        className="rounded px-1.5 text-[16px] leading-none text-fg-3 hover:text-neg"
                        aria-label={`Remove ${l.partName}`}
                        onClick={() => onChange({ lines: model.lines.filter((_, j) => j !== i) })}
                      >
                        ×
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/** Domestic or Export, and which of its terms the document shows. */
function TermsSection({
  market,
  off,
  edits,
  onChange,
  onWording,
}: {
  market: TermsMarket;
  off: string[];
  edits: SpareDocEdits;
  onChange: (patch: { termsMarket?: TermsMarket; termsOff?: string[] }) => void;
  /** A ticked term's wording typed here; null = back to the standard wording. */
  onWording: (id: string, text: string | null) => void;
}) {
  const row = (t: SpareTerm, n: number, disabled = false) => {
    const wording = edits.terms?.[t.id] ?? t.text;
    const ticked = !off.includes(t.id);
    const edited = edits.terms?.[t.id] !== undefined && edits.terms[t.id] !== t.text;
    return (
      <div key={t.id} className={`flex items-start gap-2.5 rounded-md px-2 py-1.5 text-[12.5px] ${disabled ? "opacity-50" : "hover:bg-elev"}`}>
        <input
          type="checkbox"
          className="mt-1 cursor-pointer accent-accent"
          checked={ticked}
          disabled={disabled}
          aria-label={`Show term ${n}`}
          onChange={() => onChange({ termsOff: ticked ? [...off, t.id] : off.filter((x) => x !== t.id) })}
        />
        <span className="mt-0.5 w-5 shrink-0 text-right font-mono text-fg-3">{n}</span>
        {ticked && !disabled ? (
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <textarea
              className="w-full rounded border border-line bg-paper px-1.5 py-1 text-[12.5px] text-fg outline-none focus:border-accent disabled:bg-transparent"
              rows={Math.min(8, Math.max(1, Math.ceil(wording.length / 120) + wording.split("\n").length - 1))}
              value={wording}
              aria-label={`Term ${n} wording`}
              onChange={(e) => onWording(t.id, e.target.value)}
            />
            {edited && (
              <button type="button" className="self-start text-[11.5px] font-semibold text-accent hover:underline" onClick={() => onWording(t.id, null)}>
                Reset to the standard wording
              </button>
            )}
          </div>
        ) : (
          <span className="line-clamp-3 min-w-0 whitespace-pre-line text-fg" title={wording}>
            {wording}
          </span>
        )}
      </div>
    );
  };
  const refTicked = !off.includes(WARRANTY_TERM[market]);
  const noClause = refTicked && SPARE_WARRANTY.every((t) => off.includes(t.id));

  return (
    <section className="flex flex-col gap-3 rounded-xl border border-line bg-paper p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-[14px] font-semibold text-fg">Terms and conditions</h2>
          <p className="text-[12.5px] text-fg-3">Tick what shows on the quotation document. The wording of a ticked term can be edited here.</p>
        </div>
        <div className="inline-flex rounded-lg border border-line bg-sunk p-0.5" role="tablist">
          {TERMS_MARKETS.map((m) => (
            <button
              key={m.value}
              type="button"
              role="tab"
              aria-selected={market === m.value}
              onClick={() => onChange({ termsMarket: m.value })}
              className={`rounded-md px-3 py-1 text-[12px] font-semibold ${market === m.value ? "bg-paper text-fg shadow-sm" : "text-fg-3 hover:text-fg"}`}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>
      <div className="flex flex-col">{SPARE_TERMS[market].map((t, i) => row(t, i + 1))}</div>
      <div className="flex flex-col border-t border-line pt-3">
        <p className="mb-1 px-2 text-[11.5px] font-semibold tracking-[0.05em] text-fg-3 uppercase">{SPARE_WARRANTY_HEADING}</p>
        {!refTicked && <p className="px-2 pb-1 text-[12px] text-fg-3">Not printed: the Warranty Clause term above is unticked.</p>}
        {noClause && <p className="px-2 pb-1 text-[12px] text-warn">The Warranty Clause term says &ldquo;As attached&rdquo;, but no clause is ticked.</p>}
        {SPARE_WARRANTY.map((t, i) => row(t, i + 1, !refTicked))}
      </div>
    </section>
  );
}

/** Tick the parts of this model from its parts list, or name others. */
function PartPicker({ model, onClose, onSave }: { model: ModelDraft; onClose: () => void; onSave: (lines: LineDraft[]) => void }) {
  const list = partListFor(model.pumpKind);
  const listKeys = useMemo(() => new Set(list.map((p) => partKey({ partNo: p.part_no, partName: p.part_name }))), [list]);
  const [picked, setPicked] = useState<LineDraft[]>(model.lines);
  const [find, setFind] = useState("");
  const [otherNo, setOtherNo] = useState("");
  const [otherName, setOtherName] = useState("");

  const q = find.trim().toLowerCase();
  const matches = (p: { part_no: string; part_name: string }) => !q || p.part_no.toLowerCase().includes(q) || p.part_name.toLowerCase().includes(q);
  const sections = [...new Set(list.map((p) => p.section))];
  const others = picked.filter((l) => !listKeys.has(partKey(l)));

  const toggle = (partNo: string, partName: string) => {
    const key = partKey({ partNo, partName });
    setPicked((cur) => (cur.some((l) => partKey(l) === key) ? cur.filter((l) => partKey(l) !== key) : [...cur, { partNo, partName, poNo: "", poDate: "", qty: "", unitPrice: "" }]));
  };
  const addOther = () => {
    const partName = otherName.trim();
    if (!partName) return;
    const partNo = otherNo.trim();
    if (!picked.some((l) => partKey(l) === partKey({ partNo, partName }))) setPicked((cur) => [...cur, { partNo, partName, poNo: "", poDate: "", qty: "", unitPrice: "" }]);
    setOtherNo("");
    setOtherName("");
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="flex max-h-[90vh] w-full max-w-[720px] flex-col overflow-hidden rounded-xl border border-line bg-paper" onClick={(e) => e.stopPropagation()}>
        <header className="flex items-start justify-between gap-3 border-b border-line px-4 py-3">
          <div className="min-w-0">
            <h3 className="text-[15px] font-semibold text-fg">{list.length ? "Select parts" : "Add parts"}</h3>
            <p className="font-mono text-[12.5px] break-all text-fg-3">{model.code || "No code yet"}</p>
          </div>
          <span className="shrink-0 text-[12.5px] text-fg-3">{picked.length} picked</span>
        </header>
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
          {list.length > 0 && (
          <>
          <input className={inputCls} type="search" value={find} placeholder="Find a part by name or number…" aria-label="Find a part" onChange={(e) => setFind(e.target.value)} />
          <section className="rounded-lg border border-line p-3">
            {sections.map((sec) => {
              const shown = list.filter((p) => p.section === sec && matches(p));
              if (shown.length === 0) return null;
              return (
                <div key={sec} className="mb-3 last:mb-0">
                  <p className="mb-1.5 text-[11px] font-semibold tracking-wide text-fg-3 uppercase">{sec}</p>
                  <div className="grid grid-cols-1 gap-0.5 sm:grid-cols-2">
                    {shown.map((p) => {
                      const on = picked.some((l) => partKey(l) === partKey({ partNo: p.part_no, partName: p.part_name }));
                      return (
                        <label key={`${p.part_no}-${p.part_name}`} className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-[13px] hover:bg-elev">
                          <input type="checkbox" className="accent-accent" checked={on} onChange={() => toggle(p.part_no, p.part_name)} />
                          <span className="w-[46px] shrink-0 font-mono text-[12px] text-fg-3">{p.part_no}</span>
                          <span className="min-w-0 text-fg">{p.part_name}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </section>
          </>
          )}
          <section className="flex flex-col gap-2 rounded-lg border border-line p-3">
            <h4 className="text-[13px] font-semibold text-fg">{list.length ? OTHER_PART_SECTION : "Add parts - part no. and part name"}</h4>
            {others.map((l) => (
              <label key={partKey(l)} className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1 text-[13px] hover:bg-elev">
                <input type="checkbox" className="accent-accent" checked onChange={() => toggle(l.partNo, l.partName)} />
                <span className="w-[46px] shrink-0 font-mono text-[12px] text-fg-3">{l.partNo || "—"}</span>
                <span className="min-w-0 text-fg">{l.partName}</span>
              </label>
            ))}
            <div className="flex flex-wrap items-center gap-2">
              <input className={`${inputCls} w-[130px]`} value={otherNo} maxLength={40} placeholder="Part No." aria-label="Other part number" onChange={(e) => setOtherNo(e.target.value)} />
              <input
                className={`${inputCls} min-w-[180px] flex-1`}
                value={otherName}
                maxLength={200}
                placeholder="Part name"
                aria-label="Other part name"
                onChange={(e) => setOtherName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addOther();
                  }
                }}
              />
              <button type="button" className={btn} onClick={addOther} disabled={!otherName.trim()}>
                + Add
              </button>
            </div>
          </section>
        </div>
        <footer className="flex items-center justify-end gap-2 border-t border-line px-4 py-3">
          <button type="button" className={btn} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={btnPrimary} onClick={() => onSave(picked)}>
            Done
          </button>
        </footer>
      </div>
    </div>
  );
}

/** The quotation document: preview, print, Excel, and every row editable for the
 *  document (saved as you type; the quote itself doesn't change). */
function QuotePreview({
  projectId,
  sheet,
  readOnly,
  onClose,
  onEdited,
}: {
  projectId: string;
  sheet: SpareQuoteSheet;
  readOnly: boolean;
  onClose: () => void;
  onEdited: (edits: SpareDocEdits) => void;
}) {
  const [edits, setEdits] = useState<SpareDocEdits>(sheet.edits);
  const [mode, setMode] = useState<"preview" | "edit">("preview");
  const [saveState, setSaveState] = useState<"" | "saving" | "saved" | "error">("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const current = useMemo(() => ({ ...sheet, edits }), [sheet, edits]);
  const html = useMemo(() => buildSpareQuoteHtml(current, `${window.location.origin}/logo.png`), [current]);
  const models = useMemo(() => spareDocModels(sheet.quote, edits), [sheet.quote, edits]);
  const docTerms = useMemo(() => spareDocTerms(sheet.quote, edits), [sheet.quote, edits]);

  const change = (next: SpareDocEdits) => {
    setEdits(next);
    onEdited(next);
    setSaveState("saving");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      saveSpareDocEdits(projectId, next)
        .then(() => setSaveState("saved"))
        .catch(() => setSaveState("error"));
    }, 500);
  };
  const setLine = (key: string, patch: Record<string, string>) =>
    change({ ...edits, lines: { ...edits.lines, [key]: { ...edits.lines?.[key], ...patch } } });
  const toggleRemoved = (key: string) => {
    const removed = edits.removed ?? [];
    change({ ...edits, removed: removed.includes(key) ? removed.filter((k) => k !== key) : [...removed, key] });
  };

  const headerFields: { key: "client" | "enquiry" | "quotation" | "discount" | "note"; label: string; auto: string }[] = [
    { key: "client", label: "Client Name", auto: sheet.header.clientName },
    { key: "enquiry", label: "Enquiry No. & Date", auto: sheet.header.enquiry },
    { key: "quotation", label: "Quotation No. & Date", auto: sheet.header.quotation },
    { key: "discount", label: "Discount %", auto: spareDiscountAuto(sheet.quote) },
    { key: "note", label: "Note", auto: sheet.quote.note },
  ];
  const cell = "w-full rounded border border-line bg-paper px-1.5 py-1 text-[12.5px] text-fg outline-none focus:border-accent";
  const termEditors = (heading: string, list: SpareDocTerm[]) =>
    list.length > 0 && (
      <section className="flex flex-col divide-y divide-line rounded-lg border border-line">
        <h4 className="bg-sunk px-3 py-2 text-[12.5px] font-semibold text-fg">{heading}</h4>
        {list.map((t, i) => (
          <label key={t.id} className="grid grid-cols-[28px_minmax(0,1fr)] items-start gap-2 px-3 py-2">
            <span className="pt-1 text-right font-mono text-[12.5px] text-fg-3">{i + 1}</span>
            <textarea
              className={cell}
              rows={Math.min(10, Math.max(1, Math.ceil(t.text.length / 110) + t.text.split("\n").length - 1))}
              value={t.text}
              aria-label={`${heading} ${i + 1}`}
              onChange={(e) => change({ ...edits, terms: { ...edits.terms, [t.id]: e.target.value } })}
            />
          </label>
        ))}
      </section>
    );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="flex h-[92vh] w-full max-w-[1100px] flex-col overflow-hidden rounded-xl border border-line bg-paper" onClick={(e) => e.stopPropagation()}>
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
          <div className="flex flex-wrap items-center gap-3">
            <h3 className="text-[15px] font-semibold text-fg">Quotation for Spares</h3>
            {!readOnly && (
              <div className="inline-flex rounded-lg border border-line bg-sunk p-0.5" role="tablist">
                {(["preview", "edit"] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    role="tab"
                    aria-selected={mode === m}
                    onClick={() => setMode(m)}
                    className={`rounded-md px-3 py-1 text-[12.5px] font-semibold ${mode === m ? "bg-paper text-fg shadow-sm" : "text-fg-3 hover:text-fg"}`}
                  >
                    {m === "preview" ? "Preview" : "Edit rows"}
                  </button>
                ))}
              </div>
            )}
            <span className="text-[12px] text-fg-3">
              {saveState === "saving" ? "Saving…" : saveState === "saved" ? "Saved" : saveState === "error" ? "Couldn't save. Try again." : ""}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {!readOnly && Object.keys(edits).length > 0 && (
              <button type="button" className={`${btn} text-neg hover:text-neg`} onClick={() => change({})} title="Undo every edit on this document">
                Reset edits
              </button>
            )}
            <button type="button" className={btn} onClick={() => void printHtml(html)}>
              Print / PDF
            </button>
            <button type="button" className={btn} onClick={() => downloadSpareQuoteExcel(current)}>
              Excel
            </button>
            <button type="button" className={btn} onClick={onClose}>
              Close
            </button>
          </div>
        </header>
        {mode === "preview" ? (
          <iframe title="Quotation for Spares" srcDoc={html} className="w-full flex-1 border-0 bg-white" />
        ) : (
          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
            <p className="text-[12.5px] text-fg-3">These edits are for this document only. The parts and prices on the quotation page, and the quotation total, don&apos;t change.</p>
            <section className="flex flex-col divide-y divide-line rounded-lg border border-line">
              {headerFields.map((f) => (
                <label key={f.key} className="grid grid-cols-1 items-center gap-2 px-3 py-2 sm:grid-cols-[190px_minmax(0,1fr)]">
                  <span className="text-[12.5px] font-semibold text-fg">{f.label}</span>
                  <input className={cell} value={edits[f.key] ?? f.auto} onChange={(e) => change({ ...edits, [f.key]: e.target.value })} aria-label={f.label} />
                </label>
              ))}
            </section>
            {models.map((m) => (
              <section key={m.id} className="rounded-lg border border-line">
                <label className="grid grid-cols-1 items-center gap-2 border-b border-line bg-sunk px-3 py-2 sm:grid-cols-[190px_minmax(0,1fr)]">
                  <span className="text-[12.5px] font-semibold text-fg">Model</span>
                  <input className={`${cell} font-mono`} value={m.model} aria-label="Model" onChange={(e) => change({ ...edits, models: { ...edits.models, [m.id]: e.target.value } })} />
                </label>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[640px] text-[12.5px]">
                    <thead>
                      <tr className="border-b border-line text-left text-[11px] font-semibold tracking-[0.05em] text-fg-3 uppercase">
                        <th className="w-[90px] px-2 py-1.5">Part No.</th>
                        <th className="px-2 py-1.5">Description</th>
                        {sheet.quote.hasPo && <th className="w-[170px] px-2 py-1.5">Ref. PO No. / Date</th>}
                        <th className="w-[80px] px-2 py-1.5">Qty</th>
                        <th className="w-[110px] px-2 py-1.5">Unit cost</th>
                        <th className="w-[110px] px-2 py-1.5 text-right">Amount</th>
                        <th className="w-[76px]" aria-label="Remove" />
                      </tr>
                    </thead>
                    <tbody>
                      {m.lines.map((l) => (
                        <tr key={l.key} className={`border-b border-line last:border-b-0 ${l.removed ? "bg-sunk text-fg-4 line-through" : ""}`}>
                          {l.removed ? (
                            <td colSpan={sheet.quote.hasPo ? 6 : 5} className="px-2 py-1.5">
                              {[l.partNo, l.name].filter(Boolean).join(" · ")}
                            </td>
                          ) : (
                            <>
                              <td className="px-2 py-1"><input className={`${cell} font-mono`} value={l.partNo} aria-label="Part No." onChange={(e) => setLine(l.key, { partNo: e.target.value })} /></td>
                              <td className="px-2 py-1"><input className={cell} value={l.name} aria-label="Description" onChange={(e) => setLine(l.key, { name: e.target.value })} /></td>
                              {sheet.quote.hasPo && (
                                <td className="px-2 py-1"><input className={cell} value={l.po} aria-label="Reference PO No. / Date" onChange={(e) => setLine(l.key, { po: e.target.value })} /></td>
                              )}
                              <td className="px-2 py-1"><input className={`${cell} text-right font-mono`} value={l.qty} aria-label="Quantity" onChange={(e) => setLine(l.key, { qty: e.target.value })} /></td>
                              <td className="px-2 py-1"><input className={`${cell} text-right font-mono`} value={l.unit} aria-label="Unit cost" onChange={(e) => setLine(l.key, { unit: e.target.value })} /></td>
                              <td className="px-2 py-1 text-right font-mono">{formatInr(l.amount)}</td>
                            </>
                          )}
                          <td className="px-2 text-right">
                            <button type="button" className={`text-[11.5px] font-semibold no-underline ${l.removed ? "text-accent" : "text-neg"}`} onClick={() => toggleRemoved(l.key)}>
                              {l.removed ? "Restore" : "Remove"}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            ))}
            {termEditors(`Terms and conditions (${TERMS_MARKETS.find((m) => m.value === sheet.quote.termsMarket)?.label})`, docTerms.terms)}
            {termEditors(SPARE_WARRANTY_HEADING, docTerms.warranty)}
          </div>
        )}
      </div>
    </div>
  );
}

const PartsIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="12" cy="12" r="3" />
    <path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1" />
  </svg>
);
