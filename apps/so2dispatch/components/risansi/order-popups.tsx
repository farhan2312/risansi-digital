"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Loader2, X } from "lucide-react";
import { getOrderQuickViewAction, updateOrderSectionAction } from "@/app/risansi/orders/actions";
import type { ItemDetail, OrderDetail } from "@/lib/orders";
import type { TargetRevision } from "@/lib/target-dates";
import { CLEARANCE_HOLD_REASONS } from "@/lib/order-schema";
import { DeptPopup, SO_WIDE, type DeptKey } from "./ec-dept-grid";
import { SoSections } from "./so-sections";

type Row = Record<string, unknown>;
type Data = { detail: OrderDetail; items: ItemDetail[]; targetRevisions: TargetRevision[] };

const str = (v: unknown) => (v === null || v === undefined ? "" : String(v).trim());

/** What a pop-up opened from an Orders-list row shows. */
export type PopupKind =
  | { kind: "so"; section: "orders" | "order_billing" | "order_accounts" | "order_dispatch"; title: string }
  | { kind: "ec"; dept: DeptKey };

/**
 * The one pop-up open on the Orders list: an SO section (Order details,
 * Dispatch, …) or an EC department (Planning, Assembly & Packing, …), editable
 * there. It reads the order when it opens, and again when the list refreshes
 * after a save. A Spare SO's Planning and Packing save to all its ECs.
 */
export function OrderPopupHost({
  orderId,
  soLabel,
  role,
  what,
  version,
  onClose,
}: {
  orderId: string;
  soLabel: string;
  role: string;
  what: PopupKind;
  // Changes when the list's data is refreshed — the cue to read again.
  version: unknown;
  onClose: () => void;
}) {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    getOrderQuickViewAction(orderId).then((res) => {
      if (!live) return;
      if (res.ok) setData({ detail: res.detail, items: res.items, targetRevisions: res.targetRevisions });
      else setError(res.error);
    });
    return () => {
      live = false;
    };
  }, [orderId, version]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (!data) {
    return (
      <Shell title={what.kind === "so" ? what.title : "Loading…"} soLabel={soLabel} onClose={onClose}>
        {error ? (
          <p className="text-sm text-danger">{error}</p>
        ) : (
          <p className="flex items-center gap-2 text-sm text-muted">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading the order…
          </p>
        )}
      </Shell>
    );
  }

  if (what.kind === "ec") {
    if (data.items.length === 0) {
      return (
        <Shell title="No ECs yet" soLabel={soLabel} onClose={onClose}>
          <p className="text-sm text-muted">This SO has no ECs yet — add one with the Add-On button.</p>
        </Shell>
      );
    }
    const allSpare = data.items.every((e) => str(e.item.item_type).toLowerCase() === "spare");
    return (
      <DeptPopup
        orderId={orderId}
        role={role}
        dept={what.dept}
        soWide={allSpare && SO_WIDE.includes(what.dept)}
        entries={data.items}
        onClose={onClose}
        extra={
          what.dept === "assembly" ? (
            <SoSections
              detail={data.detail}
              orderId={orderId}
              role={role}
              targetRevisions={data.targetRevisions}
              only="order_packing_slips"
            />
          ) : undefined
        }
      />
    );
  }

  return (
    <Shell
      title={what.title}
      soLabel={`${soLabel}${str(data.detail.order.client_name) ? ` · ${str(data.detail.order.client_name)}` : ""}`}
      onClose={onClose}
    >
      <div className="space-y-6">
        <SoSections
          detail={data.detail}
          orderId={orderId}
          role={role}
          targetRevisions={data.targetRevisions}
          only={what.section}
        />
      </div>
    </Shell>
  );
}

function Shell({
  title,
  soLabel,
  onClose,
  children,
}: {
  title: string;
  soLabel: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-6"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="max-h-[92vh] w-full max-w-4xl overflow-y-auto rounded-t-2xl bg-background p-5 text-left shadow-xl sm:rounded-2xl"
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="font-display text-lg font-semibold text-foreground">{title}</h2>
            <p className="text-xs text-muted">SO {soLabel}</p>
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
        {children}
      </div>
    </div>
  );
}

