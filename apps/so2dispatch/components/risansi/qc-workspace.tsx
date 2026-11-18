"use client";

import { EcLink } from "./ec-link";
import { Fragment, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, ExternalLink, FileCheck2, Link2, Loader2, MessageSquare, X } from "lucide-react";
import { DEPT_VIEWS, dispatchRowTone } from "@/lib/dept-view";
import { isWebLink, splitLinks } from "@/lib/doc-links";
import { given, linksFromRows, qcDocsStatus, requiredQcDocs, type QcLink, type QcTone } from "@/lib/qc-docs";
import type { OrderListOptions } from "@/lib/orders";
import type { PageResult } from "@/lib/pagination";
import type { DeptCompletion } from "@/lib/dept-completion";
import type { KpiCard } from "@/lib/kpis";
import { saveQcLinksAction } from "@/app/risansi/orders/qc-actions";
import { HoldBadge } from "./hold-badge";
import { VersionTag } from "./version-tag";
import { SortHeader } from "./sort-header";
import { UrlPagination, UrlSearchInput, useUrlTable } from "./url-table";
import { OrderListFilterBar } from "./order-list-filter-bar";
import { useConsumeFocusParam, useFocusRow } from "./use-focus-row";
import { OrderThreadModal } from "./order-thread-modal";
import { GadCell } from "./gad-cell";
import { PartDrawingCell, PartDrawingView } from "./part-drawing";
import { completionFor, DeptCompleteCheck } from "./dept-complete-check";
import { KpiStrip } from "./kpi-strip";
import { MultiSelectFilter } from "./multi-select-filter";
import { QC_ASSEMBLY_STATES, QC_EC_STATUSES, QC_FILTER_KEYS, QC_SO_STATES, soQcState } from "@/lib/qc-filter";
import { ecStageStatus } from "@/lib/assembly";
import { PendencyCell } from "./pendency-cell";
import type { Pendency } from "@/lib/pendency";
import type { EcAssembly } from "@/lib/ec-assembly";
import { EcFocus, PanelSection, Portrait, SplitShell, type SplitCol } from "./split-view";

type Row = Record<string, unknown>;
type Group = { key: string; head: Row; ecs: Row[] };
/**
 * An EC column that, for some ECs, the table joins with the ones after it
 * into one "—" cell (a Spare has no drawings, an EC no assembly yet): `join`
 * says how many columns it spans. The panel still shows each column's "—".
 */
type EcCol = SplitCol<Row> & { join?: (row: Row) => number | null };
const str = (v: unknown) => (v === null || v === undefined ? "" : String(v));
const rowsOf = (v: unknown) => (Array.isArray(v) ? (v as Row[]) : []);

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

