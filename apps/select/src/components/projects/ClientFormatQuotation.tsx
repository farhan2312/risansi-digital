"use client";

import { useCallback, useEffect, useState } from "react";
import { FileText } from "lucide-react";

import { Button } from "@/components/shadcn/button";
import { DRIVE_GROUP_LABEL, SPARE_GROUP, versionedQuotationNo, type TsmOption } from "../../lib/commercial";
import { createQuotation, getEnquiryQuotations, getQuotation, listTsmOptions, setQuotationErpSerial } from "../../services/quotationService";

// Client's own format (user, 2026-11-28): the documents are made by hand, but the
// quotation still has to exist with its Quotation No. serial (ERP) - Operation's list
// shows that number. Generates the quotation when it isn't yet (each drive system's, or
// the spare's), and the serial is required. Send to operation waits for it
// (review route: clientFormatQuotationProblem).

type Row = {
  group: string;
  label: string;
  quotation: { id: string; number: string; erpSerial: string | null; erpNumber: string | null } | null;
};

export default function ClientFormatQuotation({
  projectId,
  orderType,
  locked,
  onProblem,
}: {
  projectId: string;
  orderType: string;
  /** Sent to operation already: shown, not changed. */
  locked: boolean;
  /** What still stops Send to operation here, or null. */
  onProblem: (problem: string | null) => void;
}) {
  const spare = orderType === "spare";
  const [rows, setRows] = useState<Row[] | null>(null);
  const [version, setVersion] = useState(0);
  const [clientTsm, setClientTsm] = useState<TsmOption | null>(null);
  const [options, setOptions] = useState<TsmOption[] | null>(null);
  const [tsmId, setTsmId] = useState("");
  const [serial, setSerial] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    try {
      let next: Row[];
      let tsm: TsmOption | null;
      if (spare) {
        const d = await getQuotation(projectId, SPARE_GROUP);
        tsm = d.clientTsm;
        next = [{ group: SPARE_GROUP, label: "Quotation", quotation: d.quotation }];
      } else {
        const d = await getEnquiryQuotations(projectId);
        tsm = d.clientTsm;
        setVersion(d.version);
        next = d.groups.map((g) => ({ group: g.group, label: DRIVE_GROUP_LABEL[g.group], quotation: g.quotation }));
      }
      setRows(next);
      setClientTsm(tsm);
      setSerial(Object.fromEntries(next.map((r) => [r.group, r.quotation?.erpSerial ?? ""])));
      if (!tsm && next.some((r) => !r.quotation)) setOptions(await listTsmOptions().catch(() => []));
      setErr("");
    } catch {
      setErr("Couldn't load the quotation.");
    }
  }, [projectId, spare]);
  useEffect(() => {
    void load();
  }, [load]);

  // What Send to operation still waits for, from what is saved.
  useEffect(() => {
    if (!rows) return onProblem("Loading the quotation…");
    if (rows.length === 0) return onProblem("Client's own format: finish the Drive step, then generate the quotation.");
    const none = rows.filter((r) => !r.quotation);
    if (none.length) return onProblem(`Client's own format: generate the quotation${none.length > 1 ? "s" : ""} and enter the Quotation No. serial.`);
    if (rows.some((r) => !r.quotation?.erpSerial?.trim())) return onProblem("Client's own format: enter the Quotation No. serial.");
    onProblem(null);
  }, [rows, onProblem]);
  // Cleared when the box goes (client's own format off).
  useEffect(() => () => onProblem(null), [onProblem]);

  const missing = rows?.filter((r) => !r.quotation) ?? [];
  const changed = rows?.filter((r) => r.quotation && (serial[r.group] ?? "").trim().toUpperCase() !== (r.quotation.erpSerial ?? "")) ?? [];
  const blank = rows?.some((r) => !(serial[r.group] ?? "").trim()) ?? true;
  const needsTsm = missing.length > 0 && !clientTsm;
  const canSave = !busy && !locked && !blank && (missing.length > 0 || changed.length > 0) && (!needsTsm || !!tsmId);

  const save = async () => {
    if (!rows) return;
    setBusy(true);
    setErr("");
    try {
      // One after another: the first claims the enquiry's serial, the rest share it.
      for (const r of missing) await createQuotation(projectId, r.group, clientTsm ? undefined : Number(tsmId), (serial[r.group] ?? "").trim());
      for (const r of changed) await setQuotationErpSerial(r.quotation!.id, (serial[r.group] ?? "").trim());
      await load();
    } catch (e) {
      setErr((e as { response?: { data?: { error?: string } } })?.response?.data?.error ?? "Couldn't save the quotation. Try again.");
      await load();
    } finally {
      setBusy(false);
    }
  };

  const input =
    "h-9 w-full min-w-0 rounded-md border border-input bg-card px-2.5 font-mono text-[12px] text-foreground uppercase shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/25 disabled:opacity-50";

  return (
    <div className="mt-3 border-t border-dashed border-primary/25 pt-3">
      <p className="flex items-center gap-1.5 text-[12.5px] font-semibold text-foreground">
        <FileText className="size-4 text-primary" aria-hidden /> Quotation No. <span className="text-destructive">*</span>
        <span className="font-normal text-muted-foreground">- generated here if it isn&apos;t yet; the serial (ERP) is required.</span>
      </p>
      {!rows ? (
        <p className="mt-1.5 text-[12px] text-muted-foreground">{err || "Loading…"}</p>
      ) : rows.length === 0 ? (
        <p className="mt-1.5 text-[12px] text-warning">No tag has a drive system yet - finish the Drive step first.</p>
      ) : (
        <>
          {needsTsm && !locked && (
            <label className="mt-2 flex flex-wrap items-center gap-2 text-[12px] text-muted-foreground">
              TSM
              <select
                className="h-8 min-w-[220px] rounded-md border border-input bg-card px-2 text-[12.5px] text-foreground"
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
              This client has no rep in the sales portal.
            </label>
          )}
          <div className={`mt-2 grid items-start gap-3 ${rows.length > 1 ? "md:grid-cols-2" : "md:max-w-[520px]"}`}>
            {rows.map((r) => (
              <div key={r.group} className="flex min-w-0 flex-col gap-1">
                <span className="text-[12px] font-medium text-foreground">
                  {r.label}
                  {r.quotation ? (
                    <span className="ml-1.5 font-mono text-[11.5px] font-normal text-primary">
                      {r.quotation.erpNumber ? versionedQuotationNo(r.quotation.erpNumber, version) : r.quotation.number}
                    </span>
                  ) : (
                    <span className="ml-1.5 text-[11.5px] font-normal text-warning">not generated yet</span>
                  )}
                </span>
                <input
                  className={input}
                  value={serial[r.group] ?? ""}
                  maxLength={30}
                  disabled={busy || locked}
                  placeholder="Quotation No. serial (ERP)"
                  aria-label={`Quotation No. serial for ${r.label}`}
                  aria-invalid={!(serial[r.group] ?? "").trim() ? true : undefined}
                  onChange={(e) => setSerial((m) => ({ ...m, [r.group]: e.target.value }))}
                />
              </div>
            ))}
          </div>
          {!locked && (missing.length > 0 || changed.length > 0) && (
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <Button size="sm" disabled={!canSave} onClick={() => void save()}>
                {busy ? "Saving…" : missing.length > 0 ? `Generate quotation${missing.length > 1 ? `s (${missing.length})` : ""}` : "Save serial"}
              </Button>
              {blank && <span className="text-[12px] text-warning">Enter the Quotation No. serial.</span>}
            </div>
          )}
          {err && <p className="mt-2 text-[12px] font-medium text-destructive">{err}</p>}
        </>
      )}
    </div>
  );
}
