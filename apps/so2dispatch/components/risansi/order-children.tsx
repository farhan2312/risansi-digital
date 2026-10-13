"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, ChevronDown, ChevronUp, Loader2, Plus, Trash2 } from "lucide-react";
import {
  addOrderChildAction,
  deleteOrderChildAction,
  updateOrderChildAction,
} from "@/app/risansi/orders/actions";
import {
  dependsOnSatisfied,
  selectOptionsFor,
  type ChildTable,
  type OrderField,
} from "@/lib/order-schema";

type Row = Record<string, unknown>;

function toInput(value: unknown): string {
  return value === null || value === undefined ? "" : String(value);
}

export function OrderChildList({
  orderId,
  table,
  title,
  fields,
  rows,
  canEdit,
  canEditCentral = true,
  canAdd,
  canDelete,
  kind,
  context,
  renderExtra,
  rowHeader,
  rowAction,
  headerAction,
  bulkSave = false,
}: {
  orderId: string;
  table: ChildTable;
  title: string;
  fields: OrderField[];
  rows: Row[];
  canEdit: boolean;
  // Whether the viewer may edit `centralOnly` fields (Central Visibility).
  // Non-central owners see those read-only, mirroring EditableSection.
  canEditCentral?: boolean;
  // Whether rows may be removed. Defaults to whoever may add them — a
  // department that only fills fields on rows someone else created (Purchase
  // on BOI items) can save but not delete.
  canDelete?: boolean;
  // Whether new rows may be added — defaults to canEdit. Set false to keep
  // existing rows editable/deletable while retiring new additions (e.g.
  // Dispatch Lots, now superseded by Dispatch's per-SO invoices).
  canAdd?: boolean;
  // Packing slips only: new rows are created with this kind ('tentative' for
  // Planning, 'actual' for Packing).
  kind?: string;
  // Parent values a field's dependsOn may gate on (e.g. the SO's market type
  // deciding whether the export-only packing columns apply). Resolved ahead of
  // the row itself, so a column's visibility doesn't depend on rows existing.
  context?: Row;
  // Optional trailing cell per row (e.g. an invoice's LR attachment control).
  renderExtra?: { label: string; render: (row: Row) => React.ReactNode };
  // Optional per-row header shown in the grouped card layout — replaces the
  // auto-summary in the chevron toggle. Used for invoices to display the
  // linked packing slip's EC / Packing Slip No. / Qty at the top of the card
  // (that context isn't part of the invoice form itself).
  rowHeader?: (row: Row) => React.ReactNode;
  // A control at the top right of each row's card, beside (not inside) the
  // collapse toggle — e.g. a drawing revision's Documents button.
  rowAction?: (row: Row) => React.ReactNode;
  // Optional control shown in the card header, left of the Add button (e.g.
  // the PI Excel upload on the Operation card).
  headerAction?: React.ReactNode;
  // One Save for the whole list instead of a button per row — add every item
  // first, then commit them together (Purchase's bought-out items).
  bulkSave?: boolean;
}) {
  const router = useRouter();
  // Edits overlay keyed by row id; the row list itself always comes from props.
  const [edits, setEdits] = useState<Record<string, Record<string, string>>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [savingAll, setSavingAll] = useState(false);
  const [savedAll, setSavedAll] = useState(false);
  const [bulkError, setBulkError] = useState<string | null>(null);

  function seed(row: Row): Record<string, string> {
    return Object.fromEntries(fields.map((f) => [f.column, toInput(row[f.column])]));
  }

  function valueFor(row: Row, column: string): string {
    const id = String(row.id);
    // Edits win, then the row, then the parent context (market type & co).
    return (
      edits[id]?.[column] ?? toInput(row[column] ?? context?.[column])
    );
  }

  // A dependsOn'd field (e.g. the Others free-text) applies to a row only when
  // its condition is satisfied by that row's current value.
  function applies(field: OrderField, row: Row): boolean {
    return dependsOnSatisfied(field, (col) => valueFor(row, col));
  }

  // Fields declaring a `group` render as a stacked-cards layout below rather
  // than a flat table row; buckets keep the fields contiguous per group.
  const hasGroups = fields.some((f) => f.group);
  const groupBuckets = hasGroups ? bucketByGroup(fields) : [];

  const visibleFields = fields.filter((f) => {
    if (!f.dependsOn) return true;
    // When the parent context carries every gating column (e.g. the SO's
    // market type), it decides the column outright — so an Export order shows
    // its extra columns even before the first slip is added.
    if (context && f.dependsOn.every((d) => d.column in context)) {
      return dependsOnSatisfied(f, (col) => toInput(context[col]));
    }
    // Otherwise the column appears once some row qualifies (e.g. Item = Others).
    return rows.some((r) => applies(f, r));
  });

  // Editable unless derived, explicitly read-only, or a centralOnly field
  // the viewer does not own.
  function fieldEditable(f: OrderField): boolean {
    if (f.computed || f.readOnly) return false;
    if (f.centralOnly && !canEditCentral) return false;
    return true;
  }

  function update(row: Row, column: string, value: string) {
    const id = String(row.id);
    setEdits((prev) => ({
      ...prev,
      [id]: { ...(prev[id] ?? seed(row)), [column]: value },
    }));
    setSavedId(null);
    setSavedAll(false);
    setBulkError(null);
  }

  async function saveRow(row: Row) {
    const id = String(row.id);
    setBusyId(id);
    const values = edits[id] ?? seed(row);
    const result = await updateOrderChildAction(id, table, values, orderId);
    setBusyId(null);
    if (!result.ok) return;
    setEdits((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    setSavedId(id);
    router.refresh();
  }

  /**
   * Commit every edited row in one go. Rows that save are cleared as they
   * go, so a partial failure leaves only the rows that still need attention
   * marked as unsaved rather than making saved work look lost.
   */
  async function saveAll() {
    const ids = Object.keys(edits);
    if (ids.length === 0) return;
    setSavingAll(true);
    setBulkError(null);

    let firstError: string | null = null;
    const saved: string[] = [];
    for (const id of ids) {
      const result = await updateOrderChildAction(id, table, edits[id], orderId);
      if (result.ok) saved.push(id);
      else if (!firstError) firstError = result.error;
    }

    setEdits((prev) => {
      const next = { ...prev };
      for (const id of saved) delete next[id];
      return next;
    });
    setSavingAll(false);
    if (firstError) {
      setBulkError(firstError);
      return;
    }
    setSavedAll(true);
    router.refresh();
  }

  async function deleteRow(row: Row) {
    const id = String(row.id);
    setBusyId(id);
    const result = await deleteOrderChildAction(id, table, orderId);
    setBusyId(null);
    if (result.ok) router.refresh();
  }

  const dirtyCount = Object.keys(edits).length;
  // In bulk mode the per-row column only survives if it still holds a
  // delete button — Purchase can neither add nor delete, so it goes away.
  const rowCanDelete = canDelete ?? canAdd ?? canEdit;
  const showRowActions = canEdit && (!bulkSave || rowCanDelete);

  async function addRow() {
    setAdding(true);
    const result = await addOrderChildAction(orderId, table, kind);
    setAdding(false);
    if (result.ok) router.refresh();
  }

  return (
    <section className="rounded-xl border border-card-border bg-surface p-6 shadow-sm">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-display text-base font-semibold text-foreground">
          {title}
        </h2>
        <div className="flex items-center gap-2">
        {headerAction}
        {(canAdd ?? canEdit) && (
          <button
            type="button"
            onClick={addRow}
            disabled={adding}
            className="inline-flex items-center gap-1.5 rounded-lg border border-input-border px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-background disabled:opacity-60"
          >
            {adding ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Plus className="h-3.5 w-3.5" />
            )}
            Add
          </button>
        )}
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-muted">None recorded.</p>
      ) : hasGroups ? (
        // Grouped fields (e.g. invoices → Invoice / Dispatch / Docket) render
        // each row as a vertical card with one grid per group. Reads better
        // than a wide many-column table.
        <div className="space-y-4">
          {rows.map((row, rowIndex) => (
            <RowCard
              key={String(row.id)}
              row={row}
              rowIndex={rowIndex}
              groups={groupBuckets}
              renderExtra={renderExtra}
              canEdit={canEdit}
              fieldEditable={fieldEditable}
              busy={busyId === String(row.id)}
              saved={savedId === String(row.id)}
              dirty={!!edits[String(row.id)]}
              valueFor={valueFor}
              applies={applies}
              update={update}
              onSave={() => saveRow(row)}
              onDelete={() => deleteRow(row)}
              headerContent={rowHeader?.(row) ?? null}
              headerAction={rowAction?.(row) ?? null}
            />
          ))}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-card-border text-left text-xs font-semibold uppercase tracking-wide text-muted">
                {visibleFields.map((f) => (
                  <th key={f.column} className="px-3 py-2 whitespace-nowrap">
                    {f.label}
                  </th>
                ))}
                {renderExtra && (
                  <th className="px-3 py-2 whitespace-nowrap">{renderExtra.label}</th>
                )}
                {showRowActions && <th className="px-3 py-2" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-card-border">
              {rows.map((row) => {
                const id = String(row.id);
                const inputClass =
                  "h-9 w-full min-w-[120px] rounded-lg border border-input-border bg-surface px-2.5 text-[13px] text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-ring/20";
                return (
                  <tr key={id} className="text-foreground">
                    {visibleFields.map((f) => (
                      <td key={f.column} className="px-3 py-2">
                        {!applies(f, row) ? (
                          <span className="text-muted-foreground">—</span>
                        ) : !canEdit || !fieldEditable(f) ? (
                          <span>{valueFor(row, f.column) || "—"}</span>
                        ) : f.type === "select" ? (
                          <select
                            value={valueFor(row, f.column)}
                            onChange={(e) => update(row, f.column, e.target.value)}
                            className={`${inputClass} cursor-pointer`}
                          >
                            <option value="">—</option>
                            {selectOptionsFor(f, valueFor(row, f.column)).map((o) => (
                              <option key={o.value} value={o.value}>
                                {o.label}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <input
                            type={f.type === "date" ? "date" : "text"}
                            value={valueFor(row, f.column)}
                            onChange={(e) => update(row, f.column, e.target.value)}
                            className={inputClass}
                          />
                        )}
                      </td>
                    ))}
                    {renderExtra && (
                      <td className="px-3 py-2 whitespace-nowrap">
                        {renderExtra.render(row)}
                      </td>
                    )}
                    {showRowActions && (
                      <td className="px-3 py-2 whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          {!bulkSave && (
                            <button
                              type="button"
                              onClick={() => saveRow(row)}
                              disabled={!edits[id] || busyId === id}
                              className="inline-flex h-8 items-center justify-center gap-1 rounded-lg bg-primary px-2.5 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              {busyId === id ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : savedId === id ? (
                                <Check className="h-3.5 w-3.5" />
                              ) : null}
                              Save
                            </button>
                          )}
                          {rowCanDelete && (
                            <button
                              type="button"
                              onClick={() => deleteRow(row)}
                              disabled={busyId === id}
                              aria-label="Delete row"
                              className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-rose-200 text-rose-600 transition-colors hover:bg-rose-50 disabled:opacity-50"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {bulkSave && canEdit && (
        <div className="mt-4 flex flex-wrap items-center justify-end gap-3 border-t border-card-border pt-4">
          {bulkError ? (
            <span role="alert" className="mr-auto text-xs text-danger">
              {bulkError}
            </span>
          ) : dirtyCount > 0 ? (
            <span className="mr-auto text-xs text-amber-700">
              {dirtyCount} unsaved {dirtyCount === 1 ? "row" : "rows"}
            </span>
          ) : savedAll ? (
            <span className="mr-auto inline-flex items-center gap-1 text-xs text-emerald-600">
              <Check className="h-3.5 w-3.5" />
              Saved
            </span>
          ) : null}
          <button
            type="button"
            onClick={saveAll}
            disabled={dirtyCount === 0 || savingAll}
            className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg bg-primary px-4 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            {savingAll && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {savingAll ? "Saving…" : "Save all"}
          </button>
        </div>
      )}
    </section>
  );
}

// Bucket visible fields by their `group` label so grouped rendering can render
// one subsection per group.
type Bucket = { label: string | null; fields: OrderField[] };
function bucketByGroup(fields: OrderField[]): Bucket[] {
  const buckets: Bucket[] = [];
  for (const f of fields) {
    const label = f.group ?? null;
    const last = buckets[buckets.length - 1];
    if (last && last.label === label) last.fields.push(f);
    else buckets.push({ label, fields: [f] });
  }
  return buckets;
}

/** One row of a grouped list, rendered as a vertical card with a grid per group. */
function RowCard({
  row,
  rowIndex,
  groups,
  renderExtra,
  canEdit,
  fieldEditable,
  busy,
  saved,
  dirty,
  valueFor,
  applies: appliesBase,
  update,
  onSave,
  onDelete,
  headerContent,
  headerAction,
}: {
  row: Row;
  rowIndex: number;
  groups: Bucket[];
  renderExtra?: { label: string; render: (row: Row) => React.ReactNode };
  canEdit: boolean;
  fieldEditable: (f: OrderField) => boolean;
  busy: boolean;
  saved: boolean;
  dirty: boolean;
  valueFor: (row: Row, column: string) => string;
  applies: (f: OrderField, row: Row) => boolean;
  update: (row: Row, column: string, value: string) => void;
  onSave: () => void;
  onDelete: () => void;
  // Explicit header text/content, e.g. the packing-slip context for an
  // invoice card. When set, it replaces the auto-generated field summary.
  headerContent?: React.ReactNode;
  headerAction?: React.ReactNode;
}) {
  const inputClass =
    "h-10 w-full rounded-[10px] border border-input-border bg-surface px-3 text-[14px] text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-ring/20";
  // `hideOnFirstRow` fields (Revision No.) drop off the first row — the first
  // drawing issue has no revision number; re-issues do.
  const applies = (f: OrderField, r: Row) =>
    rowIndex === 0 && f.hideOnFirstRow ? false : appliesBase(f, r);
  // Collapse the card to a one-line summary when there's a lot to look at.
  // Default open on a brand-new (empty) row so it's obvious what to fill in.
  const isNew = groups.every((g) =>
    g.fields.every((f) => !valueFor(row, f.column))
  );
  const [collapsed, setCollapsed] = useState(!isNew);

  // Pick a couple of leading fields for the summary line (first non-empty
  // values, skipping conditional fields that don't apply to this row).
  const summaryParts: string[] = [];
  for (const g of groups) {
    for (const f of g.fields) {
      if (!applies(f, row)) continue;
      const v = valueFor(row, f.column);
      if (!v) continue;
      summaryParts.push(`${f.label}: ${v}`);
      if (summaryParts.length >= 3) break;
    }
    if (summaryParts.length >= 3) break;
  }
  const summary = summaryParts.length ? summaryParts.join(" · ") : "New — click to fill in";

  return (
    <div className="rounded-xl border border-card-border bg-surface shadow-sm">
      {/* The action sits beside the toggle rather than inside it: a button
          cannot hold another button, and clicking it must not fold the card. */}
      <div className="flex items-center rounded-t-xl transition-colors hover:bg-background/60">
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        aria-expanded={!collapsed}
        className="flex min-w-0 flex-1 items-center gap-3 rounded-tl-xl px-4 py-3 text-left"
      >
        <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-input-border text-muted-foreground">
          {collapsed ? (
            <ChevronDown className="h-3.5 w-3.5" />
          ) : (
            <ChevronUp className="h-3.5 w-3.5" />
          )}
        </span>
        <span className="min-w-0 flex-1 truncate text-sm text-foreground">
          {headerContent ?? summary}
        </span>
        {dirty && !collapsed && (
          <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700">
            Unsaved
          </span>
        )}
      </button>
      {headerAction && <div className="shrink-0 pr-3">{headerAction}</div>}
      </div>

      {!collapsed && (
        <>
          <div className="space-y-5 border-t border-card-border px-4 py-4">
        {groups
          .map((g) => ({ label: g.label, fields: g.fields.filter((f) => applies(f, row)) }))
          .filter((g) => g.fields.length > 0)
          .map((g, i) => (
          // A rule above every group but the first separates the phases.
          <div key={i} className={i > 0 ? "border-t border-card-border pt-5" : ""}>
            {g.label && (
              <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-primary">
                {g.label}
              </h3>
            )}
            <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {g.fields.map((f) => (
                <div key={f.column}>
                  <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                    {f.label}
                  </label>
                  {!canEdit || !fieldEditable(f) ? (
                    <div className="flex h-10 items-center px-1 text-[14px] text-foreground">
                      {valueFor(row, f.column) || "—"}
                    </div>
                  ) : f.type === "select" ? (
                    <select
                      value={valueFor(row, f.column)}
                      onChange={(e) => update(row, f.column, e.target.value)}
                      className={`${inputClass} cursor-pointer`}
                    >
                      <option value="">—</option>
                      {selectOptionsFor(f, valueFor(row, f.column)).map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type={f.type === "date" ? "date" : "text"}
                      value={valueFor(row, f.column)}
                      onChange={(e) => update(row, f.column, e.target.value)}
                      className={inputClass}
                    />
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}

        {renderExtra && (
          <div>
            <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-primary">
              {renderExtra.label}
            </h3>
            {renderExtra.render(row)}
          </div>
        )}
      </div>

          {canEdit && (
            <div className="flex items-center gap-2 border-t border-card-border px-4 py-3">
              <button
                type="button"
                onClick={onSave}
                disabled={!dirty || busy}
                className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg bg-primary px-3 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busy ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : saved ? (
                  <Check className="h-3.5 w-3.5" />
                ) : null}
                Save
              </button>
              <button
                type="button"
                onClick={onDelete}
                disabled={busy}
                aria-label="Delete row"
                className="ml-auto inline-flex h-9 w-9 items-center justify-center rounded-lg border border-rose-200 text-rose-600 transition-colors hover:bg-rose-50 disabled:opacity-50"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
