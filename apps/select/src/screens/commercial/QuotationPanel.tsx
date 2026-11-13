"use client";

import { useEffect, useState } from "react";

// shadcn/ui (user, 2026-11-13: the quotation panel in the new look, branch select-shadcn).
import { Eye, FileText, GitBranchPlus, Save, X } from "lucide-react";
import { Badge } from "@/components/shadcn/badge";
import { buttonVariants } from "@/components/shadcn/button";
import { ConfirmDialog } from "@/components/shadcn/alert-dialog";
import { Alert } from "@/components/shadcn/field";
import CommercialOfferModal from "./CommercialOfferModal";
import { discountOf, normalizeOfferConfig } from "../../lib/commercial-offer";
import {
  BOI_ITEMS,
  type DriveGroup,
  type QuotationInfo,
  type QuotationSnapshot,
  type QuotationVersionInfo,
  type TsmOption,
  boiNet,
  boiTotal,
  formatInr,
  formatUsd,
  formatUsdCents,
  usdGrandTotal,
  otherNet,
  versionLabel,
  finalBoi,
  finalPa,
  type QuoteDiscount,
} from "../../lib/commercial";
import { SPARE_GROUP } from "../../lib/commercial";
import {
  changeQuotationTsm,
  setQuotationErpSerial,
  getQuotation,
  listTsmOptions,
  newInternalVersion,
  sendQuotationToClient,
} from "../../services/quotationService";

// Quotation header on the Commercial Summary page: the self-generated number,
// the TSM, "New internal version" (the TSM asked for changes → next internal
// version) and "Save Version Vn" (→ the enquiry version's client version; saving
// again overwrites it; the button stays after a save, as "Save again Version Vn"). Reassigning the TSM
// makes no version. The serial (6000, 6001, …) is issued when the quotation is created.

const selectCls =
  "h-8 rounded-md border border-input bg-card px-2.5 text-[12.5px] text-foreground shadow-xs outline-none transition-[box-shadow,border-color] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/25 disabled:opacity-60";
const btnSm = buttonVariants({ variant: "outline", size: "sm" });
const btnPrimarySm = buttonVariants();
/** A section card, as on the other new-look pages. */
const cardCls = "rounded-lg border border-border bg-card shadow-[0_1px_2px_rgba(15,23,42,0.04)]";
/** The small uppercase label over a value. */
const labelCls = "text-[11px] font-medium tracking-wide text-muted-foreground uppercase";

/** A version's grand total in USD: a spare's is its total (after its discount) at the
 *  rate, with cents; a pump's as the Commercial Offer sums it. */
const snapshotUsd = (s: QuotationSnapshot, rate: number) =>
  s.spare ? formatUsdCents(s.grandTotal / rate) : formatUsd(usdGrandTotal(s.tags, rate, discountOf(s.offer)));

const errMsg = (e: unknown, fallback: string) =>
  (e as { response?: { data?: { error?: string } } })?.response?.data?.error || fallback;

const fmtDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : "—";

const tsmLabel = (t: TsmOption) => `${t.name} (${t.initials}${t.zone ? ` · ${t.zone}` : ""})`;

