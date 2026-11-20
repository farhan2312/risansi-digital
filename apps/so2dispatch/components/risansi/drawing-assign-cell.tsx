"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, UserRound } from "lucide-react";
import { assignDrawingAction } from "@/app/risansi/orders/drawing-assign-actions";

function formatDate(value: string | null | undefined): string {
  if (!value) return "";
  const d = new Date(`${value.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "2-digit", timeZone: "UTC" });
}

/**
 * Who in Drawing has the SO. Everyone sees it; Drawing, Central Visibility
 * and Admin pick or change the member.
 */
export function DrawingAssignCell({
  orderId,
  assignee,
  members,
  canEdit,
}: {
  orderId: string;
  assignee?: { id: string; name: string; at: string | null };
  members: { id: string; full_name: string }[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function change(next: string) {
    setSaving(true);
    setError(null);
    const res = await assignDrawingAction(orderId, next || null);
    setSaving(false);
    if (!res.ok) return setError(res.error);
    router.refresh();
  }

  if (!canEdit) {
    return assignee ? (
      <span className="inline-flex flex-col gap-0.5">
        <span className="inline-flex items-center gap-1 text-xs font-semibold text-foreground">
          <UserRound className="h-3.5 w-3.5 text-primary" />
          {assignee.name}
        </span>
        {assignee.at && <span className="text-[11px] text-muted">since {formatDate(assignee.at)}</span>}
      </span>
    ) : (
      <span className="text-xs text-muted">Unassigned</span>
    );
  }

  // A former member still shows as the current pick.
  const options = assignee && !members.some((m) => m.id === assignee.id) ? [...members, { id: assignee.id, full_name: assignee.name }] : members;
  return (
    <span className="inline-flex flex-col gap-0.5">
      <span className="inline-flex items-center gap-1.5">
        <select
          value={assignee?.id ?? ""}
          disabled={saving}
          onChange={(e) => change(e.target.value)}
          aria-label="Assigned to"
          className={`h-8 max-w-[11rem] rounded-lg border border-input-border bg-surface px-2 text-xs focus:border-primary focus:outline-none focus:ring-2 focus:ring-ring/20 ${
            assignee ? "font-semibold text-foreground" : "text-muted"
          }`}
        >
          <option value="">Unassigned</option>
          {options.map((m) => (
            <option key={m.id} value={m.id}>
              {m.full_name}
            </option>
          ))}
        </select>
        {saving && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted" />}
      </span>
      {assignee?.at && <span className="text-[11px] text-muted">since {formatDate(assignee.at)}</span>}
      {error && <span className="max-w-[11rem] text-[11px] text-rose-600">{error}</span>}
    </span>
  );
}
