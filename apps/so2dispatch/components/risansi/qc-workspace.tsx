"use client";

import { Fragment, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, ExternalLink, FileCheck2, Link2, Loader2, MessageSquare, X } from "lucide-react";
import { DEPT_VIEWS, dispatchRowTone } from "@/lib/dept-view";
import { linksFromRows, qcDocsStatus, requiredQcDocs, type QcLink, type QcTone } from "@/lib/qc-docs";
import type { OrderListOptions } from "@/lib/orders";
import type { PageResult } from "@/lib/pagination";
import type { DeptCompletion } from "@/lib/dept-completion";
import type { KpiCard } from "@/lib/kpis";
import { saveQcLinksAction } from "@/app/risansi/orders/qc-actions";
import { HoldBadge } from "./hold-badge";
import { SortHeader } from "./sort-header";
import { UrlPagination, UrlSearchInput, useUrlTable } from "./url-table";
import { OrderListFilterBar } from "./order-list-filter-bar";
import { useConsumeFocusParam, useFocusRow } from "./use-focus-row";
import { OrderThreadModal } from "./order-thread-modal";
import { completionFor, DeptCompleteCheck } from "./dept-complete-check";
import { KpiStrip } from "./kpi-strip";

type Row = Record<string, unknown>;
const str = (v: unknown) => (v === null || v === undefined ? "" : String(v));

function formatDate(value: unknown): string {
  const s = str(value).slice(0, 10);
  if (!s) return "—";
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? s : d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}
const todayIso = () => new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);

