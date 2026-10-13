"use client";

import { Fragment, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Paperclip, Pencil } from "lucide-react";
import { updateOrderSectionAction, updateSectionForSoAction } from "@/app/risansi/orders/actions";
import {
  canonicalSelectValue,
  dependsOnSatisfied,
  readyLotsOpen,
  selectOptionsFor,
  withValueRules,
  type OrderField,
  type OrderSection,
} from "@/lib/order-schema";
import type { QcDocTable } from "@/lib/orders";
import type { MarketIntellClient } from "@/lib/market-intell";
import { QcDocumentsModal } from "./qc-documents-modal";
import { ClientLookup } from "./client-lookup";
import { ReadyLotsEditor } from "./ready-lots-editor";
import {
  PACKING_LOTS_FIELD,
  READY_LOTS_FIELD,
  lotsError,
  lotsFromRows,
  lotsSummary,
  packingError,
  packingLotsFromRows,
  type PackingLot,
  type ReadyLot,
} from "@/lib/ready-lots";
import { PackingLotsEditor } from "./packing-lots-editor";

export type DocumentsConfig = {
  table: QcDocTable;
  label: string;
  canEdit: boolean;
};

type Row = Record<string, unknown>;

function toInput(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value);
}

export function formatDisplay(field: OrderField, value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (field.type === "date") {
    const d = new Date(String(value));
    if (!Number.isNaN(d.getTime())) {
      return d.toLocaleDateString("en-GB", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      });
    }
  }
  if (field.type === "number" || field.type === "int") {
    const n = Number(value);
    if (Number.isFinite(n)) return new Intl.NumberFormat("en-IN").format(n);
  }
  if (field.type === "select") {
    const v = canonicalSelectValue(field, String(value));
    return field.options?.find((o) => o.value === v)?.label ?? v;
  }
  return String(value);
}

// Seed the form value for a field, normalizing select casing.
function seedValue(field: OrderField, data: Row | null): string {
  return canonicalSelectValue(field, toInput(data?.[field.column]) || field.defaultValue || "");
}

// A field's dependsOn may reference a column outside this section (e.g. the
// order's bill_type gating a billing field). Resolve from the edit values
// first, then fall back to the row data.
function dependsSatisfied(
  field: OrderField,
  values: Record<string, string>,
  data: Row | null
): boolean {
  return dependsOnSatisfied(
    field,
    (col) => values[col] ?? toInput(data?.[col])
  );
}

/**
 * An editable order/EC section. `targetId` is the SO's order_id for SO-scope
 * sections and the EC's item_id for item-scope sections — the section's own
 * scope decides how the server routes the save.
 */
