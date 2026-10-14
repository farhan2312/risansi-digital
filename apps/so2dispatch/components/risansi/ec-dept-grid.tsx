"use client";

import { Fragment, useEffect, useState } from "react";
import { ChevronDown, ChevronRight, X } from "lucide-react";
import { DEPT_LABELS } from "@/lib/dept-completion";
import type { DeptCell, EcDeptStatus, ItemDetail, SoDeptStatus } from "@/lib/orders";
import { Badge, EC_DEPTS } from "./dept-status-board";
import { ItemSections } from "./item-sections";

type Row = Record<string, unknown>;
export type DeptKey = (typeof EC_DEPTS)[number]["key"];

const str = (v: unknown) => (v === null || v === undefined ? "" : String(v).trim());
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function day(v: unknown): string {
  const s = str(v).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return "";
  return `${s.slice(8, 10)} ${MONTHS[Number(s.slice(5, 7)) - 1]}`;
}

/** Each department's section on the EC page. */
const SECTION_OF: Record<DeptKey, string> = {
  drawing: "order_drawing",
  purchase: "order_purchase",
  quality: "order_qc",
  planning: "order_planning",
  assembly: "order_assembly_dispatch",
};
/** The departments a Spare SO plans and packs as one, saved to every EC. */
export const SO_WIDE: DeptKey[] = ["planning", "assembly"];

/** The date or count that says most about where a department is on an EC. */
function keyLine(dept: DeptKey, e: ItemDetail): string {
  switch (dept) {
    case "drawing": {
      const revs = e.order_drawing_revisions ?? [];
      const last = revs[revs.length - 1];
      if (!last) return "";
      const rev = str(last.revision_no) ? `Rev ${str(last.revision_no)}` : "First issue";
      const when = day(last.issued_to_client_date) || day(last.issued_to_operations_date);
      return [rev, when].filter(Boolean).join(" · ");
    }
    case "purchase": {
      const boi = e.order_boi_items ?? [];
      if (!boi.length) return "";
      return `${boi.filter((b) => str(b.receipt_date)).length}/${boi.length} received`;
    }
    case "quality":
      return day(e.order_qc?.qc_doc_actual_date) ? `Docs ${day(e.order_qc?.qc_doc_actual_date)}` : "";
    case "planning": {
      const lots = e.order_ready_lots ?? [];
      const date = day(e.order_planning?.planning_readiness_date);
      return [lots.length > 1 ? `Lot ${lots.length}` : "", date].filter(Boolean).join(" · ");
    }
    case "assembly": {
      const packed = [str(e.order_assembly_dispatch?.actual_packing_date), ...(e.order_ready_lots ?? []).map((l) => str(l.packed_date))]
        .filter(Boolean)
        .sort();
      return packed.length ? `Packed ${day(packed[packed.length - 1])}` : "";
    }
  }
}

/** What a Spare EC's planning and packing look like, to tell whether its ECs agree. */
function spareSignature(e: ItemDetail, s: EcDeptStatus | undefined): string {
  return JSON.stringify([
    s?.planning.label,
    s?.assembly.label,
    str(e.order_planning?.planning_readiness_date),
    (e.order_ready_lots ?? []).map((l) => [str(l.status), str(l.ready_date), str(l.packed_date)]),
  ]);
}

// Which ECs a pop-up is for, by id — so after a save it shows them as they now are.
type Open = { dept: DeptKey; ids: string[]; soWide: boolean };

/**
 * The SO page's ECs, each with where every EC department stands on it — a
 * coloured status and its key date. A click opens that department's section
 * in a pop-up, editable there. A Spare SO whose ECs agree reads as one "All
 * N ECs" row (expand for each EC); its Planning and Assembly & Packing then
 * save to every EC at once. Central Visibility and Admin.
 */
