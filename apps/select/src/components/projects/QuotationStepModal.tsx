"use client";

import { useCallback, useEffect, useState } from "react";

import { DRIVE_GROUP_LABEL, type EnquiryQuotations, type TsmOption } from "../../lib/commercial";
import {
  createQuotation,
  getEnquiryQuotations,
  listTsmOptions,
  setQuotationErpSerial,
} from "../../services/quotationService";

// The enquiry's Quotation step — between Technical and Commercial on the
// Enquiries list. Generates one quotation per drive system in use (they share
// the serial), with the TSM (the client's rep in sales, else picked here) and
// the quotation no. as entered in ERP. Commercial stays locked until at least
// one exists. Later edits (ERP no., versions, send) stay on the Commercial page.

const btn =
  "inline-flex items-center gap-1.5 rounded-lg border border-line bg-paper px-3 py-1.5 text-[12.5px] font-semibold text-fg-2 hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-50";
const btnPrimary =
  "inline-flex items-center gap-1.5 rounded-lg bg-accent px-3.5 py-1.5 text-[12.5px] font-semibold text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50";
const inputCls =
  "w-full rounded-lg border border-line bg-paper px-2.5 py-1.5 text-[13px] text-fg outline-none focus:border-accent focus:ring-2 focus:ring-accent-soft";

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });

export default function QuotationStepModal({
  project,
  onClose,
  onDone,
  onOpenCommercial,
}: {
  project: { id: string; project_code: string; name: string | null };
  onClose: () => void;
  /** After generating / saving: how many quotations the enquiry has now. */
  onDone: (quotationCount: number) => void;
  onOpenCommercial: () => void;
}) {
  const [data, setData] = useState<EnquiryQuotations | null>(null);
  const [loadError, setLoadError] = useState("");
  const [options, setOptions] = useState<TsmOption[] | null>(null);
  const [tsmId, setTsmId] = useState("");
  const [erp, setErp] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    setLoadError("");
    try {
      const d = await getEnquiryQuotations(project.id);
      setData(d);
      setErp(Object.fromEntries(d.groups.map((g) => [g.group, g.quotation?.erpSerial ?? ""])));
      if (!d.clientTsm && d.groups.some((g) => !g.quotation)) {
        setOptions(await listTsmOptions().catch(() => []));
      }
      return d;
    } catch {
      setLoadError("Couldn't load the quotation details. Try again.");
      return null;
    }
  }, [project.id]);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !busy && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, busy]);

  const missing = data?.groups.filter((g) => !g.quotation) ?? [];
  const erpChanged = (data?.groups ?? []).filter(
    (g) => g.quotation && (erp[g.group] ?? "").trim().toUpperCase() !== (g.quotation.erpSerial ?? ""),
  );
  const needsTsm = missing.length > 0 && !data?.clientTsm;
  const canSubmit = !busy && (missing.length > 0 || erpChanged.length > 0) && (!needsTsm || !!tsmId);
  const allGenerated = !!data && data.groups.length > 0 && missing.length === 0;

  const submit = async () => {
    if (!data || !canSubmit) return;
    setBusy(true);
    setError("");
    setSaved(false);
    try {
      // One after another: the first claims the enquiry's serial, the rest share it.
      for (const g of missing) {
        const serial = (erp[g.group] ?? "").trim();
        await createQuotation(project.id, g.group, data.clientTsm ? undefined : Number(tsmId), serial || undefined);
      }
      for (const g of erpChanged) await setQuotationErpSerial(g.quotation!.id, (erp[g.group] ?? "").trim());
      const fresh = await load();
      if (fresh) onDone(fresh.groups.filter((g) => g.quotation).length);
      setSaved(true);
    } catch (e) {
      const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setError(msg || "Couldn't generate the quotation. Try again.");
      const fresh = await load();
      if (fresh) onDone(fresh.groups.filter((g) => g.quotation).length);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" onClick={() => !busy && onClose()}>
      <div
        className="flex max-h-[92vh] w-full max-w-[860px] flex-col overflow-hidden rounded-xl border border-line bg-paper"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-3 border-b border-line px-4 py-3">
          <div className="min-w-0">
            <h3 className="text-[15px] font-semibold text-fg">
              Quotation
              <span className="ml-2 text-[13px] font-normal text-fg-3">{project.project_code}</span>
            </h3>
            <p className="text-[12.5px] text-fg-3">
              {project.name || "—"} · one quotation per drive system, sharing one serial. Commercial opens once it&apos;s generated.
            </p>
          </div>
          <button type="button" className={btn} onClick={onClose} disabled={busy}>
            Close
          </button>
        </header>

        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4 text-[13px]">
          {loadError && (
            <p className="text-neg">
              {loadError}{" "}
              <button type="button" className="font-semibold text-accent hover:underline" onClick={() => void load()}>
                Retry
              </button>
            </p>
          )}
          {!data && !loadError && <p className="py-6 text-center text-fg-3">Loading…</p>}

          {data && data.groups.length === 0 && (
            <p className="rounded-lg border border-[var(--warn)] bg-[var(--warn-soft)] px-3 py-2.5 text-fg-2">
              No tag has a drive system yet — finish the <b>Drive</b> step of the pump selection first, then generate the
              quotation here.
            </p>
          )}

          {data && data.groups.length > 0 && (
            <>
              {missing.length > 0 && (
                <div className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-sunk px-3 py-2">
                  <span className="font-semibold text-fg-2">TSM</span>
                  {data.clientTsm ? (
                    <span className="text-fg">
                      {data.clientTsm.name} ({data.clientTsm.initials})
                      <span className="ml-1.5 text-[12px] text-fg-3">· the client&apos;s rep in sales</span>
                    </span>
                  ) : (
                    <>
                      <select
                        className={`${inputCls} w-auto min-w-[240px]`}
                        value={tsmId}
                        onChange={(e) => setTsmId(e.target.value)}
                        aria-label="TSM"
                      >
                        <option value="">{options === null ? "Loading…" : "Pick the TSM"}</option>
                        {(options ?? []).map((o) => (
                          <option key={o.id} value={o.id}>
                            {o.name} ({o.initials}){o.zone ? ` · ${o.zone}` : ""}
                          </option>
                        ))}
                      </select>
                      <span className="text-[12px] text-fg-3">This client has no rep in the sales portal.</span>
                    </>
                  )}
                </div>
              )}

              <div className="overflow-hidden rounded-lg border border-line">
                <div className="hidden grid-cols-[1.1fr_1.3fr_150px] gap-3 border-b border-line bg-sunk px-3 py-2 text-[11px] font-semibold tracking-[0.05em] text-fg-3 uppercase sm:grid">
                  <span>Drive system · tags</span>
                  <span>Quotation No. (System)</span>
                  <span>Quotation No. serial</span>
                </div>
                {data.groups.map((g) => (
                  <div
                    key={g.group}
                    className="grid grid-cols-1 items-center gap-2 border-b border-line px-3 py-2.5 last:border-b-0 sm:grid-cols-[1.1fr_1.3fr_150px] sm:gap-3"
                  >
                    <div className="min-w-0">
                      <p className="font-semibold text-fg">
                        {DRIVE_GROUP_LABEL[g.group]}
                        {data.groups.length > 1 && <span className="ml-1 font-mono text-[11.5px] text-fg-3">/{g.group}</span>}
                      </p>
                      <p className="truncate text-[12px] text-fg-3" title={g.tags.join(", ")}>
                        {g.tags.length} tag{g.tags.length === 1 ? "" : "s"} · {g.tags.join(", ")}
                      </p>
                    </div>
                    <div className="min-w-0">
                      {g.quotation ? (
                        <>
                          <p className="font-mono text-[12.5px] font-semibold break-all text-fg">{g.quotation.number}</p>
                          <p className="text-[12px] text-fg-3">
                            <span className="mr-1.5 rounded-full bg-[var(--pos-soft)] px-1.5 py-px text-[11px] font-semibold text-pos">
                              Generated
                            </span>
                            {fmtDate(g.quotation.quoteDate)}
                            {g.quotation.tsmName ? ` · TSM ${g.quotation.tsmName}` : ""}
                          </p>
                          {g.quotation.erpNumber && (
                            <p className="font-mono text-[11.5px] break-all text-fg-2">Quotation No.: {g.quotation.erpNumber}</p>
                          )}
                        </>
                      ) : (
                        <p className="text-fg-3">
                          <span className="mr-1.5 rounded-full bg-[var(--warn-soft)] px-1.5 py-px text-[11px] font-semibold text-warn">
                            Not generated
                          </span>
                          Will be dated {fmtDate(new Date().toISOString())}
                        </p>
                      )}
                    </div>
                    <input
                      className={`${inputCls} font-mono uppercase`}
                      value={erp[g.group] ?? ""}
                      maxLength={30}
                      placeholder="ERP serial"
                      aria-label={`Quotation No. serial for ${DRIVE_GROUP_LABEL[g.group]}`}
                      onChange={(e) => {
                        setErp((m) => ({ ...m, [g.group]: e.target.value }));
                        setSaved(false);
                      }}
                    />
                  </div>
                ))}
              </div>

              {data.noDriveTags.length > 0 && (
                <p className="text-[12px] text-fg-3">
                  Not quoted yet — no drive system: {data.noDriveTags.join(", ")}. Generate again here after their Drive step.
                </p>
              )}
              <p className="text-[12px] text-fg-3">
                The quotation no. (ERP) is what the Technical Data Sheet and the Commercial Offer show; it can still be
                changed later on the Commercial page.
              </p>
            </>
          )}
          {error && <p className="text-neg">{error}</p>}
        </div>

        <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-line px-4 py-3">
          {saved && !error && <span className="mr-auto text-[12.5px] font-medium text-pos">Saved</span>}
          {allGenerated && (
            <button type="button" className={btn} onClick={onOpenCommercial} disabled={busy}>
              Open Commercial →
            </button>
          )}
          {data && data.groups.length > 0 && (
            <button type="button" className={btnPrimary} onClick={() => void submit()} disabled={!canSubmit}>
              {busy
                ? "Working…"
                : missing.length > 0
                  ? `Generate quotation${missing.length > 1 ? `s (${missing.length})` : ""}`
                  : "Save quotation no."}
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}