/**
 * Central's clearance on an SO, as a badge on its row: Clear or On hold (with
 * the reason). A click opens a small pop-up to change it — Clear, or Hold with
 * a reason and remarks. Every department sees the hold.
 */
export function ClearanceBadge({ order, readOnly = false }: { order: Row; readOnly?: boolean }) {
  const [open, setOpen] = useState(false);
  const held = str(order.clearance_status) === "Hold";
  return (
    <>
      <button
        type="button"
        // A Rep reads the clearance; only Central changes it.
        disabled={readOnly}
        onClick={() => setOpen(true)}
        title={held ? `On hold — ${str(order.clearance_hold_reason)}. Click to change.` : "Clear. Click to put on hold."}
        className={`mt-1 flex w-fit max-w-[12rem] flex-col rounded-md px-1.5 py-0.5 text-left text-[11px] leading-tight transition-opacity enabled:hover:opacity-80 disabled:cursor-default ${
          held
            ? "bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:text-rose-300"
            : "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300"
        }`}
      >
        <span className="font-semibold">{held ? "On hold" : "Clear"}</span>
        {held && str(order.clearance_hold_reason) && <span className="whitespace-normal">{str(order.clearance_hold_reason)}</span>}
      </button>
      {open && <ClearanceForm order={order} onClose={() => setOpen(false)} />}
    </>
  );
}

function ClearanceForm({ order, onClose }: { order: Row; onClose: () => void }) {
  const router = useRouter();
  const [status, setStatus] = useState(str(order.clearance_status) === "Hold" ? "Hold" : "Clear");
  const [reason, setReason] = useState(str(order.clearance_hold_reason));
  const [remarks, setRemarks] = useState(str(order.clearance_remarks));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !saving && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [saving, onClose]);

  async function save(e: FormEvent) {
    e.preventDefault();
    if (status === "Hold" && !reason) {
      setError("Choose a hold reason.");
      return;
    }
    setSaving(true);
    setError(null);
    const res = await updateOrderSectionAction(str(order.id), "orders", {
      clearance_status: status,
      clearance_hold_reason: status === "Hold" ? reason : "",
      clearance_remarks: status === "Hold" ? remarks : "",
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
  const choice = (on: boolean, tone: "rose" | "emerald") =>
    `flex-1 rounded-lg border px-3 py-2 text-sm font-semibold transition-colors ${
      on
        ? tone === "rose"
          ? "border-rose-400 bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:text-rose-300"
          : "border-emerald-400 bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300"
        : "border-input-border text-muted hover:bg-background"
    }`;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Clearance"
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-6"
      onClick={() => !saving && onClose()}
    >
      <form
        onSubmit={save}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-t-2xl bg-surface p-5 text-left shadow-xl sm:rounded-2xl"
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="font-display text-lg font-semibold text-foreground">Clearance</h2>
            <p className="text-xs text-muted">SO {str(order.so_no) || str(order.sl_no)} · every department sees a hold and its reason</p>
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
          <div className="flex gap-2">
            <button type="button" onClick={() => setStatus("Clear")} className={choice(status === "Clear", "emerald")}>
              Clear
            </button>
            <button type="button" onClick={() => setStatus("Hold")} className={choice(status === "Hold", "rose")}>
              Hold
            </button>
          </div>
          {status === "Hold" && (
            <>
              <label className="block text-sm">
                <span className="mb-1 block text-[13px] font-medium text-brand-label">
                  Hold Reason <span className="text-danger">*</span>
                </span>
                <select value={reason} onChange={(e) => setReason(e.target.value)} className={input}>
                  <option value="">Choose a reason</option>
                  {[...new Set([...CLEARANCE_HOLD_REASONS.map((o) => o.value), ...(reason ? [reason] : [])])].map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-sm">
                <span className="mb-1 block text-[13px] font-medium text-brand-label">Remarks</span>
                <textarea
                  value={remarks}
                  onChange={(e) => setRemarks(e.target.value)}
                  rows={3}
                  className="w-full rounded-[10px] border border-input-border bg-surface px-3 py-2 text-[14px] text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-ring/20"
                />
              </label>
            </>
          )}
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
