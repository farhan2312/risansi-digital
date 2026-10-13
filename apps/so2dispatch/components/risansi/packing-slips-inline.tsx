"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Eye, Loader2, Pencil, Plus, Trash2, X } from "lucide-react";
import {
  addOrderChildAction,
  deleteOrderChildAction,
  updateOrderChildAction,
} from "@/app/risansi/orders/actions";
import { PACKING_SLIP_FIELDS, dependsOnSatisfied, type OrderField } from "@/lib/order-schema";

type Row = Record<string, unknown>;

const str = (v: unknown) => (v === null || v === undefined ? "" : String(v).trim());

function day(v: unknown): string {
  const s = str(v).slice(0, 10);
  if (!s) return "";
  const d = new Date(`${s}T00:00:00Z`);
  return Number.isNaN(d.getTime())
    ? s
    : d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
}

/**
 * Assembly & Packing's packing slips, on the queue row itself: one line per
 * slip — No. and date only — with Edit and Delete, and "+ Packing slip" below.
 * With Packing Details Required, the rest of a slip (box, weights, qty…) opens
 * in a pop-up from the eye icon. Add and Edit open the same pop-up to fill in.
 */
export function PackingSlipsInline({
  orderId,
  soLabel,
  slips,
  context,
  gateOk,
  canEdit,
  canEditCentral,
}: {
  orderId: string;
  soLabel: string;
  slips: Row[];
  // The SO's market type and Packing Details Required: which fields apply.
  context: Row;
  // Packing slips need a Market Type on the SO first.
  gateOk: boolean;
  canEdit: boolean;
  canEditCentral: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<{ slip: Row | null; view?: boolean } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fields = PACKING_SLIP_FIELDS.filter((f) =>
    dependsOnSatisfied(f, (col) => str(context[col]))
  );
  // Fields beyond Slip No. and date: shown in the pop-up, not the list.
  const details = fields.length > 2;

  if (!gateOk) {
    return <span className="text-xs text-muted">Set Market Type to record packing slips.</span>;
  }

  async function remove(slip: Row) {
    if (!confirm(`Delete packing slip ${str(slip.packing_slip_no) || "(blank)"}?`)) return;
    setBusy(str(slip.id));
    setError(null);
    const res = await deleteOrderChildAction(str(slip.id), "order_packing_slips", orderId);
    setBusy(null);
    if (!res.ok) setError(res.error);
    else router.refresh();
  }

  return (
    <div className="w-[18rem]">
      {slips.length === 0 ? (
        <p className="text-xs text-muted">No packing slip yet</p>
      ) : (
        <table className="w-full table-fixed text-xs">
          <colgroup>
            <col />
            <col className="w-[6.5rem]" />
            <col className="w-[4.5rem]" />
          </colgroup>
          <thead>
            <tr className="text-left text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              <th className="pb-1 pl-1.5 pr-1.5">Slip No.</th>
              <th className="pb-1 pr-1.5">Date</th>
              <th className="pb-1" />
            </tr>
          </thead>
          <tbody className="[&>tr:nth-child(odd)]:bg-slate-100/70 dark:[&>tr:nth-child(odd)]:bg-white/[0.04]">
            {slips.map((s) => (
              <tr key={str(s.id)} className="align-top">
                <td className="rounded-l-md py-1.5 pl-1.5 pr-1.5 break-words font-medium text-foreground">
                  {str(s.packing_slip_no) || <span className="text-amber-700">—</span>}
                </td>
                <td className="py-1.5 pr-1.5 whitespace-nowrap">{day(s.packing_slip_date) || "—"}</td>
                <td className="rounded-r-md py-1.5 pr-1 text-right whitespace-nowrap">
                  <span className="inline-flex items-center gap-0.5">
                    {details && (
                      <button
                        type="button"
                        onClick={() => setEditing({ slip: s, view: true })}
                        aria-label={`Packing details of slip ${str(s.packing_slip_no)}`}
                        title="Packing details"
                        className="rounded p-0.5 text-primary hover:bg-background"
                      >
                        <Eye className="h-3.5 w-3.5" />
                      </button>
                    )}
                  {canEdit && (
                    <>
                      <button
                        type="button"
                        onClick={() => setEditing({ slip: s })}
                        aria-label={`Edit packing slip ${str(s.packing_slip_no)}`}
                        className="rounded p-0.5 text-muted-foreground hover:bg-background hover:text-foreground"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => remove(s)}
                        disabled={busy === str(s.id)}
                        aria-label={`Delete packing slip ${str(s.packing_slip_no)}`}
                        className="rounded p-0.5 text-rose-500 hover:bg-rose-50 disabled:opacity-50"
                      >
                        {busy === str(s.id) ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Trash2 className="h-3.5 w-3.5" />
                        )}
                      </button>
                    </>
                  )}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {error && <p className="mt-1 text-[11px] text-danger">{error}</p>}

      {canEdit && (
        <button
          type="button"
          onClick={() => setEditing({ slip: null })}
          className="mt-1.5 inline-flex h-7 items-center gap-1 rounded-md border border-primary/40 bg-primary/10 px-2.5 text-[11px] font-semibold text-primary transition-colors hover:bg-primary hover:text-primary-foreground"
        >
          <Plus className="h-3.5 w-3.5" />
          Packing slip
        </button>
      )}

      {editing?.view && editing.slip && (
        <SlipView
          slip={editing.slip}
          soLabel={soLabel}
          fields={fields}
          onEdit={canEdit ? () => setEditing({ slip: editing.slip }) : undefined}
          onClose={() => setEditing(null)}
        />
      )}
      {editing && !editing.view && (
        <SlipForm
          orderId={orderId}
          soLabel={soLabel}
          slip={editing.slip}
          fields={fields}
          canEditCentral={canEditCentral}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function SlipForm({
  orderId,
  soLabel,
  slip,
  fields,
  canEditCentral,
  onClose,
}: {
  orderId: string;
  soLabel: string;
  slip: Row | null;
  fields: OrderField[];
  canEditCentral: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      fields.map((f) => [f.column, f.type === "date" ? str(slip?.[f.column]).slice(0, 10) : str(slip?.[f.column])])
    )
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !saving && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [saving, onClose]);

  const editable = (f: OrderField) => !f.computed && !f.readOnly && (!f.centralOnly || canEditCentral);

  async function save(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    let id = slip ? str(slip.id) : "";
    let created = false;
    if (!id) {
      const added = await addOrderChildAction(orderId, "order_packing_slips", "actual");
      if (!added.ok || !added.id) {
        setSaving(false);
        setError(added.ok ? "Could not add the packing slip." : added.error);
        return;
      }
      id = added.id;
      created = true;
    }
    const res = await updateOrderChildAction(id, "order_packing_slips", values, orderId);
    if (!res.ok) {
      // A new slip that could not be filled is not left behind blank.
      if (created) await deleteOrderChildAction(id, "order_packing_slips", orderId);
      setSaving(false);
      setError(res.error);
      return;
    }
    setSaving(false);
    router.refresh();
    onClose();
  }

  const input =
    "h-10 w-full rounded-[10px] border border-input-border bg-surface px-3 text-[14px] text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-ring/20 disabled:opacity-60";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={slip ? "Edit packing slip" : "New packing slip"}
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-6"
      onClick={() => !saving && onClose()}
    >
      <form
        onSubmit={save}
        onClick={(e) => e.stopPropagation()}
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-surface p-5 shadow-xl sm:rounded-2xl"
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="font-display text-lg font-semibold text-foreground">
              {slip ? "Edit packing slip" : "New packing slip"}
            </h2>
            <p className="text-xs text-muted">SO {soLabel}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            aria-label="Close"
            className="rounded-lg p-1.5 text-muted transition-colors hover:bg-background hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        {error && (
          <div role="alert" className="mb-3 rounded-[10px] border border-danger-border bg-danger-bg px-3 py-2 text-sm text-danger">
            {error}
          </div>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          {fields.map((f, i) => (
            <label
              key={f.column}
              className={`block text-sm ${f.column === "description" || f.column === "marking_on_case" ? "sm:col-span-2" : ""}`}
            >
              <span className="mb-1 block text-[13px] font-medium text-brand-label">{f.label}</span>
              <input
                type={f.type === "date" ? "date" : f.type === "int" || f.type === "number" ? "number" : "text"}
                step={f.type === "number" ? "any" : f.type === "int" ? 1 : undefined}
                min={f.type === "int" || f.type === "number" ? 0 : undefined}
                value={values[f.column] ?? ""}
                onChange={(e) => setValues((prev) => ({ ...prev, [f.column]: e.target.value }))}
                disabled={!editable(f)}
                autoFocus={i === 0}
                className={input}
              />
            </label>
          ))}
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="inline-flex h-9 items-center rounded-lg border border-input-border px-4 text-sm font-medium text-foreground transition-colors hover:bg-background"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary-hover disabled:opacity-60"
          >
            {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {slip ? "Save" : "Add packing slip"}
          </button>
        </div>
      </form>
    </div>
  );
}

/** A slip's packing details, read-only — what the list leaves out. */
function SlipView({
  slip,
  soLabel,
  fields,
  onEdit,
  onClose,
}: {
  slip: Row;
  soLabel: string;
  fields: OrderField[];
  onEdit?: () => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Packing slip details"
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-6"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-surface p-5 shadow-xl sm:rounded-2xl"
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="font-display text-lg font-semibold text-foreground">
              Packing slip {str(slip.packing_slip_no) || "—"}
            </h2>
            <p className="text-xs text-muted">SO {soLabel}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-lg p-1.5 text-muted transition-colors hover:bg-background hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <dl className="grid gap-x-4 gap-y-3 rounded-xl border border-card-border p-4 sm:grid-cols-2">
          {fields.map((f) => (
            <div
              key={f.column}
              className={f.column === "description" || f.column === "marking_on_case" ? "sm:col-span-2" : ""}
            >
              <dt className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{f.label}</dt>
              <dd className="mt-0.5 text-sm text-foreground">
                {(f.type === "date" ? day(slip[f.column]) : str(slip[f.column])) || "—"}
              </dd>
            </div>
          ))}
        </dl>
        <div className="mt-5 flex justify-end gap-2">
          {onEdit && (
            <button
              type="button"
              onClick={onEdit}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-input-border px-4 text-sm font-medium text-foreground transition-colors hover:bg-background"
            >
              <Pencil className="h-3.5 w-3.5" />
              Edit
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-9 items-center rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary-hover"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
