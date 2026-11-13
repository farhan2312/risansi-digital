"use client";

import { useEffect, useState } from "react";
import { History } from "lucide-react";

import { Badge } from "@/components/shadcn/badge";
import { Button } from "@/components/shadcn/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/shadcn/dialog";
import { Alert, Field, Textarea } from "@/components/shadcn/field";
import { Input, NativeSelect } from "@/components/shadcn/input";
import { CLEARANCE_STATUSES, HOLD_REASONS, OTHER_REASON_GROUP, holdReasonText, type ClearanceEntry, type ClearanceNow, type ClearanceStatus } from "../../lib/clearance";
import { addClearanceReason, getClearance, saveClearance } from "../../services/clearanceService";

const ADD = "__add__";
const SEP = "|";

export const clearanceTone = (status: ClearanceStatus) => (status === "Clear" ? "bg-[var(--pos-soft)] text-pos" : "bg-[var(--warn-soft)] text-warn");

const fmtWhen = (iso: string) => new Date(iso).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

/** Set an enquiry's clearance and see its history. View only for someone who can't
 *  work on the enquiry. */
export default function ClearanceModal({
  project,
  canEdit,
  onClose,
  onSaved,
}: {
  project: { id: string; project_code: string; name: string | null; clearance?: ClearanceNow | null };
  canEdit: boolean;
  onClose: () => void;
  onSaved: (now: ClearanceNow) => void;
}) {
  const now = project.clearance ?? null;
  // An enquiry is Clear until someone holds it.
  const [status, setStatus] = useState<ClearanceStatus>(now?.status ?? "Clear");
  const [pick, setPick] = useState(now?.status === "Hold" && now.group ? `${now.group}${SEP}${now.reason ?? ""}` : "");
  const [remarks, setRemarks] = useState("");
  const [history, setHistory] = useState<ClearanceEntry[] | null>(null);
  const [others, setOthers] = useState<string[]>([]);
  const [adding, setAdding] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    getClearance(project.id)
      .then((d) => {
        if (cancelled) return;
        setHistory(d.history);
        setOthers(d.otherReasons);
      })
      .catch(() => !cancelled && setError("Couldn't load the history."));
    return () => {
      cancelled = true;
    };
  }, [project.id]);

  const errMsg = (e: unknown, fallback: string) => (e as { response?: { data?: { error?: string } } })?.response?.data?.error ?? fallback;

  const addReason = async () => {
    const label = (adding ?? "").trim();
    if (!label) return;
    setError("");
    try {
      const saved = await addClearanceReason(label);
      setOthers((list) => [...list, saved].sort((a, b) => a.localeCompare(b)));
      setPick(`${OTHER_REASON_GROUP}${SEP}${saved}`);
      setAdding(null);
    } catch (e) {
      setError(errMsg(e, "Couldn't add the reason."));
    }
  };

  const canSave = !busy && (status === "Clear" || Boolean(pick));
  const save = async () => {
    if (!canSave) return;
    setBusy(true);
    setError("");
    try {
      const [group, reason] = pick.split(SEP);
      const res = await saveClearance(project.id, status === "Hold" ? { status, group, reason: reason || undefined, remarks } : { status, remarks });
      setHistory(res.history);
      setRemarks("");
      onSaved(res.now);
    } catch (e) {
      setError(errMsg(e, "Couldn't save. Try again."));
    } finally {
      setBusy(false);
    }
  };

  return (
    // Escape or the X closes it (not while saving).
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent size="md" className="max-w-[560px]">
        <DialogHeader>
          <DialogTitle>Clearance</DialogTitle>
          <DialogDescription className="truncate font-mono">
            {project.project_code}
            {project.name ? ` · ${project.name}` : ""}
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="flex flex-col gap-5">
          {canEdit ? (
            <section className="flex flex-col gap-3.5">
              <div className="grid grid-cols-2 gap-1 rounded-md bg-muted p-1 ring-1 ring-border ring-inset" role="radiogroup" aria-label="Clearance">
                {CLEARANCE_STATUSES.map((s) => (
                  <button
                    key={s}
                    type="button"
                    role="radio"
                    aria-checked={status === s}
                    onClick={() => setStatus(s)}
                    className={`rounded-[5px] px-3 py-1.5 text-[13px] font-medium transition-[color,background-color,box-shadow] outline-none focus-visible:ring-[3px] focus-visible:ring-ring/30 ${
                      status === s
                        ? `bg-card shadow-[0_1px_2px_rgba(15,23,42,0.1)] ${s === "Clear" ? "text-success" : "text-warning"}`
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {s}
                  </button>
                ))}
              </div>

              {status === "Hold" && (
                <Field label="Reason for the hold">
                  <NativeSelect
                    className="w-full"
                    value={pick}
                    onChange={(e) => {
                      if (e.target.value === ADD) setAdding("");
                      else {
                        setPick(e.target.value);
                        setAdding(null);
                      }
                    }}
                  >
                    <option value="">Select the reason</option>
                    {HOLD_REASONS.map((r) =>
                      r.reasons.length ? (
                        <optgroup key={r.group} label={r.group}>
                          {r.reasons.map((x) => (
                            <option key={x} value={`${r.group}${SEP}${x}`}>
                              {x}
                            </option>
                          ))}
                        </optgroup>
                      ) : (
                        <option key={r.group} value={`${r.group}${SEP}`}>
                          {r.group}
                        </option>
                      ),
                    )}
                    <optgroup label={OTHER_REASON_GROUP}>
                      {others.map((x) => (
                        <option key={x} value={`${OTHER_REASON_GROUP}${SEP}${x}`}>
                          {x}
                        </option>
                      ))}
                      <option value={ADD}>+ Add new reason…</option>
                    </optgroup>
                  </NativeSelect>
                </Field>
              )}

              {status === "Hold" && adding !== null && (
                <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-muted/50 p-2.5">
                  <div className="min-w-[180px] flex-1">
                    <Input
                      autoFocus
                      value={adding}
                      maxLength={120}
                      placeholder="New reason"
                      aria-label="New reason"
                      onChange={(e) => setAdding(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          void addReason();
                        }
                      }}
                    />
                  </div>
                  <Button variant="outline" onClick={() => void addReason()} disabled={!adding.trim()}>
                    Add
                  </Button>
                  <Button variant="ghost" onClick={() => setAdding(null)}>
                    Cancel
                  </Button>
                  <span className="w-full text-[11.5px] text-muted-foreground">Added to the list for everyone.</span>
                </div>
              )}

              <Field label="Remarks">
                <Textarea rows={2} maxLength={2000} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
              </Field>

              <div>
                <Button onClick={() => void save()} disabled={!canSave}>
                  {busy ? "Saving…" : "Save"}
                </Button>
              </div>
            </section>
          ) : (
            <Alert tone="info" className="font-normal">
              View only. Only someone working on this enquiry can change its clearance.
            </Alert>
          )}
          {error && <Alert>{error}</Alert>}

          <section className="flex flex-col gap-2">
            <h4 className="flex items-center gap-1.5 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
              <History className="size-3.5" /> History
            </h4>
            {history === null && !error && <p className="text-[12.5px] text-muted-foreground">Loading…</p>}
            {history?.length === 0 && <p className="text-[12.5px] text-muted-foreground">No changes yet. An enquiry is Clear until someone holds it.</p>}
            {history && history.length > 0 && (
              <ul className="flex flex-col divide-y divide-border overflow-hidden rounded-md border border-border">
                {history.map((h) => (
                  <li key={h.id} className="flex flex-col gap-1 px-3 py-2.5 text-[12.5px]">
                    <span className="flex flex-wrap items-center gap-2">
                      <Badge tone={h.status === "Clear" ? "success" : "warning"} dot>
                        {h.status}
                      </Badge>
                      {h.status === "Hold" && <span className="font-medium text-foreground">{holdReasonText(h.group, h.reason)}</span>}
                    </span>
                    {h.remarks && <span className="whitespace-pre-wrap text-foreground/85">{h.remarks}</span>}
                    <span className="text-[11.5px] text-muted-foreground">
                      {fmtWhen(h.at)}
                      {h.byName ? ` · ${h.byName}` : ""} · V{h.version}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
