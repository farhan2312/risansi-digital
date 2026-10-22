"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { History, Loader2, Pencil } from "lucide-react";
import {
  drawingReadinessHistoryAction,
  setDrawingReadinessAction,
  type ReadinessEntry,
} from "@/app/risansi/orders/drawing-readiness-actions";

function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(`${value.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
}

function shift(from: string | null, to: string | null): number | null {
  if (!from || !to) return null;
  return Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);
}

/**
 * Drawing's readiness date for an SO, with every value it has held. Drawing
 * sets it here; a change after the first needs its reason.
 */
export function DrawingReadinessCell({
  orderId,
  value,
  canEdit,
}: {
  orderId: string;
  value: unknown;
  canEdit: boolean;
}) {
  const router = useRouter();
  const current = value == null ? "" : String(value).slice(0, 10);
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<ReadinessEntry[] | null>(null);
  const [date, setDate] = useState(current);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const wrapRef = useRef<HTMLSpanElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  // Fixed to the screen beside the button: the table scrolls sideways and
  // would clip a pop-up hung inside it.
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      const t = e.target as Node;
      if (!wrapRef.current?.contains(t) && !popRef.current?.contains(t)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    // The page (or the table) scrolling moves the button away from the pop-up.
    function onScroll(e: Event) {
      if (!popRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
  }, [open]);

  async function toggle() {
    if (open) return setOpen(false);
    const r = wrapRef.current?.getBoundingClientRect();
    if (r) {
      const width = 288;
      const left = Math.max(8, Math.min(r.left, window.innerWidth - width - 8));
      // Below the date, or above it when there is no room underneath.
      const below = window.innerHeight - r.bottom > 340;
      setPos({ top: below ? r.bottom + 6 : Math.max(8, r.top - 346), left });
    }
    setOpen(true);
    setDate(current);
    setReason("");
    setError(null);
    setRows(null);
    const res = await drawingReadinessHistoryAction(orderId);
    setRows(res.ok ? res.rows : []);
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    if (current && date !== current && !reason.trim()) {
      setError("Say why the date is changing.");
      return;
    }
    setSaving(true);
    setError(null);
    const res = await setDrawingReadinessAction(orderId, date, reason);
    setSaving(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setOpen(false);
    router.refresh();
  }

  const moves = rows ? Math.max(rows.length - 1, 0) : 0;

  return (
    <span ref={wrapRef} className="relative inline-flex items-center gap-1">
      <span className={current ? "font-medium text-foreground" : "text-muted"}>{formatDate(current)}</span>
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-label={canEdit ? "Set readiness date" : "Readiness date history"}
        title={canEdit ? "Set the readiness date, see its history" : "Readiness date history"}
        className="inline-flex h-5 w-5 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
      >
        {canEdit ? <Pencil className="h-3 w-3" /> : <History className="h-3 w-3" />}
      </button>

      {open && (
        <div
          ref={popRef}
          role="dialog"
          aria-label="Drawing readiness"
          style={pos ? { top: pos.top, left: pos.left } : undefined}
          className="fixed z-50 max-h-[340px] w-72 overflow-y-auto whitespace-normal rounded-xl border border-card-border bg-surface p-3 text-left shadow-xl"
        >
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Drawing readiness
            {moves > 0 && <span className="ml-1 font-normal normal-case text-amber-700">· moved {moves}×</span>}
          </p>
          {canEdit && (
            <form onSubmit={save} className="mb-3 space-y-2">
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="h-9 w-full rounded-lg border border-input-border bg-surface px-2.5 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-ring/20"
              />
              {current && date !== current && (
                <input
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Why is it changing?"
                  className="h-9 w-full rounded-lg border border-input-border bg-surface px-2.5 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-ring/20"
                />
              )}
              {error && <p className="text-xs text-rose-600">{error}</p>}
              <button
                type="submit"
                disabled={saving || date === current}
                className="inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-lg bg-primary text-xs font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                Save
              </button>
            </form>
          )}
          {!rows ? (
            <p className="flex items-center gap-1.5 py-1 text-[11px] text-muted">
              <Loader2 className="h-3 w-3 animate-spin" />
              Loading…
            </p>
          ) : rows.length === 0 ? (
            <p className="py-1 text-[11px] text-muted">Not set yet.</p>
          ) : (
            <ol className="space-y-1 border-l-2 border-card-border pl-2.5">
              {rows.map((r, i) => {
                const moved = i > 0 ? shift(rows[i - 1].readiness_date, r.readiness_date) : null;
                return (
                  <li key={r.id} className="flex flex-wrap items-baseline gap-x-1.5 text-[11px] text-muted-foreground">
                    <span className="font-medium tabular-nums text-foreground">
                      {r.readiness_date ? formatDate(r.readiness_date) : "Cleared"}
                    </span>
                    {moved !== null && moved !== 0 && (
                      <span className={moved > 0 ? "text-danger" : "text-emerald-600"}>{moved > 0 ? `+${moved}` : moved}d</span>
                    )}
                    {r.reason && <span>· {r.reason}</span>}
                    <span className="w-full text-[10px] text-muted">
                      {[r.changed_by_name, formatDate(r.created_at)].filter(Boolean).join(" · ")}
                    </span>
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      )}
    </span>
  );
}
