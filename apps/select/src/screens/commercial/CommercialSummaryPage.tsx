"use client";

import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

import PageHeader from "../../components/ui/PageHeader";
import QuotationPanel from "./QuotationPanel";
import ClientPriceRefModal from "./ClientPriceRefModal";
import CommercialOfferModal from "./CommercialOfferModal";
import ScopeControls, { ScopeLines } from "./ScopeControls";
import { EMPTY_OFFER_CONFIG, isGearedGroup, type OfferConfig } from "../../lib/commercial-offer";
import { getCommercialOffer, saveCommercialOfferConfig } from "../../services/commercialOfferService";
import PumpQtyStep, { loadPumpQtyLists } from "./PumpQtyStep";
import {
  paBasisText,
  paInputsFor,
  paPrice,
  paSuggestion,
  type PaLevel,
  type PaPriceData,
} from "../../lib/pa-price";
import { getPaPriceList } from "../../services/paPriceService";
import {
  BOI_ITEMS,
  DEFAULT_MARKUP_PCT,
  MAX_DISCOUNT_PCT,
  MAX_MARKUP_PCT,
  boiNet,
  otherNet,
  parsePct,
  type BoiKey,
  type CommercialPrices,
  type CommercialReference,
  type CommercialSummary,
  type CommercialTag,
  MAX_OTHER_ITEMS,
  boiTotal,
  formatInr,
  parsePrice,
  rupees,
  subTotal,
  unitTotal,
  DRIVE_GROUP_LABEL,
  groupsIn,
  type DriveGroup,
  type VfdOption,
  type DrpOption,
} from "../../lib/commercial";
import { getCommercialSummary, saveCommercialPrices, saveCommercialRemarks } from "../../services/commercialService";

// Commercial Summary (pricing v1, manual). Every tag of one enquiry on one
// page: Pump & Accessories + BOI items typed in per unit, quantity pulled from
// step 1 (Pump & Qty, on this page), sub-total = unit price × qty, grand total
// = sum of sub-totals. The wizard's motor / gearbox pick is shown beside those
// rows as a reference the user can copy in — never applied on its own. The
// VFD row lists the BOI Master drives covering the motor kW (one per duty) to
// pick from, for every tag; the DRP row offers the BOI Master
// probe + panel for the tag's model (every tag).

type PriceKey = "paPrice" | BoiKey;

/** Form state keeps the raw text the user typed; parsed only for totals/save. */
type Draft = {
  paPrice: string;
  /** Picked BOI Master VFD ("" = none). */
  vfdModel: string;
  /** Used BOI Master DRP kit ("" = none). */
  drpModel: string;
  /** Used BOI Master mechanical seal ("" = none). */
  mechSealModel: string;
  /** Basis of a used L1–L4 P&A suggestion ("" = typed by hand). */
  paBasis: string;
  others: OtherDraft[];
  /** Per BOI row: vendor discount % and markup % as typed. */
  adjust: Record<BoiKey, PctDraft>;
  remarks: string;
} & Record<BoiKey, string>;

type PctDraft = { discountPct: string; markupPct: string };
type OtherDraft = { name: string; price: string } & PctDraft;

/** A saved % as text; markup falls back to the 25 % default, discount to "". */
const pctDraft = (discountPct: number | null | undefined, markupPct: number | null | undefined): PctDraft => ({
  discountPct: discountPct === null || discountPct === undefined || discountPct === 0 ? "" : String(discountPct),
  markupPct: markupPct === null || markupPct === undefined ? String(DEFAULT_MARKUP_PCT) : String(markupPct),
});
const newOther = (): OtherDraft => ({ name: "", price: "", ...pctDraft(null, null) });

const priceText = (n: number | null) => (n === null ? "" : String(rupees(n)));

const toDraft = (p: CommercialPrices): Draft => ({
  paPrice: priceText(p.paPrice),
  motorPrice: priceText(p.motorPrice),
  gearboxPrice: priceText(p.gearboxPrice),
  vfdPrice: priceText(p.vfdPrice),
  mechSealPrice: priceText(p.mechSealPrice),
  mechSealModel: p.mechSealModel ?? "",
  vfdModel: p.vfdModel ?? "",
  drpModel: p.drpModel ?? "",
  paBasis: p.paBasis ?? "",
  strainerPrice: priceText(p.strainerPrice),
  prvPrice: priceText(p.prvPrice),
  drpPrice: priceText(p.drpPrice),
  others: p.others.map((o) => ({ name: o.name, price: priceText(o.price), ...pctDraft(o.discountPct, o.markupPct) })),
  adjust: Object.fromEntries(
    BOI_ITEMS.map((it) => [it.key, pctDraft(p.adjust?.[it.key]?.discountPct, p.adjust?.[it.key]?.markupPct)]),
  ) as Record<BoiKey, PctDraft>,
  remarks: p.remarks,
});

/** Parsed prices for the live totals — an invalid entry counts as 0 here and
 *  is flagged on its field instead. */
const parseDraft = (d: Draft): CommercialPrices => {
  const val = (s: string) => parsePrice(s) ?? null;
  const pct = (s: string, max: number) => parsePct(s, max) ?? 0;
  const vfdPrice = val(d.vfdPrice);
  const drpPrice = val(d.drpPrice);
  return {
    paPrice: val(d.paPrice),
    motorPrice: val(d.motorPrice),
    gearboxPrice: val(d.gearboxPrice),
    vfdPrice,
    mechSealPrice: val(d.mechSealPrice),
    mechSealModel: val(d.mechSealPrice) !== null && d.mechSealModel ? d.mechSealModel : null,
    // A picked model only means something alongside a VFD price (the API
    // applies the same rule).
    vfdModel: vfdPrice !== null && d.vfdModel ? d.vfdModel : null,
    drpModel: drpPrice !== null && d.drpModel ? d.drpModel : null,
    paBasis: val(d.paPrice) !== null && d.paBasis ? d.paBasis : null,
    strainerPrice: val(d.strainerPrice),
    prvPrice: val(d.prvPrice),
    drpPrice,
    others: d.others.map((o) => ({
      name: o.name.trim(),
      price: val(o.price),
      discountPct: pct(o.discountPct, MAX_DISCOUNT_PCT),
      markupPct: pct(o.markupPct, MAX_MARKUP_PCT),
    })),
    // Blank = 0 (the page pre-fills the 25 % markup).
    adjust: Object.fromEntries(
      BOI_ITEMS.map((it) => [
        it.key,
        { discountPct: pct(d.adjust[it.key].discountPct, MAX_DISCOUNT_PCT), markupPct: pct(d.adjust[it.key].markupPct, MAX_MARKUP_PCT) },
      ]),
    ),
    remarks: d.remarks.trim(),
  };
};

const PCT_ERROR = "Discount 0–99 %, markup 0–999 %.";
const badPct = (p: PctDraft) =>
  parsePct(p.discountPct, MAX_DISCOUNT_PCT) === undefined || parsePct(p.markupPct, MAX_MARKUP_PCT) === undefined;

/** Field-level problems that would make the save fail. */
const draftErrors = (d: Draft): Record<string, string> => {
  const errs: Record<string, string> = {};
  const bad = (s: string) => parsePrice(s) === undefined;
  (["paPrice", ...BOI_ITEMS.map((b) => b.key)] as PriceKey[]).forEach((k) => {
    if (bad(d[k])) errs[k] = "Enter a valid amount.";
  });
  d.others.forEach((o, i) => {
    if (bad(o.price)) errs[`other-${i}`] = "Enter a valid amount.";
    else if (!o.name.trim() && o.price.trim()) errs[`other-${i}`] = "Name this item.";
    if (badPct(o)) errs[`other-${i}-pct`] = PCT_ERROR;
  });
  BOI_ITEMS.forEach((it) => {
    if (badPct(d.adjust[it.key])) errs[`${it.key}-pct`] = PCT_ERROR;
  });
  return errs;
};

