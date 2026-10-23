"use client";

import { useEffect, useState } from "react";
import { Loader2, X } from "lucide-react";
import { orderDeptViewAction, type DeptViewData, type ViewDept } from "@/app/risansi/orders/dept-view-actions";
import {
  ASSEMBLY_CONTEXT_FIELDS,
  PLANNING_CONTEXT_FIELDS,
  SECTION_BY_TABLE,
} from "@/lib/order-schema";
import { DrawingWorkspace } from "./drawing-workspace";
import { PurchaseWorkspace } from "./purchase-workspace";
import { QcWorkspace } from "./qc-workspace";
import { DepartmentWorkspace } from "./department-workspace";
import type { PurchaseQueueRow } from "@/lib/orders";
import type { PageResult } from "@/lib/pagination";

const TITLE: Record<ViewDept, string> = {
  drawing: "Drawing",
  purchase: "Purchase",
  quality: "Quality",
  planning: "Planning",
  assembly: "Assembly & Packing",
};

/**
 * A department's own screen for one SO, in a pop-up over the Orders list:
 * the same table, forms and versions as on the department's page, with just
 * this SO's rows.
 */
export function DeptViewPopup({
  orderId,
  soLabel,
  role,
  dept,
  version,
  onClose,
}: {
  orderId: string;
  soLabel: string;
  role: string;
  dept: ViewDept;
  /** Changes when the list is refreshed (a save in here does that): the cue to read again. */
  version: unknown;
  onClose: () => void;
}) {
  const [data, setData] = useState<DeptViewData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    orderDeptViewAction(orderId, dept).then((res) => {
      if (!live) return;
      if (res.ok) setData(res.data);
      else setError(res.error);
    });
    return () => {
      live = false;
    };
  }, [orderId, dept, version]);

  useEffect(() => {
    // Esc closes this pop-up only when no dialog of the screen inside is open.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (document.querySelectorAll('[role="dialog"]').length > 1) return;
      onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const body = () => {
    if (!data) {
      return error ? (
        <p className="text-sm text-danger">{error}</p>
      ) : (
        <p className="flex items-center gap-2 text-sm text-muted">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading…
        </p>
      );
    }
    if (data.queue.rows.length === 0) {
      return <p className="text-sm text-muted">Nothing for {TITLE[dept]} on this SO yet.</p>;
    }
    const common = {
      queue: data.queue,
      role,
      unreadThreads: data.unreadThreads,
      completions: data.completions,
      embedded: true,
    };
    if (dept === "drawing") return <DrawingWorkspace {...common} canEdit={data.canEdit} />;
    if (dept === "quality") return <QcWorkspace {...common} canEdit={data.canEdit} />;
    if (dept === "purchase") {
      return (
        <PurchaseWorkspace
          {...common}
          queue={data.queue as unknown as PageResult<PurchaseQueueRow>}
          canEdit={data.canEdit}
          vendors={data.vendors}
          vendorList={data.vendorList}
          drawingDocCounts={data.drawingDocCounts}
        />
      );
    }
    const table = dept === "planning" ? "order_planning" : "order_assembly_dispatch";
    return (
      <DepartmentWorkspace
        {...common}
        table={table}
        fields={SECTION_BY_TABLE.get(table)?.fields ?? []}
        readonlyFields={dept === "planning" ? PLANNING_CONTEXT_FIELDS : ASSEMBLY_CONTEXT_FIELDS}
        canEdit={data.canEdit}
        canEditCentral={data.canEditCentral}
        drawingDocCounts={data.drawingDocCounts}
        ecKind={data.ecKind}
      />
    );
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${TITLE[dept]} · ${soLabel}`}
      className="fixed inset-0 z-40 flex items-end justify-center whitespace-normal bg-black/40 sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="max-h-[94vh] w-full max-w-[96rem] overflow-y-auto rounded-t-2xl bg-background p-5 text-left shadow-xl sm:rounded-2xl"
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="font-display text-lg font-semibold text-foreground">{TITLE[dept]}</h2>
            <p className="text-xs text-muted">SO {soLabel} · as on the {TITLE[dept]} page</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-lg p-1.5 text-muted transition-colors hover:bg-surface hover:text-foreground"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        {body()}
      </div>
    </div>
  );
}