export default function QuotationPanel({
  projectId,
  group,
  groupLabel,
  hasUnsavedPrices,
  pricesVersion,
  onGenerate,
  readOnly = false,
  sendBlock = null,
  onChanged,
}: {
  projectId: string;
  /** Drive group this panel quotes (GM / GB / VB / DD) — one quotation each. */
  group: string;
  /** Shown in the title when the enquiry has more than one group. */
  groupLabel?: string;
  /** Prices on the page not saved yet — sending would freeze the old ones. */
  hasUnsavedPrices: boolean;
  /** Bumped by the page after each price save, so the live version's totals refresh. */
  pricesVersion: number;
  /** Opens the enquiry's Quotation step (quotations are generated there, not here). */
  onGenerate: () => void;
  /** An older version of the enquiry: its versions can be viewed, nothing else. */
  readOnly?: boolean;
  /** What stops the send (flagged prices, the Prices reviewed tick), or null. */
  sendBlock?: string | null;
  /** After the quotation changes (sent, a new version, …). */
  onChanged?: (q: QuotationInfo) => void;
}) {
  // A spare is versioned through its enquiry versions, so its quotation shows no
  // internal or client versions: it is saved once per enquiry version.
  const isSpare = group === SPARE_GROUP;
  const [quotation, setQuotation] = useState<QuotationInfo | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState("");
  // The client's rep in sales — the TSM is locked to them. null = the client
  // has no rep (or no client code), so the TSM is picked by hand.
  const [clientTsm, setClientTsm] = useState<TsmOption | null>(null);
  const [options, setOptions] = useState<TsmOption[]>([]);
  const [optionsError, setOptionsError] = useState(false);
  const [tsmId, setTsmId] = useState<string>("");
  const [busy, setBusy] = useState(false);
  // ERP serial box (create form + existing quotation); follows the saved value.
  const [erpDraft, setErpDraft] = useState("");
  useEffect(() => setErpDraft(quotation?.erpSerial ?? ""), [quotation?.erpSerial]);
  const [actionError, setActionError] = useState("");
  const [confirm, setConfirm] = useState<null | "tsm" | "send" | "internal">(null);
  const [viewing, setViewing] = useState<QuotationVersionInfo | null>(null);
  // What the TSM asked to change, for the next internal version.
  const [note, setNote] = useState("");
  const [noteError, setNoteError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getQuotation(projectId, group)
      .then(async (q) => {
        if (cancelled) return;
        setQuotation(q.quotation);
        setClientTsm(q.clientTsm);
        setTsmId(String(q.clientTsm?.id ?? q.quotation?.tsmRepId ?? ""));
        // The pick list is only needed when the client has no rep in sales.
        if (!q.clientTsm) {
          const opts = await listTsmOptions().catch(() => null);
          if (cancelled) return;
          if (!opts) setOptionsError(true);
          setOptions(opts ?? []);
        }
      })
      .catch(() => !cancelled && setLoadError("Couldn't load the quotation."))
      .finally(() => !cancelled && setLoaded(true));
    return () => {
      cancelled = true;
    };
  }, [projectId, group]);

  // After a price save, re-read so the live internal version shows the new totals.
  useEffect(() => {
    if (pricesVersion === 0) return;
    let cancelled = false;
    getQuotation(projectId, group)
      .then((q) => !cancelled && setQuotation(q.quotation))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [projectId, group, pricesVersion]);

  // Keep the current TSM selectable even if it's no longer an active rep.
  const tsmOptions =
    quotation?.tsmRepId && !options.some((o) => o.id === quotation.tsmRepId)
      ? [
          {
            id: quotation.tsmRepId,
            name: quotation.tsmName ?? "—",
            initials: quotation.tsmInitials ?? "",
            zone: quotation.tsmZone,
            role: "",
          },
          ...options,
        ]
      : options;
  // Locked to the client's rep when there is one; otherwise the hand pick.
  const picked = clientTsm ?? tsmOptions.find((o) => String(o.id) === tsmId) ?? null;

  const run = async (fn: () => Promise<QuotationInfo>, fallback: string) => {
    setBusy(true);
    setActionError("");
    try {
      const q = await fn();
      setQuotation(q);
      onChanged?.(q);
      setTsmId(String(clientTsm?.id ?? q.tsmRepId ?? ""));
      setNote("");
    } catch (e) {
      setActionError(errMsg(e, fallback));
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  };

  if (!loaded) {
    return <section className={`${cardCls} p-4 text-[13px] text-muted-foreground`}>Loading quotation…</section>;
  }
  if (loadError) {
    return <section className={`${cardCls} p-4 text-[13px] text-destructive`}>{loadError}</section>;
  }

  // Locked: the client's rep, read-only. Otherwise a pick list.
  const tsmField = clientTsm ? (
    <div className="flex min-w-0 flex-col">
      <span className="truncate text-[13px] font-medium text-foreground" title={tsmLabel(clientTsm)}>
        {tsmLabel(clientTsm)}
      </span>
      <span className="text-[11.5px] text-muted-foreground">The client's rep in the sales portal</span>
    </div>
  ) : (
    <select
      className={selectCls}
      value={tsmId}
      onChange={(e) => setTsmId(e.target.value)}
      disabled={busy}
      aria-label="TSM"
    >
      <option value="">Select TSM</option>
      {tsmOptions.map((o) => (
        <option key={o.id} value={o.id}>
          {tsmLabel(o)}
        </option>
      ))}
    </select>
  );

  // --- Not generated yet ------------------------------------------------------
  // Quotations are generated on the enquiry's Quotation step (Enquiries list),
  // e.g. for a drive system added after the first quotation.
  if (!quotation) {
    return (
      <section className="overflow-hidden rounded-lg border border-warning/40 bg-card shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        <header className="flex items-center gap-2 border-b border-warning/25 bg-warning/8 px-4 py-3">
          <FileText className="size-4 text-warning" />
          <h2 className="text-[13px] font-semibold text-foreground">Quotation{groupLabel ? ` — ${groupLabel}` : ""}</h2>
        </header>
        <div className="flex flex-wrap items-center justify-between gap-3 p-4">
          <p className="text-[13px] text-muted-foreground">
            No quotation for {groupLabel ? `the ${groupLabel} tags` : "this enquiry"} yet — generate it on the Quotation step.
          </p>
          {!readOnly && (
            <button type="button" className={btnPrimarySm} onClick={onGenerate}>
              Generate quotation
            </button>
          )}
        </div>
      </section>
    );
  }

  // --- Existing quotation -----------------------------------------------------
  // Locked TSM: only offer a change when sales has since given the client a
  // different rep. Unlocked: when a different person is picked.
  const tsmChanged = picked !== null && picked.id !== quotation.tsmRepId;
  // The internal version that follows the saved prices (null once it was sent).
  const liveInternal = quotation.versions.find((v) => v.track === "internal" && v.live) ?? null;
  const internal = quotation.versions.filter((v) => v.track === "internal");
  const client = quotation.versions.filter((v) => v.track === "client");
  // Once saved, the button stays (user, 2026-11-11): "Save again" replaces the saved
  // copy; with nothing changed the server says so.
  const sent = quotation.sentThisVersion || (isSpare && !liveInternal);
  const sendAgain = sent && quotation.changedSinceSent;
  const saveLabel = sent ? `Save again Version V${quotation.nextClientVersion}` : `Save Version V${quotation.nextClientVersion}`;

  return (
    <section className={`overflow-hidden ${cardCls}`}>
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div className="flex min-w-0 items-start gap-2.5">
          <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
            <FileText className="size-3.5" />
          </span>
          <div className="min-w-0">
            <h2 className="text-[13px] font-semibold text-foreground">Quotation{groupLabel ? ` — ${groupLabel}` : ""}</h2>
            <p className="mt-0.5 font-mono text-[14px] font-semibold break-all text-primary">
              <span className={`mr-1.5 font-sans ${labelCls}`}>Quotation No. (System)</span>
              {quotation.number}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!isSpare && (
            <>
              <VersionBadge label="Internal" value={versionLabel(quotation.internalVersion)} />
              <VersionBadge label="Client" value={versionLabel(quotation.clientVersion)} muted={quotation.clientVersion === null} />
            </>
          )}
          {!readOnly && (
          <>
          {!isSpare && (
          <button
            type="button"
            className={btnSm}
            disabled={busy || hasUnsavedPrices}
            title={hasUnsavedPrices ? "Save the price changes first" : "The TSM asked for changes — click before making them"}
            onClick={() => {
              setNoteError(false);
              setConfirm("internal");
            }}
          >
            <GitBranchPlus /> New internal version
          </button>
          )}
          <button
            type="button"
            className={btnPrimarySm}
            disabled={busy || hasUnsavedPrices || Boolean(sendBlock)}
            title={
              sendBlock
                ? sendBlock
                : hasUnsavedPrices
                  ? "Save the price changes first"
                  : sent
                    ? `Replaces the saved Version V${quotation.nextClientVersion}`
                    : undefined
            }
            onClick={() => setConfirm("send")}
          >
            <Save /> {saveLabel}
          </button>
          </>
          )}
        </div>
      </header>

      <fieldset disabled={readOnly} className="m-0 grid min-w-0 grid-cols-1 gap-4 border-0 p-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className={labelCls}>Quotation No.</span>
          <span className="flex flex-wrap items-center gap-1.5">
            <input
              className="h-7 w-[120px] rounded-md border border-input bg-card px-2 font-mono text-[12.5px] text-foreground uppercase shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/25"
              value={erpDraft}
              maxLength={30}
              placeholder="Serial"
              aria-label="Quotation No. serial"
              onChange={(e) => setErpDraft(e.target.value)}
            />
            {erpDraft.trim().toUpperCase() !== (quotation.erpSerial ?? "") && (
              <button
                type="button"
                className={btnSm}
                disabled={busy}
                onClick={() => run(() => setQuotationErpSerial(quotation.id, erpDraft.trim()), "Couldn't save the quotation no.")}
              >
                Save
              </button>
            )}
          </span>
          <span className="font-mono text-[11.5px] break-all text-muted-foreground">{quotation.erpNumber ?? "—"}</span>
        </div>
        <Info label="Date" value={new Date(quotation.quoteDate).toLocaleDateString("en-IN", { dateStyle: "medium" })} />
        <Info label="Client" value={[quotation.clientName, quotation.clientCode].filter(Boolean).join(" · ") || "—"} />
        <Info label="Region (TSM initials)" value={quotation.regionCode ?? "—"} />
        <div className="flex min-w-0 flex-col gap-1">
          <span className={labelCls}>TSM</span>
          {clientTsm && tsmChanged ? (
            <div className="flex flex-col gap-1.5">
              <span className="truncate text-[13px] text-foreground">{quotation.tsmName ?? "—"}</span>
              <span className="text-[11.5px] text-warning">Sales now shows {clientTsm.name} as the client's rep.</span>
              <button type="button" className={`${btnSm} self-start`} disabled={busy} onClick={() => setConfirm("tsm")}>
                Update to {clientTsm.initials}
              </button>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              {tsmField}
              {tsmChanged && (
                <button type="button" className={btnSm} disabled={busy} onClick={() => setConfirm("tsm")}>
                  Save TSM
                </button>
              )}
            </div>
          )}
        </div>
      </fieldset>

      {sendBlock && !readOnly && (
        <div className="px-4 pb-3">
          <Alert tone="warning">
            {saveLabel} is waiting: {sendBlock}
          </Alert>
        </div>
      )}
      {sent && !sendAgain && !readOnly && (
        <div className="px-4 pb-3">
        <Alert tone="success">
          {isSpare
            ? `Version V${quotation.nextClientVersion} saved. If anything is corrected, Save again replaces it.`
            : `Version V${quotation.nextClientVersion} saved. If a price or document is corrected, saving again replaces client ${versionLabel(quotation.clientVersion)}.`}
        </Alert>
        </div>
      )}
      {sendAgain && !readOnly && (
        <div className="px-4 pb-3">
        <Alert tone="warning">
          {isSpare ? "The quotation or its document has" : "Prices or documents have"} changed since this version was saved. Save again to replace{" "}
          {isSpare ? `Version V${quotation.nextClientVersion}` : `client ${versionLabel(quotation.clientVersion)}`}.
        </Alert>
        </div>
      )}
      {hasUnsavedPrices && (
        <p className="px-4 pb-3 text-[12px] font-medium text-warning">
          Save the price changes below before {isSpare ? "saving the version" : "making a new internal version or saving the version"}.
        </p>
      )}
      {actionError && (
        <div className="px-4 pb-3">
          <Alert>{actionError}</Alert>
        </div>
      )}

      <div className={`grid grid-cols-1 gap-4 border-t border-border bg-muted/30 p-4 md:grid-cols-2 ${isSpare ? "hidden" : ""}`}>
        <VersionList title="Internal versions" hint="A new one each time the TSM asks for changes." items={internal} onView={setViewing} />
        <VersionList title="Client versions" hint="One for each version of the enquiry. Saving again replaces it." items={client} onView={setViewing} />
      </div>

      <ConfirmDialog
        open={confirm === "tsm"}
        title={`Change TSM to ${picked?.name ?? ""}?`}
        description={
          <>
            The quotation is reassigned to {picked?.name} and the number&apos;s initials become{" "}
            <b>{picked?.initials}</b>. No new version is made — versions stay internal{" "}
            {versionLabel(quotation.internalVersion)} / client {versionLabel(quotation.clientVersion)}.
          </>
        }
        confirmLabel="Change TSM"
        busy={busy}
        onClose={() => setConfirm(null)}
        onConfirm={() => picked && run(() => changeQuotationTsm(quotation.id, picked.id), "Couldn't change the TSM.")}
      />
      <ConfirmDialog
        open={confirm === "internal"}
        title={`Record internal V${quotation.internalVersion + 1}?`}
        description={
          <>
            Use this when the TSM asks for changes, <b>before</b> making them.{" "}
            {liveInternal && (
              <>
                Internal V{liveInternal.version} is frozen as it is now ({formatInr(liveInternal.snapshot.grandTotal)}).{" "}
              </>
            )}
            The changes you save next go into <b>internal V{quotation.internalVersion + 1}</b>. The client version stays{" "}
            {versionLabel(quotation.clientVersion)}.
          </>
        }
        confirmLabel={`Save internal V${quotation.internalVersion + 1}`}
        busy={busy}
        onClose={() => setConfirm(null)}
        onConfirm={() => {
          if (!note.trim()) {
            setNoteError(true);
            return;
          }
          run(() => newInternalVersion(quotation.id, note.trim()), "Couldn't record the internal version.");
        }}
      >
        <label className="flex flex-col gap-1.5 text-left">
          <span className="text-[12px] font-medium text-foreground">
            Changes requested by the TSM ({quotation.tsmName ?? "—"})
          </span>
          <textarea
            className={`min-h-[80px] resize-y rounded-md border bg-card px-2.5 py-2 text-[12.5px] text-foreground shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/25 ${
              noteError ? "border-destructive" : "border-input"
            }`}
            value={note}
            maxLength={2000}
            placeholder="e.g. Reduce P&A by 5%, change motor make to Siemens"
            onChange={(e) => {
              setNote(e.target.value);
              if (e.target.value.trim()) setNoteError(false);
            }}
          />
          {noteError && <span className="text-[11.5px] font-medium text-destructive">Describe what the TSM asked to change.</span>}
        </label>
      </ConfirmDialog>
      <ConfirmDialog
        open={confirm === "send"}
        title={`${saveLabel}?`}
        description={
          isSpare ? (
            sent ? (
              <>Replaces the saved Version V{quotation.nextClientVersion} with the quotation and its document as they are now. The copy saved earlier is not kept. Nothing is e-mailed.</>
            ) : (
              <>
                Saves this quotation ({formatInr(liveInternal?.snapshot.grandTotal ?? 0)}) as Version V{quotation.nextClientVersion}. If anything is corrected later, it can be saved again. Nothing is e-mailed.
              </>
            )
          ) : sent ? (
            <>
              Replaces <b>client {versionLabel(quotation.clientVersion)}</b> with the current prices, Commercial Offer and Techno-Commercial Offer. The copy saved earlier is not kept. Nothing is e-mailed.
            </>
          ) : (
          <>
            Saves internal V{quotation.internalVersion}{liveInternal ? ` (${formatInr(liveInternal.snapshot.grandTotal)})` : ""} as <b>client V{quotation.nextClientVersion}</b>.
            If a price or document is corrected later, it can be saved again. Nothing is e-mailed.
          </>
          )
        }
        confirmLabel={saveLabel}
        busy={busy}
        onClose={() => setConfirm(null)}
        onConfirm={() => run(() => sendQuotationToClient(quotation.id), "Couldn't save the version.")}
      />
      {viewing && (
        <SnapshotModal
          version={viewing}
          number={quotation?.number}
          projectId={projectId}
          group={group as DriveGroup}
          onClose={() => setViewing(null)}
        />
      )}
    </section>
  );
}

