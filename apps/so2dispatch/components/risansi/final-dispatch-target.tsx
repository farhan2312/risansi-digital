"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { setFinalDispatchTargetAction } from "@/app/risansi/dispatch-plan/actions";

function formatDate(value: string | null): string {
  if (!value) return "—";
  const d = new Date(`${value}T00:00:00`);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

/**
 * Central Visibility's Final Dispatch Target on the Dispatch Plan: a date it
 * sets on the row (saved as it is picked); everyone else reads it.
 */
export function FinalDispatchTarget({
  orderId,
  value,
  by,
  canEdit,
  late,
}: {
  orderId: string;
  value: string | null;
  by: string | null;
  canEdit: boolean;
  late: boolean;
}) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [v, setV] = useState(value ?? "");
  if (!canEdit) {
    return (
      <span className={late ? "font-medium text-rose-700 dark:text-rose-300" : ""}>
        {formatDate(value)}
        {value && by && <span className="block text-[11px] font-normal text-muted">{by}</span>}
      </span>
    );
  }
  async function save(next: string) {
    if (next === (value ?? "")) return;
    setSaving(true);
    setError(null);
    const res = await setFinalDispatchTargetAction(orderId, next);
    setSaving(false);
    if (!res.ok) setError(res.error);
    else router.refresh();
  }
  return (
    <span className="flex flex-col items-start gap-0.5">
      <span className="inline-flex items-center gap-1.5">
        <input
          type="date"
          value={v}
          disabled={saving}
          // Saved when left (or Enter): typing a year would otherwise save each digit.
          onChange={(e) => setV(e.target.value)}
          // A half-typed date is not a clearing: left as it was.
          onBlur={(e) => !e.currentTarget.validity.badInput && save(v)}
          onKeyDown={(e) => e.key === "Enter" && save(v)}
          aria-label="Final Dispatch Target"
          className={`h-8 rounded-md border bg-surface px-2 text-xs ${late ? "border-rose-300 text-rose-700" : "border-input-border text-foreground"}`}
        />
        {saving && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted" />}
      </span>
      {value && by && <span className="text-[11px] text-muted">{by}</span>}
      {error && <span className="text-[11px] text-rose-600">{error}</span>}
    </span>
  );
}
