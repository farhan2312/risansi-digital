"use client";

// Every per-EC section — the EC's own fields and each department's row and
// lists — as the forms that own them. Shared by the EC page and the order
// overview, so a value is edited the same way wherever it is shown.

import {
  CHILD_FIELDS,
  ITEM_SECTIONS,
} from "@/lib/order-schema";
import {
  canViewDepartment,
  canCreateOrders,
  canEditChild,
  canEditQcDocuments,
  canEditQcRequirementDocs,
  canEditSection,
  isCentral,
} from "@/lib/roles";
import type { ItemDetail as ItemDetailData } from "@/lib/orders";
import { EditableSection, type DocumentsConfig } from "./editable-section";
import { OrderChildList } from "./order-children";
import { RevisionDocsButton } from "./drawing-docs";
import { OrderCopyCell } from "./order-copy-cell";
import { isSpareEc } from "@/lib/dept-view";

type Row = Record<string, unknown>;

function str(value: unknown): string {
  return value === null || value === undefined ? "" : String(value);
}

export function ItemSections({
  detail,
  orderId,
  itemId,
  role,
  only,
  soWideOrderId,
}: {
  detail: ItemDetailData;
  orderId: string;
  itemId: string;
  role: string;
  // Just this department's section — the SO page's EC grid pop-up.
  only?: string;
  // Save Planning / Assembly & Packing to every EC of this SO (a Spare SO).
  soWideOrderId?: string;
}) {
  const order = detail.order;
  const item = detail.item;
  const central = isCentral(role);

  // Item + department sections the role can see (QC section hidden when the SO
  // is flagged QC Needed = No).
  const qcNeeded = str(order.qc_required).trim().toLowerCase() !== "no";
  // A Spare is supplied as it is: no drawing to track on it.
  const drawingNeeded = !isSpareEc({
    item_type: str(item.item_type),
    order_type: str(order.order_type),
  });
  const visibleSections = ITEM_SECTIONS.filter(
    (s) =>
      // A Rep sees every section, read-only.
      canViewDepartment(role, s.table) &&
      (s.table !== "order_qc" || qcNeeded) &&
      (s.table !== "order_drawing" || drawingNeeded) &&
      (!only || s.table === only)
  );

  return (
    <div className="space-y-6">
      {visibleSections.map((section) => {
        // A section may carry a 1:many child list (Purchase → BOI items,
        // Planning/Packing → packing slips), gated by childGate against the
        // SO (e.g. boi = Yes, packing_details_required = Yes).
        if (section.childTable) {
          const child = section.childTable;
          const gate = section.childGate;
          const gateOk = !gate
            ? true
            : "present" in gate
              ? str(order[gate.column]).trim() !== ""
              : str(order[gate.column]) === gate.value;

          // Packing slips are shared by Planning (tentative) and Packing
          // (actual) — show only this section's rows.
          // order_invoices is per-SO, so it never appears on an EC detail —
          // the cast narrows to the per-EC child lists this page carries.
          let rows = ((detail as Record<string, unknown>)[child] ?? []) as Row[];
          if (child === "order_packing_slips") {
            rows = rows.filter(
              (r) => !section.childKind || str(r.kind) === section.childKind
            );
          }
          // The detail packing columns gate on Packing Details Required;
          // the section-level gate above uses Market Type.
          const childContext =
            child === "order_packing_slips"
              ? {
                  market_type: order.market_type,
                  packing_details_required: order.packing_details_required,
                }
              : undefined;

          const childTitle =
            child === "order_packing_slips"
              ? `${section.title} — ${
                  section.childKind === "tentative"
                    ? "Tentative packing Details"
                    : "Actual packing Details"
                }`
              : child === "order_drawing_revisions"
                ? `${section.title} — Revisions`
                : `${section.title} — BOI Items`;

          return (
            <div key={section.key} className="space-y-6">
              {section.fields.length > 0 && (
                <EditableSection
                  targetId={itemId}
                  section={section}
                  // The EC's type rides along: Planning's fields gate on it.
                  data={{
                    ...((detail[
                      section.table as
                        | "order_purchase"
                        | "order_planning"
                        | "order_assembly_dispatch"
                    ] as Row | null) ?? {}),
                    item_type: item.item_type,
                    // A Spare's readiness lots, edited in Planning's form.
                    ready_lots: detail.order_ready_lots,
                  }}
                  canEdit={canEditSection(role, section.table)}
                  canEditCentral={central}
                  soWideOrderId={soWideOrderId}
                />
              )}
              {gateOk ? (
                <OrderChildList
                  orderId={itemId}
                  table={child}
                  title={childTitle}
                  fields={CHILD_FIELDS[child]}
                  rows={rows}
                  canEdit={canEditChild(role, child)}
                  canEditCentral={central}
                  kind={section.childKind}
                  context={childContext}
                  rowAction={
                    child === "order_drawing_revisions"
                      ? (rev) => (
                          <RevisionDocsButton
                            revisionId={String(rev.id)}
                            label={[
                              order.so_no,
                              item.ec_no,
                              String(rev.revision_no ?? "").trim()
                                ? `Rev. ${String(rev.revision_no).trim()}`
                                : "First issue",
                            ]
                              .filter(Boolean)
                              .join(" · ")}
                            count={Number(rev.doc_count ?? 0)}
                          />
                        )
                      : undefined
                  }
                />
              ) : (
                <section className="rounded-xl border border-card-border bg-surface p-6 shadow-sm">
                  <h2 className="font-display text-base font-semibold text-foreground">
                    {childTitle}
                  </h2>
                  <p className="mt-1 text-sm text-muted">
                    {child === "order_packing_slips"
                      ? "Set Market Type on this order to record packing slips."
                      : "No BOI for this order (BOI = No)."}
                  </p>
                </section>
              )}
            </div>
          );
        }

        // Department rows don't carry item_type, but some of their fields
        // gate on it (e.g. Planning's pump-only fields). Merge it in so
        // dependsOn resolves the same way it does in the dept workspace,
        // whose queue rows already include item_type.
        const rawData =
          section.table === "order_items"
            ? detail.item
            : (detail[
                section.table as
                  | "order_drawing"
                  | "order_qc"
                  | "order_planning"
                  | "order_assembly_dispatch"
              ] as Row | null);
        const data: Row | null =
          section.table === "order_items"
            ? rawData
            : {
                ...(rawData ?? {}),
                item_type: item.item_type,
                // A Spare's readiness lots: Planning edits them, Assembly &
                // Packing records when each was packed.
                ...(section.table === "order_planning" || section.table === "order_assembly_dispatch"
                  ? { ready_lots: detail.order_ready_lots }
                  : {}),
              };

        const documents: DocumentsConfig[] | undefined =
          section.table === "order_qc"
            ? [
                {
                  table: "order_qc_documents",
                  label: "Docs attached by QC",
                  canEdit: canEditQcDocuments(role),
                },
                {
                  table: "order_qc_requirement_documents",
                  label: "Required Docs",
                  canEdit: canEditQcRequirementDocs(role),
                },
              ]
            : undefined;

        // Spares carry an Order Copy attachment (set on the Spare Add-On
        // form). Show its manage-card right below the EC card. Pumps don't
        // have one, so it's omitted for them.
        const isSpare = str(item.item_type).trim().toLowerCase() === "spare";
        return (
          <div key={section.key} className="space-y-6">
            <EditableSection
              targetId={itemId}
              section={section}
              data={data ?? null}
              canEdit={canEditSection(role, section.table)}
              canEditCentral={central}
              documents={documents}
              soWideOrderId={soWideOrderId}
            />
            {section.table === "order_items" && isSpare && (
              <OrderCopyCell
                itemId={itemId}
                orderId={orderId}
                fileName={str(item.order_copy_file_name)}
                canEdit={canCreateOrders(role)}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
