"use client";

import { Fragment, useState } from "react";
import { ExternalLink, ListChecks, MessageSquare, PackageX, Pencil } from "lucide-react";
import { ADD_ON_PUMP_FIELDS, PUMP_EC_PLANNING_COLUMNS, PUMP_LIKE, READY_LOT_LIMIT, pumpEcStatus, type OrderField } from "@/lib/order-schema";
import { lotsFromRows } from "@/lib/ready-lots";
import { drawingDocStatus, drawingVersions, versionLabel } from "@/lib/dept-view";
import { formatDisplay } from "./editable-section";
import { ReadyLotHistoryButton } from "./ready-lot-history";
import { PartDrawingCell, PartPickerModal, ShortageCell } from "./part-drawing";
import { OmEcsModal } from "./om-ecs-modal";

type Row = Record<string, unknown>;
const str = (v: unknown) => (v === null || v === undefined ? "" : String(v));

// A value with its unit beside it reads as one column on the name plate.
const WITH_UNIT: Record<string, string> = {
  capacity: "capacity_unit",
  head: "head_unit",
  drive_motor_rating: "drive_motor_rating_unit",
};
const UNIT_COLUMNS = new Set(Object.values(WITH_UNIT));

/** The EC on the front: who it is and how many; the whole form opens from the row. */
const EC_FRONT = ["ec_no", "ec_date", "pump_type", "model_no", "quantity", "boi"];
const EC_COLUMNS: OrderField[] = EC_FRONT.map((c) => ADD_ON_PUMP_FIELDS.find((f) => f.column === c)!).filter(
  (f) => f && !UNIT_COLUMNS.has(f.column)
);

/** Lot 1 to n of the SO's readiness, as on a Spare. */
const LOT_COLUMNS = Array.from({ length: READY_LOT_LIMIT }, (_, i) => i + 1);

