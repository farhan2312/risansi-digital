"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, X } from "lucide-react";
import { getOrderOperationAction } from "@/app/risansi/orders/actions";
import { OPERATION_FIELDS, SECTION_BY_TABLE } from "@/lib/order-schema";
import { isCentral } from "@/lib/roles";
import type { TargetRevision } from "@/lib/target-dates";
import { EditableSection } from "./editable-section";
import { paymentTermsExtra } from "./payment-terms-control";
import { targetDateExtra } from "./target-date-control";

type Row = Record<string, unknown>;

/**
 * Order Making's Operation column: an SO's handover dates, Terms & Conditions,
 * documents and target dates, in the same form as its Order details. Central
 * Visibility and Admin edit them; everyone else who opens Order Making reads them.
 */
export function OrderOperationPopup({
  orderId,
  soLabel,
  role,
  version,
  onClose,
}: {
  orderId: string;
  soLabel: string;
  role: string;
  /** Changes when the list refreshes after a save: the cue to read again. */
  version: unknown;
  onClose: () => void;
}) {
  const [data, setData] = useState<{ order: Row; paymentTerms: Row[]; targetRevisions: TargetRevision[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const canEdit = isCentral(role);

  useEffect(() => {
    let live = true;
    getOrderOperationAction(orderId)
      .then((res) => {
        if (!live) return;
        if (res.ok) setData(res);
        else setError(res.error);
      })
      .catch(() => live && setError("Could not load the order."));
    return () => {
      live = false;
    };
  }, [orderId, version]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const section = useMemo(() => {
    const orders = SECTION_BY_TABLE.get("orders")!;
    return { ...orders, title: "Operation", fields: OPERATION_FIELDS };
  }, []);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Operation · ${soLabel}`}
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-6"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="max-h-[92vh] w-full max-w-4xl overflow-y-auto rounded-t-2xl bg-background p-5 text-left shadow-xl sm:rounded-2xl"
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="font-display text-lg font-semibold text-foreground">Operation</h2>
            <p className="text-xs text-muted">
              SO {soLabel}
              {data && String(data.order.client_name ?? "") ? ` · ${String(data.order.client_name)}` : ""}
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
        {error ? (
          <p className="text-sm text-danger">{error}</p>
        ) : !data ? (
          <p className="flex items-center gap-2 text-sm text-muted">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading the order…
          </p>
        ) : (
          <EditableSection
            targetId={orderId}
            section={section}
            data={data.order}
            canEdit={canEdit}
            canEditCentral={canEdit}
            startEditing={canEdit}
            // As on Order details: target dates and payment terms carry their own controls.
            fieldExtra={(field) =>
              paymentTermsExtra(orderId, data.paymentTerms, canEdit)(field) ??
              targetDateExtra(orderId, data.targetRevisions, canEdit)(field)
            }
          />
        )}
      </div>
    </div>
  );
}
