"use client";

import { Fragment, useState } from "react";
import { MessageSquare, Pencil } from "lucide-react";
import { ADD_ON_PUMP_FIELDS, PUMP_EC_PLANNING_COLUMNS, PUMP_LIKE, type OrderField } from "@/lib/order-schema";
import type { DeptCell, EcDeptStatus } from "@/lib/orders";
import { formatDisplay } from "./editable-section";

type Row = Record<string, unknown>;
const str = (v: unknown) => (v === null || v === undefined ? "" : String(v));

// A value with its unit beside it reads as one column on the name plate.
const WITH_UNIT: Record<string, string> = {
  capacity: "capacity_unit",
  head: "head_unit",
  drive_motor_rating: "drive_motor_rating_unit",
};
const UNIT_COLUMNS = new Set(Object.values(WITH_UNIT));

/** The pump's EC form, as columns: the Pump Add-On fields, a value and its unit as one. */
const EC_COLUMNS: OrderField[] = ADD_ON_PUMP_FIELDS.filter((f) => !UNIT_COLUMNS.has(f.column));

const TONE: Record<DeptCell["state"], string> = {
  done: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300",
  pending: "bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300",
  na: "bg-gray-100 text-gray-500 dark:bg-white/5 dark:text-gray-400",
};
const DEPTS: { key: "drawing" | "purchase" | "quality" | "assembly"; label: string }[] = [
  { key: "drawing", label: "Drawing" },
  { key: "purchase", label: "Purchase" },
  { key: "quality", label: "Quality" },
  { key: "assembly", label: "Assembly" },
];

/**
 * Planning's Pump view: each SO once on the left — its context and Planning's
 * SO-wide fields, edited for the whole SO as a Spare is — and its pump ECs on
 * the right, one row each: the EC's whole form, where every other department
 * stands on it, and its own Ready Qty and status, edited per EC.
 */