function shortDate(v: string): string {
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? v : d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

/**
 * Planning's Pump view: each SO once on the left — its context and its
 * readiness lot by lot, edited for the whole SO as a Spare is — and its pump
 * ECs on the right, one row each: the EC's whole form and its own Ready Qty
 * and status, edited per EC.
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
}: {
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
}) {
  const pumps = rows.filter((r) => PUMP_LIKE.includes(str(r.item_type)));
  // The EC whose part drawings are open to pick.
  const [partsFor, setPartsFor] = useState<string | null>(null);
  // The EC whose shortage is open to mark.
  const [shortFor, setShortFor] = useState<string | null>(null);
  // The EC whose whole form is open, with its SO's other ECs beside it.
  const [ecFor, setEcFor] = useState<{ orderId: string; id: string } | null>(null);
  // The SOs in page order, each with its pump ECs.
  const sos: { orderId: string; ecs: Row[] }[] = [];
  for (const r of pumps) {
    const id = str(r.order_id);
    const last = sos[sos.length - 1];
    if (last && last.orderId === id) last.ecs.push(r);
    else sos.push({ orderId: id, ecs: [r] });
  }
  const applies = (f: OrderField) => pumps.some((r) => fieldApplies(f, r));
  // Each EC's own Planning fields; the SO's readiness is its lots.
  const ecPlanCols = planningFields.filter((f) => PUMP_EC_PLANNING_COLUMNS.includes(f.column) && applies(f));

  const th = "px-3 py-2 whitespace-nowrap";
  const group = "border-l border-card-border px-3 pt-2.5 pb-1 text-center";
  const soSpan = 6 + soColumns.length + LOT_COLUMNS.length + (canEdit ? 1 : 0);

  return (
    <>
    <table className="w-full min-w-[2200px] text-sm">
      <thead className="relative z-10 bg-surface data-[stuck=1]:shadow-[0_2px_6px_-2px_rgba(0,0,0,0.18)] [&_th]:bg-surface">
        <tr className="text-left text-xs font-semibold uppercase tracking-wide text-muted">
          <th colSpan={soSpan} className="px-3 pt-2.5 pb-1">SO</th>
          <th colSpan={EC_COLUMNS.length} className={group}>EC details</th>
          <th colSpan={2} className={group}>Drawing</th>
          <th colSpan={ecPlanCols.length + 1 + (canEdit ? 1 : 0)} className={group}>Planning (EC)</th>
        </tr>
        <tr className="border-b border-card-border text-left text-[11px] font-semibold uppercase tracking-wide text-muted">
          <th className={th}>Sl.</th>
          <th className={th}>SO No.</th>
          <th className={th}>Chat</th>
          <th className={th}>SO Date</th>
          {soColumns.map((f) => (
            <th key={f.column} className={th}>{f.label}</th>
          ))}
          <th className={th}>Status</th>
          <th className={th}>Assembly Readiness Date</th>
          {LOT_COLUMNS.map((n) => (
            <th key={n} className={th}>Lot {n}</th>
          ))}
          {canEdit && <th className={th} />}
          {EC_COLUMNS.map((f, i) => (
            <th key={f.column} className={`${th} ${i === 0 ? "border-l border-card-border" : ""}`}>
              {f.column === "boi" ? "BOI" : f.label}
            </th>
          ))}
          <th className={`${th} border-l border-card-border`}>GAD</th>
          <th className={th}>Part Drawing</th>
          {ecPlanCols.map((f, i) => (
            <th key={f.column} className={`${th} ${i === 0 ? "border-l border-card-border" : ""}`}>{f.label}</th>
          ))}
          <th className={th}>Shortage</th>
          {canEdit && <th className={th} />}
        </tr>
      </thead>
      <tbody>
        {sos.length === 0 && (
          <tr>
            <td colSpan={99} className="px-4 py-10 text-center text-sm text-muted">
              No pump ECs match.
            </td>
          </tr>
        )}
        {sos.map(({ orderId, ecs }) => {
          const head = ecs[0];
          const soLabel = str(head.so_no) || `#${str(head.sl_no)}`;
          const unread = unreadThreads[orderId] ?? 0;
          const span = ecs.length;
          // The SO's cells, once, down the left of all its EC rows.
          const soCell = "px-3 py-2 align-top border-b border-card-border";
          return (
            <Fragment key={orderId}>
              {ecs.map((r, k) => {
                const ec = (r.ec ?? {}) as Row;
                const id = str(r.id);
                const last = k === ecs.length - 1;
                const ecCell = `px-3 py-2 ${last ? "border-b border-card-border" : "border-b border-card-border/50"}`;
                return (
                  <tr key={id} className="text-foreground hover:bg-background/40">
                    {k === 0 && (
                      <>
                        <td rowSpan={span} data-focus-row={orderId} className={`${soCell} tabular-nums`}>{str(head.sl_no)}</td>
                        <td rowSpan={span} className={`${soCell} whitespace-nowrap font-semibold`}>
                          {soLabel}
                          <span className="block text-[11px] font-normal text-muted">
                            {span} pump EC{span === 1 ? "" : "s"}
                          </span>
                        </td>
                        <td rowSpan={span} className={soCell}>
                          <button
                            type="button"
                            onClick={() => onThread(orderId, soLabel)}
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
                        </td>
                        <td rowSpan={span} className={`${soCell} whitespace-nowrap`}>
                          {str(head.so_date) ? shortDate(str(head.so_date)) : "—"}
                        </td>
                        {soColumns.map((f) => (
                          <td key={f.column} rowSpan={span} className={`${soCell} whitespace-nowrap text-muted`}>
                            {formatDisplay(f, head[f.column]) || "—"}
                          </td>
                        ))}
                        {/* The SO's own status (as a Spare's) and its readiness date. */}
                        <td rowSpan={span} className={`${soCell} whitespace-nowrap`}>
                          <span
                            className={`font-medium ${/ready/i.test(str(head.actual_spare_status)) ? "text-emerald-700" : "text-foreground"}`}
                          >
                            {str(head.actual_spare_status) || "Date awaited"}
                          </span>
                          {str(head.pump_readiness_remarks) && (
                            <span className="block max-w-[14rem] whitespace-normal text-[11px] text-muted">
                              {str(head.pump_readiness_remarks)}
                            </span>
                          )}
                        </td>
                        <td rowSpan={span} className={`${soCell} whitespace-nowrap`}>
                          {/* How the readiness date moved, as on a Spare SO. */}
                          {seesReadinessHistory ? (
                            <ReadyLotHistoryButton
                              orderId={orderId}
                              label={str(head.planning_readiness_date) ? shortDate(str(head.planning_readiness_date)) : "History"}
                              soLabel={soLabel}
                            />
                          ) : str(head.planning_readiness_date) ? (
                            shortDate(str(head.planning_readiness_date))
                          ) : (
                            "—"
                          )}
                        </td>
                        {LOT_COLUMNS.map((n) => {
                          // The SO's lots are the same on every EC: the first's stand for all.
                          const lot = lotsFromRows(head.ready_lots)[n - 1];
                          // …and which ECs are in it, how many of each.
                          const inLot = ecs
                            .map((e) => {
                              const rows = Array.isArray(e.ready_lots) ? (e.ready_lots as Row[]) : [];
                              return { ec: str(e.ec_no), qty: Number(rows[n - 1]?.qty ?? 0) || 0 };
                            })
                            .filter((x) => x.qty > 0);
                          return (
                            <td key={n} rowSpan={span} className={`${soCell} whitespace-nowrap`}>
                              {lot ? (
                                <span>
                                  <span className={`block font-medium ${lot.status === "Fully ready" ? "text-emerald-700" : "text-foreground"}`}>
                                    {lot.status || "—"}
                                  </span>
                                  <span className="block text-[11px] text-muted">{lot.ready_date ? shortDate(lot.ready_date) : "—"}</span>
                                  {inLot.map((x) => (
                                    <span key={x.ec} className="block text-[11px] text-foreground">
                                      {x.ec} <span className="text-muted">×{x.qty}</span>
                                    </span>
                                  ))}
                                </span>
                              ) : (
                                <span className="text-muted">—</span>
                              )}
                            </td>
                          );
                        })}
                        {canEdit && (
                          <td rowSpan={span} className={soCell}>
                            <button
                              type="button"
                              onClick={() => onEditSo(orderId, ecs)}
                              className="inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-lg border border-primary/40 bg-primary/10 px-3 text-xs font-semibold text-primary transition-colors hover:bg-primary hover:text-primary-foreground"
                            >
                              <Pencil className="h-3.5 w-3.5" />
                              Edit SO
                            </button>
                          </td>
                        )}
                      </>
                    )}
                    {EC_COLUMNS.map((f, i) => {
                      const unit = WITH_UNIT[f.column];
                      const v = formatDisplay(f, ec[f.column]);
                      return (
                        <td
                          key={f.column}
                          onClick={() => setEcFor({ orderId, id })}
                          title="Open the EC's details"
                          className={`${ecCell} cursor-pointer whitespace-nowrap hover:bg-primary/5 ${i === 0 ? "border-l border-card-border font-semibold text-primary underline-offset-2 hover:underline" : ""}`}
                        >
                          {v ? (unit && str(ec[unit]) ? `${v} ${str(ec[unit])}` : v) : <span className="text-muted">—</span>}
                        </td>
                      );
                    })}
                    <td className={`${ecCell} whitespace-nowrap border-l border-card-border`}>
                      <GadCell versions={Array.isArray(r.gad_versions) ? (r.gad_versions as Row[]) : []} />
                    </td>
                    <td className={ecCell}>
                      <div className="flex items-start gap-2">
                        <PartDrawingCell required={r.part_drawing} parts={Array.isArray(r.part_drawings) ? (r.part_drawings as Row[]) : []} />
                        <button
                          type="button"
                          onClick={() => setPartsFor(str(r.id))}
                          title={canEdit ? "Pick parts for drawing" : "Parts for drawing"}
                          className="inline-flex h-7 items-center gap-1 rounded-lg border border-input-border px-2 text-xs font-medium hover:bg-background"
                        >
                          <ListChecks className="h-3.5 w-3.5" />
                          Parts
                        </button>
                      </div>
                    </td>
                    {ecPlanCols.map((f, i) => (
                      <td key={f.column} className={`${ecCell} whitespace-nowrap ${i === 0 ? "border-l border-card-border" : ""}`}>
                        {!fieldApplies(f, r) ? (
                          <span className="text-muted">—</span>
                        ) : f.column === "actual_pump_status" ? (
                          // Always as Ready Qty against the EC's quantity says.
                          <PumpStatus status={pumpEcStatus(r.ready_qty, ec.quantity)} />
                        ) : f.column === "ready_qty" ? (
                          `${str(r.ready_qty) || "0"} / ${str(ec.quantity) || "—"}`
                        ) : (
                          formatPlanning(f, str(r[f.column]) ? r[f.column] : (f.defaultValue ?? null))
                        )}
                      </td>
                    ))}
                    <td className={ecCell}>
                      <div className="flex items-start gap-2">
                        <ShortageCell parts={Array.isArray(r.part_shortages) ? (r.part_shortages as Row[]) : []} />
                        <button
                          type="button"
                          onClick={() => setShortFor(str(r.id))}
                          title={canEdit ? "Mark the parts short" : "Parts short"}
                          className="inline-flex h-7 items-center gap-1 rounded-lg border border-input-border px-2 text-xs font-medium hover:bg-background"
                        >
                          <PackageX className="h-3.5 w-3.5" />
                          Parts
                        </button>
                      </div>
                    </td>
                    {canEdit && (
                      <td className={`${ecCell} text-right`}>
                        {/* Ready Qty comes from the lots once they name this SO's ECs. */}
                        {!ecs.some((e) => Array.isArray(e.ready_lots) && (e.ready_lots as Row[]).some((l) => l.qty !== null && l.qty !== undefined)) && (
                        <button
                          type="button"
                          onClick={() => onEditEc(r)}
                          className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-input-border px-3 text-xs font-medium hover:bg-background"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                          Edit
                        </button>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </Fragment>
          );
        })}
      </tbody>
    </table>
      {(() => {
        const r = partsFor ? pumps.find((x) => str(x.id) === partsFor) : null;
        if (!r) return null;
        const ec = (r.ec ?? {}) as Row;
        return (
          <PartPickerModal
            key={str(r.id)}
            itemId={str(r.id)}
            label={[str(r.so_no), `EC ${str(r.ec_no) || "—"}`].filter(Boolean).join(" · ")}
            pumpType={ec.pump_type}
            required={r.part_drawing}
            parts={Array.isArray(r.part_drawings) ? (r.part_drawings as Row[]) : []}
            canEdit={canEdit}
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
    <div role="group" aria-label="Spare or Pump" className="inline-flex h-9 rounded-lg border border-input-border p-0.5">
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
          className={`rounded-md px-3 text-sm font-semibold transition-colors ${
            shown === k ? "bg-primary text-primary-foreground" : "text-muted hover:text-foreground"
          }`}
        >
          {k === "spare" ? "Spare" : "Pump"}
        </button>
      ))}
    </div>
  );
}

