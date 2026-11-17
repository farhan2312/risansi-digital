"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ClipboardCheck, Loader2, X } from "lucide-react";
import { checklistFor, fillablePoints, isSpareChecklist, type ChecklistPoint } from "@/lib/so-checklist";
import { getChecklistAction, saveChecklistAction, type ChecklistData } from "@/app/risansi/departments/order-making/checklist-actions";

const ISO = /^\d{4}-\d{2}-\d{2}/;

function fmtDate(v: string | null | undefined): string {
  if (!v) return "";
  const d = new Date(ISO.test(v) && v.length === 10 ? `${v}T00:00:00Z` : v);
  if (Number.isNaN(d.getTime())) return v;
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: v.length === 10 ? "UTC" : "Asia/Kolkata" });
}

type Draft = Record<string, { answer: string; remarks: string }>;

/**
 * An SO's checklist (Order Making): the Spare or Pump list, its green points
 * filled by the member the SO is assigned to, the rest by Order Making PO.
 * The current version is filled here; earlier versions are read-only.
 */
export function SoChecklistModal({ orderId, onClose }: { orderId: string; onClose: () => void }) {
  const router = useRouter();
  const [data, setData] = useState<ChecklistData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>({});
  const [shownVersion, setShownVersion] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const res = await getChecklistAction(orderId);
    if (!res.ok) setError(res.error);
    else {
      setData(res.data);
      setDraft({});
    }
  }, [orderId]);

  useEffect(() => {
    let live = true;
    getChecklistAction(orderId).then((res) => {
      if (!live) return;
      if (!res.ok) setError(res.error);
      else setData(res.data);
    });
    return () => {
      live = false;
    };
  }, [orderId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const points = useMemo(() => (data ? checklistFor(data.orderType) : []), [data]);
  const version = shownVersion ?? data?.versionNo ?? 0;
  const current = !!data && version === data.versionNo;
  const saved = useMemo(() => new Map((data?.versions[version] ?? []).map((a) => [a.point_key, a])), [data, version]);
  const value = (p: ChecklistPoint) => ({
    answer: draft[p.key]?.answer ?? saved.get(p.key)?.answer ?? "",
    remarks: draft[p.key]?.remarks ?? saved.get(p.key)?.remarks ?? "",
  });
  const changed = Object.entries(draft).filter(([key, d]) => {
    const s = saved.get(key);
    return d.answer !== (s?.answer ?? "") || d.remarks !== (s?.remarks ?? "");
  });
  const set = (key: string, patch: Partial<{ answer: string; remarks: string }>) =>
    setDraft((prev) => {
      const s = saved.get(key);
      const base = prev[key] ?? { answer: s?.answer ?? "", remarks: s?.remarks ?? "" };
      return { ...prev, [key]: { ...base, ...patch } };
    });

  const progress = (team: "SO" | "PO") => {
    const all = fillablePoints(points, team);
    return { done: all.filter((p) => value(p).answer).length, total: all.length };
  };

  async function save() {
    if (!data || changed.length === 0) return;
    setSaving(true);
    setError(null);
    const res = await saveChecklistAction(
      data.orderId,
      data.versionNo,
      changed.map(([key, d]) => ({ key, answer: d.answer, remarks: d.remarks }))
    );
    setSaving(false);
    if (!res.ok) setError(res.error);
    else {
      await load();
      router.refresh();
    }
  }

  const close = () => {
    if (changed.length > 0 && !confirm("Close without saving the checklist?")) return;
    onClose();
  };

  const versionNos = data ? Object.keys(data.versions).map(Number).sort((a, b) => b - a) : [];
  const spare = data ? isSpareChecklist(data.orderType) : false;
  const firstVerifier = points.findIndex((p) => p.verifier);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="SO checklist"
      className="fixed inset-0 z-40 flex items-end justify-center bg-black/40 sm:items-center sm:p-6"
      onClick={close}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[92vh] w-full max-w-6xl flex-col rounded-t-2xl bg-surface p-5 shadow-xl sm:rounded-2xl"
      >
        <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 inline-flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <ClipboardCheck className="h-5 w-5" />
            </span>
            <div>
              <h2 className="text-base font-semibold text-foreground">{spare ? "Spare" : "Pump"} Order Checklist</h2>
              {data && (
                <p className="text-sm text-muted">
                  SO No. {data.soNo || "—"} <span className="text-muted-foreground">(Sl. {data.slNo})</span> · Version v{data.versionNo}
                  {data.soDate ? ` · Date ${fmtDate(data.soDate)}` : ""}
                </p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {versionNos.length > 1 && (
              <select
                value={version}
                onChange={(e) => {
                  setShownVersion(Number(e.target.value));
                  setDraft({});
                }}
                aria-label="Version"
                className="h-9 rounded-lg border border-input-border bg-surface px-2 text-sm text-foreground"
              >
                {versionNos.map((v) => (
                  <option key={v} value={v}>
                    v{v}
                    {v === data?.versionNo ? " (current)" : " (read-only)"}
                  </option>
                ))}
              </select>
            )}
            <button
              type="button"
              onClick={close}
              aria-label="Close"
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-muted hover:bg-background hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {data && (
          <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted">
            <span className="inline-flex items-center gap-1.5">
              <span className="h-3 w-3 rounded-sm border border-emerald-300 bg-emerald-100 dark:border-emerald-500/40 dark:bg-emerald-500/20" />
              Order Making SO (the assigned member) —{" "}
              <b className="text-foreground">
                {progress("SO").done}/{progress("SO").total}
              </b>
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-3 w-3 rounded-sm border border-card-border bg-surface" />
              Order Making PO —{" "}
              <b className="text-foreground">
                {progress("PO").done}/{progress("PO").total}
              </b>
            </span>
            <span>Auto: read from the SO.</span>
            {!current && <span className="font-semibold text-amber-700 dark:text-amber-300">An earlier version: read-only.</span>}
          </div>
        )}

        {error && <p className="mb-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-500/10 dark:text-rose-300">{error}</p>}

        <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-card-border">
          {!data && !error && (
            <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading the checklist…
            </div>
          )}
          {data && (
            <table className="w-full text-left text-sm">
              <thead className="sticky top-0 z-10 bg-surface text-xs font-semibold uppercase tracking-wide text-muted shadow-[0_1px_0_var(--color-card-border)]">
                <tr>
                  <th className="px-3 py-2">#</th>
                  <th className="px-3 py-2">Checklist</th>
                  <th className="px-3 py-2">Details</th>
                  <th className="px-3 py-2">Remark</th>
                  <th className="px-3 py-2 whitespace-nowrap">Filled by</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-card-border">
                {points.map((p, i) => {
                  const v = value(p);
                  const s = saved.get(p.key);
                  const editable = current && data.can[p.team];
                  const green = p.team === "SO";
                  return (
                    <Fragment key={p.key}>
                      {i === firstVerifier && (
                        <tr className="bg-background">
                          <td colSpan={5} className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted">
                            These check points are for the verifier
                          </td>
                        </tr>
                      )}
                      <tr className={green ? "bg-emerald-50/70 dark:bg-emerald-500/10" : ""}>
                        <td className="px-3 py-2 align-top tabular-nums text-muted">{i + 1}</td>
                        <td className="px-3 py-2 align-top font-medium text-foreground">{p.label}</td>
                        <td className="px-3 py-2 align-top">
                          {p.auto ? (
                            <span className="inline-flex items-center gap-1.5">
                              <span className="text-foreground">
                                {(p.auto.endsWith("_date") || p.auto === "delivery_date_as_per_so"
                                  ? fmtDate(data.auto[p.auto])
                                  : data.auto[p.auto]) || "—"}
                              </span>
                              <span className="rounded bg-slate-100 px-1 text-[10px] font-semibold uppercase text-slate-500 dark:bg-white/10 dark:text-slate-300">
                                Auto
                              </span>
                            </span>
                          ) : editable && (p.options ?? []).length <= 3 ? (
                            <div className="flex flex-wrap gap-1">
                              {(p.options ?? []).map((o) => (
                                <button
                                  key={o}
                                  type="button"
                                  onClick={() => set(p.key, { answer: v.answer === o ? "" : o })}
                                  aria-pressed={v.answer === o}
                                  className={`h-7 rounded-md border px-2.5 text-xs font-semibold transition-colors ${
                                    v.answer === o
                                      ? "border-primary bg-primary text-primary-foreground"
                                      : "border-input-border bg-surface text-foreground hover:bg-background"
                                  }`}
                                >
                                  {o}
                                </button>
                              ))}
                            </div>
                          ) : editable ? (
                            <select
                              value={v.answer}
                              onChange={(e) => set(p.key, { answer: e.target.value })}
                              className="h-8 max-w-[16rem] rounded-lg border border-input-border bg-surface px-2 text-xs text-foreground"
                            >
                              <option value="">—</option>
                              {(p.options ?? []).map((o) => (
                                <option key={o} value={o}>
                                  {o}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <span className={v.answer ? "font-semibold text-foreground" : "text-muted"}>{v.answer || "Pending"}</span>
                          )}
                        </td>
                        <td className="px-3 py-2 align-top">
                          {editable ? (
                            <input
                              value={v.remarks}
                              onChange={(e) => set(p.key, { remarks: e.target.value })}
                              maxLength={1000}
                              placeholder="Remark"
                              className="h-8 w-full min-w-[12rem] rounded-lg border border-input-border bg-surface px-2 text-xs text-foreground focus:border-primary focus:outline-none"
                            />
                          ) : (
                            <span className="whitespace-pre-wrap text-xs text-foreground">{v.remarks || ""}</span>
                          )}
                        </td>
                        <td className="px-3 py-2 align-top text-xs whitespace-nowrap text-muted">
                          {s?.filled_by_name ? (
                            <>
                              <span className="block text-foreground">{s.filled_by_name}</span>
                              {fmtDate(s.filled_at)}
                            </>
                          ) : (
                            <span>{p.auto ? "" : p.team === "SO" ? "SO team" : "PO team"}</span>
                          )}
                        </td>
                      </tr>
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {data && current && (data.can.SO || data.can.PO) && (
          <div className="mt-3 flex items-center justify-end gap-2">
            {changed.length > 0 && <span className="text-xs text-muted">{changed.length} unsaved</span>}
            <button
              type="button"
              onClick={save}
              disabled={saving || changed.length === 0}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
            >
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              Save checklist
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