export function EditableSection({
  targetId,
  section,
  data,
  canEdit,
  canEditCentral,
  documents = [],
  clientLookup = false,
  fieldExtra,
  soWideOrderId,
}: {
  targetId: string;
  section: OrderSection;
  data: Row | null;
  canEdit: boolean;
  canEditCentral: boolean;
  documents?: DocumentsConfig[];
  // Offers the Market Intell directory search while editing, to overwrite the
  // client columns of this section.
  clientLookup?: boolean;
  // Renders alongside a field's value — for fields owned by their own flow
  // rather than the section form, e.g. a target date's revise button and
  // history. Returns null for fields it does not handle.
  fieldExtra?: (field: OrderField) => React.ReactNode;
  // Planning / Assembly & Packing on a Spare SO edited as one: the save goes
  // to every EC of this SO, as the department queues' "Edit SO" does.
  soWideOrderId?: string;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openDocs, setOpenDocs] = useState<DocumentsConfig | null>(null);
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(section.fields.map((f) => [f.column, seedValue(f, data)]))
  );

  // A Spare's readiness lots live in Planning's form; once there is one, the
  // status and readiness date are the latest lot's.
  const spareLots =
    section.table === "order_planning" &&
    toInput(data?.item_type).trim().toLowerCase() === "spare";
  const [lots, setLots] = useState<ReadyLot[]>(() => lotsFromRows(data?.ready_lots));
  const lotsLead = spareLots ? lotsSummary(editing ? lots : lotsFromRows(data?.ready_lots)) : null;

  // …and Assembly & Packing records when each lot was packed.
  const spareAssembly =
    section.table === "order_assembly_dispatch" &&
    toInput(data?.item_type).trim().toLowerCase() === "spare";
  const [packLots, setPackLots] = useState<PackingLot[]>(() => packingLotsFromRows(data?.ready_lots));

  function startEdit() {
    setValues(
      Object.fromEntries(section.fields.map((f) => [f.column, seedValue(f, data)]))
    );
    setLots(lotsFromRows(data?.ready_lots));
    setPackLots(packingLotsFromRows(data?.ready_lots));
    setError(null);
    setEditing(true);
  }

  // Overwrite the client columns from a directory pick. Only columns this
  // section actually has are touched — everything else stays as edited.
  function applyClient(client: MarketIntellClient) {
    const next: Record<string, string> = {
      client_code: client.code,
      client_name: client.legal_name ?? "",
      market_type: client.market_type ?? "",
      client_type: client.client_type ?? "",
      industry_type: client.industry ?? "",
      zone: client.zone ?? "",
      reps: client.rep_name ?? "",
    };
    setValues((prev) => {
      const merged = { ...prev };
      for (const [col, val] of Object.entries(next)) {
        if (col in merged) merged[col] = val;
      }
      return merged;
    });
    setError(null);
  }

  async function save() {
    const lotProblem = spareLots ? lotsError(lots) : spareAssembly ? packingError(packLots) : null;
    if (lotProblem) {
      setError(lotProblem);
      return;
    }
    setSaving(true);
    setError(null);
    const lead = spareLots ? lotsSummary(lots) : null;
    const saveSection = (t: string, v: Record<string, string>) =>
      soWideOrderId
        ? updateSectionForSoAction(soWideOrderId, t, v)
        : updateOrderSectionAction(targetId, t, v);
    const result = await saveSection(
      section.table,
      spareLots
        ? {
            ...values,
            ...(lead
              ? { actual_spare_status: lead.status, planning_readiness_date: lead.date }
              : {}),
            [READY_LOTS_FIELD]: JSON.stringify(lots),
          }
        : spareAssembly
          ? { ...values, [PACKING_LOTS_FIELD]: JSON.stringify(packLots) }
          : values
    );
    setSaving(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setEditing(false);
    router.refresh();
  }

  return (
    <section className="rounded-xl border border-card-border bg-surface p-6 shadow-sm">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-display text-base font-semibold text-foreground">
          {section.title}
        </h2>
        <div className="flex items-center gap-2">
          {documents.map((doc) => (
            <button
              key={doc.table}
              type="button"
              onClick={() => setOpenDocs(doc)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-input-border px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-background"
            >
              <Paperclip className="h-3.5 w-3.5" />
              {doc.label}
            </button>
          ))}
          {!editing && canEdit && (
            <button
              type="button"
              onClick={startEdit}
              className="inline-flex items-center gap-1.5 rounded-lg border border-input-border px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-background"
            >
              <Pencil className="h-3.5 w-3.5" />
              Edit
            </button>
          )}
        </div>
      </div>

      {openDocs && (
        <QcDocumentsModal
          table={openDocs.table}
          title={openDocs.label}
          orderId={targetId}
          label={section.title}
          canEdit={openDocs.canEdit}
          onClose={() => setOpenDocs(null)}
        />
      )}

      {error && (
        <div
          role="alert"
          className="mb-4 rounded-[10px] border border-danger-border bg-danger-bg px-4 py-2.5 text-sm text-danger"
        >
          {error}
        </div>
      )}

      {editing && clientLookup && (
        <ClientLookup
          onSelect={applyClient}
          label="Replace client details from directory"
        />
      )}

      {(() => {
        // Bucket visible fields by their `group` label (consecutive fields
        // sharing a label are one bucket). Buckets with no label render as
        // a plain grid — matches the old behavior when no groups are defined.
        type Bucket = { label: string | null; fields: OrderField[] };
        const buckets: Bucket[] = [];
        for (const f of section.fields) {
          if (!dependsSatisfied(f, values, data)) continue;
          const label = f.group ?? null;
          const last = buckets[buckets.length - 1];
          if (last && last.label === label) last.fields.push(f);
          else buckets.push({ label, fields: [f] });
        }
        const gridClass =
          "grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4";
        return (
          <div className="space-y-6">
            {spareAssembly && (
              <PackingLotsEditor
                lots={editing ? packLots : packingLotsFromRows(data?.ready_lots)}
                onChange={setPackLots}
                editing={editing}
              />
            )}
            {buckets.map((bucket, bi) => (
              <div key={bi}>
                {bucket.label && (
                  <h3 className="mb-3 text-[12px] font-semibold uppercase tracking-wide text-primary">
                    {bucket.label}
                  </h3>
                )}
                <div className={gridClass}>
                  {bucket.fields.map((field) => {
                    // readOnly fields are shown here but changed elsewhere —
                    // target dates, for instance, are moved from the Target
                    // Dates panel so every change lands in their history.
                    // With lots, a Spare's status and readiness date follow
                    // the latest one.
                    const fromLots =
                      !!lotsLead &&
                      (field.column === "actual_spare_status" ||
                        field.column === "planning_readiness_date");
                    const fieldEditable =
                      editing &&
                      !fromLots &&
                      !field.computed &&
                      !field.readOnly &&
                      (!field.centralOnly || canEditCentral);
                    const lotsHere =
                      spareLots &&
                      field.column === "actual_spare_status" &&
                      (editing
                        ? lots.length > 0 || readyLotsOpen(values.actual_spare_status)
                        : lotsFromRows(data?.ready_lots).length > 0);
                    return (
                      <Fragment key={field.column}>
                      <div>
                        <div className="mb-1 flex items-center gap-1.5 text-[12px] font-medium uppercase tracking-wide text-muted-foreground">
                          {field.label}
                          {field.centralOnly && !canEditCentral && (
                            <span className="rounded bg-slate-100 px-1 text-[9px] font-semibold text-slate-500">
                              read-only
                            </span>
                          )}
                          {field.computed && (
                            <span className="rounded bg-slate-100 px-1 text-[9px] font-semibold text-slate-500">
                              auto
                            </span>
                          )}
                          {fromLots && (
                            <span className="rounded bg-slate-100 px-1 text-[9px] font-semibold normal-case text-slate-500">
                              from lots
                            </span>
                          )}
                        </div>
                        {fieldEditable ? (
                          field.type === "select" ? (
                            <select
                              value={values[field.column] || field.defaultValue || ""}
                              onChange={(e) => {
                                const next = e.target.value;
                                setValues((prev) => withValueRules(prev, field.column, next));
                                // Partial / Fully ready opens Lot 1 with that status.
                                if (
                                  spareLots &&
                                  field.column === "actual_spare_status" &&
                                  lots.length === 0 &&
                                  (next === "Partial ready" || next === "Fully ready")
                                ) {
                                  setLots([{ status: next, ready_date: "" }]);
                                }
                              }}
                              className="h-10 w-full rounded-[10px] border border-input-border bg-surface px-3 text-[14px] text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-ring/20 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              {!field.defaultValue && <option value="">—</option>}
                              {selectOptionsFor(field, values[field.column] ?? "").map((o) => (
                                <option key={o.value} value={o.value}>
                                  {o.label}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <input
                              type={
                                field.type === "date"
                                  ? "date"
                                  : field.type === "text"
                                    ? "text"
                                    : "number"
                              }
                              step={field.type === "number" ? "any" : undefined}
                              min={field.min}
                              value={values[field.column] ?? ""}
                              onChange={(e) =>
                                setValues((prev) => ({
                                  ...prev,
                                  [field.column]: e.target.value,
                                }))
                              }
                              className="h-10 w-full rounded-[10px] border border-input-border bg-surface px-3 text-[14px] text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-ring/20 disabled:cursor-not-allowed disabled:opacity-50"
                            />
                          )
                        ) : (
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[14px] text-foreground">
                            <span>
                              {fromLots && lotsLead
                                ? formatDisplay(
                                    field,
                                    field.column === "actual_spare_status"
                                      ? lotsLead.status
                                      : lotsLead.date
                                  )
                                : formatDisplay(field, data?.[field.column] ?? field.defaultValue)}
                            </span>
                            {fieldExtra?.(field)}
                          </div>
                        )}
                      </div>
                      {lotsHere && (
                        <div className="col-span-full">
                          <ReadyLotsEditor
                            // Fresh each time the form opens, so its lock reads what is saved.
                            key={editing ? "edit" : "view"}
                            lots={editing ? lots : lotsFromRows(data?.ready_lots)}
                            onChange={setLots}
                            editing={editing}
                          />
                        </div>
                      )}
                      </Fragment>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        );
      })()}

      {editing && (
        <div className="mt-5 flex gap-3">
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="flex h-10 items-center justify-center gap-2 rounded-[10px] bg-primary px-5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary-hover disabled:opacity-70"
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            {saving ? "Saving..." : "Save"}
          </button>
          <button
            type="button"
            onClick={() => setEditing(false)}
            className="h-10 rounded-[10px] border border-input-border bg-surface px-5 text-sm font-medium text-foreground transition-colors hover:bg-background"
          >
            Cancel
          </button>
        </div>
      )}
    </section>
  );
}
