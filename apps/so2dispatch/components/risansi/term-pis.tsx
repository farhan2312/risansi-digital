"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { IndianRupee, Link2, Loader2, Pencil, Plus, Trash2, X } from "lucide-react";
import {
  deleteOrderChildAction,
  linkPiAction,
  savePiAction,
  savePiPaymentAction,
} from "@/app/risansi/orders/actions";
import { PAYMENT_HOLD_VALUE, PAYMENT_STATUS_OPTIONS } from "@/lib/order-schema";

type Row = Record<string, unknown>;

const str = (v: unknown) => (v === null || v === undefined ? "" : String(v).trim());
const money = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 });

function day(v: unknown): string {
  const s = str(v).slice(0, 10);
  if (!s) return "";
  const d = new Date(`${s}T00:00:00Z`);
  return Number.isNaN(d.getTime())
    ? s
    : d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
}

/** "30% Advance Against ABG · 45 days" — the term line as it reads. */
function termLabel(t: Row): string {
  const pct = str(t.percent);
  return [
    [pct ? `${Number(pct)}%` : "", str(t.term) || "—"].filter(Boolean).join(" "),
    str(t.days) ? `${str(t.days)} days` : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

/**
 * Billing's view of an SO's payment terms, on the queue row itself: each
 * term line with the one PI raised against
 * it — or "+ PI" to raise it. With no terms there is nothing to raise a PI
 * against. PIs not tied to a line (an SO without terms, or
 * older ones) sit below, and can be linked to a free line.
 */
export function TermPis({
  orderId,
  soLabel,
  terms,
  pis,
  canEdit,
  payments,
}: {
  orderId: string;
  soLabel: string;
  terms: Row[];
  pis: Row[];
  canEdit: boolean;
  payments?: { canEdit: boolean };
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<{ pi: Row | null; termId: string | null; label: string } | null>(null);
  // The line being paid: a PI, or a term line with no PI yet (termId set).
  const [paying, setPaying] = useState<{ pi: Row; label: string; termId?: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const piFor = new Map(pis.filter((p) => str(p.payment_term_id)).map((p) => [str(p.payment_term_id), p]));
  const unlinked = pis.filter((p) => !str(p.payment_term_id) || !terms.some((t) => str(t.id) === str(p.payment_term_id)));
  const freeTerms = terms.filter((t) => !piFor.has(str(t.id)));

  async function remove(pi: Row) {
    if (!confirm(`Delete PI ${str(pi.pi_no) || "(blank)"}?`)) return;
    setBusy(str(pi.id));
    setError(null);
    const res = await deleteOrderChildAction(str(pi.id), "order_billing_docs", orderId);
    setBusy(null);
    if (!res.ok) setError(res.error);
    else router.refresh();
  }

  async function link(pi: Row, termId: string) {
    setBusy(str(pi.id));
    setError(null);
    const res = await linkPiAction(orderId, str(pi.id), termId || null);
    setBusy(null);
    if (!res.ok) setError(res.error);
    else router.refresh();
  }

  // The PI's own cells, the same on a term line and on an unlinked PI.
  const piCells = (pi: Row | null, termId: string | null, label: string, term?: Row) =>
    pi ? (
      <>
        <td className="py-1.5 pr-1.5 font-medium text-foreground break-words">{str(pi.pi_no) || "—"}</td>
        <td className="py-1.5 pr-1.5 text-muted whitespace-nowrap">{day(pi.pi_date) || "—"}</td>
        <td className="py-1.5 pr-1.5 text-right tabular-nums text-foreground whitespace-nowrap">
          {str(pi.pi_value) ? `₹${money.format(Number(pi.pi_value))}` : "—"}
        </td>
        {payments && (
          <td className="py-1.5 pl-2 pr-1.5">
            <PaymentCell pi={pi} />
          </td>
        )}
        <td className="py-1.5 text-right whitespace-nowrap">
          {payments?.canEdit && (
            <button
              type="button"
              onClick={() => setPaying({ pi, label })}
              aria-label={`Record payment for PI ${str(pi.pi_no)}`}
              title="Record payment"
              className="inline-flex h-6 items-center gap-0.5 rounded-md border border-input-border px-1.5 text-[11px] font-medium text-foreground hover:bg-background"
            >
              <IndianRupee className="h-3 w-3" />
              {str(pi.pi_payment_status) || str(pi.pi_amount_received) ? "Edit" : "Pay"}
            </button>
          )}
          {canEdit && (
            <span className="inline-flex items-center gap-0.5">
              <button
                type="button"
                onClick={() => setEditing({ pi, termId, label })}
                aria-label="Edit PI"
                title="Edit PI"
                className="rounded p-0.5 text-muted-foreground hover:bg-background hover:text-foreground"
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => remove(pi)}
                disabled={busy === str(pi.id)}
                aria-label="Delete PI"
                title="Delete PI"
                className="rounded p-0.5 text-rose-500 hover:bg-rose-50 disabled:opacity-50"
              >
                {busy === str(pi.id) ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
              </button>
            </span>
          )}
        </td>
      </>
    ) : payments && term ? (
      // Accounts: no PI on this term yet — the payment can still be recorded
      // against the term line; it moves onto the PI once Billing raises it.
      <>
        <td colSpan={3} className="py-1.5 pr-1.5">
          {canEdit ? (
            <button
              type="button"
              onClick={() => setEditing({ pi: null, termId, label })}
              className="inline-flex h-6 items-center gap-1 rounded-md border border-primary/40 px-2 text-[11px] font-semibold text-primary transition-colors hover:bg-primary/5"
            >
              <Plus className="h-3 w-3" />
              PI
            </button>
          ) : (
            <span className="text-muted">No PI yet</span>
          )}
        </td>
        <td className="py-1.5 pl-2 pr-1.5">
          <PaymentCell pi={termAsLine(term)} />
        </td>
        <td className="py-1.5 text-right whitespace-nowrap">
          {payments.canEdit && (
            <button
              type="button"
              onClick={() => setPaying({ pi: termAsLine(term), label, termId: str(term.id) })}
              aria-label={`Record payment for ${label}`}
              title="Record payment against this term"
              className="inline-flex h-6 items-center gap-0.5 rounded-md border border-input-border px-1.5 text-[11px] font-medium text-foreground hover:bg-background"
            >
              <IndianRupee className="h-3 w-3" />
              {str(term.term_payment_status) || str(term.term_amount_received) ? "Edit" : "Pay"}
            </button>
          )}
        </td>
      </>
    ) : (
      <td colSpan={payments ? 5 : 4} className="py-1.5">
        {canEdit ? (
          <button
            type="button"
            onClick={() => setEditing({ pi: null, termId, label })}
            className="inline-flex h-6 items-center gap-1 rounded-md border border-primary/40 px-2 text-[11px] font-semibold text-primary transition-colors hover:bg-primary/5"
          >
            <Plus className="h-3 w-3" />
            PI
          </button>
        ) : (
          <span className="text-muted">No PI yet</span>
        )}
      </td>
    );

  return (
    <div className={payments ? "w-[40rem]" : "w-[28.5rem]"}>
      {terms.length === 0 && unlinked.length === 0 ? (
        <span className="text-xs text-muted">No payment terms yet</span>
      ) : (
        // A small table: the term, then its PI's number, date and value in
        // their own columns, so the lines read straight down.
        // Fixed column widths, so the PI columns line up from one SO's row
        // to the next instead of each table sizing itself to its contents.
        <table className="w-full table-fixed text-xs">
          <colgroup>
            <col className="w-[10.5rem]" />
            <col className="w-[7rem]" />
            <col className="w-[5rem]" />
            <col className="w-[3.75rem]" />
            {payments && <col className="w-[9.5rem]" />}
            <col className={payments ? "w-[3.5rem]" : "w-[2.25rem]"} />
          </colgroup>
          <thead>
            <tr className="text-left text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              <th className="pb-1 pl-1.5 pr-1.5 font-semibold whitespace-nowrap">Term</th>
              <th className="pb-1 pr-1.5 font-semibold whitespace-nowrap">PI No.</th>
              <th className="pb-1 pr-1.5 font-semibold whitespace-nowrap">PI Date</th>
              <th className="pb-1 pr-1.5 text-right font-semibold whitespace-nowrap">PI Value</th>
              {payments && <th className="pb-1 pl-2 pr-1.5 font-semibold whitespace-nowrap">Payment</th>}
              <th className="pb-1" />
            </tr>
          </thead>
          <tbody className="[&>tr:nth-child(odd)]:bg-slate-100/70 dark:[&>tr:nth-child(odd)]:bg-white/[0.04]">
            {terms.length === 0 && (
              <tr>
                <td colSpan={payments ? 6 : 5} className="py-1.5 text-muted">No payment terms yet</td>
              </tr>
            )}
            {terms.map((t) => {
              const pi = piFor.get(str(t.id)) ?? null;
              return (
                <tr key={str(t.id)} className="align-top">
                  <td className="rounded-l-md py-1.5 pl-1.5 pr-1.5 text-foreground">
                    {termLabel(t)}
                    {str(t.documents) && <span className="block text-[11px] text-muted">Docs: {str(t.documents)}</span>}
                  </td>
                  {piCells(pi, str(t.id), termLabel(t), t)}
                </tr>
              );
            })}
            {/* PIs not against a term line: an SO without terms, or older PIs. */}
            {unlinked.map((pi) => (
              <tr key={str(pi.id)} className="align-top">
                <td className="rounded-l-md py-1.5 pl-1.5 pr-1.5">
                  <span className="text-[11px] italic text-muted">Not linked to a term</span>
                  {canEdit && freeTerms.length > 0 && (
                    <label className="mt-0.5 flex items-center gap-1 text-[11px] text-muted">
                      <Link2 className="h-3 w-3" />
                      <select
                        value=""
                        onChange={(e) => e.target.value && link(pi, e.target.value)}
                        disabled={busy === str(pi.id)}
                        aria-label="Link to a payment term"
                        className="h-6 rounded border border-input-border bg-surface px-1 text-[11px] text-foreground"
                      >
                        <option value="">Link to…</option>
                        {freeTerms.map((t) => (
                          <option key={str(t.id)} value={str(t.id)}>
                            {termLabel(t)}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                </td>
                {piCells(pi, null, "PI")}
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {error && <p className="text-[11px] text-danger">{error}</p>}

      {paying && (
        <PaymentForm
          orderId={orderId}
          soLabel={soLabel}
          termLabel={paying.label}
          pi={paying.pi}
          termId={paying.termId}
          onClose={() => setPaying(null)}
        />
      )}
      {editing && (
        <PiForm
          orderId={orderId}
          soLabel={soLabel}
          termLabel={editing.label}
          termId={editing.termId}
          pi={editing.pi}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

/** Raise or edit one PI: its number, date and value (the value starts blank). */
function PiForm({
  orderId,
  soLabel,
  termLabel: label,
  termId,
  pi,
  onClose,
}: {
  orderId: string;
  soLabel: string;
  termLabel: string;
  termId: string | null;
  pi: Row | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const [piNo, setPiNo] = useState(str(pi?.pi_no));
  const [piDate, setPiDate] = useState(str(pi?.pi_date).slice(0, 10));
  const [piValue, setPiValue] = useState(str(pi?.pi_value));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !saving && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [saving, onClose]);

  async function save(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const res = await savePiAction(orderId, {
      piId: pi ? str(pi.id) : null,
      termId,
      pi_no: piNo,
      pi_date: piDate,
      pi_value: piValue,
    });
    setSaving(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    router.refresh();
    onClose();
  }

  const input =
    "h-10 w-full rounded-[10px] border border-input-border bg-surface px-3 text-[14px] text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-ring/20";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={pi ? "Edit PI" : "New PI"}
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-6"
      onClick={() => !saving && onClose()}
    >
      <form
        onSubmit={save}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-t-2xl bg-surface p-5 shadow-xl sm:rounded-2xl"
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="font-display text-lg font-semibold text-foreground">{pi ? "Edit PI" : "New PI"}</h2>
            <p className="text-xs text-muted">
              SO {soLabel} · {label}
            </p>
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
        <div className="space-y-3">
          <label className="block text-sm">
            <span className="mb-1 block text-[13px] font-medium text-brand-label">
              PI No. <span className="text-danger">*</span>
            </span>
            <input value={piNo} onChange={(e) => setPiNo(e.target.value)} className={input} autoFocus />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-[13px] font-medium text-brand-label">PI Date</span>
            <input type="date" value={piDate} onChange={(e) => setPiDate(e.target.value)} className={input} />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-[13px] font-medium text-brand-label">PI Value</span>
            <input
              type="number"
              step="any"
              min={0}
              value={piValue}
              onChange={(e) => setPiValue(e.target.value)}
              className={input}
            />
          </label>
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
            {pi ? "Save" : "Create PI"}
          </button>
        </div>
      </form>
    </div>
  );
}

/** A PI's payment as the row reads it: its status, then what came in and when. */
function PaymentCell({ pi }: { pi: Row }) {
  const status = str(pi.pi_payment_status);
  const amount = str(pi.pi_amount_received);
  const date = day(pi.pi_confirmed_date);
  if (!status && !amount && !date) return <span className="text-muted-foreground">—</span>;
  const tone =
    status === PAYMENT_HOLD_VALUE
      ? "bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:text-rose-300"
      : status === "Payment Rcvd"
        ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300"
        : status.startsWith("Advance")
          ? "bg-amber-50 text-amber-800 dark:bg-amber-500/10 dark:text-amber-300"
          : "bg-slate-100 text-slate-600 dark:bg-white/10 dark:text-slate-300";
  return (
    <div className="min-w-0">
      {status && (
        <span className={`inline-block max-w-full truncate rounded-full px-1.5 py-px text-[10.5px] font-semibold ${tone}`} title={status}>
          {status}
        </span>
      )}
      {(amount || date) && (
        <div className="mt-0.5 truncate text-[11px] text-muted">
          {[amount && `₹${money.format(Number(amount))}`, date].filter(Boolean).join(" · ")}
        </div>
      )}
      {status === PAYMENT_HOLD_VALUE && str(pi.pi_hold_reason) && (
        <div className="truncate text-[11px] text-rose-600" title={str(pi.pi_hold_reason)}>
          {str(pi.pi_hold_reason)}
        </div>
      )}
    </div>
  );
}

/** A term line's payment, read the way a PI's is. */
function termAsLine(t: Row): Row {
  return {
    id: t.id,
    pi_payment_status: t.term_payment_status,
    pi_confirmed_date: t.term_confirmed_date,
    pi_amount_received: t.term_amount_received,
    pi_hold_reason: t.term_hold_reason,
  };
}

/** Accounts records the payment against one PI, or a term line with no PI yet. */
function PaymentForm({
  orderId,
  soLabel,
  termLabel: label,
  pi,
  termId,
  onClose,
}: {
  orderId: string;
  soLabel: string;
  termLabel: string;
  pi: Row;
  termId?: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [status, setStatus] = useState(str(pi.pi_payment_status));
  const [date, setDate] = useState(str(pi.pi_confirmed_date).slice(0, 10));
  const [amount, setAmount] = useState(str(pi.pi_amount_received));
  const [reason, setReason] = useState(str(pi.pi_hold_reason));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !saving && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [saving, onClose]);

  async function save(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const res = await savePiPaymentAction(orderId, termId ? { termId } : { piId: str(pi.id) }, {
      payment_status: status,
      confirmed_date: date,
      amount_received: amount,
      hold_reason: reason,
    });
    setSaving(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    router.refresh();
    onClose();
  }

  const input =
    "h-10 w-full rounded-[10px] border border-input-border bg-surface px-3 text-[14px] text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-ring/20";
  const piValue = str(pi.pi_value);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Record payment"
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-6"
      onClick={() => !saving && onClose()}
    >
      <form
        onSubmit={save}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-t-2xl bg-surface p-5 shadow-xl sm:rounded-2xl"
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="font-display text-lg font-semibold text-foreground">
              {termId ? "Payment · no PI yet" : `Payment · PI ${str(pi.pi_no) || "—"}`}
            </h2>
            <p className="text-xs text-muted">
              SO {soLabel} · {label}
              {piValue && <> · PI value ₹{money.format(Number(piValue))}</>}
            </p>
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
        <div className="space-y-3">
          <label className="block text-sm">
            <span className="mb-1 block text-[13px] font-medium text-brand-label">Payment Status</span>
            <select value={status} onChange={(e) => setStatus(e.target.value)} className={input} autoFocus>
              <option value="">—</option>
              {PAYMENT_STATUS_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          {status === PAYMENT_HOLD_VALUE && (
            <label className="block text-sm">
              <span className="mb-1 block text-[13px] font-medium text-brand-label">
                Hold Reason <span className="text-danger">*</span>
              </span>
              <input value={reason} onChange={(e) => setReason(e.target.value)} className={input} />
            </label>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm">
              <span className="mb-1 block text-[13px] font-medium text-brand-label">Amount Received</span>
              <input type="number" step="any" min={0} value={amount} onChange={(e) => setAmount(e.target.value)} className={input} />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block text-[13px] font-medium text-brand-label">Payment Confirmed Date</span>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={input} />
            </label>
          </div>
          <p className="text-[11px] text-muted">The SO&apos;s Amount Received, Balance and Payment Status are worked out from its PIs.</p>
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
            Save
          </button>
        </div>
      </form>
    </div>
  );
}
