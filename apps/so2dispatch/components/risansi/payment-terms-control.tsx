"use client";

import { useState } from "react";
import { Loader2, Plus, Trash2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import {
  addOrderChildAction,
  deleteOrderChildAction,
  updateOrderChildAction,
} from "@/app/risansi/orders/actions";
import {
  TERMS_WITH_DAYS,
  PAYMENT_AGAINST_DOCUMENTS,
  PAYMENT_DOCUMENT_OPTIONS,
  PAYMENT_TERM_OPTIONS,
  type OrderField,
} from "@/lib/order-schema";

type Row = Record<string, unknown>;

const str = (v: unknown) => (v === null || v === undefined ? "" : String(v));

/** "30% After Receipt · 45 days" — the line as it reads once filled in. */
function describe(row: Row): string {
  const percent = str(row.percent).trim();
  const days = str(row.days).trim();
  const docs = str(row.documents).trim();
  return [
    percent ? `${Number(percent)}%` : null,
    str(row.term).trim() || "—",
    docs ? `Docs: ${docs}` : null,
    days ? `${days} days` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

/**
 * The order's payment terms, beside the terms field itself — one line per
 * slice of them, added to rather than revised.
 *
 * Unlike a target date there is no history behind a line: a term that changes
 * is a new agreement, not a correction, so a wrong line is removed and the
 * right one added. Each line saved tells Accounts and Billing (see
 * paymentTermNotice).
 */
export function PaymentTermsControl({
  orderId,
  rows,
  canEdit,
}: {
  orderId: string;
  rows: Row[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState("");
  const [percent, setPercent] = useState("");
  const [days, setDays] = useState("");
  const [docs, setDocs] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const needsDays = TERMS_WITH_DAYS.includes(term);
  // Payment Against Documents names the documents it waits on.
  const needsDocs = term === PAYMENT_AGAINST_DOCUMENTS;
  const total = rows.reduce((n, r) => n + (Number(str(r.percent)) || 0), 0);

  async function save() {
    if (!term) {
      setError("Choose a term.");
      return;
    }
    if (needsDocs && docs.length === 0) {
      setError("Choose the required documents.");
      return;
    }
    setSaving(true);
    setError(null);
    // The row is created first, then filled: the same two steps the list form
    // takes, so the same guards, audit line and notification apply.
    const created = await addOrderChildAction(orderId, "order_payment_terms");
    if (!created.ok) {
      setSaving(false);
      setError(created.error);
      return;
    }
    const saved = await updateOrderChildAction(
      created.id ?? "",
      "order_payment_terms",
      {
        term,
        percent,
        days: needsDays ? days : "",
        // In the list's own order, whatever order they were ticked in.
        documents: needsDocs
          ? PAYMENT_DOCUMENT_OPTIONS.map((o) => o.value).filter((d) => docs.includes(d)).join(", ")
          : "",
      },
      orderId
    );
    setSaving(false);
    if (!saved.ok) {
      setError(saved.error);
      return;
    }
    setTerm("");
    setPercent("");
    setDays("");
    setDocs([]);
    setOpen(false);
    router.refresh();
  }

  async function remove(id: string) {
    setRemovingId(id);
    setError(null);
    const result = await deleteOrderChildAction(id, "order_payment_terms", orderId);
    setRemovingId(null);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    router.refresh();
  }

  return (
    <div className="mt-1 w-full">
      {rows.length > 0 && (
        <ul className="mb-1.5 space-y-1">
          {rows.map((r) => (
            <li
              key={str(r.id)}
              className="flex items-center justify-between gap-2 rounded-md border border-card-border bg-background px-2 py-1"
            >
              <span className="text-xs text-foreground">{describe(r)}</span>
              {canEdit && (
                <button
                  type="button"
                  onClick={() => remove(str(r.id))}
                  disabled={removingId === str(r.id)}
                  aria-label={`Remove ${describe(r)}`}
                  className="shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:text-danger disabled:opacity-50"
                >
                  {removingId === str(r.id) ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Trash2 className="h-3 w-3" />
                  )}
                </button>
              )}
            </li>
          ))}
          {/* The parts should account for the whole order; saying so is more
              use than refusing a line that does not yet add up. */}
          <li
            className={`text-[11px] ${
              total === 100 ? "text-muted-foreground" : "text-amber-700"
            }`}
          >
            {total}% of the order covered
            {total === 100 ? "" : " — the terms do not add up to 100% yet"}
          </li>
        </ul>
      )}

      {error && (
        <p role="alert" className="mb-1 text-[11px] text-danger">
          {error}
        </p>
      )}

      {canEdit &&
        (open ? (
          <div className="rounded-lg border border-card-border bg-surface p-2">
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={term}
                onChange={(e) => setTerm(e.target.value)}
                aria-label="Term"
                className="h-8 min-w-44 rounded-md border border-input-border bg-surface px-2 text-xs text-foreground"
              >
                <option value="">Choose a term…</option>
                {PAYMENT_TERM_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
              <input
                type="number"
                min={0}
                value={percent}
                onChange={(e) => setPercent(e.target.value)}
                placeholder="%"
                aria-label="Percent"
                className="h-8 w-16 rounded-md border border-input-border bg-surface px-2 text-xs text-foreground"
              />
              {/* After Receipt's credit period, a Letter of Credit's days. */}
              {needsDays && (
                <input
                  type="number"
                  min={0}
                  value={days}
                  onChange={(e) => setDays(e.target.value)}
                  placeholder="Days"
                  aria-label="Days"
                  className="h-8 w-20 rounded-md border border-input-border bg-surface px-2 text-xs text-foreground"
                />
              )}
              {needsDocs && (
                <div className="w-full">
                  <p className="mb-1 text-[11px] font-medium text-muted-foreground">Required documents</p>
                  <div className="flex flex-wrap gap-x-3 gap-y-1">
                    {PAYMENT_DOCUMENT_OPTIONS.map((o) => (
                      <label key={o.value} className="inline-flex items-center gap-1 text-xs text-foreground">
                        <input
                          type="checkbox"
                          checked={docs.includes(o.value)}
                          onChange={(e) =>
                            setDocs((prev) =>
                              e.target.checked ? [...prev, o.value] : prev.filter((d) => d !== o.value)
                            )
                          }
                          className="h-3.5 w-3.5 accent-primary"
                        />
                        {o.label}
                      </label>
                    ))}
                  </div>
                </div>
              )}
              <button
                type="button"
                onClick={save}
                disabled={saving}
                className="inline-flex h-8 items-center gap-1 rounded-md bg-primary px-3 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary-hover disabled:opacity-60"
              >
                {saving && <Loader2 className="h-3 w-3 animate-spin" />}
                Save
              </button>
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  setError(null);
                }}
                aria-label="Cancel"
                className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-input-border text-muted-foreground transition-colors hover:bg-background"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="inline-flex h-7 items-center gap-1 rounded-md border border-input-border px-2 text-[11px] font-medium text-foreground transition-colors hover:bg-background"
          >
            <Plus className="h-3 w-3" />
            Add term
          </button>
        ))}
    </div>
  );
}

/**
 * The `fieldExtra` renderer for the Order details section: the terms list on
 * the Payment Terms field, nothing on any other.
 */
export function paymentTermsExtra(orderId: string, rows: Row[], canEdit: boolean) {
  return function render(field: OrderField) {
    if (field.column !== "payment_terms") return null;
    return <PaymentTermsControl orderId={orderId} rows={rows} canEdit={canEdit} />;
  };
}
