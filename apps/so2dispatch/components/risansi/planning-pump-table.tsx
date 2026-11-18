"use client";

import { EcLink } from "./ec-link";
import { Fragment, useState } from "react";
import { MessageSquare, PackageX, Pencil } from "lucide-react";
import { ADD_ON_PUMP_FIELDS, LD_DATE_FIELD, withLdCombined, PUMP_EC_PLANNING_COLUMNS, PUMP_LIKE, READY_LOT_LIMIT, SORTABLE_DATE_COLUMNS, pumpEcStatus, type OrderField } from "@/lib/order-schema";
import { lotsFromRows } from "@/lib/ready-lots";
import { ecDone, pumpEcStage, pumpLotsFromEcs, type PumpLot } from "@/lib/assembly";
import { boiInHand, dispatchRowTone } from "@/lib/dept-view";
import { formatDisplay } from "./editable-section";
import { ReadyLotHistoryButton } from "./ready-lot-history";
import { GadCell } from "./gad-cell";
import { PartDrawingCell, PartDrawingView, PartPickerModal, ShortageCell } from "./part-drawing";
import { BoiDetailModal, BoiStatusTag, boiName } from "./boi-detail-modal";
import { OmEcsModal } from "./om-ecs-modal";
import { PumpAfterPlanningCells, pumpAfterPlanningParts } from "./pump-dept-cells";
import { PanelSection, Portrait, SplitShell, type SplitCol } from "./split-view";
import { HoldBadge } from "./hold-badge";
import { VersionTag } from "./version-tag";
import { SortHeader } from "./sort-header";
import type { PumpSummary } from "@/lib/pump-summary";