const sameDraft = (a: Draft, b: Draft) => JSON.stringify(a) === JSON.stringify(b);

const inputCls =
  "w-full rounded-lg border border-line bg-paper px-3 py-2 text-[13px] text-fg outline-none transition placeholder:text-fg-4 focus:border-accent focus:ring-2 focus:ring-accent-soft";
const moneyCls = `${inputCls} text-right font-mono`;
const btnSm =
  "inline-flex items-center gap-1.5 rounded-lg border border-line bg-paper px-3 py-1.5 text-[12.5px] font-semibold whitespace-nowrap text-fg-2 transition-colors hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-50";
const btnPrimarySm =
  "inline-flex items-center gap-1.5 rounded-lg bg-accent px-3.5 py-1.5 text-[12.5px] font-semibold whitespace-nowrap text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50";

export default function CommercialSummaryPage() {
  const projectId = useSearchParams().get("projectId") ?? "";
  const [data, setData] = useState<CommercialSummary | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Saved (server) and working copies per tag.
  const [saved, setSaved] = useState<Record<string, Draft>>({});
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [saveError, setSaveError] = useState<Record<string, string>>({});
  const [showErrors, setShowErrors] = useState<Record<string, boolean>>({});
  const [justSaved, setJustSaved] = useState<Record<string, boolean>>({});
  // Tag cards folded to their one-line summary (per tag; Collapse/Expand all).
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const toggleTag = (id: string) =>
    setCollapsed((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  // Bumped after each price save so the quotation's live version refreshes.
  const [pricesVersion, setPricesVersion] = useState(0);
  // "Client Price Ref" viewer (the client's old price sheets on SharePoint).
  const [showPriceRef, setShowPriceRef] = useState(false);
  // L1–L4 P&A price lists for the P&A suggestion (null while loading).
  const [paData, setPaData] = useState<PaPriceData | "error" | null>(null);
  useEffect(() => {
    // Start the Pump & Qty lists now rather than after the summary arrives.
    loadPumpQtyLists().catch(() => {});
    let cancelled = false;
    getPaPriceList()
      .then((d) => !cancelled && setPaData(d))
      .catch(() => !cancelled && setPaData("error"));
    return () => {
      cancelled = true;
    };
  }, []);
  // Two steps: 1 Pump & Qty (product code + quantity per tag), 2 Summary.
  // Opens on Pump & Qty while any tag still lacks either.
  const [stage, setStage] = useState<"pump" | "summary" | null>(null);

  const load = useCallback(async () => {
    if (!projectId) {
      setLoadError("No enquiry selected. Open the Commercial Summary from the Enquiries page.");
      return;
    }
    setLoadError(null);
    try {
      const res = await getCommercialSummary(projectId);
      const d = Object.fromEntries(res.tags.map((t) => [t.tagId, toDraft(t.prices)]));
      setData(res);
      setSaved(d);
      setDrafts(d);
      setStage((s) => s ?? (res.tags.some((t) => !t.productCode || t.quantity === null) ? "pump" : "summary"));
    } catch (e) {
      const status = (e as { response?: { status?: number } })?.response?.status;
      setLoadError(status === 404 ? "This enquiry no longer exists." : "Couldn't load the Commercial Summary. Try again.");
    }
  }, [projectId]);

  useEffect(() => {
    load();
  }, [load]);

  const dirtyIds = useMemo(
    () => Object.keys(drafts).filter((id) => saved[id] && !sameDraft(drafts[id], saved[id])),
    [drafts, saved],
  );

  // Warn before leaving with unsaved prices.
  useEffect(() => {
    if (dirtyIds.length === 0) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirtyIds.length]);

  const updateDraft = (tagId: string, patch: Partial<Draft>) => {
    setDrafts((m) => ({ ...m, [tagId]: { ...m[tagId], ...patch } }));
    setJustSaved((m) => ({ ...m, [tagId]: false }));
  };

  const saveTag = async (tagId: string): Promise<boolean> => {
    const draft = drafts[tagId];
    if (Object.keys(draftErrors(draft)).length > 0) {
      setShowErrors((m) => ({ ...m, [tagId]: true }));
      return false;
    }
    setSaving((m) => ({ ...m, [tagId]: true }));
    setSaveError((m) => ({ ...m, [tagId]: "" }));
    try {
      const prices = parseDraft(draft);
      // Drop rows the user added but never filled.
      prices.others = prices.others.filter((o) => o.name || o.price !== null);
      await saveCommercialPrices(tagId, prices);
      const clean = toDraft(prices);
      setSaved((m) => ({ ...m, [tagId]: clean }));
      setDrafts((m) => ({ ...m, [tagId]: clean }));
      setShowErrors((m) => ({ ...m, [tagId]: false }));
      setJustSaved((m) => ({ ...m, [tagId]: true }));
      setPricesVersion((n) => n + 1);
      return true;
    } catch (e) {
      const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setSaveError((m) => ({ ...m, [tagId]: msg || "Couldn't save. Try again." }));
      return false;
    } finally {
      setSaving((m) => ({ ...m, [tagId]: false }));
    }
  };

  const saveAll = async () => {
    for (const id of dirtyIds) await saveTag(id);
  };

  const rows = useMemo(
    () =>
      (data?.tags ?? []).map((t) => {
        const p = drafts[t.tagId] ? parseDraft(drafts[t.tagId]) : t.prices;
        return { tag: t, prices: p, unit: unitTotal(p), sub: subTotal(p, t.quantity) };
      }),
    [data, drafts],
  );
  // Quoted per drive system: one tab (quotation, summary, grand total) per
  // group, plus one for tags whose drive isn't chosen yet.
  const groups = groupsIn(rows.map((r) => r.tag.driveGroup));
  const hasNoDrive = rows.some((r) => r.tag.driveGroup === null);
  const tabs: (DriveGroup | "NONE")[] = [...groups, ...(hasNoDrive ? (["NONE"] as const) : [])];
  const mixed = groups.length > 1;
  const [activeTab, setActiveTab] = useState<DriveGroup | "NONE" | null>(null);
  const tab = activeTab && tabs.includes(activeTab) ? activeTab : (tabs[0] ?? null);
  const groupRows = rows.filter((r) => (r.tag.driveGroup ?? "NONE") === tab);
  const groupDirty = groupRows.some((r) => dirtyIds.includes(r.tag.tagId));
  const tabLabel = (t: DriveGroup | "NONE") => (t === "NONE" ? "No drive yet" : DRIVE_GROUP_LABEL[t]);
  const grand = groupRows.reduce((s, r) => s + r.sub, 0);
  const missingQty = groupRows.filter((r) => r.tag.quantity === null).length;

  const project = data?.project;
  // Commercial Offer sheet of the open drive group — from the SAVED prices.
  const [showOffer, setShowOffer] = useState(false);
  // Each group's Commercial Offer edits — the page sets its scope lists; the
  // modal edits the rest. Re-read after the modal closes so the two never
  // overwrite each other with a stale copy.
  const [offerConfigs, setOfferConfigs] = useState<Record<string, OfferConfig> | null>(null);
  const [scopeSave, setScopeSave] = useState<"" | "saving" | "saved" | "error">("");
  const loadOfferConfigs = useCallback(() => {
    if (!projectId) return;
    getCommercialOffer(projectId)
      .then((d) => setOfferConfigs(d.configs))
      .catch(() => setOfferConfigs((c) => c ?? {}));
  }, [projectId]);
  useEffect(() => {
    loadOfferConfigs();
  }, [loadOfferConfigs]);
  const saveScope = (group: DriveGroup, next: OfferConfig) => {
    setOfferConfigs((m) => ({ ...(m ?? {}), [group]: next }));
    setScopeSave("saving");
    saveCommercialOfferConfig(projectId, group, next)
      .then(() => setScopeSave("saved"))
      .catch(() => setScopeSave("error"));
  };
  // `saved` holds each tag's last-saved prices (data.tags is only the first
  // load), so a Save shows up in the sheet straight away.
  const offerTags = useMemo(
    () =>
      (data?.tags ?? [])
        .filter((t) => (t.driveGroup ?? "NONE") === tab)
        .map((t) => {
          const prices = saved[t.tagId] ? parseDraft(saved[t.tagId]) : t.prices;
          return {
            tagId: t.tagId,
            tagName: t.tagName,
            tech: t.tech,
            pumpModel: t.productCode ?? t.model,
            prices,
            quantity: t.quantity,
            unit: unitTotal(prices),
            sub: subTotal(prices, t.quantity),
          };
        }),
    [data, saved, tab],
  );

  return (
    <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-5 px-4 py-5 sm:px-6">
      <PageHeader
        icon={<RupeeIcon />}
        title="Commercial Summary"
        subtitle={
          project
            ? [project.code, project.name, project.customerName].filter(Boolean).join(" · ")
            : "Pump & Accessories and BOI prices for every tag of the enquiry"
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {dirtyIds.length > 0 && (
              <span className="text-[12.5px] font-medium text-warn">
                {dirtyIds.length} tag{dirtyIds.length === 1 ? "" : "s"} with unsaved changes
              </span>
            )}
            <button
              type="button"
              className={btnPrimarySm}
              onClick={saveAll}
              disabled={dirtyIds.length === 0 || dirtyIds.some((id) => saving[id])}
            >
              Save all
            </button>
            <button
              type="button"
              className={btnSm}
              onClick={() => setShowPriceRef(true)}
              disabled={!data}
              title="View this client's past price reference sheets (SharePoint)"
            >
              Client Price Ref
            </button>
            <button
              type="button"
              className={btnSm}
              onClick={() => setShowOffer(true)}
              disabled={!data || !tab || tab === "NONE"}
              title={
                mixed && tab && tab !== "NONE"
                  ? `Commercial Offer sheet for ${tabLabel(tab)} (the open drive-system tab)`
                  : "Preview, edit, print or download the Commercial Offer sheet"
              }
            >
              Commercial Offer
            </button>
            <Link href="/projects" className={btnSm}>
              Back to Enquiries
            </Link>
          </div>
        }
      />

      {loadError && (
        <div className="rounded-xl border border-line bg-paper p-5 text-[13.5px] text-neg">
          {loadError}{" "}
          {projectId && (
            <button type="button" className="font-semibold text-accent underline" onClick={load}>
              Retry
            </button>
          )}
        </div>
      )}

      {!data && !loadError && (
        <div className="rounded-xl border border-line bg-paper p-8 text-center text-[13.5px] text-fg-3">
          Loading Commercial Summary…
        </div>
      )}

      {data && data.tags.length === 0 && (
        <div className="rounded-xl border border-line bg-paper p-8 text-center text-[13.5px] text-fg-3">
          This enquiry has no tags yet.
        </div>
      )}

      {data && data.tags.length > 0 && (
        <nav className="flex flex-wrap items-center gap-2" aria-label="Commercial steps">
          {(
            [
              ["pump", "1", "Pump & Qty"],
              ["summary", "2", "Summary"],
            ] as const
          ).map(([key, n, label], i) => {
            const incomplete = key === "pump" ? data.tags.filter((t) => !t.productCode || t.quantity === null).length : 0;
            return (
              <div key={key} className="flex items-center gap-2">
                {i > 0 && <span className="text-fg-4">→</span>}
                <button
                  type="button"
                  onClick={() => setStage(key)}
                  aria-current={stage === key ? "step" : undefined}
                  className={`inline-flex items-center gap-2 rounded-lg border px-3.5 py-2 text-[13px] font-semibold transition-colors ${
                    stage === key ? "border-accent bg-accent text-white" : "border-line bg-paper text-fg-2 hover:border-accent"
                  }`}
                >
                  <span
                    className={`flex h-5 w-5 items-center justify-center rounded-full text-[11px] ${
                      stage === key ? "bg-white/25" : "bg-sunk"
                    }`}
                  >
                    {n}
                  </span>
                  {label}
                  {incomplete > 0 && (
                    <span
                      className={`rounded-full px-1.5 text-[11px] ${stage === key ? "bg-white/25" : "bg-[var(--warn-soft)] text-warn"}`}
                      title={`${incomplete} tag${incomplete === 1 ? "" : "s"} without a product code or quantity`}
                    >
                      {incomplete}
                    </span>
                  )}
                </button>
              </div>
            );
          })}
        </nav>
      )}

      {data && data.tags.length > 0 && stage === "pump" && (
        <PumpQtyStep
          projectId={projectId}
          projectCode={data.project.code}
          projectName={data.project.name}
          tags={data.tags}
          onSaved={(tagId, productCode, quantity, codeParts) => {
            setData((d) =>
              d
                ? { ...d, tags: d.tags.map((t) => (t.tagId === tagId ? { ...t, productCode, quantity, codeParts } : t)) }
                : d,
            );
            // The quotation's live version prices the new quantity.
            setPricesVersion((n) => n + 1);
          }}
          onNext={() => setStage("summary")}
        />
      )}

      {data && data.tags.length > 0 && stage === "summary" && (
        <>
          {tabs.length > 1 && (
            <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Drive system">
              {tabs.map((t) => {
                const n = rows.filter((r) => (r.tag.driveGroup ?? "NONE") === t).length;
                return (
                  <button
                    key={t}
                    type="button"
                    role="tab"
                    aria-selected={t === tab}
                    onClick={() => setActiveTab(t)}
                    className={`rounded-lg border px-3.5 py-2 text-[13px] font-semibold transition-colors ${
                      t === tab ? "border-accent bg-accent-soft text-accent" : "border-line bg-paper text-fg-2 hover:border-accent"
                    }`}
                  >
                    {tabLabel(t)}
                    {t !== "NONE" && mixed && <span className="ml-1.5 font-mono text-[11.5px] opacity-75">/{t}</span>}
                    <span className="ml-1.5 text-[12px] font-normal opacity-75">· {n} tag{n === 1 ? "" : "s"}</span>
                  </button>
                );
              })}
            </div>
          )}

          {tab === "NONE" ? (
            <div className="rounded-xl border border-line bg-paper p-4 text-[13px] text-fg-2">
              These tags have no drive system yet, so they can&apos;t be quoted. Choose the drive on the tag&apos;s Drive step —
              the tag then moves to its drive group&apos;s quotation.
            </div>
          ) : (
            tab && (
              <QuotationPanel
                key={tab}
                projectId={projectId}
                group={tab}
                groupLabel={mixed ? tabLabel(tab) : undefined}
                hasUnsavedPrices={groupDirty}
                pricesVersion={pricesVersion}
              />
            )
          )}

          {tab && tab !== "NONE" && (
            <section className="rounded-xl border border-line bg-paper">
              <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
                <h2 className="text-[14px] font-semibold text-fg">
                  Scope of Supply{mixed ? ` — ${tabLabel(tab)}` : ""}
                </h2>
                <span className="text-[12px] text-fg-3">
                  {scopeSave === "saving"
                    ? "Saving…"
                    : scopeSave === "saved"
                      ? "Saved — shown on the Commercial Offer"
                      : scopeSave === "error"
                        ? "Couldn't save — try again"
                        : "Printed on the Commercial Offer"}
                </span>
              </header>
              <div className="flex flex-col gap-3 p-4">
                {offerConfigs === null ? (
                  <p className="text-[12.5px] text-fg-3">Loading…</p>
                ) : (
                  <>
                    <ScopeControls
                      config={offerConfigs[tab] ?? EMPTY_OFFER_CONFIG}
                      group={tab}
                      onChange={(next) => saveScope(tab, next)}
                    />
                    <ScopeLines config={offerConfigs[tab] ?? EMPTY_OFFER_CONFIG} group={tab} />
                  </>
                )}
              </div>
            </section>
          )}

          {/* Summary across all tags */}
          <section className="rounded-xl border border-line bg-paper">
            <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
              <h2 className="text-[14px] font-semibold text-fg">
                Summary{mixed && tab && tab !== "NONE" ? ` — ${tabLabel(tab)}` : ""}
              </h2>
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-[12px] text-fg-3">All prices in INR, per unit unless marked</span>
                {tab && tab !== "NONE" && (
                  <button
                    type="button"
                    className={btnSm}
                    onClick={() => setShowOffer(true)}
                    title="Preview, edit, print or download this drive group's Commercial Offer sheet"
                  >
                    Commercial Offer
                  </button>
                )}
              </div>
            </header>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-[13px]">
                <thead>
                  <tr className="border-b border-line text-left text-[11.5px] font-semibold tracking-[0.06em] text-fg-3 uppercase">
                    <th className="px-4 py-2.5">Tag</th>
                    <th className="px-4 py-2.5">Pump Model</th>
                    <th className="px-4 py-2.5 text-right">P&amp;A</th>
                    <th className="px-4 py-2.5 text-right">BOI Items</th>
                    <th className="px-4 py-2.5 text-right">Unit Price</th>
                    <th className="px-4 py-2.5 text-right">Qty</th>
                    <th className="px-4 py-2.5 text-right">Sub-total</th>
                  </tr>
                </thead>
                <tbody>
                  {groupRows.map(({ tag, prices, unit, sub }) => (
                    <tr key={tag.tagId} className="border-b border-line last:border-b-0">
                      <td className="px-4 py-2.5">
                        <a href={`#tag-${tag.tagId}`} className="font-semibold text-accent hover:underline">
                          {tag.tagName}
                        </a>
                        {dirtyIds.includes(tag.tagId) && (
                          <span className="ml-2 text-[11px] font-medium text-warn">unsaved</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-fg-2">
                        {tag.productCode ?? tag.model ?? "—"}
                        {tag.productCode && tag.model && (
                          <span className="block text-[11.5px] text-fg-3">{tag.model}</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono">{formatInr(prices.paPrice)}</td>
                      <td className="px-4 py-2.5 text-right font-mono">{formatInr(boiTotal(prices))}</td>
                      <td className="px-4 py-2.5 text-right font-mono">{formatInr(unit)}</td>
                      <td className="px-4 py-2.5 text-right font-mono">
                        {tag.quantity ?? <span className="text-neg">not set</span>}
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono font-semibold text-fg">{formatInr(sub)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  {/* Column sums: P&A, BOI and unit price as listed (per unit), qty, sub-total. */}
                  <tr className="border-t-2 border-line-strong bg-sunk">
                    <td colSpan={2} className="px-4 py-3 text-[13px] font-semibold text-fg">
                      Grand Total
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-[13px] font-semibold text-fg">
                      {formatInr(groupRows.reduce((s, r) => s + (r.prices.paPrice ?? 0), 0))}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-[13px] font-semibold text-fg">
                      {formatInr(groupRows.reduce((s, r) => s + boiTotal(r.prices), 0))}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-[13px] font-semibold text-fg">
                      {formatInr(groupRows.reduce((s, r) => s + r.unit, 0))}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-[13px] font-semibold text-fg">
                      {groupRows.reduce((s, r) => s + (r.tag.quantity ?? 0), 0)}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-[15px] font-bold text-fg">{formatInr(grand)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
            {missingQty > 0 && (
              <p className="border-t border-line px-4 py-2.5 text-[12px] text-neg">
                {missingQty} tag{missingQty === 1 ? " has" : "s have"} no quantity, so{" "}
                {missingQty === 1 ? "it counts" : "they count"} as 0. Set Quantity on the Pump &amp; Qty step (step 1 above)
                step.
              </p>
            )}
          </section>

          {groupRows.length > 1 && (
            <div className="flex justify-end gap-2">
              <button
                type="button"
                className={btnSm}
                onClick={() => setCollapsed((cur) => new Set([...cur, ...groupRows.map((r) => r.tag.tagId)]))}
              >
                Collapse all
              </button>
              <button
                type="button"
                className={btnSm}
                onClick={() =>
                  setCollapsed((cur) => new Set([...cur].filter((id) => !groupRows.some((r) => r.tag.tagId === id))))
                }
              >
                Expand all
              </button>
            </div>
          )}

          {groupRows.map(({ tag, prices, unit, sub }) => (
            <TagCard
              key={tag.tagId}
              tag={tag}
              collapsed={collapsed.has(tag.tagId)}
              onToggle={() => toggleTag(tag.tagId)}
              paData={paData}
              draft={drafts[tag.tagId]}
              prices={prices}
              unit={unit}
              sub={sub}
              dirty={dirtyIds.includes(tag.tagId)}
              saving={!!saving[tag.tagId]}
              justSaved={!!justSaved[tag.tagId]}
              error={saveError[tag.tagId] ?? ""}
              errors={showErrors[tag.tagId] ? draftErrors(drafts[tag.tagId]) : {}}
              onChange={(patch) => updateDraft(tag.tagId, patch)}
              onSave={() => saveTag(tag.tagId)}
              onReset={() => {
                setDrafts((m) => ({ ...m, [tag.tagId]: saved[tag.tagId] }));
                setShowErrors((m) => ({ ...m, [tag.tagId]: false }));
              }}
            />
          ))}

          {/* One remarks note for the whole enquiry — last on the page. */}
          <RemarksCard
            projectId={projectId}
            saved={data.project.remarks}
            onSaved={(remarks) => {
              setData((d) => (d ? { ...d, project: { ...d.project, remarks } } : d));
              // The quotation's live version carries the remarks.
              setPricesVersion((n) => n + 1);
            }}
          />
        </>
      )}
      {showOffer && tab && tab !== "NONE" && (
        <CommercialOfferModal
          projectId={projectId}
          group={tab}
          tags={offerTags}
          unsavedPrices={groupDirty}
          onClose={() => {
            setShowOffer(false);
            loadOfferConfigs();
          }}
        />
      )}
      {showPriceRef && data && (
        <ClientPriceRefModal
          clientCode={data.project.clientCode}
          clientName={data.project.name}
          onClose={() => setShowPriceRef(false)}
        />
      )}
    </div>
  );
}

function TagCard({
  tag,
  collapsed,
  onToggle,
  paData,
  draft,
  prices,
  unit,
  sub,
  dirty,
  saving,
  justSaved,
  error,
  errors,
  onChange,
  onSave,
  onReset,
}: {
  tag: CommercialTag;
  /** Folded to the header's one-line summary. */
  collapsed: boolean;
  onToggle: () => void;
  paData: PaPriceData | "error" | null;
  draft: Draft;
  prices: CommercialPrices;
  unit: number;
  sub: number;
  dirty: boolean;
  saving: boolean;
  justSaved: boolean;
  error: string;
  errors: Record<string, string>;
  onChange: (patch: Partial<Draft>) => void;
  onSave: () => void;
  onReset: () => void;
}) {
  const refs: Partial<Record<BoiKey, CommercialReference | null>> = {
    motorPrice: tag.motorRef,
    gearboxPrice: tag.gearboxRef,
  };
  const setOther = (i: number, patch: Partial<OtherDraft>) =>
    onChange({ others: draft.others.map((o, j) => (j === i ? { ...o, ...patch } : o)) });
  // Mechanical seal row opened by "Price anyway" on a non-mechanical sealing.
  const [sealOpen, setSealOpen] = useState(false);

  /** A fixed BOI line's reference (wizard pick / BOI Master suggestion), the
   *  master price it's checked against, and a sub-label under the item name. */
  const boiReference = (key: BoiKey): { node: ReactNode; master: number | null; sub?: string } => {
    switch (key) {
      case "motorPrice":
      case "gearboxPrice": {
        const ref = refs[key];
        if (!ref) return { master: null, node: <span className="text-fg-3">Not selected in the wizard</span> };
        const price = ref.price;
        const active = price !== null && draft[key] === priceText(price);
        return {
          master: price,
          node: (
            <RefLine text={ref.label} warn={ref.confirmed ? undefined : "not confirmed"}>
              {price !== null && (
                <UseChip
                  price={price}
                  active={active}
                  onClick={() => onChange({ [key]: active ? "" : priceText(price) } as Partial<Draft>)}
                  title="Copy the master price from the wizard into this field"
                />
              )}
            </RefLine>
          ),
        };
      }
      case "vfdPrice": {
        const picked = tag.vfdOptions.find((o) => o.driveDescription === draft.vfdModel);
        return {
          master: picked?.netPrice ?? null,
          sub: tag.motorKw !== null ? `Motor ${tag.motorKw} kW${tag.vfdRequired ? " · required" : ""}` : undefined,
          node: (
            <VfdOptions
              tag={tag}
              picked={draft.vfdModel}
              onPick={(o) => onChange({ vfdModel: o.driveDescription, vfdPrice: priceText(o.netPrice) })}
              onClear={() => onChange({ vfdModel: "", vfdPrice: "" })}
            />
          ),
        };
      }
      case "mechSealPrice": {
        const o = tag.mechSealOption;
        const clear = () => onChange({ mechSealModel: "", mechSealPrice: "" });
        const active = !!o && draft.mechSealModel === o.label;
        const stale = draft.mechSealModel && !active && <UsedLine value={draft.mechSealModel} onClear={clear} />;
        if (!o)
          return {
            master: null,
            node: (
              <div className="flex flex-col items-start gap-1">
                {stale}
                <span className="text-warn">{tag.mechSealNote}</span>
              </div>
            ),
          };
        return {
          master: o.price,
          node: (
            <RefLine text={`${o.drawingNo} · ${o.material} · ${o.shaftSizeMm} mm shaft`}>
              <UseChip
                price={o.price}
                active={active}
                onClick={() => (active ? clear() : onChange({ mechSealModel: o.label, mechSealPrice: priceText(o.price) }))}
                title="Copy the BOI Master price into this line's base price"
              />
              {stale}
            </RefLine>
          ),
        };
      }
      case "drpPrice": {
        const o = tag.drpOption;
        const clear = () => onChange({ drpModel: "", drpPrice: "" });
        const active = !!o && draft.drpModel === o.label;
        const stale = draft.drpModel && !active && <UsedLine value={draft.drpModel} onClear={clear} />;
        if (!o)
          return {
            master: null,
            node: (
              <div className="flex flex-col items-start gap-1">
                {stale}
                <span className="text-warn">{tag.drpNote}</span>
              </div>
            ),
          };
        return {
          master: o.total,
          node: (
            <RefLine
              text={
                <>
                  {tag.model} · shaft {o.shaftDia} mm → probe {o.probeSizeMm} mm {formatInr(o.probeRate)}
                  {o.panelRate !== null && <> + panel {formatInr(o.panelRate)}</>}
                </>
              }
              warn={tag.modelConfirmed ? undefined : "model not confirmed"}
            >
              <UseChip
                price={o.total}
                active={active}
                onClick={() => (active ? clear() : onChange({ drpModel: o.label, drpPrice: priceText(o.total) }))}
                title="Copy the BOI Master DRP price (probe + panel) into this field"
              />
              {stale}
            </RefLine>
          ),
        };
      }
      default:
        return { master: null, node: <span className="text-fg-3">Manual entry</span> };
    }
  };

  return (
    <section id={`tag-${tag.tagId}`} className="scroll-mt-4 rounded-xl border border-line bg-paper">
      <header
        className={`flex flex-wrap items-center justify-between gap-3 px-4 py-3 ${collapsed ? "" : "border-b border-line"}`}
      >
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={!collapsed}
          className="flex min-w-0 flex-1 items-start gap-2.5 text-left"
          title={collapsed ? "Expand this tag" : "Collapse this tag"}
        >
          <span className="mt-0.5 shrink-0 text-[13px] text-fg-3" aria-hidden="true">
            {collapsed ? "▸" : "▾"}
          </span>
          <span className="min-w-0">
            <span className="block text-[15px] font-semibold text-fg">
              {tag.tagName}
              <span className="ml-2 text-[13px] font-normal text-fg-3">{tag.model ?? "No pump selected"}</span>
            </span>
            {collapsed ? (
              <span className="mt-0.5 block text-[12px] text-fg-3">
                {tag.productCode ?? "No product code"} · Unit <b className="font-mono text-fg-2">{formatInr(unit)}</b> ·{" "}
                {tag.quantity === null ? <span className="text-warn">qty not set</span> : `× ${tag.quantity}`} · Sub-total{" "}
                <b className="font-mono text-fg">{formatInr(sub)}</b>
              </span>
            ) : (
              <span className="mt-0.5 block text-[12px] text-fg-3">
                {[tag.media, tag.driveSystem, tag.status].filter(Boolean).join(" · ")}
                {tag.model && !tag.modelConfirmed && <span className="ml-1 text-warn">· model not confirmed</span>}
              </span>
            )}
          </span>
        </button>
        <div className="flex items-center gap-2">
          {dirty && collapsed && <span className="text-[12px] font-medium text-warn">Unsaved changes</span>}
          {justSaved && !dirty && <span className="text-[12px] font-medium text-pos">Saved</span>}
          {dirty && (
            <button type="button" className={btnSm} onClick={onReset} disabled={saving}>
              Discard
            </button>
          )}
          <button type="button" className={btnPrimarySm} onClick={onSave} disabled={!dirty || saving}>
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </header>

      <div className={`grid grid-cols-1 gap-5 p-4 lg:grid-cols-[1fr_280px] ${collapsed ? "hidden" : ""}`}>
        <div className="flex min-w-0 flex-col gap-4">
          {/* Pump & Accessories */}
          <div>
            <h3 className="mb-2 text-[11.5px] font-semibold tracking-[0.09em] text-fg-3 uppercase">
              Pump &amp; Accessories
            </h3>
            <div className="grid grid-cols-1 items-start gap-2 sm:grid-cols-[1fr_200px]">
              <p className="pt-2 text-[13px] text-fg-2">
                {tag.productCode ?? tag.model ?? "Pump"} with accessories
                {!tag.productCode && (
                  <span className="block text-[11.5px] text-warn">Product code not picked on the Pump &amp; Qty step</span>
                )}
              </p>
              <MoneyInput
                value={draft.paPrice}
                error={errors.paPrice}
                onChange={(v) => onChange({ paPrice: v })}
                label="Pump & Accessories price per unit"
                strong
              />
            </div>
            <PaSuggestionPanel
              tag={tag}
              data={paData}
              used={draft.paBasis}
              onUse={(price, basis) => onChange({ paPrice: priceText(price), paBasis: basis })}
              onClear={() => onChange({ paBasis: "", paPrice: "" })}
            />
          </div>

          {/* BOI items — one line per item: the wizard / BOI Master suggestion,
              base price, disc %, markup % and the quoted price. The left edge
              shows the line's state (priced / differs from master / not priced). */}
          <div>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-[11.5px] font-semibold tracking-[0.09em] text-fg-3 uppercase">BOI Items (bought-out)</h3>
              <span className="hidden items-center gap-3.5 text-[11.5px] font-medium text-fg-3 sm:flex">
                {(["ok", "diff", "empty"] as const).map((s) => (
                  <span key={s} className="inline-flex items-center gap-1.5">
                    <i className={`inline-block h-2 w-2 rounded-full ${BOI_DOT[s]}`} />
                    {BOI_STATE_LABEL[s]}
                  </span>
                ))}
              </span>
            </div>
            <div className="overflow-hidden rounded-lg border border-line">
              <div
                className={`hidden border-b border-line bg-sunk py-2 pr-3 pl-[15px] text-[11px] font-semibold tracking-[0.04em] text-fg-3 uppercase sm:grid sm:gap-x-2.5 ${BOI_GRID}`}
              >
                <span>Item</span>
                <span>Reference / suggestion</span>
                <span>Base price</span>
                <span className="text-right">Disc %</span>
                <span className="text-right">Markup %</span>
                <span className="text-right">Price</span>
              </div>

              {BOI_ITEMS.map((item) => {
                const key = item.key;
                // Mechanical seal on a non-mechanical sealing: one muted line
                // until "Price anyway" (or a price is already there).
                const sealing = tag.codeHints.sealingType;
                if (
                  key === "mechSealPrice" &&
                  sealing &&
                  sealing !== "Mechanical Seal" &&
                  !draft.mechSealPrice &&
                  !draft.mechSealModel &&
                  !sealOpen
                ) {
                  return (
                    <div
                      key={key}
                      className={`grid grid-cols-1 gap-1 border-b border-l-[3px] border-line border-l-[color:var(--fg-4)] bg-sunk px-3 py-2 text-fg-4 sm:items-center sm:gap-x-2.5 ${BOI_GRID}`}
                    >
                      <span className="text-[13px] font-semibold">{item.label}</span>
                      <span className="text-[12px] sm:col-span-4">
                        <span className="mr-2 rounded bg-paper px-1.5 py-px text-[11px] font-semibold text-fg-3">N/A</span>
                        {tag.mechSealNote ?? `${sealing} — no mechanical seal`}
                        <button
                          type="button"
                          className="ml-2 text-[12px] font-semibold text-accent hover:underline"
                          onClick={() => setSealOpen(true)}
                        >
                          Price anyway
                        </button>
                      </span>
                      <span className="hidden text-right sm:block">—</span>
                    </div>
                  );
                }
                const r = boiReference(key);
                return (
                  <BoiRow
                    key={key}
                    label={item.label}
                    sub={r.sub}
                    state={boiState(draft[key], r.master)}
                    reference={r.node}
                    base={draft[key]}
                    master={r.master}
                    pct={draft.adjust[key]}
                    net={boiNet(prices, key)}
                    error={errors[key] || errors[`${key}-pct`]}
                    onBase={(v) => onChange({ [key]: v } as Partial<Draft>)}
                    onPct={(patch) => onChange({ adjust: { ...draft.adjust, [key]: { ...draft.adjust[key], ...patch } } })}
                  />
                );
              })}

              {draft.others.map((o, i) => (
                <BoiRow
                  key={`other-${i}`}
                  label="Other"
                  state={boiState(o.price, null)}
                  reference={
                    <div className="flex items-center gap-2">
                      <input
                        className={`${inputCls} py-1.5`}
                        placeholder="Item name, e.g. Coupling guard"
                        value={o.name}
                        maxLength={100}
                        onChange={(e) => setOther(i, { name: e.target.value })}
                        aria-label="Other item name"
                      />
                      <button
                        type="button"
                        className="shrink-0 rounded-md px-2 py-1.5 text-[12px] font-semibold text-neg hover:bg-[var(--neg-soft)]"
                        onClick={() => onChange({ others: draft.others.filter((_, j) => j !== i) })}
                        aria-label="Remove this item"
                      >
                        Remove
                      </button>
                    </div>
                  }
                  base={o.price}
                  master={null}
                  pct={o}
                  net={prices.others[i] ? otherNet(prices, prices.others[i]) : null}
                  error={errors[`other-${i}`] || errors[`other-${i}-pct`]}
                  onBase={(v) => setOther(i, { price: v })}
                  onPct={(patch) => setOther(i, patch)}
                />
              ))}

              <div className="border-l-[3px] border-l-transparent px-3 py-2">
                <button
                  type="button"
                  className="text-[12.5px] font-semibold text-accent hover:underline disabled:cursor-not-allowed disabled:text-fg-4 disabled:no-underline"
                  onClick={() => onChange({ others: [...draft.others, newOther()] })}
                  disabled={draft.others.length >= MAX_OTHER_ITEMS}
                >
                  + Add other item
                </button>
              </div>
            </div>
          </div>

          {error && <p className="text-[12.5px] text-neg">{error}</p>}
          {tag.updatedAt && (
            <p className="text-[11.5px] text-fg-4">
              Last saved {new Date(tag.updatedAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}
              {tag.updatedByName ? ` by ${tag.updatedByName}` : ""}
            </p>
          )}
        </div>

        {/* Totals */}
        <aside className="flex h-fit flex-col gap-2 rounded-lg border border-line bg-sunk p-4 text-[13px]">
          <TotalRow label="Pump & Accessories" value={formatInr(prices.paPrice ?? 0)} />
          <TotalRow label="BOI items" value={formatInr(boiTotal(prices))} />
          <div className="my-1 border-t border-line" />
          <TotalRow label="Unit price" value={formatInr(unit)} strong />
          <TotalRow
            label="Quantity"
            value={tag.quantity === null ? "not set" : `× ${tag.quantity}`}
            warn={tag.quantity === null}
          />
          <div className="my-1 border-t border-line-strong" />
          <TotalRow label="Sub-total" value={formatInr(sub)} big />
          <p className="mt-1 text-[11.5px] text-fg-3">Quantity comes from the Pump & Qty step (step 1).</p>
        </aside>
      </div>
    </section>
  );
}

// --- BOI table ------------------------------------------------------------------

type BoiState = "ok" | "diff" | "empty";
const BOI_GRID = "sm:grid-cols-[112px_minmax(0,1fr)_132px_68px_68px_96px]";
const BOI_EDGE: Record<BoiState, string> = {
  ok: "border-l-[color:var(--pos)]",
  diff: "border-l-[color:#f59e0b]",
  empty: "border-l-[color:var(--fg-4)]",
};
const BOI_DOT: Record<BoiState, string> = { ok: "bg-[var(--pos)]", diff: "bg-[#f59e0b]", empty: "bg-[var(--fg-4)]" };
const BOI_STATE_LABEL: Record<BoiState, string> = { ok: "Priced", diff: "Differs from master", empty: "Not priced" };

/** Not priced (blank or invalid), priced, or priced but not the master price. */
function boiState(base: string, master: number | null): BoiState {
  const n = parsePrice(base);
  if (n === null || n === undefined) return "empty";
  return master !== null && rupees(master) !== n ? "diff" : "ok";
}

/** "Use ₹…" pill; once used it turns green ("✓ Used ₹…  ×") and a click clears it. */
function UseChip({
  price,
  active,
  onClick,
  title,
  verb = "Used",
}: {
  price: number;
  active: boolean;
  onClick: () => void;
  title: string;
  verb?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={active ? "Click to clear this price" : title}
      className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-px font-mono text-[11.5px] font-semibold whitespace-nowrap transition-colors ${
        active
          ? "border-[color:var(--pos)] bg-[var(--pos-soft)] text-pos"
          : "border-[color:var(--accent-line)] bg-paper text-accent hover:bg-accent-soft"
      }`}
    >
      {active ? `✓ ${verb} ${formatInr(price)}` : `Use ${formatInr(price)}`}
      {active && (
        <span aria-hidden className="font-sans opacity-70">
          ×
        </span>
      )}
    </button>
  );
}

/** A BOI line's reference text with its warning and the Use pill below. */
function RefLine({ text, warn, children }: { text: ReactNode; warn?: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-start gap-1">
      <span>
        {text}
        {warn && <span className="ml-1 text-warn">({warn})</span>}
      </span>
      {children}
    </div>
  );
}

/** A used BOI Master item that no longer matches today's suggestion. */
function UsedLine({ label = "Used", value, onClear }: { label?: string; value: string; onClear: () => void }) {
  return (
    <span className="flex flex-wrap items-center gap-x-2 text-[11.5px]">
      <span className="text-fg-2">
        {label}: {value}
      </span>
      <button type="button" className="font-semibold text-fg-3 hover:text-neg" onClick={onClear}>
        Clear
      </button>
    </span>
  );
}

const DUTY_SHORT = { Nominal: "N", "Light Duty": "LD", "Heavy Duty": "HD" } as const;

/** The VFD line's reference: the BOI Master drives covering the motor kW (one
 *  per duty), each with its net price (list less discount, plus BOP extra). */
function VfdOptions({
  tag,
  picked,
  onPick,
  onClear,
}: {
  tag: CommercialTag;
  picked: string;
  onPick: (o: VfdOption) => void;
  onClear: () => void;
}) {
  const stale = picked && !tag.vfdOptions.some((o) => o.driveDescription === picked) && (
    <UsedLine label="Picked" value={picked} onClear={onClear} />
  );
  if (tag.motorKw === null || tag.vfdOptions.length === 0)
    return (
      <div className="flex flex-col items-start gap-1">
        {stale}
        <span className="text-warn">
          {tag.motorKw === null
            ? "No motor kW on the Motor Rating step to match a drive"
            : `No drive in the BOI Master covers ${tag.motorKw} kW`}
        </span>
      </div>
    );
  return (
    <div className="flex flex-col gap-1">
      {tag.vfdOptions.map((o) => {
        const active = o.driveDescription === picked;
        return (
          <div key={o.driveDescription} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11.5px]">
            {o.netPrice !== null ? (
              <UseChip
                price={o.netPrice}
                active={active}
                verb="Picked"
                onClick={() => (active ? onClear() : onPick(o))}
                title={`List ${formatInr(o.listPrice)} less ${o.discountPct ?? 0}% + BOP ${formatInr(o.bopExtra ?? 0)}`}
              />
            ) : (
              <span className="text-fg-4">no price</span>
            )}
            <span className="font-mono font-semibold text-fg">{o.driveDescription}</span>
            <span className="text-fg-3" title="N = Nominal use · LD = Light duty · HD = Heavy duty">
              {[o.make, o.frame, o.duties.map((d) => `${DUTY_SHORT[d.duty]} ${d.kw} kW`).join(" / ")].filter(Boolean).join(" · ")}
            </span>
          </div>
        );
      })}
      {stale}
    </div>
  );
}

function PctInput({ value, label, onChange }: { value: string; label: string; onChange: (v: string) => void }) {
  return (
    <div className="relative w-[68px] shrink-0">
      <input
        className={`${moneyCls} pr-6`}
        inputMode="decimal"
        placeholder="0"
        value={value}
        aria-label={label}
        onChange={(e) => onChange(e.target.value)}
      />
      <span className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-[12px] text-fg-3">%</span>
    </div>
  );
}

/** One BOI line: item, reference, base price, disc %, markup % and the quoted
 *  price (base × (1 − disc %) × (1 + markup %)). */
function BoiRow({
  label,
  sub,
  state,
  reference,
  base,
  master,
  pct,
  net,
  error,
  onBase,
  onPct,
}: {
  label: string;
  sub?: string;
  state: BoiState;
  reference: ReactNode;
  base: string;
  master: number | null;
  pct: PctDraft;
  net: number | null;
  error?: string;
  onBase: (v: string) => void;
  onPct: (patch: Partial<PctDraft>) => void;
}) {
  return (
    <div
      className={`grid grid-cols-1 gap-2 border-b border-l-[3px] border-line px-3 py-2.5 sm:items-center sm:gap-x-2.5 ${BOI_GRID} ${BOI_EDGE[state]}`}
    >
      <div className="text-[13px] font-semibold text-fg">
        {label}
        {sub && <span className="mt-px block text-[11px] font-normal text-fg-3">{sub}</span>}
      </div>
      <div className="min-w-0 text-[12px] text-fg-2">{reference}</div>
      <div className="flex items-center gap-2 sm:contents">
        <div className="min-w-0 flex-1 sm:flex-none">
          <MoneyInput
            grouped
            value={base}
            onChange={onBase}
            label={`${label} base price per unit`}
            invalid={!!error}
            warn={state === "diff"}
            title={state === "diff" && master !== null ? `Master price ${formatInr(master)}` : undefined}
          />
        </div>
        <PctInput value={pct.discountPct} label={`${label} vendor discount %`} onChange={(v) => onPct({ discountPct: v })} />
        <PctInput value={pct.markupPct} label={`${label} markup %`} onChange={(v) => onPct({ markupPct: v })} />
        <span
          className={`w-[96px] shrink-0 text-right font-mono text-[13.5px] ${net === null ? "text-fg-4" : "font-bold text-fg"}`}
          title="Base × (1 − disc %) × (1 + markup %)"
        >
          {formatInr(net)}
        </span>
      </div>
      {error && <span className="text-[11.5px] text-neg sm:col-span-6 sm:text-right">{error}</span>}
    </div>
  );
}

/** "NON SUGAR INDUSTRIES - Price List_V6_" → "Non Sugar Industries V6". */
const levelName = (l: PaLevel) =>
  l.title
    .replace(/\s*-\s*Price List_?/i, " ")
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
    .replace(/\b([a-z])/g, (c) => c.toUpperCase())
    .replace(/\bNi\b/g, "NI")
    .replace(/\bV(\d)/g, "V$1");
const dmy = (iso: string | null) => (iso ? iso.split("-").reverse().join("-") : "");

/** The P&A price suggestion from the L1–L4 price lists (lib/pa-price.ts):
 *  the tag's model row × MOC column, the sheet's adjustments as tick-boxes
 *  (pre-ticked from the data), one price per list to use. */
function PaSuggestionPanel({
  tag,
  data,
  used,
  onUse,
  onClear,
}: {
  tag: CommercialTag;
  data: PaPriceData | "error" | null;
  used: string;
  onUse: (price: number, basis: string) => void;
  onClear: () => void;
}) {
  const inputs = useMemo(() => paInputsFor(tag), [tag]);
  const sug = useMemo(() => (data && data !== "error" ? paSuggestion(data, inputs) : null), [data, inputs]);
  const defaults = useMemo(
    () => new Set((sug?.adjustments ?? []).filter((a) => a.defaultOn).map((a) => a.key)),
    [sug],
  );
  const [on, setOn] = useState<Set<string>>(defaults);
  useEffect(() => setOn(defaults), [defaults]);
  const toggle = (key: string, group?: string) =>
    setOn((cur) => {
      const next = new Set(cur);
      if (next.has(key)) next.delete(key);
      else {
        // Only one of a group (size up / size down).
        if (group) for (const a of sug?.adjustments ?? []) if (a.group === group) next.delete(a.key);
        next.add(key);
      }
      return next;
    });

  const from = (k: keyof typeof inputs.source) => (inputs.source[k] ? `${k === "subCategory" ? "sub-category" : k} from ${inputs.source[k]}` : null);

  return (
    <div className="mt-2 rounded-lg border border-line bg-sunk/50 p-3 text-[12px] text-fg-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-semibold text-fg">Price suggestion · L1–L4 price list</span>
        {used && (
          <span className="flex flex-wrap items-center gap-2">
            <span>
              Used: <span className="font-mono text-[11.5px]">{used}</span>
            </span>
            <button type="button" className="text-[11.5px] font-semibold text-fg-3 hover:text-neg" onClick={onClear}>
              Clear
            </button>
          </span>
        )}
      </div>

      {data === null && <p className="mt-1 text-fg-3">Loading the price list…</p>}
      {data === "error" && <p className="mt-1 text-neg">Couldn&apos;t load the price list.</p>}
      {sug?.problem && <p className="mt-1 text-warn">{sug.problem}</p>}

      {sug && !sug.problem && sug.row && sug.col && data && data !== "error" && (
        <div className="mt-1.5 flex flex-col gap-2">
          <p>
            Row <b className="text-fg">{sug.row.pumpModelNo}</b> · MOC <b className="text-fg">{sug.col.toUpperCase()}</b>
            <span className="ml-1 text-fg-3">
              ({[from("model"), from("moc"), from("subCategory"), from("rubber")].filter(Boolean).join(", ")})
            </span>
          </p>
          {sug.notes.length > 0 && <p className="text-fg-3">{sug.notes.join(" · ")}</p>}

          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {sug.adjustments.map((a) => (
              <label key={a.key} className="flex cursor-pointer items-center gap-1.5" title={a.note}>
                <input
                  type="checkbox"
                  checked={on.has(a.key)}
                  onChange={() => toggle(a.key, a.group)}
                  className="h-3.5 w-3.5 accent-[var(--brand-blue)]"
                />
                <span className={on.has(a.key) ? "text-fg" : ""}>{a.label}</span>
                {a.note && <span className="text-[11px] text-fg-4">({a.note})</span>}
              </label>
            ))}
          </div>

          <div className="flex flex-col divide-y divide-line rounded-md border border-line bg-paper">
            {data.levels.map((l) => {
              const { base, price } = paPrice(sug, l.level, on);
              const basis = paBasisText(sug, l.level, on);
              const active = used === basis;
              return (
                <div key={l.level} className={`flex flex-wrap items-center gap-x-3 gap-y-1 px-2.5 py-1.5 ${active ? "bg-accent-soft" : ""}`}>
                  <span className="w-[22px] font-mono font-semibold text-fg">{l.level}</span>
                  <span className="min-w-0 flex-1 truncate" title={`${l.title} ${l.dateText ?? ""}`}>
                    {levelName(l)} <span className="text-fg-4">· {dmy(l.listDate)}</span>
                  </span>
                  {price === null ? (
                    <span className="text-fg-4">no {sug.col?.toUpperCase()} price in this list</span>
                  ) : (
                    <>
                      <span className="font-mono text-fg-3">list {formatInr(base)}</span>
                      <button
                        type="button"
                        className="rounded-md border border-line bg-paper px-1.5 py-0.5 font-mono text-[11.5px] text-accent hover:border-accent"
                        onClick={() => (active ? onClear() : onUse(price, basis))}
                        title={active ? "Click to clear this price" : basis}
                      >
                        {active ? "Used" : "Use"} {formatInr(price)}{active && " ✕"}
                      </button>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

/** One remarks note for the whole Commercial Summary (all tags and groups). */
function RemarksCard({
  projectId,
  saved,
  onSaved,
}: {
  projectId: string;
  saved: string;
  onSaved: (remarks: string) => void;
}) {
  const [text, setText] = useState(saved);
  const [state, setState] = useState<"" | "saving" | "saved" | "error">("");
  useEffect(() => setText(saved), [saved]);
  const dirty = text.trim() !== saved;
  const save = async () => {
    setState("saving");
    try {
      await saveCommercialRemarks(projectId, text.trim());
      onSaved(text.trim());
      setState("saved");
    } catch {
      setState("error");
    }
  };
  return (
    <section className="rounded-xl border border-line bg-paper">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
        <h2 className="text-[14px] font-semibold text-fg">Remarks</h2>
        <div className="flex items-center gap-2">
          <span className="text-[12px] text-fg-3">
            {state === "saving" ? "Saving…" : state === "error" ? "Couldn't save — try again" : state === "saved" && !dirty ? "Saved" : "One note for the whole enquiry"}
          </span>
          <button type="button" className={btnPrimarySm} onClick={() => void save()} disabled={!dirty || state === "saving"}>
            Save
          </button>
        </div>
      </header>
      <div className="p-4">
        <textarea
          className={`${inputCls} min-h-[72px] resize-y`}
          value={text}
          maxLength={2000}
          placeholder="Optional notes on these prices"
          onChange={(e) => {
            setText(e.target.value);
            if (state === "saved") setState("");
          }}
          aria-label="Commercial Summary remarks"
        />
      </div>
    </section>
  );
}

function MoneyInput({
  value,
  error,
  onChange,
  label,
  grouped,
  invalid,
  warn,
  title,
  strong,
}: {
  value: string;
  error?: string;
  onChange: (v: string) => void;
  label: string;
  /** Show 24,457 while not editing; keeps plain digits as the value. */
  grouped?: boolean;
  /** Red border without the message (the row shows it). */
  invalid?: boolean;
  /** Amber box — the price isn't the master price. */
  warn?: boolean;
  title?: string;
  /** Bold, larger figure (the P&A price). */
  strong?: boolean;
}) {
  const [focused, setFocused] = useState(false);
  const shown = grouped && !focused && /^\d+$/.test(value) ? Number(value).toLocaleString("en-IN") : value;
  return (
    <div className="flex flex-col gap-1">
      <div className="relative">
        <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-[13px] text-fg-3">₹</span>
        <input
          className={`${moneyCls} pl-7 ${error || invalid ? "border-neg" : ""}`}
          style={{
            ...(strong ? { fontSize: 15, fontWeight: 700 } : {}),
            ...(warn && !error && !invalid ? { background: "var(--warn-soft)", borderColor: "#f5b84a" } : {}),
          }}
          inputMode="numeric"
          placeholder="0"
          value={shown}
          title={title}
          aria-label={label}
          aria-invalid={!!(error || invalid)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onChange={(e) => {
            const v = e.target.value.replace(/\.\d*/g, "");
            onChange(grouped ? v.replace(/\D/g, "") : v.replace(/[^\d,]/g, ""));
          }}
        />
      </div>
      {error && <span className="text-[11.5px] text-neg">{error}</span>}
    </div>
  );
}

function TotalRow({
  label,
  value,
  strong,
  big,
  warn,
}: {
  label: string;
  value: string;
  strong?: boolean;
  big?: boolean;
  warn?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className={big || strong ? "font-semibold text-fg" : "text-fg-2"}>{label}</span>
      <span
        className={`font-mono ${big ? "text-[16px] font-bold text-fg" : strong ? "font-semibold text-fg" : "text-fg-2"} ${
          warn ? "text-neg" : ""
        }`}
      >
        {value}
      </span>
    </div>
  );
}

const RupeeIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M6 4h12M6 9h12M14.5 20 7 13h2.5a4.5 4.5 0 0 0 0-9" />
  </svg>
);
