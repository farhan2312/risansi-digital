"use client";

import { useCallback, useEffect, useState } from "react";

import { ArrowRight, CircleCheck } from "lucide-react";

import { ConfirmDialog } from "@/components/shadcn/alert-dialog";
import { Badge } from "@/components/shadcn/badge";
import { Button } from "@/components/shadcn/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/shadcn/dialog";
import { Alert } from "@/components/shadcn/field";
import { Input, NativeSelect } from "@/components/shadcn/input";
import { DRIVE_GROUP_LABEL, type EnquiryQuotations, type TsmOption } from "../../lib/commercial";
import ScopeControls, { ScopeLines } from "../../screens/commercial/ScopeControls";
import { EMPTY_OFFER_CONFIG, type OfferConfig } from "../../lib/commercial-offer";
import { getCommercialOffer, saveCommercialOfferConfig } from "../../services/commercialOfferService";
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
// one exists. Also each group's Scope of supply / Out of scope (its offer
// config — the Technical Data Sheet and the Commercial Offer both print them).
// Later edits (ERP no., scope, versions, send) can still be made on Commercial.

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
  // Each drive group's offer config (scope lists live there): the form's copy,
  // and what is saved. The Save button below writes the difference.
  const [offerConfigs, setOfferConfigs] = useState<Record<string, OfferConfig> | null>(null);
  const [savedConfigs, setSavedConfigs] = useState<Record<string, OfferConfig>>({});
  const [confirmClose, setConfirmClose] = useState(false);
  useEffect(() => {
    let cancelled = false;
    getCommercialOffer(project.id)
      .then((d) => {
        if (cancelled) return;
        setOfferConfigs(d.configs);
        setSavedConfigs(d.configs);
      })
      .catch(() => !cancelled && setOfferConfigs({}));
    return () => {
      cancelled = true;
    };
  }, [project.id]);
  const changeScope = (group: string, next: OfferConfig) => {
    setOfferConfigs((m) => ({ ...(m ?? {}), [group]: next }));
    setSaved(false);
  };

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
  const missing = data?.groups.filter((g) => !g.quotation) ?? [];
  const erpChanged = (data?.groups ?? []).filter(
    (g) => g.quotation && (erp[g.group] ?? "").trim().toUpperCase() !== (g.quotation.erpSerial ?? ""),
  );
  const needsTsm = missing.length > 0 && !data?.clientTsm;
  const scopeChanged = (data?.groups ?? [])
    .map((g) => g.group)
    .filter((g) => JSON.stringify(offerConfigs?.[g] ?? EMPTY_OFFER_CONFIG) !== JSON.stringify(savedConfigs[g] ?? EMPTY_OFFER_CONFIG));
  const unsaved = erpChanged.length > 0 || scopeChanged.length > 0;
  const canSubmit = !busy && (missing.length > 0 || unsaved) && (!needsTsm || !!tsmId);
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
      for (const g of scopeChanged) {
        const config = offerConfigs?.[g] ?? EMPTY_OFFER_CONFIG;
        await saveCommercialOfferConfig(project.id, g, config);
        setSavedConfigs((m) => ({ ...m, [g]: config }));
      }
      const fresh = await load();
      if (fresh) onDone(fresh.groups.filter((g) => g.quotation).length);
      setSaved(true);
    } catch (e) {
      const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setError(msg || (missing.length > 0 ? "Couldn't generate the quotation. Try again." : "Couldn't save. Try again."));
      const fresh = await load();
      if (fresh) onDone(fresh.groups.filter((g) => g.quotation).length);
    } finally {
      setBusy(false);
    }
  };

  const requestClose = () => {
    if (busy) return;
    if (unsaved) setConfirmClose(true);
    else onClose();
  };
  return (
    // Escape or the X asks first when something is unsaved (requestClose); the
    // close confirm is a nested dialog, so Escape there only closes the confirm.
    <Dialog open onOpenChange={(o) => !o && requestClose()}>
      <DialogContent
        // Wide and tall enough that the scope dropdowns (340px lists) open
        // without squeezing; the body scrolls inside.
        size="full"
        className="h-[90vh]"
      >
        <DialogHeader>
          <DialogTitle>
            Quotation
            <span className="ml-2 font-mono text-[12.5px] font-normal text-muted-foreground">{project.project_code}</span>
          </DialogTitle>
          <DialogDescription>
            {project.name || "—"} · one quotation per drive system, sharing one serial. Technical and Commercial open once it&apos;s generated.
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="flex flex-col gap-3 text-[13px]">
          {loadError && (
            <Alert className="flex flex-wrap items-center gap-2">
              {loadError}
              <Button variant="link" size="sm" className="h-auto px-0" onClick={() => void load()}>
                Retry
              </Button>
            </Alert>
          )}
          {!data && !loadError && <p className="py-6 text-center text-muted-foreground">Loading…</p>}

          {data && data.groups.length === 0 && (
            <Alert tone="warning" className="font-normal text-foreground">
              No tag has a drive system yet — finish the <b>Drive</b> step of the pump selection first, then generate the
              quotation here.
            </Alert>
          )}

          {data && data.groups.length > 0 && (
            <>
              {missing.length > 0 && (
                <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-muted/50 px-3 py-2">
                  <span className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">TSM</span>
                  {data.clientTsm ? (
                    <span className="text-foreground">
                      {data.clientTsm.name} ({data.clientTsm.initials})
                      <span className="ml-1.5 text-[12px] text-muted-foreground">· the client&apos;s rep in sales</span>
                    </span>
                  ) : (
                    <>
                      <NativeSelect className="min-w-[240px]" value={tsmId} onChange={(e) => setTsmId(e.target.value)} aria-label="TSM">
                        <option value="">{options === null ? "Loading…" : "Pick the TSM"}</option>
                        {(options ?? []).map((o) => (
                          <option key={o.id} value={o.id}>
                            {o.name} ({o.initials}){o.zone ? ` · ${o.zone}` : ""}
                          </option>
                        ))}
                      </NativeSelect>
                      <span className="text-[12px] text-muted-foreground">This client has no rep in the sales portal.</span>
                    </>
                  )}
                </div>
              )}

              {/* Not overflow-hidden: the scope dropdowns open past the box's edge. */}
              <div className="rounded-md border border-border">
                <div className="hidden grid-cols-[1.1fr_1.3fr_150px] gap-3 rounded-t-md border-b border-border bg-muted/60 px-3 py-2 text-[11px] font-medium tracking-wide text-muted-foreground uppercase sm:grid">
                  <span>Drive system · tags</span>
                  <span>Quotation No. (System)</span>
                  <span>Quotation No. serial</span>
                </div>
                {data.groups.map((g) => (
                  <div key={g.group} className="border-b border-border last:border-b-0 last:[&>div:last-child]:rounded-b-md">
                    <div className="grid grid-cols-1 items-center gap-2 px-3 py-2.5 sm:grid-cols-[1.1fr_1.3fr_150px] sm:gap-3">
                      <div className="min-w-0">
                        <p className="font-medium text-foreground">
                          {DRIVE_GROUP_LABEL[g.group]}
                          {data.groups.length > 1 && <span className="ml-1 font-mono text-[11.5px] text-muted-foreground">/{g.group}</span>}
                        </p>
                        <p className="truncate text-[12px] text-muted-foreground" title={g.tags.join(", ")}>
                          {g.tags.length} tag{g.tags.length === 1 ? "" : "s"} · {g.tags.join(", ")}
                        </p>
                      </div>
                      <div className="min-w-0">
                        {g.quotation ? (
                          <>
                            <p className="font-mono text-[12.5px] font-semibold break-all text-primary">{g.quotation.number}</p>
                            <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[12px] text-muted-foreground">
                              <Badge tone="success" dot>
                                Generated
                              </Badge>
                              {fmtDate(g.quotation.quoteDate)}
                              {g.quotation.tsmName ? ` · TSM ${g.quotation.tsmName}` : ""}
                            </p>
                            {g.quotation.erpNumber && (
                              <p className="mt-0.5 font-mono text-[11.5px] break-all text-foreground/80">Quotation No.: {g.quotation.erpNumber}</p>
                            )}
                          </>
                        ) : (
                          <p className="flex flex-wrap items-center gap-1.5 text-muted-foreground">
                            <Badge tone="warning" dot>
                              Not generated
                            </Badge>
                            Will be dated {fmtDate(new Date().toISOString())}
                          </p>
                        )}
                      </div>
                      <Input
                        className="font-mono uppercase"
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
                    <div className="flex flex-col gap-2 border-t border-dashed border-border bg-muted/40 px-3 py-2.5">
                      {offerConfigs === null ? (
                        <span className="text-[12px] text-muted-foreground">Loading scope…</span>
                      ) : (
                        <>
                          <ScopeControls
                            config={offerConfigs[g.group] ?? EMPTY_OFFER_CONFIG}
                            group={g.group}
                            onChange={(next) => changeScope(g.group, next)}
                          />
                          <ScopeLines config={offerConfigs[g.group] ?? EMPTY_OFFER_CONFIG} group={g.group} />
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              {data.noDriveTags.length > 0 && (
                <p className="text-[12px] text-muted-foreground">
                  Not quoted yet — no drive system: {data.noDriveTags.join(", ")}. Generate again here after their Drive step.
                </p>
              )}
              <p className="text-[12px] text-muted-foreground">
                The quotation no. (ERP) and the scope lines are what the Technical Data Sheet and the Commercial Offer
                show; both can still be changed later on the Commercial page.
              </p>
            </>
          )}
          {error && <Alert>{error}</Alert>}
        </DialogBody>

        <DialogFooter>
          {unsaved ? (
            <span className="mr-auto text-[12.5px] font-medium text-warning">Unsaved changes</span>
          ) : (
            saved &&
            !error && (
              <span className="mr-auto inline-flex items-center gap-1 text-[12.5px] font-medium text-success">
                <CircleCheck className="size-3.5" /> Saved
              </span>
            )
          )}
          {allGenerated && (
            <Button variant="outline" onClick={onOpenCommercial} disabled={busy || unsaved} title={unsaved ? "Save your changes first" : undefined}>
              Open Commercial <ArrowRight />
            </Button>
          )}
          {data && data.groups.length > 0 && (
            <Button onClick={() => void submit()} disabled={!canSubmit}>
              {busy
                ? "Working…"
                : missing.length > 0
                  ? `Generate quotation${missing.length > 1 ? `s (${missing.length})` : ""}`
                  : "Save"}
            </Button>
          )}
        </DialogFooter>

        <ConfirmDialog
          open={confirmClose}
          title="Close without saving?"
          description="Your changes to the scope or the quotation no. will be lost."
          confirmLabel="Close without saving"
          cancelLabel="Keep editing"
          tone="danger"
          onConfirm={onClose}
          onClose={() => setConfirmClose(false)}
        />
      </DialogContent>
    </Dialog>
  );
}