function VersionBadge({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <span className="inline-flex h-7 items-center gap-1.5 rounded-md bg-muted px-2.5 text-[12px] ring-1 ring-border ring-inset">
      <span className="text-muted-foreground">{label}</span>
      <b className={`font-mono font-semibold ${muted ? "text-muted-foreground" : "text-foreground"}`}>{value}</b>
    </span>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className={labelCls}>{label}</span>
      <span className="truncate pt-1 text-[13px] text-foreground" title={value}>
        {value}
      </span>
    </div>
  );
}

function VersionList({
  title,
  hint,
  items,
  onView,
}: {
  title: string;
  hint: string;
  items: QuotationVersionInfo[];
  onView: (v: QuotationVersionInfo) => void;
}) {
  return (
    <div className="min-w-0">
      <h3 className="text-[12.5px] font-semibold text-foreground">{title}</h3>
      <p className="mb-2 text-[11.5px] text-muted-foreground">{hint}</p>
      {items.length === 0 ? (
        <p className="rounded-md border border-dashed border-border bg-card px-3 py-2.5 text-[12.5px] text-muted-foreground">None yet.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border overflow-hidden rounded-md border border-border bg-card">
          {items.map((v) => (
            <li key={v.id} className="flex items-center justify-between gap-3 px-3 py-2 transition-colors hover:bg-muted/50">
              <div className="min-w-0">
                <p className="text-[13px] text-foreground">
                  <b className="font-mono font-semibold">V{v.version}</b> <span className="text-muted-foreground">· {v.reason ?? ""}</span>
                  {v.live && (
                    <Badge tone="success" dot className="ml-2">
                      Live · follows saved prices
                    </Badge>
                  )}
                </p>
                {v.note && (
                  <p className="line-clamp-2 text-[12px] text-foreground/85" title={v.note}>
                    &ldquo;{v.note}&rdquo;
                  </p>
                )}
                <p className="truncate text-[11.5px] text-muted-foreground">
                  {fmtDate(v.createdAt)}
                  {v.createdByName ? ` · ${v.createdByName}` : ""} · TSM {v.tsmInitials ?? "—"} ·{" "}
                  {formatInr(v.snapshot.grandTotal)}
                  {v.snapshot.fx ? ` · ${snapshotUsd(v.snapshot, v.snapshot.fx.rate)}` : ""}
                </p>
              </div>
              <button type="button" className={btnSm} onClick={() => onView(v)}>
                <Eye /> View
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function SnapshotModal({
  version,
  number,
  projectId,
  group,
  onClose,
}: {
  version: QuotationVersionInfo;
  /** The quotation number, shown above the version. */
  number?: string;
  projectId: string;
  group: DriveGroup;
  onClose: () => void;
}) {
  // This version's Commercial Offer: its prices + the sheet edits frozen with it.
  const [showOffer, setShowOffer] = useState(false);
  const label = `${version.track === "internal" ? "Internal" : "Client"} V${version.version}`;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const s = version.snapshot;
  // A spare quotation's rows are its parts.
  const isSpare = Boolean(s.spare);
  return (
    // A plain overlay, not a Radix Dialog: it opens the Commercial Offer (its own plain
    // overlay, which prints) on top of itself.
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-[1px]"
      role="dialog"
      aria-modal="true"
      aria-label={label}
      onClick={onClose}
    >
      <div
        className="flex max-h-[90vh] w-full max-w-[900px] flex-col overflow-hidden rounded-lg border border-border bg-card shadow-[0_24px_64px_rgba(15,23,42,0.25)]"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
          <div>
            {number && <p className="font-mono text-[12.5px] font-semibold break-all text-primary">{number}</p>}
            <h3 className="flex flex-wrap items-center gap-2 text-[15px] font-semibold text-foreground">
              {version.track === "internal" ? "Internal" : "Client"} V{version.version}
              {version.live && (
                <Badge tone="success" dot>
                  Live — current saved prices
                </Badge>
              )}
            </h3>
            <p className="text-[12.5px] text-muted-foreground">
              {version.reason} · {fmtDate(version.createdAt)} · TSM {version.tsmName ?? "—"}
            </p>
            {version.note && (
              <p className="mt-1 text-[12.5px] whitespace-pre-line text-foreground/85">
                <span className="font-medium text-foreground">Asked for:</span> {version.note}
              </p>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {!isSpare && (
              <button type="button" className={btnSm} onClick={() => setShowOffer(true)}>
                <FileText /> Commercial Offer
              </button>
            )}
            <button type="button" className={buttonVariants({ variant: "ghost", size: "icon" })} onClick={onClose} aria-label="Close">
              <X className="size-4" />
            </button>
          </div>
        </header>
        {showOffer && (
          <CommercialOfferModal
            projectId={projectId}
            group={group}
            tags={version.snapshot.tags.map((t) => ({
              tagId: t.tagId ?? t.tagName,
              tagName: t.tagName,
              tech: t.tech,
              pumpModel: t.productCode ?? t.model,
              prices: t.prices,
              quantity: t.quantity,
              unit: t.unit,
              sub: t.sub,
            }))}
            version={{ label, config: normalizeOfferConfig(version.snapshot.offer) }}
            fx={version.snapshot.fx}
            onClose={() => setShowOffer(false)}
          />
        )}
        <div className="overflow-auto">
          <table className="w-full min-w-[600px] text-[13px]">
            <thead>
              <tr className="border-b border-border bg-muted/60 text-left text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
                <th className="px-4 py-2">{isSpare ? "Part" : "Tag"}</th>
                <th className="px-4 py-2">{isSpare ? "Model" : "Pump Model"}</th>
                <th className="px-4 py-2 text-right">Unit Price</th>
                <th className="px-4 py-2 text-right">Qty</th>
                <th className="px-4 py-2 text-right">Sub-total</th>
              </tr>
            </thead>
            <tbody>
              {s.tags.map((t, i) => (
                <tr key={i} className="border-b border-border transition-colors last:border-b-0 hover:bg-muted/50">
                  <td className="px-4 py-2 font-medium text-foreground">{t.tagName}</td>
                  <td className="px-4 py-2 font-mono text-[12.5px] text-muted-foreground">{t.productCode ?? t.model ?? "—"}</td>
                  <td className="px-4 py-2 text-right font-mono tabular-nums">{formatInr(t.unit)}</td>
                  <td className="px-4 py-2 text-right font-mono tabular-nums">{t.quantity ?? "—"}</td>
                  <td className="px-4 py-2 text-right font-mono tabular-nums">{formatInr(t.sub)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-input bg-muted/60">
                <td colSpan={4} className="px-4 py-2.5 text-right font-semibold text-foreground">
                  Grand Total
                </td>
                <td className="px-4 py-2.5 text-right font-mono font-semibold text-foreground tabular-nums">{formatInr(s.grandTotal)}</td>
              </tr>
              {s.fx && (
                <tr className="bg-muted/60">
                  <td colSpan={4} className="px-4 pb-2.5 text-right text-[12px] text-muted-foreground">
                    Quoted in USD · 1 USD = ₹{s.fx.rate.toLocaleString("en-IN", { maximumFractionDigits: 4 })}
                  </td>
                  <td className="px-4 pb-2.5 text-right font-mono font-semibold text-primary tabular-nums">
                    {snapshotUsd(s, s.fx.rate)}
                  </td>
                </tr>
              )}
            </tfoot>
          </table>

          {/* Each tag's price build-up, as saved in this version. */}
          <div className={`flex flex-col gap-3 border-t border-border bg-muted/40 p-4 ${isSpare ? "hidden" : ""}`}>
            {s.remarks && (
              <p className="rounded-md border border-border bg-card px-3 py-2 text-[12.5px] whitespace-pre-line text-foreground/85">
                <span className="font-medium text-foreground">Remarks:</span> {s.remarks}
              </p>
            )}
            <h4 className={labelCls}>Details by tag</h4>
            {s.tags.map((t, i) => (
              <TagBreakdown key={i} tag={t} discount={discountOf(s.offer)} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

type SnapshotTag = QuotationSnapshot["tags"][number];

/** Labels saved beside a BOI price (the BOI Master VFD / DRP kit picked). */
const BOI_NOTE: Partial<Record<string, (p: SnapshotTag["prices"]) => string | null | undefined>> = {
  vfdPrice: (p) => p.vfdModel,
  mechSealPrice: (p) => p.mechSealModel,
  drpPrice: (p) => p.drpModel,
};

/** "base ₹10,000 −5% +25%" beside a BOI line (versions saved with discount / markup). */
const pctNote = (base: number | null, d?: number | null, m?: number | null) =>
  base === null ? null : `base ${formatInr(base)}${d ? ` −${d}%` : ""} +${m ?? 0}%`;

/** unit / sub on the version are after its discount (frozen with its sheet edits). */
function TagBreakdown({ tag, discount }: { tag: SnapshotTag; discount: QuoteDiscount }) {
  const p = tag.prices;
  const join = (...parts: (string | null | undefined)[]) => parts.filter(Boolean).join(" · ") || null;
  const line = (label: string, value: number | null | undefined, note?: string | null, key?: string) => (
    <tr key={key ?? label} className="border-b border-border last:border-b-0">
      <td className="px-3 py-1.5 text-foreground/85">
        {label}
        {note && <span className="ml-2 font-mono text-[11.5px] text-muted-foreground">{note}</span>}
      </td>
      <td className={`px-3 py-1.5 text-right font-mono tabular-nums ${value == null ? "text-muted-foreground/70" : "text-foreground"}`}>
        {formatInr(value ?? null)}
      </td>
    </tr>
  );
  return (
    <section className="overflow-hidden rounded-md border border-border bg-card">
      <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border px-3 py-2">
        <span className="text-[13px] font-semibold text-foreground">
          {tag.tagName}
          <span className="ml-2 text-[12.5px] font-normal text-muted-foreground">{tag.productCode ?? tag.model ?? "No pump"}</span>
        </span>
        <span className="text-[12px] text-muted-foreground">Qty {tag.quantity ?? "not set"}</span>
      </header>
      <table className="w-full text-[12.5px]">
        <tbody>
          {line("Pump & Accessories", p.paPrice, p.paBasis)}
          <tr className="border-b border-border bg-muted/60">
            <td colSpan={2} className="px-3 py-1 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
              BOI items
            </td>
          </tr>
          {BOI_ITEMS.map((it) =>
            line(
              it.label,
              boiNet(p, it.key),
              join(
                BOI_NOTE[it.key]?.(p),
                p.adjust ? pctNote(p[it.key] ?? null, p.adjust[it.key]?.discountPct, p.adjust[it.key]?.markupPct ?? 25) : null,
              ),
              it.key,
            ),
          )}
          {(p.others ?? []).map((o, j) =>
            line(
              o.name || "Other",
              otherNet(p, o),
              p.adjust ? pctNote(o.price, o.discountPct, o.markupPct ?? 25) : null,
              `other-${j}`,
            ),
          )}
        </tbody>
        <tfoot className="text-[12.5px]">
          <tr className="border-t border-border">
            <td className="px-3 py-1.5 text-right text-muted-foreground">BOI total</td>
            <td className="px-3 py-1.5 text-right font-mono text-foreground/85 tabular-nums">{formatInr(boiTotal({ ...p, others: p.others ?? [] }))}</td>
          </tr>
          {discount.paPct > 0 && (
            <tr>
              <td className="px-3 py-1.5 text-right text-muted-foreground">P&amp;A less {discount.paPct}% discount</td>
              <td className="px-3 py-1.5 text-right font-mono text-foreground/85 tabular-nums">{formatInr(finalPa(p, discount))}</td>
            </tr>
          )}
          {discount.boiPct > 0 && (
            <tr>
              <td className="px-3 py-1.5 text-right text-muted-foreground">BOI less {discount.boiPct}% discount</td>
              <td className="px-3 py-1.5 text-right font-mono text-foreground/85 tabular-nums">{formatInr(finalBoi(p, discount))}</td>
            </tr>
          )}
          <tr>
            <td className="px-3 py-1.5 text-right font-semibold text-foreground">Unit price</td>
            <td className="px-3 py-1.5 text-right font-mono font-semibold text-foreground tabular-nums">{formatInr(tag.unit)}</td>
          </tr>
          <tr>
            <td className="px-3 py-1.5 text-right text-muted-foreground">× Quantity</td>
            <td className="px-3 py-1.5 text-right font-mono text-foreground/85 tabular-nums">{tag.quantity ?? "—"}</td>
          </tr>
          <tr className="border-t border-input bg-muted/60">
            <td className="px-3 py-2 text-right font-semibold text-foreground">Sub-total</td>
            <td className="px-3 py-2 text-right font-mono font-semibold text-foreground tabular-nums">{formatInr(tag.sub)}</td>
          </tr>
        </tfoot>
      </table>
      {p.remarks && (
        <p className="border-t border-border px-3 py-2 text-[12px] whitespace-pre-line text-foreground/85">
          <span className="font-medium text-foreground">Remarks:</span> {p.remarks}
        </p>
      )}
    </section>
  );
}