export function EcDeptGrid({
  orderId,
  role,
  items,
  status,
  actions,
}: {
  orderId: string;
  role: string;
  items: ItemDetail[];
  status: SoDeptStatus | null;
  // The row's own buttons (Open, Delete), as the SO page draws them.
  actions?: (item: Row) => React.ReactNode;
}) {
  const [open, setOpen] = useState<Open | null>(null);
  const [expanded, setExpanded] = useState(false);
  const statusOf = (id: string) => status?.ecs.find((e) => e.id === id);

  // A department appears once any EC has something to do in it.
  const depts = EC_DEPTS.map((d) => d.key).filter((k) =>
    items.some((e) => (statusOf(str(e.item.id))?.[k].state ?? "na") !== "na")
  );

  const allSpare = items.length > 1 && items.every((e) => str(e.item.item_type).toLowerCase() === "spare");
  const agree =
    allSpare && new Set(items.map((e) => spareSignature(e, statusOf(str(e.item.id))))).size === 1;
  const grouped = allSpare && agree;

  const cellButton = (cell: DeptCell | undefined, line: string, onClick: () => void) => (
    <button
      type="button"
      onClick={onClick}
      className="group flex max-w-[11rem] flex-col items-start rounded-md p-1 text-left transition-colors hover:bg-background"
      title="Open this department's details"
    >
      {cell ? <Badge cell={cell} /> : <span className="text-xs text-muted-foreground">—</span>}
      {line && <span className="mt-0.5 text-[11px] text-muted">{line}</span>}
    </button>
  );

  const ecRow = (e: ItemDetail, indent = false) => {
    const id = str(e.item.id);
    const s = statusOf(id);
    return (
      <tr key={id} className="align-top text-foreground">
        <td className={`px-3 py-2 whitespace-nowrap ${indent ? "pl-8 text-muted" : "font-medium"}`}>
          {str(e.item.ec_no) || "—"}
          <span className="block text-[11px] font-normal text-muted">
            {[str(e.item.model_no), str(e.item.quantity) && `Qty ${str(e.item.quantity)}`].filter(Boolean).join(" · ")}
          </span>
        </td>
        {depts.map((k) => (
          <td key={k} className="px-2 py-1.5">
            {s?.[k].state === "na"
              ? <span className="px-1 text-xs text-muted-foreground">{s?.[k].label === "—" ? "—" : "N/A"}</span>
              : cellButton(s?.[k], keyLine(k, e), () => setOpen({ dept: k, ids: [id], soWide: false }))}
          </td>
        ))}
        <td className="px-3 py-2 text-right whitespace-nowrap">{actions?.(e.item)}</td>
      </tr>
    );
  };

  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-sm">
          <thead>
            <tr className="border-b border-card-border text-left text-xs font-semibold uppercase tracking-wide text-muted">
              <th className="px-3 py-2">EC</th>
              {depts.map((k) => (
                <th key={k} className="px-3 py-2 whitespace-nowrap">
                  {DEPT_LABELS[k]}
                </th>
              ))}
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-card-border">
            {grouped ? (
              <>
                <tr className="align-top bg-background/40 text-foreground">
                  <td className="px-3 py-2 whitespace-nowrap">
                    <button
                      type="button"
                      onClick={() => setExpanded((v) => !v)}
                      aria-expanded={expanded}
                      className="flex items-start gap-1.5 text-left"
                    >
                      {expanded ? <ChevronDown className="mt-0.5 h-3.5 w-3.5" /> : <ChevronRight className="mt-0.5 h-3.5 w-3.5" />}
                      <span>
                        <span className="font-semibold">All {items.length} ECs</span>
                        <span className="block text-[11px] text-muted">same for every EC</span>
                      </span>
                    </button>
                  </td>
                  {depts.map((k) => {
                    const cells = items.map((e) => statusOf(str(e.item.id))?.[k]);
                    const same = new Set(cells.map((c) => `${c?.state}|${c?.label}`)).size === 1;
                    const lines = new Set(items.map((e) => keyLine(k, e)));
                    const cell: DeptCell | undefined = same ? cells[0] : { state: "pending", label: "Differs by EC" };
                    return (
                      <td key={k} className="px-2 py-1.5">
                        {cell?.state === "na" ? (
                          <span className="px-1 text-xs text-muted-foreground">{cell.label === "—" ? "—" : "N/A"}</span>
                        ) : (
                          cellButton(cell, lines.size === 1 ? [...lines][0] : "", () =>
                            setOpen({ dept: k, ids: items.map((e) => str(e.item.id)), soWide: SO_WIDE.includes(k) })
                          )
                        )}
                      </td>
                    );
                  })}
                  <td className="px-3 py-2" />
                </tr>
                {expanded && items.map((e) => ecRow(e, true))}
              </>
            ) : (
              <>
                {allSpare && (
                  <tr>
                    <td colSpan={depts.length + 2} className="bg-amber-50 px-3 py-1.5 text-[11px] text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">
                      This Spare SO&apos;s ECs differ in Planning or Packing — shown EC by EC.
                    </td>
                  </tr>
                )}
                {items.map((e) => (
                  <Fragment key={str(e.item.id)}>{ecRow(e)}</Fragment>
                ))}
              </>
            )}
          </tbody>
        </table>
      </div>

      {open && (
        <DeptPopup
          orderId={orderId}
          role={role}
          dept={open.dept}
          soWide={open.soWide}
          entries={items.filter((e) => open.ids.includes(str(e.item.id)))}
          onClose={() => setOpen(null)}
        />
      )}
    </>
  );
}

/** One department's section for one EC — or a Spare SO's ECs as one — in a pop-up, editable there. */
export function DeptPopup({
  orderId,
  role,
  dept,
  soWide,
  entries,
  onClose,
  extra,
}: {
  orderId: string;
  role: string;
  dept: DeptKey;
  soWide: boolean;
  entries: ItemDetail[];
  onClose: () => void;
  // Shown under the sections (e.g. the SO's packing slips under Assembly & Packing).
  extra?: React.ReactNode;
}) {
  const open = { dept, soWide, entries };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (entries.length === 0) return null;
  const section = SECTION_OF[open.dept];
  const many = open.entries.length > 1;
  // A Spare SO's Planning / Packing edited once for all its ECs; anything
  // else on several ECs is shown EC by EC.
  const shown = open.soWide ? open.entries.slice(0, 1) : open.entries;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${DEPT_LABELS[open.dept]} details`}
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-6"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="max-h-[92vh] w-full max-w-4xl overflow-y-auto rounded-t-2xl bg-background p-5 shadow-xl sm:rounded-2xl"
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="font-display text-lg font-semibold text-foreground">
              {DEPT_LABELS[open.dept]} · {many ? `All ${open.entries.length} ECs` : str(open.entries[0].item.ec_no) || "EC"}
            </h2>
            <p className="text-xs text-muted">
              SO {str(open.entries[0].order.so_no)}
              {open.soWide && " · saving here updates every EC of this SO"}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-lg p-1.5 text-muted transition-colors hover:bg-surface hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="space-y-6">
          {shown.map((e) => (
            <div key={str(e.item.id)}>
              {many && !open.soWide && (
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">EC · {str(e.item.ec_no) || "—"}</p>
              )}
              <ItemSections
                detail={e}
                orderId={orderId}
                itemId={str(e.item.id)}
                role={role}
                only={section}
                soWideOrderId={open.soWide ? orderId : undefined}
              />
            </div>
          ))}
        </div>
        {extra && <div className="mt-6 space-y-6">{extra}</div>}
      </div>
    </div>
  );
}
