"use client";

import { KpiStrip } from "./kpi-strip";
import type { KpiCard } from "@/lib/kpis";
import { Fragment, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { CalendarCheck, CheckCircle2, FileText, Loader2, MessageSquare, PenTool, Plus, Send, Trash2, X } from "lucide-react";
import { DRAWING_DOC_TYPES, type DrawingDocType } from "@/lib/order-schema";
import { DEPT_VIEWS, dispatchRowTone, drawingDocStatus, drawingVersions, type DrawingStatusTone } from "@/lib/dept-view";
import type { OrderListOptions } from "@/lib/orders";
import type { PageResult } from "@/lib/pagination";
import type { DeptCompletion } from "@/lib/dept-completion";
import { addOrderChildAction, deleteOrderChildAction, updateOrderChildAction } from "@/app/risansi/orders/actions";
import { HoldBadge } from "./hold-badge";
import { SortHeader } from "./sort-header";
import { UrlPagination, UrlSearchInput, useUrlTable } from "./url-table";
import { OrderListFilterBar } from "./order-list-filter-bar";
import { useConsumeFocusParam, useFocusRow } from "./use-focus-row";
import { OrderThreadModal } from "./order-thread-modal";
import { MultiSelectFilter } from "./multi-select-filter";
import {
  CURVE_STATUSES,
  DRAWING_FILTER_KEYS,
  GAD_STATUSES,
  PART_STATUSES,
  SO_STATES,
} from "@/lib/drawing-filter";
import { PartDrawingCell, PartProgress } from "./part-drawing";
import { partDrawingStatus } from "@/lib/part-drawings";
import { completionFor, DeptCompleteCheck } from "./dept-complete-check";
import { DrawingReadinessCell } from "./drawing-readiness-cell";
import { applyDrawingVersionToSoAction } from "@/app/risansi/orders/drawing-readiness-actions";

type Row = Record<string, unknown>;
const str = (v: unknown) => (v === null || v === undefined ? "" : String(v));
const yes = (v: unknown) => str(v).trim().toLowerCase() === "yes";

function formatDate(value: unknown): string {
  const s = str(value);
  if (!s) return "—";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

/** The SO asks for a Performance Curve on each of its ECs. */
const wantsCurve = (r: Row) => yes(r.performance_curve_required);
/** The documents an EC has: a GAD always, a Performance Curve when asked for. */
const docsFor = (r: Row): DrawingDocType[] => DRAWING_DOC_TYPES.filter((d) => d === "GAD" || wantsCurve(r));
const versionsOf = (r: Row) => (Array.isArray(r.child_rows) ? (r.child_rows as Row[]) : []);
/** Planning asked for part drawings on this EC. */
const wantsParts = (r: Row) => str(r.part_drawing).trim().toLowerCase() === "yes";
const partsOf = (r: Row) => (Array.isArray(r.part_drawings) ? (r.part_drawings as Row[]) : []);
/** A tab of the pop-up: a document, or the EC's part drawings. */
type DrawingTab = DrawingDocType | "Part Drawing";

/**
 * Drawing's queue, pump ECs only: each SO once on the left with its ECs
 * beside it, every EC's GAD and Performance Curve status on the front, and a
 * pop-up to keep each document's versions.
 */
export function DrawingWorkspace({
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
  /** The summary cards under the filter bar. */
  kpis?: KpiCard[];
  queue: PageResult<Row>;
  canEdit: boolean;
  openItemId?: string;
  openThreadId?: string;
  focusOrderId?: string;
  role: string;
  unreadThreads?: Record<string, number>;
  completions?: DeptCompletion[];
  filterOptions?: OrderListOptions;
}) {
  const rows = queue.rows;
  const { get: getParam, getList, setParams } = useUrlTable();
  const emptyMessage = getParam("q") ? "No orders match your search." : "No orders yet.";
  // The EC whose drawings are open, and which document of it. A notification
  // about an EC arrives with it open.
  const [drawingsFor, setDrawingsFor] = useState<string | null>(() =>
    openItemId && rows.some((r) => r.id === openItemId) ? openItemId : null
  );
  const [docFor, setDocFor] = useState<DrawingTab>("GAD");
  // The discussion icon's deep link arrives with that SO's thread open.
  const [threadFor, setThreadFor] = useState<{ orderId: string; soLabel: string } | null>(() => {
    const row = openThreadId ? rows.find((r) => String(r.order_id) === openThreadId) : null;
    return row && openThreadId ? { orderId: openThreadId, soLabel: str(row.so_no ?? row.sl_no) } : null;
  });

  const focusClass = useFocusRow([openItemId, focusOrderId], rows.length > 0);
  useConsumeFocusParam(queue.page);

  type SoGroup = { key: string; head: Row; ecs: Row[] };
  const soGroups: SoGroup[] = Array.from(
    rows.reduce((map, r) => {
      const key = str(r.order_id ?? r.so_no);
      const g = map.get(key);
      if (g) g.ecs.push(r);
      else map.set(key, { key, head: r, ecs: [r] });
      return map;
    }, new Map<string, SoGroup>())
  ).map(([, g]) => g);

  const open = (ecId: string, doc: DrawingTab) => {
    setDrawingsFor(ecId);
    setDocFor(doc);
  };

  return (
    <div>
      <div className="mb-3">
        {filterOptions ? (
          <OrderListFilterBar
            options={filterOptions}
            total={queue.total}
            dept="drawing"
            hasTarget={DEPT_VIEWS["drawing"].hasTarget}
            searchPlaceholder="Search SO, EC…"
            noTypeFilter
            noStatusFilter
            // Narrower, so Drawing's own filters fit on the first row.
            searchClassName="sm:max-w-[12rem]"
            extraKeys={Object.values(DRAWING_FILTER_KEYS)}
            extraFilters={
              <>
                <MultiSelectFilter
                  label="SO status"
                  allLabel="Any"
                  options={SO_STATES}
                  selected={getList(DRAWING_FILTER_KEYS.so)}
                  onChange={(next) => setParams({ [DRAWING_FILTER_KEYS.so]: next })}
                />
                <MultiSelectFilter
                  label="GAD"
                  allLabel="Any"
                  options={GAD_STATUSES}
                  selected={getList(DRAWING_FILTER_KEYS.gad)}
                  onChange={(next) => setParams({ [DRAWING_FILTER_KEYS.gad]: next })}
                />
                <MultiSelectFilter
                  label="Performance Curve"
                  allLabel="Any"
                  options={CURVE_STATUSES}
                  selected={getList(DRAWING_FILTER_KEYS.curve)}
                  onChange={(next) => setParams({ [DRAWING_FILTER_KEYS.curve]: next })}
                />
                <MultiSelectFilter
                  label="Part Drawing"
                  allLabel="Any"
                  options={PART_STATUSES}
                  selected={getList(DRAWING_FILTER_KEYS.part)}
                  onChange={(next) => setParams({ [DRAWING_FILTER_KEYS.part]: next })}
                />
              </>
            }
          />
        ) : (
          <UrlSearchInput placeholder="Search SO, EC…" />
        )}
      </div>

      <KpiStrip cards={kpis} />

      <div className="rounded-xl border border-card-border bg-surface shadow-sm">
        {/* The header row stays under the top bar as the page scrolls (AppShell). */}
        <div className="overflow-x-auto" data-sticky-head>
          <table className="w-full min-w-[1600px] text-sm">
            <thead className="relative z-10 bg-surface data-[stuck=1]:shadow-[0_2px_6px_-2px_rgba(0,0,0,0.18)] [&_th]:bg-surface">
              <tr className="text-left text-xs font-semibold uppercase tracking-wide text-muted">
                <th colSpan={8} className="px-3 pt-2.5 pb-1">SO</th>
                <th colSpan={8} className="border-l border-card-border px-3 pt-2.5 pb-1 text-center">EC</th>
              </tr>
              <tr className="border-b border-card-border text-left text-[11px] font-semibold uppercase tracking-wide text-muted">
                <th className="px-3 py-2"><SortHeader label="Sl." sortKey="sl" /></th>
                <th className="px-3 py-2"><SortHeader label="SO No. / Date" sortKey="so_date" /></th>
                <th className="px-3 py-2">Chat</th>
                <th className="px-3 py-2">Client</th>
                <th className="px-3 py-2 whitespace-nowrap">Drawing Target</th>
                <th className="px-3 py-2 whitespace-nowrap">Readiness</th>
                <th className="px-3 py-2 whitespace-nowrap">Perf. Curve</th>
                <th className="px-3 py-2 whitespace-nowrap">SO Status</th>
                <th className="border-l border-card-border px-3 py-2">EC No.</th>
                <th className="px-3 py-2">EC Date</th>
                <th className="px-3 py-2">Pump Type</th>
                <th className="px-3 py-2">Model No.</th>
                <th className="px-3 py-2">GAD</th>
                <th className="px-3 py-2">Performance Curve</th>
                <th className="px-3 py-2">Part Drawing</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {soGroups.length === 0 && (
                <tr>
                  <td colSpan={16} className="px-4 py-10 text-center text-sm text-muted">
                    {emptyMessage}
                  </td>
                </tr>
              )}
              {soGroups.map((g) => {
                const span = g.ecs.length;
                const soCell = "px-3 py-2 align-top border-b border-card-border";
                return (
                  <Fragment key={g.key}>
                    {g.ecs.map((row, k) => {
                      const last = k === g.ecs.length - 1;
                      const ecCell = `px-3 py-2 align-top ${last ? "border-b border-card-border" : "border-b border-card-border/50"}`;
                      const ecId = str(row.id);
                      return (
                        <tr
                          key={ecId}
                          data-focus-row={ecId}
                          className={`text-foreground ${dispatchRowTone(g.head) ?? "hover:bg-background/40"} ${focusClass(ecId)}`}
                        >
                          {k === 0 && (
                            <>
                              <td rowSpan={span} data-focus-row={str(g.head.order_id)} className={`${soCell} font-medium tabular-nums ${focusClass(str(g.head.order_id))}`}>
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
                                  onClick={() => setThreadFor({ orderId: str(g.head.order_id), soLabel: str(g.head.so_no ?? g.head.sl_no) })}
                                  aria-label="Chat"
                                  title="Chat"
                                  className="relative inline-flex h-7 w-7 items-center justify-center rounded-lg border border-input-border text-foreground transition-colors hover:bg-background"
                                >
                                  <MessageSquare className="h-3.5 w-3.5" />
                                  {(unreadThreads[str(g.head.order_id)] ?? 0) > 0 && (
                                    <span className="absolute -right-1.5 -top-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-600 px-1 text-[10px] font-bold text-white">
                                      {unreadThreads[str(g.head.order_id)]}
                                    </span>
                                  )}
                                </button>
                              </td>
                              <td rowSpan={span} className={soCell}>
                                <span title={str(g.head.client_name)} className="line-clamp-2 w-32 text-xs leading-snug">
                                  {str(g.head.client_name) || "—"}
                                </span>
                              </td>
                              <td rowSpan={span} className={`${soCell} whitespace-nowrap text-muted`}>{formatDate(g.head.drg_target_date)}</td>
                              <td rowSpan={span} className={`${soCell} whitespace-nowrap`}>
                                {/* Drawing's own date for the SO, with every value it has held. */}
                                <DrawingReadinessCell orderId={str(g.head.order_id)} value={g.head.drg_readiness_date} canEdit={canEdit} />
                              </td>
                              <td rowSpan={span} className={soCell}>
                                {wantsCurve(g.head) ? (
                                  <span className="font-semibold text-foreground">Yes</span>
                                ) : (
                                  <span className="text-muted">No</span>
                                )}
                              </td>
                              <td rowSpan={span} className={soCell}>
                                {/* Closed once Drawing is done with every EC on it. */}
                                {g.head.so_drawing_closed ? (
                                  <span className="flex flex-col items-start gap-0.5">
                                    <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700">Closed</span>
                                    {str(g.head.so_drawing_closed_date) && (
                                      <span className="whitespace-nowrap text-[11px] text-muted">{formatDate(g.head.so_drawing_closed_date)}</span>
                                    )}
                                    <TargetNote target={g.head.drg_readiness_date} until={g.head.so_drawing_closed_date} closed />
                                  </span>
                                ) : (
                                  <span className="flex flex-col items-start gap-0.5">
                                    <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-700">Open</span>
                                    <TargetNote target={g.head.drg_readiness_date} until={todayIso()} />
                                  </span>
                                )}
                              </td>
                            </>
                          )}
                          <td className={`${ecCell} border-l border-card-border whitespace-nowrap font-semibold`}>{str(row.ec_no) || "—"}</td>
                          <td className={`${ecCell} whitespace-nowrap text-muted`}>{formatDate(row.ec_date)}</td>
                          <td className={`${ecCell} whitespace-nowrap`}>{str(row.pump_type) || "—"}</td>
                          <td className={`${ecCell} whitespace-nowrap`}>{str(row.model_no) || "—"}</td>
                          <td className={ecCell}>
                            <DocCell row={row} doc="GAD" onOpen={() => open(ecId, "GAD")} />
                          </td>
                          <td className={ecCell}>
                            {wantsCurve(row) ? (
                              <DocCell row={row} doc="Performance Curve" onOpen={() => open(ecId, "Performance Curve")} />
                            ) : (
                              <span className="text-xs text-muted">Not required</span>
                            )}
                          </td>
                          <td className={ecCell}>
                            {wantsParts(row) ? (
                              <button type="button" onClick={() => open(ecId, "Part Drawing")} title="Open part drawings" className="text-left">
                                <PartDrawingCell required={row.part_drawing} parts={partsOf(row)} />
                              </button>
                            ) : (
                              <span className="text-xs text-muted">Not required</span>
                            )}
                          </td>
                          <td className={`${ecCell} whitespace-nowrap`}>
                            <span className="inline-flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => open(ecId, "GAD")}
                                className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-primary/40 bg-primary/10 px-3 text-xs font-semibold text-primary transition-colors hover:bg-primary hover:text-primary-foreground"
                              >
                                <PenTool className="h-3.5 w-3.5" />
                                Drawings
                              </button>
                              <DeptCompleteCheck
                                scopeId={ecId}
                                dept="drawing"
                                label={str(row.ec_no ?? row.id)}
                                completion={completionFor(completions, "drawing", ecId, true)}
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
        const ec = drawingsFor ? rows.find((r) => r.id === drawingsFor) : null;
        if (!ec) return null;
        const docs: DrawingTab[] = [...docsFor(ec), ...(wantsParts(ec) ? (["Part Drawing"] as const) : [])];
        const doc = docs.includes(docFor) ? docFor : "GAD";
        return (
          <div
            role="dialog"
            aria-modal="true"
            aria-label={`Drawings of ${str(ec.ec_no) || "EC"}`}
            className="fixed inset-0 z-40 flex items-end justify-center bg-black/40 sm:items-center sm:p-6"
            onClick={() => setDrawingsFor(null)}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              className="max-h-[92vh] w-full max-w-4xl overflow-y-auto rounded-t-2xl bg-surface p-5 shadow-xl sm:rounded-2xl"
            >
              <div className="mb-4 flex items-start justify-between gap-3">
                <div>
                  <h2 className="font-display text-lg font-semibold text-foreground">Drawings · EC {str(ec.ec_no) || "—"}</h2>
                  <p className="text-xs text-muted">
                    {[ec.so_no, ec.client_name, ec.pump_type, ec.model_no].map(str).filter(Boolean).join(" · ")}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setDrawingsFor(null)}
                  aria-label="Close"
                  className="rounded-lg p-1.5 text-muted transition-colors hover:bg-background hover:text-foreground"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div role="tablist" aria-label="Documents" className="mb-4 flex flex-wrap gap-2">
                {docs.map((d) => {
                  const on = d === doc;
                  const st =
                    d === "Part Drawing"
                      ? (() => {
                          const p = partDrawingStatus(ec.part_drawing, partsOf(ec));
                          return { version: 0, label: p ? `${p.label} · ${p.done}/${p.total}` : "" };
                        })()
                      : drawingDocStatus(versionsOf(ec), d);
                  return (
                    <button
                      key={d}
                      type="button"
                      role="tab"
                      aria-selected={on}
                      onClick={() => setDocFor(d)}
                      className={`inline-flex flex-col items-start rounded-lg border px-3 py-1.5 text-left transition-colors ${
                        on ? "border-primary bg-primary text-primary-foreground" : "border-input-border text-foreground hover:bg-background"
                      }`}
                    >
                      <span className="text-sm font-semibold">{d}</span>
                      <span className={`text-[11px] ${on ? "text-primary-foreground/80" : "text-muted"}`}>
                        {st.version ? `V${st.version} · ` : ""}
                        {st.label}
                      </span>
                    </button>
                  );
                })}
              </div>
              {doc === "Part Drawing" ? (
                <PartProgress key={`${str(ec.id)}:parts`} itemId={str(ec.id)} parts={partsOf(ec)} canEdit={canEdit} />
              ) : (
                <DocVersions
                  key={`${str(ec.id)}:${doc}`}
                  ec={ec}
                  doc={doc}
                  canEdit={canEdit}
                  siblings={rows.filter((r) => str(r.order_id) === str(ec.order_id) && str(r.id) !== str(ec.id)).length}
                />
              )}
            </div>
          </div>
        );
      })()}

      {threadFor && (
        <OrderThreadModal
          orderId={threadFor.orderId}
          role={role}
          soLabel={threadFor.soLabel}
          onClose={() => setThreadFor(null)}
        />
      )}
    </div>
  );
}

const TONE: Record<DrawingStatusTone, string> = {
  done: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  part: "bg-sky-50 text-sky-700 ring-sky-200",
  pending: "bg-amber-50 text-amber-700 ring-amber-200",
  rework: "bg-rose-50 text-rose-700 ring-rose-200",
};

function StatusPill({ label, tone }: { label: string; tone: DrawingStatusTone }) {
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${TONE[tone]}`}>
      {tone === "done" && <CheckCircle2 className="h-3 w-3" />}
      {label}
    </span>
  );
}

/** A document on the front: its status, its version and the date that matters. */
function DocCell({ row, doc, onOpen }: { row: Row; doc: DrawingDocType; onOpen: () => void }) {
  const versions = drawingVersions(versionsOf(row), doc);
  const st = drawingDocStatus(versionsOf(row), doc);
  const last = versions[versions.length - 1];
  const when = last
    ? yes(last.issued_to_production) && last.issued_to_production_date
      ? `Planning ${formatDate(last.issued_to_production_date)}`
      : last.approved_date && str(last.approved)
        ? `${yes(last.approved) ? "Approved" : "Returned"} ${formatDate(last.approved_date)}`
        : last.issued_to_client_date
          ? `Sent ${formatDate(last.issued_to_client_date)}`
          : ""
    : "";
  return (
    <button type="button" onClick={onOpen} title={`Open ${doc}`} className="flex flex-col items-start gap-0.5 text-left">
      <StatusPill label={st.label} tone={st.tone} />
      <span className="text-[11px] text-muted">{[st.version ? `V${st.version}` : "", when].filter(Boolean).join(" · ")}</span>
    </button>
  );
}

/** One document's versions: a button per version on top, the chosen one below. */
function DocVersions({ ec, doc, canEdit, siblings = 0 }: { ec: Row; doc: DrawingDocType; canEdit: boolean; siblings?: number }) {
  const router = useRouter();
  const versions = drawingVersions(versionsOf(ec), doc);
  const [picked, setPicked] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const shown = versions.find((v) => str(v.id) === picked) ?? versions[versions.length - 1];
  const latest = versions[versions.length - 1];
  // A new version follows a resubmit; the first one starts the document.
  const canAdd = canEdit && (!latest || str(latest.approved).toLowerCase() === "no");

  async function addVersion() {
    setBusy(true);
    setError(null);
    const res = await addOrderChildAction(str(ec.id), "order_drawing_revisions", doc);
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    if (res.id) setPicked(res.id);
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {versions.map((v, i) => {
          const on = shown && str(v.id) === str(shown.id);
          const st = drawingDocStatus([v], doc);
          return (
            <button
              key={str(v.id)}
              type="button"
              onClick={() => setPicked(str(v.id))}
              className={`inline-flex flex-col items-start rounded-lg border px-3 py-1.5 text-left transition-colors ${
                on ? "border-primary bg-primary/10 text-foreground" : "border-input-border text-foreground hover:bg-background"
              }`}
            >
              <span className="text-sm font-semibold">V{i + 1}</span>
              <span className="text-[11px] text-muted">{st.label}</span>
            </button>
          );
        })}
        {canAdd && (
          <button
            type="button"
            onClick={addVersion}
            disabled={busy}
            className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-dashed border-primary/50 px-3 text-sm font-semibold text-primary transition-colors hover:bg-primary/10 disabled:opacity-60"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            {latest ? `New version V${versions.length + 1}` : "Start V1"}
          </button>
        )}
      </div>
      {error && <p className="text-sm text-rose-600">{error}</p>}
      {shown ? (
        <VersionForm
          key={str(shown.id)}
          version={shown}
          number={versions.findIndex((v) => str(v.id) === str(shown.id)) + 1}
          latest={str(shown.id) === str(latest?.id)}
          ec={ec}
          doc={doc}
          canEdit={canEdit}
          siblings={siblings}
        />
      ) : (
        <p className="rounded-xl border border-dashed border-card-border px-4 py-8 text-center text-sm text-muted">
          No version of the {doc} yet.
        </p>
      )}
    </div>
  );
}

const input =
  "h-10 w-full rounded-lg border border-input-border bg-surface px-3 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-ring/20 disabled:bg-background disabled:text-muted";

function Step({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-card-border p-4">
      <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 text-primary">{icon}</span>
        {title}
      </h3>
      {children}
    </section>
  );
}

function Choice({
  value,
  options,
  onChange,
  disabled,
}: {
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  return (
    <div role="radiogroup" className="inline-flex h-10 rounded-lg border border-input-border p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          disabled={disabled}
          onClick={() => onChange(o.value)}
          className={`rounded-md px-3 text-sm font-semibold transition-colors disabled:cursor-not-allowed ${
            value === o.value ? "bg-primary text-primary-foreground" : "text-muted hover:text-foreground"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

const VERSION_FIELDS = [
  "issued_to_client",
  "issued_to_client_date",
  "approved",
  "approved_date",
  "issued_to_production",
  "issued_to_production_date",
  "planning_link",
  "remarks",
] as const;

/** One version, filled in order: sent to the client, the client's answer, the workshop (GAD). */
function VersionForm({
  version,
  number,
  latest,
  ec,
  doc,
  canEdit,
  siblings = 0,
}: {
  version: Row;
  number: number;
  latest: boolean;
  ec: Row;
  doc: DrawingDocType;
  canEdit: boolean;
  /** The SO's other pump ECs on the page: one click gives them this version too. */
  siblings?: number;
}) {
  const router = useRouter();
  const initial = () =>
    Object.fromEntries(
      VERSION_FIELDS.map((k) => {
        const raw = str(version[k]);
        if (k.endsWith("_date")) return [k, raw.slice(0, 10)];
        if (k === "remarks" || k === "planning_link") return [k, raw];
        return [k, raw.trim().toLowerCase() === "yes" ? "Yes" : raw.trim().toLowerCase() === "no" ? "No" : ""];
      })
    ) as Record<string, string>;
  const [v, setV] = useState<Record<string, string>>(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const set = (k: string, value: string) => {
    setV((p) => ({ ...p, [k]: value }));
    setSaved(false);
  };
  const dirty = JSON.stringify(v) !== JSON.stringify(initial());
  const ro = !canEdit;
  const gad = doc === "GAD";
  const sent = v.issued_to_client === "Yes";
  const approved = sent && v.approved === "Yes";
  const live = drawingDocStatus([{ ...v, doc_type: doc }], doc);

  const [note, setNote] = useState<string | null>(null);
  async function save(toAll = false) {
    setSaving(true);
    setError(null);
    setNote(null);
    // A later step means nothing without the one before it.
    const out: Record<string, string> = { ...v };
    if (!sent) Object.assign(out, { issued_to_client_date: "", approved: "", approved_date: "" });
    if (out.approved === "") out.approved_date = "";
    if (!(sent && out.approved === "Yes") || !gad) Object.assign(out, { issued_to_production: "", issued_to_production_date: "" });
    if (out.issued_to_production !== "Yes") Object.assign(out, { issued_to_production_date: "", planning_link: "" });
    out.planning_link = out.planning_link.trim();
    if (out.planning_link && !/^https?:\/\//i.test(out.planning_link)) {
      setSaving(false);
      setError("The SharePoint link must start with https://");
      return;
    }
    const res = dirty || !toAll ? await updateOrderChildAction(str(version.id), "order_drawing_revisions", out, str(ec.id)) : { ok: true as const };
    if (!res.ok) {
      setSaving(false);
      setError(res.error);
      return;
    }
    // The same version on every other pump EC of the SO.
    if (toAll) {
      const all = await applyDrawingVersionToSoAction(str(ec.id), doc, number, out);
      if (!all.ok) {
        setSaving(false);
        setError(all.error);
        return;
      }
      setNote(
        `Applied to ${all.applied} other EC${all.applied === 1 ? "" : "s"}` +
          (all.skipped.length ? ` · skipped ${all.skipped.join(", ")}` : "")
      );
    }
    setSaving(false);
    setSaved(true);
    router.refresh();
  }

  async function remove() {
    if (!window.confirm(`Delete ${doc} V${number}?`)) return;
    setSaving(true);
    const res = await deleteOrderChildAction(str(version.id), "order_drawing_revisions", str(ec.id));
    setSaving(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-card-border bg-background/50 px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <FileText className="h-4 w-4" />
          </span>
          <div>
            <p className="text-base font-semibold text-foreground">
              {doc} · V{number}
            </p>
            <p className="text-xs text-muted">{latest ? "Latest version" : "Earlier version"}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <StatusPill label={live.label} tone={live.tone} />
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Step icon={<Send className="h-4 w-4" />} title="Sent to client">
          <div className="flex flex-wrap items-end gap-3">
            <Choice
              value={sent ? "Yes" : "No"}
              options={[
                { value: "No", label: "No" },
                { value: "Yes", label: "Yes" },
              ]}
              onChange={(x) => set("issued_to_client", x === "Yes" ? "Yes" : "")}
              disabled={ro}
            />
            {sent && (
              <label className="block min-w-[10rem] flex-1">
                <span className="mb-1 block text-xs font-medium text-muted-foreground">Sent Date</span>
                <input type="date" value={v.issued_to_client_date} onChange={(e) => set("issued_to_client_date", e.target.value)} disabled={ro} className={input} />
              </label>
            )}
          </div>
        </Step>

        <Step icon={<CheckCircle2 className="h-4 w-4" />} title="Client response">
          {sent ? (
            <div className="flex flex-wrap items-end gap-3">
              <Choice
                value={v.approved}
                options={[
                  { value: "", label: "Pending" },
                  { value: "Yes", label: "Approved" },
                  { value: "No", label: "Resubmit" },
                ]}
                onChange={(x) => set("approved", x)}
                disabled={ro}
              />
              {v.approved !== "" && (
                <label className="block min-w-[10rem] flex-1">
                  <span className="mb-1 block text-xs font-medium text-muted-foreground">
                    {v.approved === "Yes" ? "Approved Date" : "Returned Date"}
                  </span>
                  <input type="date" value={v.approved_date} onChange={(e) => set("approved_date", e.target.value)} disabled={ro} className={input} />
                </label>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted">Once the version is sent to the client.</p>
          )}
          {sent && v.approved === "No" && latest && (
            <p className="mt-2 text-xs text-rose-700">Client asked to resubmit — save, then start the next version.</p>
          )}
        </Step>

        {gad && (
          <Step icon={<CalendarCheck className="h-4 w-4" />} title="Issued to Planning">
            {approved ? (
              <div className="flex flex-wrap items-end gap-3">
                <Choice
                  value={v.issued_to_production === "Yes" ? "Yes" : "No"}
                  options={[
                    { value: "No", label: "No" },
                    { value: "Yes", label: "Yes" },
                  ]}
                  onChange={(x) => set("issued_to_production", x === "Yes" ? "Yes" : "")}
                  disabled={ro}
                />
                {v.issued_to_production === "Yes" && (
                  <label className="block min-w-[10rem] flex-1">
                    <span className="mb-1 block text-xs font-medium text-muted-foreground">Issued Date</span>
                    <input
                      type="date"
                      value={v.issued_to_production_date}
                      onChange={(e) => set("issued_to_production_date", e.target.value)}
                      disabled={ro}
                      className={input}
                    />
                  </label>
                )}
                {v.issued_to_production === "Yes" && (
                  <label className="block w-full">
                    <span className="mb-1 block text-xs font-medium text-muted-foreground">SharePoint Link</span>
                    <input
                      type="url"
                      value={v.planning_link}
                      onChange={(e) => set("planning_link", e.target.value)}
                      disabled={ro}
                      placeholder="https://…sharepoint.com/…"
                      className={input}
                    />
                  </label>
                )}
              </div>
            ) : (
              <p className="text-sm text-muted">Once the client approves the GAD.</p>
            )}
          </Step>
        )}

        <label className={`block ${gad ? "" : "md:col-span-2"}`}>
          <span className="mb-1 block text-xs font-medium text-muted-foreground">Remarks</span>
          <textarea
            value={v.remarks}
            onChange={(e) => set("remarks", e.target.value)}
            disabled={ro}
            rows={3}
            className={`${input} h-auto py-2`}
            placeholder="Client comments, what changed in this version…"
          />
        </label>
      </div>

      {canEdit && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          {latest && !sent ? (
            <button
              type="button"
              onClick={remove}
              disabled={saving}
              className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-medium text-rose-700 hover:bg-rose-50 disabled:opacity-60"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Delete version
            </button>
          ) : (
            <span />
          )}
          <div className="flex items-center gap-3">
            {error && <span className="text-sm text-rose-600">{error}</span>}
            {saved && !dirty && <span className="text-sm text-emerald-700">{note ?? "Saved"}</span>}
            {siblings > 0 && (
              <button
                type="button"
                onClick={() => save(true)}
                disabled={saving}
                title={`Save this ${doc} V${number} on every pump EC of this SO`}
                className="inline-flex h-10 items-center gap-2 rounded-lg border border-primary/40 bg-primary/10 px-4 text-sm font-semibold text-primary transition-colors hover:bg-primary hover:text-primary-foreground disabled:opacity-50"
              >
                Save to all {siblings + 1} ECs
              </button>
            )}
            <button
              type="button"
              onClick={() => save()}
              disabled={saving || !dirty}
              className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-5 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              Save
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Today in India, as YYYY-MM-DD. */
function todayIso(): string {
  return new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
}

/**
 * Against the Drawing target: an open SO past it is overdue by so many days;
 * a closed one that closed after it was late by so many.
 */
function TargetNote({ target, until, closed = false }: { target: unknown; until: unknown; closed?: boolean }) {
  const t = str(target).slice(0, 10);
  const u = str(until).slice(0, 10);
  if (!t || !u) return null;
  const days = Math.round((Date.parse(u) - Date.parse(t)) / 86400000);
  if (days <= 0) return null;
  return (
    <span className="whitespace-nowrap rounded-full bg-rose-50 px-2 py-0.5 text-[11px] font-semibold text-rose-700">
      {closed ? `Late by ${days}d` : `Overdue ${days}d`}
    </span>
  );
}