/**
 * The EC's GAD as Planning needs it: once Drawing issues it to Planning, the
 * date and its SharePoint link; until then, where it stands.
 */
function GadCell({ versions }: { versions: Row[] }) {
  const st = drawingDocStatus(versions, "GAD");
  const all = drawingVersions(versions, "GAD");
  const last = all[all.length - 1];
  const issued = st.label === "Issued to planning";
  if (!issued) {
    return <span className="text-xs text-muted">{st.version ? `${versionLabel(st.version)} · ` : ""}{st.label}</span>;
  }
  const link = str(last?.planning_link).trim();
  const date = str(last?.issued_to_production_date);
  return (
    <span className="flex flex-col gap-0.5">
      <span className="text-xs font-semibold text-emerald-700">
        {versionLabel(st.version)} · Issued{date ? ` ${shortDate(date)}` : ""}
      </span>
      {/^https?:\/\//i.test(link) ? (
        <a
          href={link}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
        >
          <ExternalLink className="h-3 w-3" />
          Open GAD
        </a>
      ) : (
        <span className="text-[11px] text-muted">No link</span>
      )}
    </span>
  );
}

/** A pump EC's status as a chip: Pending, Partially ready, Fully ready. */
function PumpStatus({ status }: { status: string }) {
  const cls =
    status === "Fully ready"
      ? "bg-emerald-50 text-emerald-700"
      : status === "Partially ready"
        ? "bg-sky-50 text-sky-700"
        : "bg-amber-50 text-amber-700";
  return <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${cls}`}>{status}</span>;
}
