"use client";

import { useEffect, useState } from "react";

import ConfirmModal from "../../components/ui/ConfirmModal";
import CommercialOfferModal from "./CommercialOfferModal";
import { normalizeOfferConfig } from "../../lib/commercial-offer";
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
  otherNet,
  versionLabel,
} from "../../lib/commercial";
import {
  changeQuotationTsm,
  createQuotation,
  setQuotationErpSerial,
  getQuotation,
  listTsmOptions,
  newInternalVersion,
  sendQuotationToClient,
} from "../../services/quotationService";

// Quotation header on the Commercial Summary page: the self-generated number,
// the TSM, "New internal version" (the TSM asked for changes → next internal
// version) and "Send to client" (→ next client version). The two version
// tracks never move each other. Reassigning the TSM makes no version. The
// serial (6000, 6001, …) is issued when the quotation is created.

const selectCls =
  "rounded-lg border border-line bg-paper px-3 py-2 text-[13px] text-fg outline-none focus:border-accent focus:ring-2 focus:ring-accent-soft disabled:opacity-60";
const btnSm =
  "inline-flex items-center gap-1.5 rounded-lg border border-line bg-paper px-3 py-1.5 text-[12.5px] font-semibold whitespace-nowrap text-fg-2 transition-colors hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-50";