export function PlanningPumpTable({
  rows,
  planningFields,
  soColumns,
  statuses,
  unreadThreads,
  canEdit,
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
  /** Where each department stands, by EC id. */
  statuses: Record<string, EcDeptStatus>;
  unreadThreads: Record<string, number>;
  canEdit: boolean;
  fieldApplies: (f: OrderField, row: Row) => boolean;
  formatPlanning: (f: OrderField, value: unknown) => string;
  onEditSo: (orderId: string, ecs: Row[]) => void;
  onEditEc: (row: Row) => void;
  onThread: (orderId: string, soLabel: string) => void;
}) {
  const pumps = rows.filter((r) => PUMP_LIKE.includes(str(r.item_type)));
  // The SOs in page order, each with its pump ECs.
  const sos: { orderId: string; ecs: Row[] }[] = [];
  for (const r of pumps) {
    const id = str(r.order_id);
    const last = sos[sos.length - 1];
    if (last && last.orderId === id) last.ecs.push(r);
    else sos.push({ orderId: id, ecs: [r] });
  }
  const applies = (f: OrderField) => pumps.some((r) => fieldApplies(f, r));
  // Planning's SO-wide fields, and the two that are each EC's own.
  const soPlanCols = planningFields.filter((f) => !PUMP_EC_PLANNING_COLUMNS.includes(f.column) && applies(f));
  const ecPlanCols = planningFields.filter((f) => PUMP_EC_PLANNING_COLUMNS.includes(f.column) && applies(f));

  const th = "px-3 py-2 whitespace-nowrap";
  const group = "border-l border-card-border px-3 pt-2.5 pb-1 text-center";
  const soSpan = 4 + soColumns.length + soPlanCols.length + (canEdit ? 1 : 0);

  return (
    <table className="w-full min-w-[2600px] text-sm">
      <thead className="relative z-10 bg-surface data-[stuck=1]:shadow-[0_2px_6px_-2px_rgba(0,0,0,0.18)] [&_th]:bg-surface">
        <tr className="text-left text-xs font-semibold uppercase tracking-wide text-muted">
          <th colSpan={soSpan} className="px-3 pt-2.5 pb-1">SO</th>
          <th colSpan={EC_COLUMNS.length} className={group}>EC details</th>
          <th colSpan={DEPTS.length} className={group}>Departments</th>
          <th colSpan={ecPlanCols.length + (canEdit ? 1 : 0)} className={group}>Planning (EC)</th>
        </tr>
        <tr className="border-b border-card-border text-left text-[11px] font-semibold uppercase tracking-wide text-muted">
          <th className={th}>Sl.</th>
          <th className={th}>SO No.</th>
          <th className={th}>Chat</th>
          <th className={th}>Client</th>
          {soColumns.map((f) => (
            <th key={f.column} className={th}>{f.label}</th>
          ))}
          {soPlanCols.map((f) => (
            <th key={f.column} className={th}>{f.label}</th>
          ))}
          {canEdit && <th className={th} />}
          {EC_COLUMNS.map((f, i) => (
            <th key={f.column} className={`${th} ${i === 0 ? "border-l border-card-border" : ""}`}>
              {f.column === "boi" ? "BOI" : f.label}
            </th>
          ))}
          {DEPTS.map((d, i) => (
            <th key={d.key} className={`${th} ${i === 0 ? "border-l border-card-border" : ""}`}>{d.label}</th>
          ))}
          {ecPlanCols.map((f, i) => (
            <th key={f.column} className={`${th} ${i === 0 ? "border-l border-card-border" : ""}`}>{f.label}</th>
          ))}
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
                const st = statuses[id];
                const last = k === ecs.length - 1;
                const ecCell = `px-3 py-2 ${last ? "border-b border-card-border" : "border-b border-card-border/50"}`;
                return (
                  <tr key={id} className="text-foreground hover:bg-background/40">
                    {k === 0 && (
                      <>
                        <td rowSpan={span} className={`${soCell} tabular-nums`}>{str(head.sl_no)}</td>
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
                        <td rowSpan={span} className={`${soCell} max-w-[16rem]`}>{str(head.client_name) || "—"}</td>
                        {soColumns.map((f) => (
                          <td key={f.column} rowSpan={span} className={`${soCell} whitespace-nowrap text-muted`}>
                            {formatDisplay(f, head[f.column]) || "—"}
                          </td>
                        ))}
                        {soPlanCols.map((f) => (
                          <td key={f.column} rowSpan={span} className={`${soCell} whitespace-nowrap`}>
                            {fieldApplies(f, head) ? formatPlanning(f, head[f.column]) : <span className="text-muted">—</span>}
                          </td>
                        ))}
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
                          className={`${ecCell} whitespace-nowrap ${i === 0 ? "border-l border-card-border font-semibold" : ""}`}
                        >
                          {v ? (unit && str(ec[unit]) ? `${v} ${str(ec[unit])}` : v) : <span className="text-muted">—</span>}
                        </td>
                      );
                    })}
                    {DEPTS.map((d, i) => {
                      const cell = st?.[d.key];
                      return (
                        <td key={d.key} className={`${ecCell} ${i === 0 ? "border-l border-card-border" : ""}`}>
                          {cell ? (
                            <span className={`inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ${TONE[cell.state]}`}>
                              {cell.label}
                            </span>
                          ) : (
                            <span className="text-muted">—</span>
                          )}
                        </td>
                      );
                    })}
                    {ecPlanCols.map((f, i) => (
                      <td key={f.column} className={`${ecCell} whitespace-nowrap ${i === 0 ? "border-l border-card-border" : ""}`}>
                        {fieldApplies(f, r) ? formatPlanning(f, r[f.column]) : <span className="text-muted">—</span>}
                      </td>
                    ))}
                    {canEdit && (
                      <td className={`${ecCell} text-right`}>
                        <button
                          type="button"
                          onClick={() => onEditEc(r)}
                          className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-input-border px-3 text-xs font-medium hover:bg-background"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                          Edit
                        </button>
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