/** An EC's assembly: green once assembled, blue part-way, amber pending. */
function AssemblyChip({ label }: { label: string }) {
  const cls =
    label === "Assembled"
      ? "bg-emerald-50 text-emerald-700"
      : label === "Partially assembled"
        ? "bg-sky-50 text-sky-700"
        : "bg-amber-50 text-amber-700";
  return <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ${cls}`}>{label}</span>;
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
  embedded = false,
  assembly = {},
  pendency = {},
  split: splitView = false,
}: {
  /** The split view (the profile menu's switch): the SO list, the SO picked beside it. */
  split?: boolean;
  /** Why each Open SO is still pending with Quality (remarks), by SO id. */
  pendency?: Record<string, Pendency>;
  /** How far Assembly has got on each pump EC, by EC id. */
  assembly?: Record<string, EcAssembly>;
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
  /** Inside a pop-up (the Orders list's): one SO's rows — no filter bar, cards or paging. */
  embedded?: boolean;
}) {
  const rows = queue.rows;
  const { get: getParam, getList, setParams } = useUrlTable();
  const emptyMessage = getParam("q") ? "No orders match your search." : "No orders yet.";
  const [docsFor, setDocsFor] = useState<string | null>(() =>
    openItemId && rows.some((r) => r.id === openItemId) ? openItemId : null
  );
  const [threadFor, setThreadFor] = useState<{ orderId: string; soLabel: string } | null>(() => {
    const row = openThreadId ? rows.find((r) => str(r.order_id) === openThreadId) : null;
    return row && openThreadId ? { orderId: openThreadId, soLabel: str(row.so_no ?? row.sl_no) } : null;
  });
  const [partsFor, setPartsFor] = useState<string | null>(null);
  const focusClass = useFocusRow([openItemId, focusOrderId], rows.length > 0);
  useConsumeFocusParam(queue.page);

  const groups: Group[] = [];
  for (const r of rows) {
    const key = str(r.order_id);
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.ecs.push(r);
    else groups.push({ key, head: r, ecs: [r] });
  }

  // The columns, listed once: the table draws them across, the split view's
  // panel stands the same ones upright (SO, then each EC).
  const soCols: SplitCol<Group>[] = [
    { key: "sl", label: "Sl.", head: <SortHeader label="Sl." sortKey="sl" />, tdClass: "font-medium tabular-nums", cell: (g) => str(g.head.sl_no), list: true },
    {
      key: "so",
      label: "SO No. / Date",
      head: <SortHeader label="SO No. / Date" sortKey="so_date" />,
      thClass: "sticky-so",
      tdClass: "sticky-so whitespace-nowrap",
      cell: (g) => (
        <>
          <span className="font-semibold">{str(g.head.so_no) || "—"}</span>
          <VersionTag order={g.head} />
          <HoldBadge order={g.head} />
          <span className="block text-xs text-muted">{formatDate(g.head.so_date)}</span>
        </>
      ),
      list: true,
    },
    {
      key: "chat",
      label: "Chat",
      cell: (g) => (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setThreadFor({ orderId: g.key, soLabel: str(g.head.so_no ?? g.head.sl_no) });
          }}
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
      ),
    },
    {
      key: "target",
      label: "Quality Target",
      head: <SortHeader label="Quality Target" sortKey="qc_doc_target_date" />,
      thClass: "whitespace-nowrap",
      tdClass: "whitespace-nowrap text-muted",
      cell: (g) => formatDate(g.head.qc_doc_target_date),
      list: true,
    },
    {
      key: "needed",
      label: "Docs Needed",
      thClass: "whitespace-nowrap",
      cell: (g) => {
        const needed = requiredQcDocs(g.head);
        return needed.length ? (
          <span className="flex flex-wrap gap-1">
            {needed.map((d) => (
              <span key={d} className="rounded-full bg-background px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset ring-card-border">
                {d}
              </span>
            ))}
          </span>
        ) : (
          <span className="text-xs text-muted">Not specified</span>
        );
      },
    },
    {
      key: "state",
      label: "SO Status",
      thClass: "whitespace-nowrap",
      cell: (g) =>
        // Closed once every EC has all its documents in — from all its ECs, before a filter.
        (str(g.head.qc_so_state) || soQcState(g.ecs)) === "Closed" ? (
          <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700">Closed</span>
        ) : (
          // Open: why, in Quality's remarks.
          <PendencyCell
            orderId={g.key}
            soLabel={str(g.head.so_no) || `#${str(g.head.sl_no)}`}
            dept="qc"
            pendency={pendency[g.key]}
            canEdit={canEdit}
          >
            <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-700">Open</span>
          </PendencyCell>
        ),
      list: true,
    },
  ];
  // The documents each EC needs are the SO's (every EC row carries them).
  const docsStatus = (row: Row) => qcDocsStatus(requiredQcDocs(row), linksFromRows(row.qc_links));
  const ecCols: EcCol[] = [
    {
      key: "ec",
      label: "EC No.",
      thClass: "border-l border-card-border",
      tdClass: "border-l border-card-border whitespace-nowrap font-semibold",
      cell: (row) => (
        <>
          {str(row.ec_no) || "—"}
          <EcLink href={row.ec_link} at={row.ec_link_at} links={row.ec_links} latest />
        </>
      ),
    },
    { key: "ecdate", label: "EC Date", head: <SortHeader label="EC Date" sortKey="ec_date" />, tdClass: "whitespace-nowrap text-muted", cell: (row) => formatDate(row.ec_date) },
    { key: "pump", label: "Pump Type", tdClass: "whitespace-nowrap", cell: (row) => str(row.pump_type) || "—" },
    { key: "model", label: "Model No.", tdClass: "whitespace-nowrap", cell: (row) => str(row.model_no) || "—" },
    // Drawing's work on the EC, to read: a Spare has none.
    {
      key: "gad",
      label: "GAD",
      tdClass: "whitespace-nowrap",
      join: (row) => (row.is_spare ? 2 : null),
      cell: (row) => (row.is_spare ? "—" : <GadCell versions={rowsOf(row.gad_versions)} gadRequired={row.gad_required} ecLink={row.ec_link} />),
    },
    {
      key: "parts",
      label: "Part Drawing",
      thClass: "whitespace-nowrap",
      cell: (row) =>
        row.is_spare ? (
          "—"
        ) : rowsOf(row.part_drawings).length > 0 ? (
          <button type="button" onClick={() => setPartsFor(str(row.id))} title="See the parts" className="text-left">
            <PartDrawingCell required={row.part_drawing} parts={rowsOf(row.part_drawings)} />
          </button>
        ) : (
          <PartDrawingCell required={row.part_drawing} parts={[]} />
        ),
    },
    // Where Assembly has got with the EC, and the last day it assembled any.
    {
      key: "qty",
      label: "Qty",
      tdClass: "tabular-nums",
      join: (row) => (assembly[str(row.id)] ? null : 4),
      cell: (row) => assembly[str(row.id)]?.qty || "—",
    },
    { key: "ready", label: "Ready", tdClass: "tabular-nums", cell: (row) => assembly[str(row.id)]?.ready ?? "—" },
    { key: "assembled", label: "Assembled", tdClass: "tabular-nums", cell: (row) => assembly[str(row.id)]?.assembled ?? "—" },
    {
      key: "assembly",
      label: "Assembly",
      tdClass: "whitespace-nowrap",
      cell: (row) => {
        const a = assembly[str(row.id)];
        if (!a) return "—";
        return (
          <>
            <AssemblyChip label={ecStageStatus(a.assembled, a.qty, "assembly")} />
            {a.lastAssembled && <span className="block text-[11px] text-muted">{formatDate(a.lastAssembled)}</span>}
          </>
        );
      },
    },
    {
      key: "docs",
      label: "Documents",
      cell: (row) => {
        const st = docsStatus(row);
        return (
          <button type="button" onClick={() => setDocsFor(str(row.id))} className="flex flex-col items-start gap-0.5 text-left" title="Open the QC documents">
            {<Chip label={st.label} tone={st.tone} />}
            {st.total > 0 && <span className="text-[11px] text-muted">{st.done}/{st.total} in</span>}
          </button>
        );
      },
    },
    {
      key: "submitted",
      label: "Submitted On",
      head: <SortHeader label="Submitted On" sortKey="qc_submitted" />,
      thClass: "whitespace-nowrap",
      tdClass: "whitespace-nowrap",
      cell: (row) => formatDate(row.qc_doc_actual_date),
    },
    {
      key: "actions",
      label: "Actions",
      head: null,
      tdClass: "whitespace-nowrap",
      cell: (row) => {
        const ecId = str(row.id);
        return (
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
        );
      },
    },
  ];
  const headOf = <R,>(c: SplitCol<R>) => ("head" in c ? c.head : c.label);
  // The EC cells of one row, with the joined ones drawn as one "—" cell.
  const ecCells = (row: Row, ecCell: string) => {
    const out: ReactNode[] = [];
    for (let i = 0; i < ecCols.length; i++) {
      const c = ecCols[i];
      const span = c.join?.(row) ?? null;
      if (span) {
        out.push(
          <td key={c.key} colSpan={span} className={`${ecCell} text-muted`}>
            —
          </td>
        );
        i += span - 1;
      } else {
        out.push(
          <td key={c.key} className={`${ecCell} ${c.tdClass ?? ""}`}>
            {c.cell(row)}
          </td>
        );
      }
    }
    return out;
  };
  // Split view (not inside a pop-up): the SO picked, the first until another is.
  const split = splitView && !embedded;
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const focusGroup = split ? (groups.find((g) => g.key === focusKey) ?? groups[0] ?? null) : null;
  const listCols = soCols.filter((c) => c.list);

  return (
    <div>
      <div className={embedded ? "hidden" : "mb-3"}>
        {filterOptions ? (
          <OrderListFilterBar
            options={filterOptions}
            total={queue.total}
            dept="quality"
            hasTarget={DEPT_VIEWS["quality"].hasTarget}
            searchPlaceholder="Search SO, EC…"
            noTypeFilter
            noStatusFilter
            extraKeys={Object.values(QC_FILTER_KEYS)}
            extraFilters={
              <>
                <MultiSelectFilter
                  label="SO status"
                  allLabel="Any"
                  options={QC_SO_STATES}
                  selected={getList(QC_FILTER_KEYS.so)}
                  onChange={(next) => setParams({ [QC_FILTER_KEYS.so]: next })}
                />
                <MultiSelectFilter
                  label="EC status"
                  allLabel="Any"
                  options={QC_EC_STATUSES}
                  selected={getList(QC_FILTER_KEYS.ec)}
                  onChange={(next) => setParams({ [QC_FILTER_KEYS.ec]: next })}
                />
                <MultiSelectFilter
                  label="Assembly"
                  allLabel="Any"
                  options={QC_ASSEMBLY_STATES}
                  selected={getList(QC_FILTER_KEYS.asm)}
                  onChange={(next) => setParams({ [QC_FILTER_KEYS.asm]: next })}
                />
              </>
            }
          />
        ) : (
          <UrlSearchInput placeholder="Search SO, EC…" />
        )}
      </div>

      {!embedded && <KpiStrip cards={kpis} />}

      <SplitShell
        split={split}
        focusKey={focusGroup?.key ?? null}
        focusLabel={focusGroup ? str(focusGroup.head.so_no) || `#${str(focusGroup.head.sl_no)}` : null}
        list={
      <div className="rounded-xl border border-card-border bg-surface shadow-sm">
        <div className="overflow-x-auto" data-sticky-head={embedded ? undefined : ""}>
          {split ? (
            // Split view: the SO's identity and state; the rest is the panel's.
            <table className="w-full text-sm">
              <thead className="relative z-10 bg-surface data-[stuck=1]:shadow-[0_2px_6px_-2px_rgba(0,0,0,0.18)] [&_th]:bg-surface">
                <tr className="border-b border-card-border text-left text-[11px] font-semibold uppercase tracking-wide text-muted">
                  {listCols.map((c) => (
                    <th key={c.key} className={`px-3 py-2 ${c.thClass ?? ""}`}>{headOf(c)}</th>
                  ))}
                  <th className="px-3 py-2">ECs</th>
                </tr>
              </thead>
              <tbody>
                {groups.length === 0 && (
                  <tr>
                    <td colSpan={listCols.length + 1} className="px-4 py-10 text-center text-sm text-muted">
                      {emptyMessage}
                    </td>
                  </tr>
                )}
                {groups.map((g) => (
                  <tr
                    key={g.key}
                    data-focus-row={g.key}
                    onClick={() => setFocusKey(g.key)}
                    className={`cursor-pointer text-foreground ${dispatchRowTone(g.head) ?? "hover:bg-background/40"} ${
                      focusGroup?.key === g.key ? "outline-2 -outline-offset-2 outline-primary/50" : ""
                    } ${focusClass(g.key)}`}
                  >
                    {listCols.map((c) => (
                      <td key={c.key} className={`border-b border-card-border px-3 py-2 align-top ${c.tdClass ?? ""}`}>
                        {c.cell(g)}
                      </td>
                    ))}
                    <td className="border-b border-card-border px-3 py-2 align-top tabular-nums">{g.ecs.length}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
          <table className="w-full min-w-[1600px] text-sm">
            <thead className="relative z-10 bg-surface data-[stuck=1]:shadow-[0_2px_6px_-2px_rgba(0,0,0,0.18)] [&_th]:bg-surface">
              <tr className="text-left text-xs font-semibold uppercase tracking-wide text-muted">
                <th colSpan={soCols.length} className="px-3 pt-2.5 pb-1">SO</th>
                <th colSpan={ecCols.length} className="border-l border-card-border px-3 pt-2.5 pb-1 text-center">EC</th>
              </tr>
              <tr className="border-b border-card-border text-left text-[11px] font-semibold uppercase tracking-wide text-muted">
                {[...soCols, ...ecCols].map((c) => (
                  <th key={c.key} className={`px-3 py-2 ${c.thClass ?? ""}`}>{headOf(c as SplitCol<unknown>)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {groups.length === 0 && (
                <tr>
                  <td colSpan={soCols.length + ecCols.length} className="px-4 py-10 text-center text-sm text-muted">
                    {emptyMessage}
                  </td>
                </tr>
              )}
              {groups.map((g) => {
                const span = g.ecs.length;
                const soCell = "px-3 py-2 align-top border-b border-card-border";
                return (
                  <Fragment key={g.key}>
                    {g.ecs.map((row, k) => {
                      const last = k === g.ecs.length - 1;
                      const ecCell = `px-3 py-2 align-top ${last ? "border-b border-card-border" : "border-b border-card-border/50"}`;
                      const ecId = str(row.id);
                      return (
                        <tr key={ecId} data-focus-row={ecId} className={`text-foreground ${dispatchRowTone(g.head) ?? "hover:bg-background/40"} ${focusClass(ecId)}`}>
                          {k === 0 &&
                            soCols.map((c, i) => (
                              <td
                                key={c.key}
                                rowSpan={span}
                                data-focus-row={i === 0 ? g.key : undefined}
                                className={`${soCell} ${c.tdClass ?? ""} ${i === 0 ? focusClass(g.key) : ""}`}
                              >
                                {c.cell(g)}
                              </td>
                            ))}
                          {ecCells(row, ecCell)}
                        </tr>
                      );
                    })}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
          )}
        </div>
        {!embedded && <UrlPagination page={queue.page} totalPages={queue.totalPages} from={queue.from} to={queue.to} total={queue.total} />}
      </div>
        }
        panel={
          focusGroup ? (
            <>
              <PanelSection title="SO">
                <Portrait cols={soCols} row={focusGroup} />
              </PanelSection>
              {/* The ECs: all, or one picked from the chips. */}
              <EcFocus key={focusGroup.key} ecs={focusGroup.ecs} keyOf={(ec) => str(ec.id)} labelOf={(ec) => str(ec.ec_no) || "—"}>
                {(ec) => (
                <PanelSection key={str(ec.id)} title={`EC ${str(ec.ec_no) || "—"}`}>
                  <Portrait cols={ecCols} row={ec} />
                </PanelSection>
                )}
              </EcFocus>
            </>
          ) : null
        }
      />

      {(() => {
        const ec = docsFor ? rows.find((r) => r.id === docsFor) : null;
        if (!ec) return null;
        return <QcDocsModal key={str(ec.id)} ec={ec} canEdit={canEdit} onClose={() => setDocsFor(null)} />;
      })()}

      {(() => {
        const ec = partsFor ? rows.find((r) => r.id === partsFor) : null;
        if (!ec) return null;
        return <PartDrawingView key={str(ec.id)} itemId={str(ec.id)} label={str(ec.ec_no) || "EC"} parts={rowsOf(ec.part_drawings)} onClose={() => setPartsFor(null)} />;
      })()}

      {threadFor && (
        <OrderThreadModal orderId={threadFor.orderId} role={role} soLabel={threadFor.soLabel} onClose={() => setThreadFor(null)} />
      )}
    </div>
  );
}

const input =
  "h-10 w-full rounded-lg border border-input-border bg-surface px-3 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-ring/20 disabled:bg-background disabled:text-muted";

/** One EC's QC documents: a card for each the SO needs — its links, the day it went in, remarks. */
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
              const opens = splitLinks(l.link).filter(isWebLink);
              const isIn = given(l);
              return (
                <section key={l.doc_type} className={`rounded-xl border p-4 ${isIn ?"border-emerald-200 bg-emerald-50/30" : "border-card-border"}`}>
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
                      <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 text-primary">
                        <Link2 className="h-4 w-4" />
                      </span>
                      {l.doc_type}
                    </p>
                    {opens.length > 0 ? (
                      <span className="flex flex-wrap justify-end gap-x-3 gap-y-1">
                        {opens.map((href, k) => (
                          <a key={k} href={href} target="_blank" rel="noopener noreferrer" title={href} className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline">
                            {opens.length > 1 ? `Link ${k + 1}` : "Open"} <ExternalLink className="h-3.5 w-3.5" />
                          </a>
                        ))}
                      </span>
                    ) : isIn ? (
                      <span className="text-xs font-semibold text-emerald-700">Submitted · no link</span>
                    ) : (
                      <span className="text-xs text-muted">Not in yet</span>
                    )}
                  </div>
                  <div className="grid gap-3 sm:grid-cols-[1fr_11rem]">
                    <label className="block">
                      <span className="mb-1 block text-[11px] font-medium text-muted-foreground">SharePoint Links, one on each line</span>
                      <textarea
                        value={l.link}
                        disabled={ro}
                        rows={2}
                        onChange={(e) =>
                          set(i, { link: e.target.value, submitted_date: l.submitted_date || (e.target.value.trim() ? todayIso() : "") })
                        }
                        placeholder="https://…sharepoint.com/…"
                        className={`${input} h-auto py-2`}
                      />
                    </label>
                    <label className="block">
                      <span className="mb-1 block text-[11px] font-medium text-muted-foreground">Submitted On</span>
                      <input type="date" value={l.submitted_date} disabled={ro} onChange={(e) => set(i, { submitted_date: e.target.value })} className={input} />
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
