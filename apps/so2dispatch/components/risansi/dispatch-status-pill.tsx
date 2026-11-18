import { dispatchStatusHasReason } from "@/lib/order-schema";

type Row = Record<string, unknown>;
const numbered = (rows: unknown) =>
  Array.isArray(rows) && (rows as Row[]).some((r) => String(r?.packing_slip_no ?? "").trim() !== "");

/**
 * Dispatch has the SO: it has a numbered packing slip — on the SO's slips
 * (so_slips, so_child_rows, packing_slips) or any of its ECs' (child_rows).
 */
export function atDispatch(head: Row, ecs: Row[] = []): boolean {
  return (
    numbered(head.so_slips) ||
    numbered(head.so_child_rows) ||
    numbered(head.packing_slips) ||
    !!head.in_dispatch ||
    ecs.some((e) => numbered(e.child_rows))
  );
}

/** Before Dispatch has the SO: no status there yet. */
export function NotAtDispatch() {
  return <span className="whitespace-nowrap text-xs text-muted-foreground">Not at Dispatch yet</span>;
}

/** The SO's dispatch status as a coloured pill: Fully dispatch green, LOT dispatch blue, Pending amber. */
export function DispatchStatusPill({ status }: { status: unknown }) {
  const s = String(status ?? "").trim();
  if (!s) return <span className="text-muted-foreground">—</span>;
  const k = s.toLowerCase();
  const tone =
    k === "fully dispatch"
      ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300"
      : k.startsWith("lot dispatch")
        ? "bg-sky-100 text-sky-800 dark:bg-sky-500/15 dark:text-sky-300"
        : k === "hold"
          ? "bg-orange-100 text-orange-800 dark:bg-orange-500/15 dark:text-orange-300"
          : k === "pending"
          ? "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300"
          : "bg-slate-100 text-slate-600 dark:bg-white/10 dark:text-slate-300";
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${tone}`}>{s}</span>;
}

/**
 * The SO's dispatch status with, under it, why Dispatch set it by hand: a Hold
 * (its reason and remarks) or a Final lot pending (its free text). Takes the
 * SO's status, status_override and status_reason.
 */
export function DispatchStatusWithReason({
  status,
  override,
  reason,
}: {
  status: unknown;
  override: unknown;
  reason: unknown;
}) {
  const why = dispatchStatusHasReason(override) ? String(reason ?? "").trim() : "";
  const hold = String(override ?? "").trim() === "Hold";
  return (
    <>
      <DispatchStatusPill status={String(status ?? "").trim() || "Pending"} />
      {why && (
        <span
          className={`mt-1 block max-w-[16rem] whitespace-normal text-[11px] ${
            hold ? "text-orange-700 dark:text-orange-300" : "text-sky-700 dark:text-sky-300"
          }`}
        >
          {why}
        </span>
      )}
    </>
  );
}