type Row = Record<string, unknown>;
/** 05 Nov 26. */
function shortDay(v: unknown): string {
  const s = String(v ?? "").slice(0, 10);
  const d = new Date(`${s}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? s : d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "2-digit", timeZone: "UTC" });
}

const str = (v: unknown) => (v === null || v === undefined ? "" : String(v));

// A value with its unit beside it reads as one column on the name plate.
const WITH_UNIT: Record<string, string> = {
  capacity: "capacity_unit",
  head: "head_unit",
  drive_motor_rating: "drive_motor_rating_unit",
};
const UNIT_COLUMNS = new Set(Object.values(WITH_UNIT));

/** The EC on the front: who it is and how many; the whole form opens from the row. */
const EC_FRONT = ["ec_no", "ec_date", "pump_type", "model_no", "internal_model", "quantity", "boi"];
const EC_COLUMNS: OrderField[] = EC_FRONT.map((c) => ADD_ON_PUMP_FIELDS.find((f) => f.column === c)!).filter(
  (f) => f && !UNIT_COLUMNS.has(f.column)
);

/** Lot 1 to n of the SO's readiness, as on a Spare. */
const LOT_COLUMNS = Array.from({ length: READY_LOT_LIMIT }, (_, i) => i + 1);

function shortDate(v: string): string {
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? v : d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

/** One SO and its pump ECs, as the table and the split view's panel read them. */
type SoGroup = { key: string; head: Row; ecs: Row[]; rows: EcRow[]; soLabel: string; span: number; pumpQty: number; lots: PumpLot[] };
/** One pump EC, with its SO. */
type EcRow = { r: Row; ec: Row; id: string; g: SoGroup };
/**
 * A column, listed once for the table and the panel. A table cell that opens
 * something as a whole carries it here; After Planning's columns are drawn in
 * the table by their own helper.
 */
type Col<R> = SplitCol<R> & { onCell?: (row: R) => void; cellTitle?: string; after?: boolean };
const headOf = <R,>(c: SplitCol<R>) => (c.head === undefined ? c.label : c.head);

/**
 * Planning's Pump view: each SO once on the left — its context and its
 * readiness lot by lot, edited for the whole SO as a Spare is — and its pump
 * ECs on the right, one row each: the EC's whole form and its own Ready Qty
 * and status, edited per EC. In split view, the SO list on the left and the
 * SO picked on the right, the same columns upright.
 */
export function PlanningPumpTable({
  rows,
  planningFields,
  soColumns,
  unreadThreads,
  canEdit,
  seesReadinessHistory = false,
  fieldApplies,
  formatPlanning,
  onEditSo,
  onEditEc,
  onThread,
  summaries,
  split = false,
}: {
  /** Each SO's Assembly & Packing, packing slips and dispatch, by SO id. */
  summaries?: Record<string, PumpSummary>;
  rows: Row[];
  /** Planning's own fields (the section form). */
  planningFields: OrderField[];
  /** SO-level context Planning reads (dispatch target, LD, BOI, bill mode…). */
  soColumns: OrderField[];
  unreadThreads: Record<string, number>;
  canEdit: boolean;
  /** Planning and Central read how the readiness date moved, as on a Spare. */
  seesReadinessHistory?: boolean;
  fieldApplies: (f: OrderField, row: Row) => boolean;
  formatPlanning: (f: OrderField, value: unknown) => string;
  onEditSo: (orderId: string, ecs: Row[]) => void;
  onEditEc: (row: Row) => void;
  onThread: (orderId: string, soLabel: string) => void;
  /** Split view: the SO list and the SO picked side by side. */
  split?: boolean;
}) {
  const pumps = rows.filter((r) => PUMP_LIKE.includes(str(r.item_type)));
  // The EC whose part drawings are open to read; Drawing picks them.
  const [partsFor, setPartsFor] = useState<string | null>(null);
  // The EC whose shortage is open to mark.
  const [shortFor, setShortFor] = useState<string | null>(null);
  // The EC whose whole form is open, with its SO's other ECs beside it.
  const [ecFor, setEcFor] = useState<{ orderId: string; id: string } | null>(null);
  // A bought-out item open in full, read-only.
  const [boiFor, setBoiFor] = useState<{ item: Row; ecLabel: string } | null>(null);
  // The SO picked in split view: the first until another is.
  const [focusKey, setFocusKey] = useState<string | null>(null);
  // The SOs in page order, each with its pump ECs.
  const sos: { orderId: string; ecs: Row[] }[] = [];
  for (const r of pumps) {
    const id = str(r.order_id);
    const last = sos[sos.length - 1];
    if (last && last.orderId === id) last.ecs.push(r);
    else sos.push({ orderId: id, ecs: [r] });
  }
  const groups: SoGroup[] = sos.map(({ orderId, ecs }) => {
    const head = ecs[0];
    const g: SoGroup = {
      key: orderId,
      head,
      ecs,
      rows: [],
      soLabel: str(head.so_no) || `#${str(head.sl_no)}`,
      span: ecs.length,
      pumpQty: ecs.reduce((t, e) => t + (Number(((e.ec ?? {}) as Row).quantity ?? 0) || 0), 0),
      lots: pumpLotsFromEcs(ecs),
    };
    g.rows = ecs.map((r) => ({ r, ec: (r.ec ?? {}) as Row, id: str(r.id), g }));
    return g;
  });
  const focusGroup = split ? (groups.find((g) => g.key === focusKey) ?? groups[0] ?? null) : null;
  const applies = (f: OrderField) => pumps.some((r) => fieldApplies(f, r));
  // Each EC's own Planning fields; the SO's readiness is its lots.
  const ecPlanCols = planningFields.filter((f) => PUMP_EC_PLANNING_COLUMNS.includes(f.column) && applies(f));

  const th = "px-3 py-2 whitespace-nowrap";
  const group = "border-l border-card-border px-3 pt-2.5 pb-1 text-center";
  // LD and LD Date in one column.
  const soFields = withLdCombined(soColumns);
  // After Planning, once per SO, right after its lots.
  // After Planning, as Assembly & Packing lays it out: the Alignment, then a column per lot.
  const AFTER = ["Base Plate", "Wooden Box", ...LOT_COLUMNS.map((n) => `Lot ${n}`), "Latest Lot", "Packing Slips", "Dispatch Status"];
  const showAfter = !!summaries;
  // Today in the browser's calendar, to mark a plan that has passed.
  const today = new Date().toLocaleDateString("en-CA");
  const afterOf = (g: SoGroup) => {
    const s = summaries?.[g.key];
    return s
      ? pumpAfterPlanningParts({ s, lots: g.lots, lotCount: LOT_COLUMNS.length, slips: (Array.isArray(g.head.so_slips) ? g.head.so_slips : []) as Row[] })
      : null;
  };

  // The SO's columns, once down the left of all its EC rows.
  const soMainCols: Col<SoGroup>[] = [
    { key: "sl", label: "Sl.", head: <SortHeader label="Sl." sortKey="sl" />, tdClass: "tabular-nums", cell: (g) => str(g.head.sl_no), list: true },
    {
      key: "so",
      label: "SO No.",
      thClass: "sticky-so",
      tdClass: "sticky-so whitespace-nowrap font-semibold",
      cell: (g) => (
        <>
          {g.soLabel}
          {/* Its ECs, and the pumps they hold (their quantities summed). */}
          <span className="block text-[11px] font-normal text-muted">
            {g.span} EC{g.span === 1 ? "" : "s"} · {g.pumpQty} pump{g.pumpQty === 1 ? "" : "s"}
          </span>
          <VersionTag order={g.head} />
          <HoldBadge order={g.head} />
        </>
      ),
      list: true,
    },
    {
      key: "chat",
      label: "Chat",
      cell: (g) => {
        const unread = unreadThreads[g.key] ?? 0;
        return (
          <button
            type="button"
            onClick={() => onThread(g.key, g.soLabel)}
            aria-label="Chat"
            className="relative inline-flex h-7 w-7 items-center justify-center rounded-lg border border-input-border hover:bg-background"
          >
            <MessageSquare className="h-3.5 w-3.5" />
            {unread > 0 && (
              <span className="absolute -right-1.5 -top-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-600 px-1 text-[10px] font-bold text-white">
                {unread}
              </span>
            )}
          </button>
        );
      },
    },
    {
      key: "so_date",
      label: "SO Date",
      head: <SortHeader label="SO Date" sortKey="so_date" />,
      tdClass: "whitespace-nowrap",
      cell: (g) => (str(g.head.so_date) ? shortDate(str(g.head.so_date)) : "—"),
    },
    {
      key: "readiness",
      label: "Assembly Readiness Date",
      head: <SortHeader label="Assembly Readiness Date" sortKey="readiness" />,
      tdClass: "whitespace-nowrap",
      // How the readiness date moved, as on a Spare SO.
      cell: (g) =>
        seesReadinessHistory ? (
          <ReadyLotHistoryButton
            orderId={g.key}
            label={str(g.head.planning_readiness_date) ? shortDate(str(g.head.planning_readiness_date)) : "History"}
            soLabel={g.soLabel}
          />
        ) : str(g.head.planning_readiness_date) ? (
          shortDate(str(g.head.planning_readiness_date))
        ) : (
          "—"
        ),
      list: true,
    },
    ...soFields.map(
      (f): Col<SoGroup> => ({
        key: `so:${f.column}`,
        label: f.label,
        // The SO's own dates sort the queue.
        head: f.type === "date" && SORTABLE_DATE_COLUMNS.has(f.column) ? <SortHeader label={f.label} sortKey={f.column} /> : undefined,
        tdClass: "whitespace-nowrap text-muted",
        cell: (g) => (
          <>
            {formatDisplay(f, g.head[f.column]) || "—"}
            {/* LD with its date under it. */}
            {f.column === "ld" && str(g.head.ld_date) && <span className="block text-[11px]">{formatDisplay(LD_DATE_FIELD, g.head.ld_date)}</span>}
          </>
        ),
      })
    ),
    {
      // The SO's own status (as a Spare's) and its readiness date.
      key: "status",
      label: "Status",
      tdClass: "whitespace-nowrap",
      cell: (g) => (
        <>
          <span className={`font-medium ${/ready/i.test(str(g.head.actual_spare_status)) ? "text-emerald-700" : "text-foreground"}`}>
            {str(g.head.actual_spare_status) || "Date awaited"}
          </span>
          {str(g.head.pump_readiness_remarks) && (
            <span className="block max-w-[14rem] whitespace-normal text-[11px] text-muted">{str(g.head.pump_readiness_remarks)}</span>
          )}
        </>
      ),
      list: true,
    },
    // Lot 1 to 3, then the latest however many there are (col 0).
    ...[...LOT_COLUMNS, 0].map(
      (col): Col<SoGroup> => ({
        key: `lot${col}`,
        label: col ? `Lot ${col}` : "Latest Lot",
        tdClass: "whitespace-nowrap",
        cell: (g) => {
          // The SO's lots are the same on every EC: the first's stand for all.
          const planLots = lotsFromRows(g.head.ready_lots);
          const n = col || planLots.length;
          const lot = planLots[n - 1];
          // …and which ECs are in it, how many of each.
          const inLot = g.ecs
            .map((e) => {
              const rows = Array.isArray(e.ready_lots) ? (e.ready_lots as Row[]) : [];
              // Keyed by the EC's id: two ECs can share an EC No.
              return { id: str(e.id), ec: str(e.ec_no), qty: Number(rows[n - 1]?.qty ?? 0) || 0 };
            })
            .filter((x) => x.qty > 0);
          return lot ? (
            <span>
              {col === 0 && <span className="block text-[11px] font-semibold text-muted">Lot {n}</span>}
              <span className={`block font-medium ${lot.status === "Fully ready" ? "text-emerald-700" : "text-foreground"}`}>{lot.status || "—"}</span>
              <span className="block text-[11px] text-muted">{lot.ready_date ? shortDate(lot.ready_date) : "—"}</span>
              {inLot.map((x) => (
                <span key={x.id} className="block text-[11px] text-foreground">
                  {x.ec} <span className="text-muted">×{x.qty}</span>
                </span>
              ))}
            </span>
          ) : (
            <span className="text-muted">—</span>
          );
        },
      })
    ),
  ];
  // After Planning, read-only: Alignment, Assembly & Packing, slips, dispatch.
  const afterCols: Col<SoGroup>[] = showAfter
    ? AFTER.map((h, i) => ({
        key: `after:${i}`,
        label: h,
        thClass: i === 0 ? "border-l border-card-border" : "",
        after: true,
        cell: (g) => afterOf(g)?.[i]?.node ?? <span className="text-muted">—</span>,
      }))
    : [];
  const editSoCols: Col<SoGroup>[] = canEdit
    ? [
        {
          key: "edit",
          label: "Actions",
          head: null,
          cell: (g) => (
            <button
              type="button"
              onClick={() => onEditSo(g.key, g.ecs)}
              className="inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-lg border border-primary/40 bg-primary/10 px-3 text-xs font-semibold text-primary transition-colors hover:bg-primary hover:text-primary-foreground"
            >
              <Pencil className="h-3.5 w-3.5" />
              Edit SO
            </button>
          ),
        },
      ]
    : [];
  const soCols = [...soMainCols, ...afterCols, ...editSoCols];

  // Each EC's columns, a row each.
  const ecDetailCols: Col<EcRow>[] = [
    ...EC_COLUMNS.map(
      (f, i): Col<EcRow> => ({
        key: `ec:${f.column}`,
        label: f.column === "boi" ? "BOI" : f.label,
        head: f.column === "ec_date" ? <SortHeader label={f.label} sortKey="ec_date" /> : undefined,
        thClass: i === 0 ? "border-l border-card-border" : "",
        tdClass: `cursor-pointer whitespace-nowrap hover:bg-primary/5 ${i === 0 ? "border-l border-card-border font-semibold text-primary underline-offset-2 hover:underline" : ""}`,
        onCell: (x) => setEcFor({ orderId: x.g.key, id: x.id }),
        cellTitle: "Open the EC's details",
        cell: ({ r, ec }) => {
          const unit = WITH_UNIT[f.column];
          const v = formatDisplay(f, ec[f.column]);
          return (
            <>
              {v ? (unit && str(ec[unit]) ? `${v} ${str(ec[unit])}` : v) : <span className="text-muted">—</span>}
              {/* The EC's attachment, beside its EC No. */}
              {i === 0 && <EcLink href={r.ec_link} at={r.ec_link_at} links={r.ec_links} latest />}
            </>
          );
        },
      })
    ),
    {
      // The EC's bought-out items, one aligned line each: item, qty, where it
      // stands, and its day — received on, or (until in) the day Purchase
      // expects it, red once past. One opens in full.
      key: "boi_items",
      label: "BOI Items",
      wide: true,
      cell: ({ r, ec }) =>
        Array.isArray(r.boi_items) && r.boi_items.length > 0 ? (
          <span className="grid grid-cols-[6.5rem_2.25rem_6.75rem_5.75rem] gap-y-1">
            {(r.boi_items as Row[]).map((b) => {
              const inHand = boiInHand(b);
              const date = str(inHand ? b.receipt_date : b.expected_receipt_date).slice(0, 10);
              const late = !inHand && !!date && date < today;
              return (
                <button
                  key={str(b.id)}
                  type="button"
                  onClick={() => setBoiFor({ item: b, ecLabel: str(ec.ec_no) })}
                  title={`Open ${boiName(b)}`}
                  className="col-span-4 grid grid-cols-subgrid items-center rounded-md px-1 py-0.5 text-left text-xs hover:bg-primary/5"
                >
                  <span className="truncate font-medium text-foreground">{boiName(b)}</span>
                  <span className="tabular-nums text-muted">{str(b.boi_qty) ? `×${str(b.boi_qty)}` : ""}</span>
                  <span>{<BoiStatusTag item={b} small />}</span>
                  <span
                    title={inHand ? "Received on" : "Vendor expected date"}
                    className={`whitespace-nowrap tabular-nums ${
                      inHand ? "text-emerald-700 dark:text-emerald-400" : late ? "font-semibold text-rose-600" : "text-muted"
                    }`}
                  >
                    {date ? `${inHand ? "Rcvd" : "Exp"} ${shortDay(date)}` : ""}
                  </span>
                </button>
              );
            })}
          </span>
        ) : (
          <span className="text-xs text-muted">—</span>
        ),
    },
  ];
  const drawingCols: Col<EcRow>[] = [
    {
      key: "gad",
      label: "GAD",
      thClass: "border-l border-card-border",
      tdClass: "whitespace-nowrap border-l border-card-border",
      cell: ({ r }) => <GadCell versions={Array.isArray(r.gad_versions) ? (r.gad_versions as Row[]) : []} gadRequired={r.gad_required} ecLink={r.ec_link} />,
    },
    {
      key: "part",
      label: "Part Drawing",
      cell: ({ r, id }) =>
        str(r.part_drawing).toLowerCase() === "yes" ? (
          <button type="button" onClick={() => setPartsFor(id)} title="See the parts" className="text-left">
            <PartDrawingCell required={r.part_drawing} parts={Array.isArray(r.part_drawings) ? (r.part_drawings as Row[]) : []} />
          </button>
        ) : (
          <PartDrawingCell required={r.part_drawing} parts={[]} />
        ),
    },
  ];
  const ecPlanningCols: Col<EcRow>[] = [
    ...ecPlanCols.map(
      (f, i): Col<EcRow> => ({
        key: `plan:${f.column}`,
        label: f.label,
        head: f.type === "date" && SORTABLE_DATE_COLUMNS.has(f.column) ? <SortHeader label={f.label} sortKey={f.column} /> : undefined,
        thClass: i === 0 ? "border-l border-card-border" : "",
        tdClass: `whitespace-nowrap ${i === 0 ? "border-l border-card-border" : ""}`,
        cell: ({ r, ec, g }) =>
          !fieldApplies(f, r) ? (
            <span className="text-muted">—</span>
          ) : f.column === "actual_pump_status" ? (
            // Ready Qty against the EC's quantity, then how far Assembly & Packing has got (shown only).
            <PumpStatus status={pumpEcStage(pumpEcStatus(r.ready_qty, ec.quantity), Number(ec.quantity ?? 0) || 0, ecDone(g.lots, str(r.id)))} />
          ) : f.column === "ready_qty" ? (
            `${str(r.ready_qty) || "0"} / ${str(ec.quantity) || "—"}`
          ) : (
            formatPlanning(f, str(r[f.column]) ? r[f.column] : (f.defaultValue ?? null))
          ),
      })
    ),
    {
      key: "shortage",
      label: "Shortage",
      cell: ({ r, id }) => (
        <div className="flex items-start gap-2">
          <ShortageCell parts={Array.isArray(r.part_shortages) ? (r.part_shortages as Row[]) : []} />
          <button
            type="button"
            onClick={() => setShortFor(id)}
            title={canEdit ? "Mark the parts short" : "Parts short"}
            className="inline-flex h-7 items-center gap-1 rounded-lg border border-input-border px-2 text-xs font-medium hover:bg-background"
          >
            <PackageX className="h-3.5 w-3.5" />
            Parts
          </button>
        </div>
      ),
    },
  ];
  const ecEditCols: Col<EcRow>[] = canEdit
    ? [
        {
          key: "ec_edit",
          label: "Actions",
          head: null,
          tdClass: "text-right",
          // Ready Qty comes from the lots once they name this SO's ECs.
          cell: ({ r, g }) =>
            !g.ecs.some((e) => Array.isArray(e.ready_lots) && (e.ready_lots as Row[]).some((l) => l.qty !== null && l.qty !== undefined)) && (
              <button
                type="button"
                onClick={() => onEditEc(r)}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-input-border px-3 text-xs font-medium hover:bg-background"
              >
                <Pencil className="h-3.5 w-3.5" />
                Edit
              </button>
            ),
        },
      ]
    : [];
  const ecCols = [...ecDetailCols, ...drawingCols, ...ecPlanningCols, ...ecEditCols];
  const listCols = soCols.filter((c) => c.list);

  // The SO's cells in the table, once, down the left of all its EC rows.
  const soCellsOf = (g: SoGroup) => {
    const soCell = "px-3 py-2 align-top border-b border-card-border";
    return soCols.map((c, i) => {
      if (c.after) {
        // After Planning's columns come together from their own helper (one cell across until the SO has a summary).
        if (c.key !== afterCols[0].key) return null;
        const s = summaries?.[g.key];
        return s ? (
          <PumpAfterPlanningCells
            key="after"
            s={s}
            lots={g.lots}
            lotCount={LOT_COLUMNS.length}
            slips={(Array.isArray(g.head.so_slips) ? g.head.so_slips : []) as Row[]}
            rowSpan={g.span}
            className={soCell}
          />
        ) : (
          <td key="after" rowSpan={g.span} colSpan={AFTER.length} className={`${soCell} border-l border-card-border text-muted`}>—</td>
        );
      }
      return (
        <td key={c.key} rowSpan={g.span} data-focus-row={i === 0 ? g.key : undefined} className={`${soCell} ${c.tdClass ?? ""}`}>
          {c.cell(g)}
        </td>
      );
    });
  };

  const table = split ? (
    // Split view: the SO's identity and state; the rest is the panel's.
    <table className="w-full text-sm">
      <thead className="relative z-10 bg-surface data-[stuck=1]:shadow-[0_2px_6px_-2px_rgba(0,0,0,0.18)] [&_th]:bg-surface">
        <tr className="border-b border-card-border text-left text-[11px] font-semibold uppercase tracking-wide text-muted">
          {listCols.map((c) => (
            <th key={c.key} className={`${th} ${c.thClass ?? ""}`}>{headOf(c)}</th>
          ))}
          <th className={th}>ECs</th>
        </tr>
      </thead>
      <tbody>
        {groups.length === 0 && (
          <tr>
            <td colSpan={listCols.length + 1} className="px-4 py-10 text-center text-sm text-muted">
              No pump ECs match.
            </td>
          </tr>
        )}
        {groups.map((g) => (
          <tr
            key={g.key}
            data-focus-row={g.key}
            onClick={() => setFocusKey(g.key)}
            className={`cursor-pointer text-foreground transition-colors ${dispatchRowTone(g.head) ?? "hover:bg-background/40"} ${
              focusGroup?.key === g.key ? "outline-2 -outline-offset-2 outline-primary/50" : ""
            }`}
          >
            {listCols.map((c) => (
              <td key={c.key} className={`border-b border-card-border px-3 py-2 align-top ${c.tdClass ?? ""}`}>
                {c.cell(g)}
              </td>
            ))}
            <td className="border-b border-card-border px-3 py-2 align-top tabular-nums">{g.span}</td>
          </tr>
        ))}
      </tbody>
    </table>
  ) : (
    <table className="w-full min-w-[2200px] text-sm">
      <thead className="relative z-10 bg-surface data-[stuck=1]:shadow-[0_2px_6px_-2px_rgba(0,0,0,0.18)] [&_th]:bg-surface">
        <tr className="text-left text-xs font-semibold uppercase tracking-wide text-muted">
          <th colSpan={soMainCols.length} className="px-3 pt-2.5 pb-1">SO</th>
          {showAfter && <th colSpan={afterCols.length} className={group}>Assembly &amp; Packing · Dispatch</th>}
          {canEdit && <th />}
          <th colSpan={ecDetailCols.length} className={group}>EC details</th>
          <th colSpan={drawingCols.length} className={group}>Drawing</th>
          <th colSpan={ecPlanningCols.length + ecEditCols.length} className={group}>Planning (EC)</th>
        </tr>
        <tr className="border-b border-card-border text-left text-[11px] font-semibold uppercase tracking-wide text-muted">
          {soCols.map((c) => (
            <th key={c.key} className={`${th} ${c.thClass ?? ""}`}>{headOf(c)}</th>
          ))}
          {ecCols.map((c) => (
            <th key={c.key} className={`${th} ${c.thClass ?? ""}`}>{headOf(c)}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {groups.length === 0 && (
          <tr>
            <td colSpan={99} className="px-4 py-10 text-center text-sm text-muted">
              No pump ECs match.
            </td>
          </tr>
        )}
        {groups.map((g) => (
          <Fragment key={g.key}>
            {g.rows.map((x, k) => {
              const last = k === g.rows.length - 1;
              const ecCell = `px-3 py-2 ${last ? "border-b border-card-border" : "border-b border-card-border/50"}`;
              return (
                <tr key={x.id} className={`text-foreground transition-colors ${dispatchRowTone(g.head) ?? "hover:bg-background/40"}`}>
                  {k === 0 && soCellsOf(g)}
                  {ecCols.map((c) => (
                    <td
                      key={c.key}
                      onClick={c.onCell ? () => c.onCell?.(x) : undefined}
                      title={c.cellTitle}
                      className={`${ecCell} ${c.tdClass ?? ""}`}
                    >
                      {c.cell(x)}
                    </td>
                  ))}
                </tr>
              );
            })}
          </Fragment>
        ))}
      </tbody>
    </table>
  );

  return (
    <>
      <SplitShell
        split={split}
        focusKey={focusGroup?.key ?? null}
        focusLabel={focusGroup?.soLabel ?? null}
        // Split view: the list in a card of its own (outside the workspace card), as on every page.
        list={split ? <div className="overflow-x-auto rounded-xl border border-card-border bg-surface shadow-sm" data-sticky-head>{table}</div> : table}
        panel={
          focusGroup ? (
            <>
              <PanelSection title="SO">
                <Portrait cols={soCols} row={focusGroup} />
              </PanelSection>
              {focusGroup.rows.map((x) => (
                <PanelSection
                  key={x.id}
                  title={`EC ${str(x.ec.ec_no) || str(x.r.ec_no) || "—"}`}
                  aside={
                    // The table opens the EC's whole form from its cells.
                    <button
                      type="button"
                      onClick={() => setEcFor({ orderId: focusGroup.key, id: x.id })}
                      className="text-xs font-semibold text-primary underline-offset-2 hover:underline"
                    >
                      EC details
                    </button>
                  }
                >
                  <Portrait cols={ecCols} row={x} />
                </PanelSection>
              ))}
            </>
          ) : null
        }
      />
      {boiFor && <BoiDetailModal item={boiFor.item} ecLabel={boiFor.ecLabel} onClose={() => setBoiFor(null)} />}
      {(() => {
        const r = partsFor ? pumps.find((x) => str(x.id) === partsFor) : null;
        if (!r) return null;
        return (
          <PartDrawingView
            key={str(r.id)}
            itemId={str(r.id)}
            label={[str(r.so_no), `EC ${str(r.ec_no) || "—"}`].filter(Boolean).join(" · ")}
            parts={Array.isArray(r.part_drawings) ? (r.part_drawings as Row[]) : []}
            onClose={() => setPartsFor(null)}
          />
        );
      })()}
      {(() => {
        const r = shortFor ? pumps.find((x) => str(x.id) === shortFor) : null;
        if (!r) return null;
        const ec = (r.ec ?? {}) as Row;
        return (
          <PartPickerModal
            key={`short:${str(r.id)}`}
            mode="shortage"
            itemId={str(r.id)}
            label={[str(r.so_no), `EC ${str(r.ec_no) || "—"}`].filter(Boolean).join(" · ")}
            pumpType={ec.pump_type}
            parts={Array.isArray(r.part_shortages) ? (r.part_shortages as Row[]) : []}
            canEdit={canEdit}
            onClose={() => setShortFor(null)}
          />
        );
      })()}
      {(() => {
        const so = ecFor ? sos.find((s) => s.orderId === ecFor.orderId) : null;
        if (!so || !ecFor) return null;
        const head = so.ecs[0];
        return (
          <OmEcsModal
            key={ecFor.id}
            initialId={ecFor.id}
            order={{ so_no: head.so_no, sl_no: head.sl_no, client_name: head.client_name, order_type: "Pump" }}
            items={so.ecs.map((r) => ({ ...((r.ec ?? {}) as Row), id: r.id }))}
            canManage={false}
            deletingId={null}
            onAdd={() => {}}
            onEdit={() => {}}
            onDelete={() => {}}
            onClose={() => setEcFor(null)}
          />
        );
      })()}
    </>
  );
}

/** Spare or Pump: Planning's two ways of looking at its queue. */
export function EcKindToggle({ value, onChange }: { value: "spare" | "pump"; onChange: (v: "spare" | "pump") => void }) {
  // Switches at once; the queue follows when it has loaded. A new value from
  // the page (it caught up, or Back) rules again.
  const [asked, setAsked] = useState<"spare" | "pump" | null>(null);
  const [seen, setSeen] = useState(value);
  if (seen !== value) {
    setSeen(value);
    setAsked(null);
  }
  const shown = asked ?? value;
  return (
    <div role="group" aria-label="Spare or Pump" className="inline-flex h-8 rounded-lg border border-input-border p-0.5">
      {(["spare", "pump"] as const).map((k) => (
        <button
          key={k}
          type="button"
          aria-pressed={shown === k}
          onClick={() => {
            if (shown === k) return;
            setAsked(k);
            onChange(k);
          }}
          className={`rounded-md px-2.5 text-[13px] font-semibold transition-colors ${
            shown === k ? "bg-primary text-primary-foreground" : "text-muted hover:text-foreground"
          }`}
        >
          {k === "spare" ? "Spare" : "Pump"}
        </button>
      ))}
    </div>
  );
}

/** A pump EC's status as a chip: Pending, Partially ready, Fully ready. */
function PumpStatus({ status }: { status: string }) {
  const cls = /^fully/i.test(status)
    ? "bg-emerald-50 text-emerald-700"
    : /^partially/i.test(status)
      ? "bg-sky-50 text-sky-700"
      : "bg-amber-50 text-amber-700";
  return <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${cls}`}>{status}</span>;
}