const TONE: Record<QcTone, string> = {
  done: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  part: "bg-sky-50 text-sky-700 ring-sky-200",
  pending: "bg-amber-50 text-amber-700 ring-amber-200",
  na: "bg-slate-100 text-slate-600 ring-slate-200",
};
function Chip({ label, tone }: { label: string; tone: QcTone }) {
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${TONE[tone]}`}>
      {tone === "done" && <CheckCircle2 className="h-3 w-3" />}
      {label}
    </span>
  );
}

/**
 * Quality's queue: each SO once, with the QC documents it needs; its ECs
 * beside it, each with how many of those documents are in and a pop-up to
 * give them as SharePoint links.
 */
export function QcWorkspace({
  queue,
  canEdit,
  openItemId,
  openThreadId,
  focusOrderId,
  role,
  unreadThreads = {},
  completions = [],
  filterOptions,
  kpis = [],
}: {
  queue: PageResult<Row>;
  canEdit: boolean;
  openItemId?: string;
  openThreadId?: string;
  focusOrderId?: string;
  role: string;
  unreadThreads?: Record<string, number>;
  completions?: DeptCompletion[];
  filterOptions?: OrderListOptions;
  kpis?: KpiCard[];
}) {
  const rows = queue.rows;
  const { get: getParam } = useUrlTable();
  const emptyMessage = getParam("q") ? "No orders match your search." : "No orders yet.";
  const [docsFor, setDocsFor] = useState<string | null>(() =>
    openItemId && rows.some((r) => r.id === openItemId) ? openItemId : null
  );
  const [threadFor, setThreadFor] = useState<{ orderId: string; soLabel: string } | null>(() => {
    const row = openThreadId ? rows.find((r) => str(r.order_id) === openThreadId) : null;
    return row && openThreadId ? { orderId: openThreadId, soLabel: str(row.so_no ?? row.sl_no) } : null;
  });
  const focusClass = useFocusRow([openItemId, focusOrderId], rows.length > 0);
  useConsumeFocusParam(queue.page);

  const groups: { key: string; head: Row; ecs: Row[] }[] = [];
  for (const r of rows) {
    const key = str(r.order_id);
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.ecs.push(r);
    else groups.push({ key, head: r, ecs: [r] });
  }

  return (
    <div>
      <div className="mb-3">
        {filterOptions ? (
          <OrderListFilterBar
            options={filterOptions}
            total={queue.total}
            dept="quality"
            hasTarget={DEPT_VIEWS["quality"].hasTarget}
            searchPlaceholder="Search SO, EC…"
            noTypeFilter
          />
        ) : (
          <UrlSearchInput placeholder="Search SO, EC…" />
        )}
      </div>

      <KpiStrip cards={kpis} />

      <div className="rounded-xl border border-card-border bg-surface shadow-sm">
        <div className="overflow-x-auto" data-sticky-head>
          <table className="w-full min-w-[1300px] text-sm">
            <thead className="relative z-10 bg-surface data-[stuck=1]:shadow-[0_2px_6px_-2px_rgba(0,0,0,0.18)] [&_th]:bg-surface">
              <tr className="text-left text-xs font-semibold uppercase tracking-wide text-muted">
                <th colSpan={5} className="px-3 pt-2.5 pb-1">SO</th>
                <th colSpan={7} className="border-l border-card-border px-3 pt-2.5 pb-1 text-center">EC</th>
              </tr>
              <tr className="border-b border-card-border text-left text-[11px] font-semibold uppercase tracking-wide text-muted">
                <th className="px-3 py-2"><SortHeader label="Sl." sortKey="sl" /></th>
                <th className="px-3 py-2"><SortHeader label="SO No. / Date" sortKey="so_date" /></th>
                <th className="px-3 py-2">Chat</th>
                <th className="px-3 py-2 whitespace-nowrap">Quality Target</th>
                <th className="px-3 py-2 whitespace-nowrap">Docs Needed</th>
                <th className="border-l border-card-border px-3 py-2">EC No.</th>
                <th className="px-3 py-2">EC Date</th>
                <th className="px-3 py-2">Pump Type</th>
                <th className="px-3 py-2">Model No.</th>
                <th className="px-3 py-2">Documents</th>
                <th className="px-3 py-2 whitespace-nowrap">Submitted On</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {groups.length === 0 && (
                <tr>
                  <td colSpan={12} className="px-4 py-10 text-center text-sm text-muted">
                    {emptyMessage}
                  </td>
                </tr>
              )}
              {groups.map((g) => {
                const span = g.ecs.length;
                const soCell = "px-3 py-2 align-top border-b border-card-border";
                const needed = requiredQcDocs(g.head);
                return (
                  <Fragment key={g.key}>
                    {g.ecs.map((row, k) => {
                      const last = k === g.ecs.length - 1;
                      const ecCell = `px-3 py-2 align-top ${last ? "border-b border-card-border" : "border-b border-card-border/50"}`;
                      const ecId = str(row.id);
                      const st = qcDocsStatus(needed, linksFromRows(row.qc_links));
                      return (
                        <tr key={ecId} data-focus-row={ecId} className={`text-foreground ${dispatchRowTone(g.head) ?? "hover:bg-background/40"} ${focusClass(ecId)}`}>
                          {k === 0 && (
                            <>
                              <td rowSpan={span} data-focus-row={g.key} className={`${soCell} font-medium tabular-nums ${focusClass(g.key)}`}>
                                {str(g.head.sl_no)}
                              </td>
                              <td rowSpan={span} className={`${soCell} whitespace-nowrap`}>
                                <span className="font-semibold">{str(g.head.so_no) || "—"}</span>
                                <HoldBadge order={g.head} />
                                <span className="block text-xs text-muted">{formatDate(g.head.so_date)}</span>
                              </td>
                              <td rowSpan={span} className={soCell}>
                                <button
                                  type="button"
                                  onClick={() => setThreadFor({ orderId: g.key, soLabel: str(g.head.so_no ?? g.head.sl_no) })}
                                  aria-label="Chat"
                                  className="relative inline-flex h-7 w-7 items-center justify-center rounded-lg border border-input-border hover:bg-background"
                                >
                                  <MessageSquare className="h-3.5 w-3.5" />
                                  {(unreadThreads[g.key] ?? 0) > 0 && (
                                    <span className="absolute -right-1.5 -top-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-600 px-1 text-[10px] font-bold text-white">
                                      {unreadThreads[g.key]}
                                    </span>
                                  )}
                                </button>
                              </td>
                              <td rowSpan={span} className={`${soCell} whitespace-nowrap text-muted`}>{formatDate(g.head.qc_doc_target_date)}</td>
                              <td rowSpan={span} className={soCell}>
                                {needed.length ? (
                                  <span className="flex flex-wrap gap-1">
                                    {needed.map((d) => (
                                      <span key={d} className="rounded-full bg-background px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset ring-card-border">
                                        {d}
                                      </span>
                                    ))}
                                  </span>
                                ) : (
                                  <span className="text-xs text-muted">Not specified</span>
                                )}
                              </td>
                            </>
                          )}
                          <td className={`${ecCell} border-l border-card-border whitespace-nowrap font-semibold`}>{str(row.ec_no) || "—"}</td>
                          <td className={`${ecCell} whitespace-nowrap text-muted`}>{formatDate(row.ec_date)}</td>
                          <td className={`${ecCell} whitespace-nowrap`}>{str(row.pump_type) || "—"}</td>
                          <td className={`${ecCell} whitespace-nowrap`}>{str(row.model_no) || "—"}</td>
                          <td className={ecCell}>
                            <button type="button" onClick={() => setDocsFor(ecId)} className="flex flex-col items-start gap-0.5 text-left" title="Open the QC documents">
                              <Chip label={st.label} tone={st.tone} />
                              {st.total > 0 && <span className="text-[11px] text-muted">{st.done}/{st.total} in</span>}
                            </button>
                          </td>
                          <td className={`${ecCell} whitespace-nowrap`}>{formatDate(row.qc_doc_actual_date)}</td>
                          <td className={`${ecCell} whitespace-nowrap`}>
                            <span className="inline-flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => setDocsFor(ecId)}
                                className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-primary/40 bg-primary/10 px-3 text-xs font-semibold text-primary hover:bg-primary hover:text-primary-foreground"
                              >
                                <FileCheck2 className="h-3.5 w-3.5" />
                                QC Docs
                              </button>
                              <DeptCompleteCheck
                                scopeId={ecId}
                                dept="quality"
                                label={str(row.ec_no ?? row.id)}
                                completion={completionFor(completions, "quality", ecId, true)}
                                canEdit={canEdit}
                              />
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
        <UrlPagination page={queue.page} totalPages={queue.totalPages} from={queue.from} to={queue.to} total={queue.total} />
      </div>

      {(() => {
        const ec = docsFor ? rows.find((r) => r.id === docsFor) : null;
        if (!ec) return null;
        return <QcDocsModal key={str(ec.id)} ec={ec} canEdit={canEdit} onClose={() => setDocsFor(null)} />;
      })()}

      {threadFor && (
        <OrderThreadModal orderId={threadFor.orderId} role={role} soLabel={threadFor.soLabel} onClose={() => setThreadFor(null)} />
      )}
    </div>
  );
}

const input =
  "h-10 w-full rounded-lg border border-input-border bg-surface px-3 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-ring/20 disabled:bg-background disabled:text-muted";

/** One EC's QC documents: a card for each the SO needs — its link, the day it went in, remarks. */
function QcDocsModal({ ec, canEdit, onClose }: { ec: Row; canEdit: boolean; onClose: () => void }) {
  const router = useRouter();
  const needed = requiredQcDocs(ec);
  const saved = linksFromRows(ec.qc_links);
  const initial = (): QcLink[] =>
    needed.map((d) => saved.find((l) => l.doc_type === d) ?? { doc_type: d, link: "", submitted_date: "", remarks: "" });
  const [links, setLinks] = useState<QcLink[]>(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirty = JSON.stringify(links) !== JSON.stringify(initial());
  const st = qcDocsStatus(needed, links);
  const ro = !canEdit;
  const set = (i: number, patch: Partial<QcLink>) => setLinks((ls) => ls.map((l, k) => (k === i ? { ...l, ...patch } : l)));

  async function save() {
    setSaving(true);
    setError(null);
    const res = await saveQcLinksAction(str(ec.id), links);
    setSaving(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    router.refresh();
    onClose();
  }

  return (
    <div role="dialog" aria-modal="true" aria-label="QC documents" className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-6" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-t-2xl bg-surface p-5 shadow-xl sm:rounded-2xl">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="font-display text-lg font-semibold text-foreground">QC documents · EC {str(ec.ec_no) || "—"}</h2>
            <p className="text-xs text-muted">{[ec.so_no, ec.pump_type, ec.model_no].map(str).filter(Boolean).join(" · ")}</p>
          </div>
          <div className="flex items-center gap-2">
            <Chip label={st.label} tone={st.tone} />
            <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg p-1.5 text-muted hover:bg-background hover:text-foreground">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {needed.length === 0 ? (
          <p className="rounded-xl border border-dashed border-card-border px-4 py-8 text-center text-sm text-muted">
            The SO does not name any QC documents yet — they are set under Document Required on the order.
          </p>
        ) : (
          <div className="space-y-3">
            {links.map((l, i) => {
              const ok = /^https?:\/\//i.test(l.link.trim());
              return (
                <section key={l.doc_type} className={`rounded-xl border p-4 ${ok ? "border-emerald-200 bg-emerald-50/30" : "border-card-border"}`}>
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
                      <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 text-primary">
                        <Link2 className="h-4 w-4" />
                      </span>
                      {l.doc_type}
                    </p>
                    {ok ? (
                      <a href={l.link.trim()} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline">
                        Open <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    ) : (
                      <span className="text-xs text-muted">Not in yet</span>
                    )}
                  </div>
                  <div className="grid gap-3 sm:grid-cols-[1fr_11rem]">
                    <label className="block">
                      <span className="mb-1 block text-[11px] font-medium text-muted-foreground">SharePoint Link</span>
                      <input
                        type="url"
                        value={l.link}
                        disabled={ro}
                        onChange={(e) =>
                          set(i, { link: e.target.value, submitted_date: l.submitted_date || (e.target.value.trim() ? todayIso() : "") })
                        }
                        placeholder="https://…sharepoint.com/…"
                        className={input}
                      />
                    </label>
                    <label className="block">
                      <span className="mb-1 block text-[11px] font-medium text-muted-foreground">Submitted On</span>
                      <input type="date" value={l.submitted_date} disabled={ro || !l.link.trim()} onChange={(e) => set(i, { submitted_date: e.target.value })} className={input} />
                    </label>
                    <label className="block sm:col-span-2">
                      <span className="mb-1 block text-[11px] font-medium text-muted-foreground">Remarks</span>
                      <input value={l.remarks} disabled={ro} onChange={(e) => set(i, { remarks: e.target.value })} className={input} />
                    </label>
                  </div>
                </section>
              );
            })}
          </div>
        )}

        {canEdit && needed.length > 0 && (
          <div className="mt-4 flex items-center justify-end gap-3">
            {error && <span className="text-sm text-rose-600">{error}</span>}
            <button
              type="button"
              onClick={save}
              disabled={saving || !dirty}
              className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-5 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
            >
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              Save
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
