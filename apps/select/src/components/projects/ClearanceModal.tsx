"use client";

import { useEffect, useState } from "react";

import { CLEARANCE_STATUSES, HOLD_REASONS, OTHER_REASON_GROUP, holdReasonText, type ClearanceEntry, type ClearanceNow, type ClearanceStatus } from "../../lib/clearance";
import { addClearanceReason, getClearance, saveClearance } from "../../services/clearanceService";

const btn =
  "inline-flex items-center gap-1.5 rounded-lg border border-line bg-paper px-3 py-1.5 text-[12.5px] font-semibold text-fg-2 hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-50";
const btnPrimary =
  "inline-flex items-center gap-1.5 rounded-lg bg-accent px-3.5 py-1.5 text-[12.5px] font-semibold text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50";
const inputCls =
  "w-full rounded-lg border border-line bg-paper px-2.5 py-2 text-[13px] text-fg outline-none focus:border-accent focus:ring-2 focus:ring-accent-soft disabled:cursor-not-allowed disabled:opacity-60";
const labelCls = "text-[11.5px] font-semibold text-fg-3";

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

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !busy && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" onClick={() => !busy && onClose()}>
      <div className="flex max-h-[90vh] w-full max-w-[560px] flex-col overflow-hidden rounded-xl border border-line bg-paper" onClick={(e) => e.stopPropagation()}>
        <header className="flex items-start justify-between gap-3 border-b border-line px-4 py-3">
          <div className="min-w-0">
            <h3 className="text-[15px] font-semibold text-fg">Clearance</h3>
            <p className="truncate font-mono text-[12.5px] text-fg-3">
              {project.project_code}
              {project.name ? ` · ${project.name}` : ""}
            </p>
          </div>
          <button type="button" className={btn} onClick={onClose} disabled={busy}>
            Close
          </button>
        </header>

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
          {canEdit ? (
            <section className="flex flex-col gap-3">
              <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Clearance">
                {CLEARANCE_STATUSES.map((s) => (
                  <button
                    key={s}
                    type="button"
                    role="radio"
                    aria-checked={status === s}
                    onClick={() => setStatus(s)}
                    className={`rounded-lg border px-3 py-2 text-[13.5px] font-semibold transition-colors ${
                      status === s ? "border-accent bg-accent-soft text-accent" : "border-line bg-paper text-fg-2 hover:border-accent"
                    }`}
                  >
                    {s}
                  </button>
                ))}
              </div>

              {status === "Hold" && (
                <label className="flex flex-col gap-1">
                  <span className={labelCls}>Reason for the hold</span>
                  <select
                    className={inputCls}
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
                  </select>
                </label>
              )}

              {status === "Hold" && adding !== null && (
                <div className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-sunk p-2">
                  <input
                    autoFocus
                    className={`${inputCls} min-w-[180px] flex-1`}
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
                  <button type="button" className={btn} onClick={() => void addReason()} disabled={!adding.trim()}>
                    Add
                  </button>
                  <button type="button" className="text-[12px] font-semibold text-fg-3 hover:text-fg" onClick={() => setAdding(null)}>
                    Cancel
                  </button>
                  <span className="w-full text-[11px] text-fg-3">Added to the list for everyone.</span>
                </div>
              )}

              <label className="flex flex-col gap-1">
                <span className={labelCls}>Remarks</span>
                <textarea className={inputCls} rows={2} maxLength={2000} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
              </label>

              <div>
                <button type="button" className={btnPrimary} onClick={() => void save()} disabled={!canSave}>
                  {busy ? "Saving…" : "Save"}
                </button>
              </div>
            </section>
          ) : (
            <p className="rounded-lg border border-line bg-sunk px-3 py-2 text-[12.5px] text-fg-3">View only. Only someone working on this enquiry can change its clearance.</p>
          )}
          {error && <p className="text-[12.5px] font-medium text-neg">{error}</p>}

          <section className="flex flex-col gap-2">
            <h4 className="text-[11.5px] font-semibold tracking-[0.08em] text-fg-3 uppercase">History</h4>
            {history === null && !error && <p className="text-[12.5px] text-fg-3">Loading…</p>}
            {history?.length === 0 && <p className="text-[12.5px] text-fg-3">No changes yet. An enquiry is Clear until someone holds it.</p>}
            {history && history.length > 0 && (
              <ul className="flex flex-col divide-y divide-line rounded-lg border border-line">
                {history.map((h) => (
                  <li key={h.id} className="flex flex-col gap-0.5 px-3 py-2 text-[12.5px]">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className={`rounded-full px-2 py-0.5 text-[11.5px] font-semibold ${clearanceTone(h.status)}`}>{h.status}</span>
                      {h.status === "Hold" && <span className="font-medium text-fg">{holdReasonText(h.group, h.reason)}</span>}
                    </span>
                    {h.remarks && <span className="whitespace-pre-wrap text-fg-2">{h.remarks}</span>}
                    <span className="text-[11.5px] text-fg-3">
                      {fmtWhen(h.at)}
                      {h.byName ? ` · ${h.byName}` : ""} · V{h.version}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