const btnPrimarySm =
  "inline-flex items-center gap-1.5 rounded-lg bg-accent px-3.5 py-1.5 text-[12.5px] font-semibold whitespace-nowrap text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50";

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
}) {
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
    return <section className="rounded-xl border border-line bg-paper p-4 text-[13px] text-fg-3">Loading quotation…</section>;
  }
  if (loadError) {
    return <section className="rounded-xl border border-line bg-paper p-4 text-[13px] text-neg">{loadError}</section>;
  }

  // Locked: the client's rep, read-only. Otherwise a pick list.
  const tsmField = clientTsm ? (
    <div className="flex min-w-0 flex-col">
      <span className="truncate text-[13px] font-semibold text-fg" title={tsmLabel(clientTsm)}>
        {tsmLabel(clientTsm)}
      </span>
      <span className="text-[11.5px] text-fg-3">The client's rep in the sales portal</span>
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

  // --- Not created yet --------------------------------------------------------
  if (!quotation) {
    return (
      <section className="rounded-xl border border-line bg-paper">
        <header className="border-b border-line px-4 py-3">
          <h2 className="text-[14px] font-semibold text-fg">Quotation{groupLabel ? ` — ${groupLabel}` : ""}</h2>
        </header>
        <div className="flex flex-col gap-3 p-4">
          <p className="text-[13px] text-fg-2">
            No quotation for {groupLabel ? `the ${groupLabel} tags` : "this enquiry"} yet. Creating one fills in the number, date and client, and starts
            internal V0.{" "}
            {clientTsm
              ? "The TSM is the client's rep in the sales portal."
              : "This client has no rep in the sales portal, so pick the TSM."}
          </p>
          <div className="flex flex-wrap items-center gap-3">
            {tsmField}
            <label className="flex items-center gap-2 text-[12.5px] text-fg-2">
              Quotation No. (ERP) serial
              <input
                className="w-[130px] rounded-lg border border-line bg-paper px-2.5 py-1.5 font-mono text-[13px] text-fg uppercase outline-none focus:border-accent focus:ring-2 focus:ring-accent-soft"
                value={erpDraft}
                maxLength={30}
                placeholder="optional"
                onChange={(e) => setErpDraft(e.target.value)}
              />
            </label>
            <button
              type="button"
              className={btnPrimarySm}
              disabled={busy || !picked}
              onClick={() =>
                picked &&
                run(
                  () => createQuotation(projectId, group, clientTsm ? undefined : picked.id, erpDraft.trim() || undefined),
                  "Couldn't create the quotation.",
                )
              }
            >
              {busy ? "Creating…" : "Create Quotation"}
            </button>
          </div>
          {optionsError && <p className="text-[12px] text-warn">The TSM list from the sales portal is unavailable right now.</p>}
          {actionError && <p className="text-[12.5px] text-neg">{actionError}</p>}
        </div>
      </section>
    );
  }

  // --- Existing quotation -----------------------------------------------------
  // Locked TSM: only offer a change when sales has since given the client a
  // different rep. Unlocked: when a different person is picked.
  const tsmChanged = picked !== null && picked.id !== quotation.tsmRepId;
  const nextClient = quotation.clientVersion === null ? 0 : quotation.clientVersion + 1;
  // The internal version that follows the saved prices (null once it was sent).
  const liveInternal = quotation.versions.find((v) => v.track === "internal" && v.live) ?? null;
  const internal = quotation.versions.filter((v) => v.track === "internal");
  const client = quotation.versions.filter((v) => v.track === "client");

  return (
    <section className="rounded-xl border border-line bg-paper">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
        <div className="min-w-0">
          <h2 className="text-[14px] font-semibold text-fg">Quotation{groupLabel ? ` — ${groupLabel}` : ""}</h2>
          <p className="mt-0.5 font-mono text-[15px] font-semibold break-all text-fg">{quotation.number}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <VersionBadge label="Internal" value={versionLabel(quotation.internalVersion)} />
          <VersionBadge label="Client" value={versionLabel(quotation.clientVersion)} muted={quotation.clientVersion === null} />
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
            New internal version
          </button>
          <button
            type="button"
            className={btnPrimarySm}
            disabled={busy || hasUnsavedPrices || !liveInternal}
            title={
              hasUnsavedPrices
                ? "Save the price changes first"
                : !liveInternal
                  ? "Already sent — start a new internal version for further changes"
                  : undefined
            }
            onClick={() => setConfirm("send")}
          >
            Send to client
          </button>
        </div>
      </header>

      <div className="grid grid-cols-1 gap-4 p-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="text-[11px] font-semibold tracking-[0.08em] text-fg-3 uppercase">Quotation No. (ERP)</span>
          <span className="flex flex-wrap items-center gap-1.5">
            <input
              className="w-[120px] rounded-md border border-line bg-paper px-2 py-1 font-mono text-[12.5px] text-fg uppercase outline-none focus:border-accent"
              value={erpDraft}
              maxLength={30}
              placeholder="ERP serial"
              aria-label="ERP serial"
              onChange={(e) => setErpDraft(e.target.value)}
            />
            {erpDraft.trim().toUpperCase() !== (quotation.erpSerial ?? "") && (
              <button
                type="button"
                className={btnSm}
                disabled={busy}
                onClick={() => run(() => setQuotationErpSerial(quotation.id, erpDraft.trim()), "Couldn't save the ERP serial.")}
              >
                Save
              </button>
            )}
          </span>
          <span className="font-mono text-[11.5px] break-all text-fg-2">{quotation.erpNumber ?? "—"}</span>
        </div>
        <Info label="Date" value={new Date(quotation.quoteDate).toLocaleDateString("en-IN", { dateStyle: "medium" })} />
        <Info label="Client" value={[quotation.clientName, quotation.clientCode].filter(Boolean).join(" · ") || "—"} />
        <Info label="Region (TSM initials)" value={quotation.regionCode ?? "—"} />
        <div className="flex min-w-0 flex-col gap-1">
          <span className="text-[11.5px] font-semibold tracking-[0.09em] text-fg-3 uppercase">TSM</span>
          {clientTsm && tsmChanged ? (
            <div className="flex flex-col gap-1.5">
              <span className="truncate text-[13px] text-fg">{quotation.tsmName ?? "—"}</span>
              <span className="text-[11.5px] text-warn">Sales now shows {clientTsm.name} as the client's rep.</span>
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
      </div>

      {!liveInternal && (
        <p className="px-4 pb-2 text-[12px] text-warn">
          Internal V{quotation.internalVersion} was sent to the client and is frozen. If the TSM asks for changes,
          start a new internal version before changing prices.
        </p>
      )}
      {hasUnsavedPrices && (
        <p className="px-4 pb-2 text-[12px] text-warn">
          Save the price changes below before making a new version or sending to the client.
        </p>
      )}
      {actionError && <p className="px-4 pb-3 text-[12.5px] text-neg">{actionError}</p>}

      <div className="grid grid-cols-1 gap-4 border-t border-line p-4 md:grid-cols-2">
        <VersionList title="Internal versions" hint="A new one each time the TSM asks for changes." items={internal} onView={setViewing} />
        <VersionList title="Client versions" hint="A new one each time it is sent to the client." items={client} onView={setViewing} />
      </div>

      <ConfirmModal
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
      <ConfirmModal
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
        <label className="mt-3 flex flex-col gap-1.5 text-left">
          <span className="text-[12px] font-semibold text-fg-2">
            Changes requested by the TSM ({quotation.tsmName ?? "—"})
          </span>
          <textarea
            className={`min-h-[80px] resize-y rounded-lg border bg-paper px-3 py-2 text-[13px] text-fg outline-none focus:border-accent focus:ring-2 focus:ring-accent-soft ${
              noteError ? "border-neg" : "border-line"
            }`}
            value={note}
            maxLength={2000}
            placeholder="e.g. Reduce P&A by 5%, change motor make to Siemens"
            onChange={(e) => {
              setNote(e.target.value);
              if (e.target.value.trim()) setNoteError(false);
            }}
          />
          {noteError && <span className="text-[11.5px] text-neg">Describe what the TSM asked to change.</span>}
        </label>
      </ConfirmModal>
      <ConfirmModal
        open={confirm === "send"}
        title={`Record client V${nextClient}?`}
        description={
          <>
            Marks internal V{quotation.internalVersion} ({formatInr(liveInternal?.snapshot.grandTotal ?? 0)}) as sent
            to the client as <b>client V{nextClient}</b>. Both keep a frozen copy of these prices; further changes need a
            new internal version. Nothing is e-mailed.
          </>
        }
        confirmLabel={`Send as client V${nextClient}`}
        busy={busy}
        onClose={() => setConfirm(null)}
        onConfirm={() => run(() => sendQuotationToClient(quotation.id), "Couldn't record the send.")}
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
    <span className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-sunk px-2.5 py-1 text-[12px]">
      <span className="text-fg-3">{label}</span>
      <b className={`font-mono ${muted ? "text-fg-3" : "text-fg"}`}>{value}</b>
    </span>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="text-[11.5px] font-semibold tracking-[0.09em] text-fg-3 uppercase">{label}</span>
      <span className="truncate pt-1.5 text-[13px] text-fg" title={value}>
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
      <h3 className="text-[12.5px] font-semibold text-fg">{title}</h3>
      <p className="mb-2 text-[11.5px] text-fg-3">{hint}</p>
      {items.length === 0 ? (
        <p className="rounded-lg border border-dashed border-line px-3 py-2.5 text-[12.5px] text-fg-3">None yet.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-line rounded-lg border border-line">
          {items.map((v) => (
            <li key={v.id} className="flex items-center justify-between gap-3 px-3 py-2">
              <div className="min-w-0">
                <p className="text-[13px] text-fg">
                  <b className="font-mono">V{v.version}</b> <span className="text-fg-2">· {v.reason ?? ""}</span>
                  {v.live && (
                    <span className="ml-2 rounded-full bg-[var(--pos-soft)] px-2 py-0.5 text-[10.5px] font-semibold text-pos">
                      Live · follows saved prices
                    </span>
                  )}
                </p>
                {v.note && (
                  <p className="line-clamp-2 text-[12px] text-fg-2" title={v.note}>
                    &ldquo;{v.note}&rdquo;
                  </p>
                )}
                <p className="truncate text-[11.5px] text-fg-3">
                  {fmtDate(v.createdAt)}
                  {v.createdByName ? ` · ${v.createdByName}` : ""} · TSM {v.tsmInitials ?? "—"} ·{" "}
                  {formatInr(v.snapshot.grandTotal)}
                </p>
              </div>
              <button type="button" className={btnSm} onClick={() => onView(v)}>
                View
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
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="flex max-h-[90vh] w-full max-w-[900px] flex-col overflow-hidden rounded-xl border border-line bg-paper"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-3 border-b border-line px-4 py-3">
          <div>
            {number && <p className="font-mono text-[12.5px] font-semibold break-all text-fg-2">{number}</p>}
            <h3 className="text-[14px] font-semibold text-fg">
              {version.track === "internal" ? "Internal" : "Client"} V{version.version}
              {version.live && <span className="ml-2 text-[12px] font-normal text-pos">Live — current saved prices</span>}
            </h3>
            <p className="text-[12px] text-fg-3">
              {version.reason} · {fmtDate(version.createdAt)} · TSM {version.tsmName ?? "—"}
            </p>
            {version.note && (
              <p className="mt-1 text-[12.5px] whitespace-pre-line text-fg-2">
                <span className="font-semibold">Asked for:</span> {version.note}
              </p>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button type="button" className={btnSm} onClick={() => setShowOffer(true)}>
              Commercial Offer
            </button>
            <button type="button" className={btnSm} onClick={onClose}>
              Close
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
            onClose={() => setShowOffer(false)}
          />
        )}
        <div className="overflow-auto">
          <table className="w-full min-w-[600px] text-[13px]">
            <thead>
              <tr className="border-b border-line text-left text-[11.5px] font-semibold tracking-[0.06em] text-fg-3 uppercase">
                <th className="px-4 py-2">Tag</th>
                <th className="px-4 py-2">Pump Model</th>
                <th className="px-4 py-2 text-right">Unit Price</th>
                <th className="px-4 py-2 text-right">Qty</th>
                <th className="px-4 py-2 text-right">Sub-total</th>
              </tr>
            </thead>
            <tbody>
              {s.tags.map((t, i) => (
                <tr key={i} className="border-b border-line last:border-b-0">
                  <td className="px-4 py-2 font-semibold text-fg">{t.tagName}</td>
                  <td className="px-4 py-2 text-fg-2">{t.productCode ?? t.model ?? "—"}</td>
                  <td className="px-4 py-2 text-right font-mono">{formatInr(t.unit)}</td>
                  <td className="px-4 py-2 text-right font-mono">{t.quantity ?? "—"}</td>
                  <td className="px-4 py-2 text-right font-mono">{formatInr(t.sub)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-line-strong bg-sunk">
                <td colSpan={4} className="px-4 py-2.5 text-right font-semibold text-fg">
                  Grand Total
                </td>
                <td className="px-4 py-2.5 text-right font-mono font-bold text-fg">{formatInr(s.grandTotal)}</td>
              </tr>
            </tfoot>
          </table>

          {/* Each tag's price build-up, as saved in this version. */}
          <div className="flex flex-col gap-3 border-t border-line bg-sunk p-4">
            {s.remarks && (
              <p className="rounded-lg border border-line bg-paper px-3 py-2 text-[12.5px] whitespace-pre-line text-fg-2">
                <span className="font-semibold">Remarks:</span> {s.remarks}
              </p>
            )}
            <h4 className="text-[11.5px] font-semibold tracking-[0.09em] text-fg-3 uppercase">Details by tag</h4>
            {s.tags.map((t, i) => (
              <TagBreakdown key={i} tag={t} />
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

function TagBreakdown({ tag }: { tag: SnapshotTag }) {
  const p = tag.prices;
  const join = (...parts: (string | null | undefined)[]) => parts.filter(Boolean).join(" · ") || null;
  const line = (label: string, value: number | null | undefined, note?: string | null, key?: string) => (
    <tr key={key ?? label} className="border-b border-line last:border-b-0">
      <td className="px-3 py-1.5 text-fg-2">
        {label}
        {note && <span className="ml-2 font-mono text-[11.5px] text-fg-3">{note}</span>}
      </td>
      <td className={`px-3 py-1.5 text-right font-mono ${value == null ? "text-fg-4" : "text-fg"}`}>
        {formatInr(value ?? null)}
      </td>
    </tr>
  );
  return (
    <section className="rounded-lg border border-line bg-paper">
      <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line px-3 py-2">
        <span className="text-[13.5px] font-semibold text-fg">
          {tag.tagName}
          <span className="ml-2 text-[12.5px] font-normal text-fg-3">{tag.productCode ?? tag.model ?? "No pump"}</span>
        </span>
        <span className="text-[12px] text-fg-3">Qty {tag.quantity ?? "not set"}</span>
      </header>
      <table className="w-full text-[12.5px]">
        <tbody>
          {line("Pump & Accessories", p.paPrice, p.paBasis)}
          <tr className="border-b border-line bg-sunk">
            <td colSpan={2} className="px-3 py-1 text-[11px] font-semibold tracking-[0.08em] text-fg-3 uppercase">
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
          <tr className="border-t border-line">
            <td className="px-3 py-1.5 text-right text-fg-3">BOI total</td>
            <td className="px-3 py-1.5 text-right font-mono text-fg-2">{formatInr(boiTotal({ ...p, others: p.others ?? [] }))}</td>
          </tr>
          <tr>
            <td className="px-3 py-1.5 text-right font-semibold text-fg">Unit price</td>
            <td className="px-3 py-1.5 text-right font-mono font-semibold text-fg">{formatInr(tag.unit)}</td>
          </tr>
          <tr>
            <td className="px-3 py-1.5 text-right text-fg-3">× Quantity</td>
            <td className="px-3 py-1.5 text-right font-mono text-fg-2">{tag.quantity ?? "—"}</td>
          </tr>
          <tr className="border-t border-line-strong bg-sunk">
            <td className="px-3 py-2 text-right font-semibold text-fg">Sub-total</td>
            <td className="px-3 py-2 text-right font-mono font-bold text-fg">{formatInr(tag.sub)}</td>
          </tr>
        </tfoot>
      </table>
      {p.remarks && (
        <p className="border-t border-line px-3 py-2 text-[12px] whitespace-pre-line text-fg-2">
          <span className="font-semibold">Remarks:</span> {p.remarks}
        </p>
      )}
    </section>
  );
}
