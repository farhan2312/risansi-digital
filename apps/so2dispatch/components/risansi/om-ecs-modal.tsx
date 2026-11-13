"use client";

import { EcLink } from "./ec-link";
import { Fragment, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Ban, Loader2, Pencil, Plus, Trash2, X } from "lucide-react";
import { cancelEcAction, ecBoiListAction, ecCancelCheckAction, listEcCancellationsAction } from "@/app/risansi/orders/actions";
import type { EcCancellation } from "@/lib/ec-cancel";
import { BoiStatusTag } from "./boi-detail-modal";
import { addOnFieldsFor, isOnlyBilling } from "@/lib/order-schema";
import { formatDisplay } from "./editable-section";

type Row = Record<string, unknown>;
const str = (v: unknown) => (v === null || v === undefined ? "" : String(v));

/**
 * An SO's ECs on Order Making, in a pop-up: every EC as a button, and the
 * one picked shown in full — its whole EC form (the Pump or Spare Add-On
 * fields, name plate and BOI included). Those who manage ECs add, edit and
 * delete them here.
 */
export function OmEcsModal({
  order,
  items,
  canManage,
  deletingId,
  onAdd,
  onEdit,
  onDelete,
  onClose,
  initialId,
  onCancelled,
}: {
  /** An EC was cancelled: read the ECs again (else the page is refreshed). */
  onCancelled?: () => void;
  /** The EC shown first (else the first EC). */
  initialId?: string;
  order: Row;
  items: Row[];
  canManage: boolean;
  deletingId: string | null;
  onAdd: () => void;
  onEdit: (item: Row) => void;
  onDelete: (item: Row) => void;
  onClose: () => void;
}) {
  const fields = addOnFieldsFor(str(order.order_type) || null);
  // The EC shown: the first until another is picked (and the first again if
  // the one picked is deleted).
  const [picked, setPicked] = useState<string | null>(initialId ?? null);
  const current = items.find((it) => str(it.id) === picked) ?? items[0] ?? null;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const soLabel = str(order.so_no) || `#${str(order.sl_no)}`;
  const isSpare = str(order.order_type) === "Spare";
  const router = useRouter();
  // The EC being cancelled (its dialog), and the SO's cancelled ECs below.
  const [cancelling, setCancelling] = useState<Row | null>(null);
  const [cancelled, setCancelled] = useState<EcCancellation[] | null>(null);
  const [cancelledVersion, setCancelledVersion] = useState(0);
  useEffect(() => {
    let live = true;
    listEcCancellationsAction(str(order.id))
      .then((r) => live && setCancelled(r))
      .catch(() => live && setCancelled([]));
    return () => {
      live = false;
    };
  }, [order.id, cancelledVersion]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`ECs of ${soLabel}`}
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-6"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="max-h-[90vh] w-full max-w-5xl overflow-y-auto rounded-t-2xl bg-surface p-5 shadow-xl sm:rounded-2xl"
      >
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-display text-lg font-semibold text-foreground">ECs · {soLabel}</h2>
            <p className="text-xs text-muted">
              {[str(order.client_name), str(order.order_type), `${items.length} EC${items.length === 1 ? "" : "s"}`]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {/* An Only Billing SO has no ECs. */}
            {canManage && !isOnlyBilling(order) && (
              <button
                type="button"
                onClick={onAdd}
                className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3 text-xs font-semibold text-primary-foreground hover:bg-primary-hover"
              >
                <Plus className="h-3.5 w-3.5" />
                {isSpare ? "Spare Add-On" : "Pump Add-On"}
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="rounded-lg p-1.5 text-muted transition-colors hover:bg-background hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {items.length === 0 || !current ? (
          <p className="rounded-xl border border-dashed border-card-border px-4 py-8 text-center text-sm text-muted">
            No ECs on this SO yet.
            {canManage ? ` Use ${isSpare ? "Spare" : "Pump"} Add-On to add one.` : ""}
          </p>
        ) : (
          <>
            {/* Every EC as a button; the one picked shows its details below. */}
            <div role="tablist" aria-label="ECs" className="mb-4 flex flex-wrap gap-2">
              {items.map((it) => {
                const id = str(it.id);
                const on = id === str(current.id);
                return (
                  <button
                    key={id}
                    type="button"
                    role="tab"
                    aria-selected={on}
                    onClick={() => setPicked(id)}
                    className={`inline-flex flex-col items-start rounded-lg border px-3 py-1.5 text-left transition-colors ${
                      on
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-input-border text-foreground hover:bg-background"
                    }`}
                  >
                    <span className="text-sm font-semibold">{str(it.ec_no) || "EC"}</span>
                    {(str(it.model_no) || str(it.quantity)) && (
                      <span className={`text-[11px] ${on ? "text-primary-foreground/80" : "text-muted"}`}>
                        {[str(it.model_no), str(it.quantity) && `Qty ${str(it.quantity)}`].filter(Boolean).join(" · ")}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            <section role="tabpanel" className="rounded-xl border border-card-border">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-card-border px-4 py-3">
                <span className="font-semibold text-foreground">
                  {str(current.ec_no) || "EC"}
                  <EcLink href={current.ec_link} at={current.ec_link_at} links={current.ec_links} />
                </span>
                {canManage && (
                  <span className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => onEdit(current)}
                      className="inline-flex h-8 items-center gap-1 rounded-lg border border-input-border px-2.5 text-xs font-medium text-foreground hover:bg-background"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                      Edit
                    </button>
                    {/* The client no longer wants it: cancelled and kept, not deleted. */}
                    <button
                      type="button"
                      onClick={() => setCancelling(current)}
                      className="inline-flex h-8 items-center gap-1 rounded-lg border border-amber-300 px-2.5 text-xs font-medium text-amber-800 hover:bg-amber-50 dark:border-amber-500/40 dark:text-amber-300 dark:hover:bg-amber-500/10"
                    >
                      <Ban className="h-3.5 w-3.5" />
                      Cancel EC
                    </button>
                    <button
                      type="button"
                      onClick={() => onDelete(current)}
                      disabled={deletingId === str(current.id)}
                      aria-label={`Delete ${str(current.ec_no) || "EC"}`}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-rose-200 text-rose-600 hover:bg-rose-50 disabled:opacity-50"
                    >
                      {deletingId === str(current.id) ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                    </button>
                  </span>
                )}
              </div>
              <dl className="grid grid-cols-1 gap-x-5 gap-y-3 px-4 py-3 sm:grid-cols-2 lg:grid-cols-4">
                {fields.map((f, i) => (
                  <Fragment key={f.column}>
                    {f.group && f.group !== fields[i - 1]?.group && (
                      <h3 className="col-span-full mt-1 border-t border-card-border pt-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        {f.group}
                      </h3>
                    )}
                    <div className="text-sm">
                      <dt className="text-[12px] text-muted">{f.label}</dt>
                      <dd className="break-all font-medium text-foreground">
                        {f.column === "ec_link" ? (
                          str(current.ec_link) ? <EcLink href={current.ec_link} at={current.ec_link_at} links={current.ec_links} label /> : "—"
                        ) : (
                          formatDisplay(f, current[f.column]) || "—"
                        )}
                      </dd>
                    </div>
                  </Fragment>
                ))}
              </dl>
              {str(current.boi) === "Yes" && <EcBoiList itemId={str(current.id)} />}
            </section>
          </>
        )}
        {cancelled && cancelled.length > 0 && <CancelledEcs rows={cancelled} />}
        {cancelling && (
          <CancelEcDialog
            item={cancelling}
            soLabel={soLabel}
            onClose={() => setCancelling(null)}
            onDone={() => {
              setCancelling(null);
              setCancelledVersion((v) => v + 1);
              if (onCancelled) onCancelled();
              else router.refresh();
            }}
          />
        )}
      </div>
    </div>
  );
}

/** The EC's bought-out items, a row each with where it stands. */
function EcBoiList({ itemId }: { itemId: string }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  useEffect(() => {
    let live = true;
    ecBoiListAction(itemId)
      .then((r) => live && setRows(r))
      .catch(() => live && setRows([]));
    return () => {
      live = false;
    };
  }, [itemId]);
  return (
    <div className="border-t border-card-border px-4 py-3">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        BOI items{rows ? ` · ${rows.length}` : ""}
      </h3>
      {rows === null ? (
        <p className="flex items-center gap-2 text-sm text-muted">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…
        </p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted">No BOI items listed.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                <th className="py-1.5 pr-3">Item</th>
                <th className="py-1.5 pr-3">Make</th>
                <th className="py-1.5 pr-3">Qty</th>
                <th className="py-1.5 pr-3">Description</th>
                <th className="py-1.5">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((b) => (
                <tr key={str(b.id)} className="border-t border-card-border align-top text-foreground">
                  <td className="py-1.5 pr-3 font-medium">
                    {str(b.boi_item) === "Others" ? str(b.boi_item_other) || "Others" : str(b.boi_item) || "—"}
                  </td>
                  <td className="py-1.5 pr-3">{str(b.boi_make) || "—"}</td>
                  <td className="py-1.5 pr-3 tabular-nums">{str(b.boi_qty) || "—"}</td>
                  <td className="py-1.5 pr-3 text-muted">{str(b.boi_description) || "—"}</td>
                  <td className="py-1.5">
                    <BoiStatusTag item={b} small />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const DISPOSITION_OPTIONS = ["Keep as stock", "Dismantle / reuse", "Divert to another SO"];

/**
 * Cancel an EC the client no longer wants: the reason, and when it is packed,
 * what happens to the packed goods. Refused while it is on a slip or invoiced.
 */
function CancelEcDialog({ item, soLabel, onClose, onDone }: { item: Row; soLabel: string; onClose: () => void; onDone: () => void }) {
  const ec = str(item.ec_no) || "this EC";
  const [check, setCheck] = useState<{ blocked: string | null; packed: boolean } | null>(null);
  const [reason, setReason] = useState("");
  const [disposition, setDisposition] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    ecCancelCheckAction(str(item.id))
      .then((r) => live && setCheck({ blocked: r.blocked, packed: r.packed }))
      .catch(() => live && setCheck({ blocked: "Could not check the EC.", packed: false }));
    return () => {
      live = false;
    };
  }, [item.id]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!reason.trim()) return setError("Give the reason the client cancelled it.");
    if (check?.packed && !disposition) return setError("Say what happens to the packed goods.");
    setBusy(true);
    setError(null);
    const res = await cancelEcAction({ itemId: str(item.id), reason, disposition: disposition || null, dispositionNote: note || null });
    setBusy(false);
    if (!res.ok) setError(res.error);
    else onDone();
  }

  return (
    <div role="dialog" aria-modal="true" aria-label={`Cancel ${ec}`} className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <form onClick={(e) => e.stopPropagation()} onSubmit={submit} className="w-full max-w-md rounded-2xl bg-surface p-5 shadow-xl">
        <h3 className="font-display text-base font-semibold text-foreground">Cancel {ec}</h3>
        <p className="mt-0.5 text-xs text-muted">SO {soLabel} · the client no longer wants it</p>
        {!check ? (
          <p className="mt-4 flex items-center gap-2 text-sm text-muted">
            <Loader2 className="h-4 w-4 animate-spin" /> Checking…
          </p>
        ) : check.blocked ? (
          <p className="mt-4 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-500/10 dark:text-rose-300">{check.blocked}</p>
        ) : (
          <div className="mt-4 space-y-3">
            <label className="block text-sm">
              <span className="text-[12px] font-medium text-muted">Reason</span>
              <textarea
                value={reason}
                onChange={(e) => {
                  setReason(e.target.value);
                  setError(null);
                }}
                rows={2}
                className="mt-1 w-full rounded-lg border border-input-border bg-background px-3 py-2 text-sm text-foreground"
              />
            </label>
            {check.packed && (
              <>
                <label className="block text-sm">
                  <span className="text-[12px] font-medium text-muted">It is packed: what happens to the packed goods</span>
                  <select
                    value={disposition}
                    onChange={(e) => {
                      setDisposition(e.target.value);
                      setError(null);
                    }}
                    className="mt-1 h-9 w-full rounded-lg border border-input-border bg-background px-2 text-sm text-foreground"
                  >
                    <option value="">Choose…</option>
                    {DISPOSITION_OPTIONS.map((o) => (
                      <option key={o} value={o}>
                        {o}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block text-sm">
                  <span className="text-[12px] font-medium text-muted">Note (which SO, where it is kept…)</span>
                  <input value={note} onChange={(e) => setNote(e.target.value)} className="mt-1 h-9 w-full rounded-lg border border-input-border bg-background px-3 text-sm text-foreground" />
                </label>
              </>
            )}
            <p className="text-[11px] text-muted">
              Every department drops it and is told; Purchase cancels its open POs. It stays listed as cancelled. Lower the SO&apos;s quantity
              and value in Order Making if they change.
            </p>
          </div>
        )}
        {error && <p className="mt-3 text-sm text-danger">{error}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="inline-flex h-9 items-center rounded-lg border border-input-border px-4 text-sm font-medium text-foreground hover:bg-background">
            Close
          </button>
          {check && !check.blocked && (
            <button
              type="submit"
              disabled={busy}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-amber-600 px-4 text-sm font-semibold text-white hover:bg-amber-700 disabled:opacity-60"
            >
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              Cancel {ec}
            </button>
          )}
        </div>
      </form>
    </div>
  );
}

/** The SO's cancelled ECs: what, why, when, by whom, and the packed goods. */
function CancelledEcs({ rows }: { rows: EcCancellation[] }) {
  const day = (v: string) => new Date(v).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
  return (
    <section className="mt-4 rounded-xl border border-card-border">
      <h3 className="border-b border-card-border px-4 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Cancelled by client · {rows.length}
      </h3>
      <ul className="divide-y divide-card-border">
        {rows.map((r) => (
          <li key={r.id} className="px-4 py-2 text-sm">
            <div className="flex flex-wrap items-baseline gap-x-2">
              <span className="font-semibold text-muted line-through">{r.ec_no ?? "EC"}</span>
              <span className="text-xs text-muted">{[r.model_no, r.quantity != null ? `Qty ${r.quantity}` : "", r.version_no ? `v${r.version_no}` : ""].filter(Boolean).join(" · ")}</span>
            </div>
            <div className="text-foreground">{r.reason}</div>
            {r.was_packed && (
              <div className="text-xs text-amber-800 dark:text-amber-300">
                Packed goods: {r.disposition ?? "—"}
                {r.disposition_note ? ` · ${r.disposition_note}` : ""}
              </div>
            )}
            <div className="text-[11px] text-muted">
              {day(r.cancelled_at)}
              {r.cancelled_by_name ? ` · ${r.cancelled_by_name}` : ""}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
