"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Loader2, X } from "lucide-react";
import { saveAlignmentAction, type Alignment } from "@/app/risansi/orders/assembly-actions";

type Row = Record<string, unknown>;
const str = (v: unknown) => (v == null ? "" : String(v));

const STATUSES = {
  base_plate: ["Manufactured", "Pending"],
  wooden_box: ["In House", "Bought out"],
} as const;

/** One Alignment item on the front: Yes with its status, No, or not set. */
function Value({ yes, status, done }: { yes: string; status: string; done: string }) {
  if (yes === "No") return <span className="text-xs text-muted">No</span>;
  if (yes !== "Yes") return <span className="text-xs text-muted">—</span>;
  return (
    <span className="flex flex-col items-start gap-0.5">
      <span className="text-xs font-semibold text-foreground">Yes</span>
      {status && (
        <span
          className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ${
            status === done ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"
          }`}
        >
          {status}
        </span>
      )}
    </span>
  );
}

/** The Alignment form, for one SO. */
export function AlignmentForm({
  orderId,
  soLabel,
  alignment,
  onClose,
}: {
  orderId: string;
  soLabel: string;
  alignment: unknown;
  onClose: () => void;
}) {
  const router = useRouter();
  const a = (alignment ?? {}) as Row;
  const [v, setV] = useState<Alignment>({
    base_plate: str(a.base_plate),
    base_plate_status: str(a.base_plate_status),
    wooden_box: str(a.wooden_box),
    wooden_box_status: str(a.wooden_box_status),
  });
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
    const res = await saveAlignmentAction(orderId, v);
    setSaving(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    router.refresh();
    onClose();
  }

  const pill = (on: boolean) =>
    `flex-1 rounded-lg border px-3 py-2 text-sm font-semibold transition-colors ${
      on ? "border-primary bg-primary text-primary-foreground" : "border-input-border text-muted hover:bg-background"
    }`;
  const part = (key: "base_plate" | "wooden_box", label: string) => (
    <section className="rounded-xl border border-card-border p-4">
      <p className="mb-2 text-sm font-semibold text-foreground">{label}</p>
      <div className="flex gap-2">
        {(["Yes", "No"] as const).map((o) => (
          <button
            key={o}
            type="button"
            onClick={() => setV((p) => ({ ...p, [key]: o, ...(o === "No" ? { [`${key}_status`]: "" } : {}) }))}
            className={pill(v[key] === o)}
          >
            {o}
          </button>
        ))}
      </div>
      {v[key] === "Yes" && (
        <div className="mt-3">
          <p className="mb-1.5 text-xs font-medium text-muted-foreground">Status</p>
          <div className="flex gap-2">
            {STATUSES[key].map((st) => (
              <button
                key={st}
                type="button"
                onClick={() => setV((p) => ({ ...p, [`${key}_status`]: st }))}
                className={pill(v[`${key}_status` as keyof Alignment] === st)}
              >
                {st}
              </button>
            ))}
          </div>
        </div>
      )}
    </section>
  );

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Alignment"
      className="fixed inset-0 z-50 flex items-end justify-center whitespace-normal bg-black/40 sm:items-center sm:p-6"
      onClick={() => !saving && onClose()}
    >
      <form
        onSubmit={save}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-t-2xl bg-surface p-5 text-left shadow-xl sm:rounded-2xl"
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="font-display text-lg font-semibold text-foreground">Alignment</h2>
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
        <div className="space-y-3">
          {part("base_plate", "Base Plate")}
          {part("wooden_box", "Wooden Box")}
        </div>
        {error && <p className="mt-3 text-sm text-rose-600">{error}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="inline-flex h-10 items-center rounded-lg border border-input-border px-4 text-sm font-medium text-foreground hover:bg-background"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary-hover disabled:opacity-60"
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            Save
          </button>
        </div>
      </form>
    </div>
  );
}

/** One Alignment cell on the front (Base Plate or Wooden Box), opening the form. */
export function AlignmentValue({
  alignment,
  which,
  canEdit,
  onOpen,
}: {
  alignment: unknown;
  which: "base_plate" | "wooden_box";
  canEdit: boolean;
  onOpen: () => void;
}) {
  const a = (alignment ?? {}) as Row;
  return (
    <button
      type="button"
      disabled={!canEdit}
      onClick={onOpen}
      title={canEdit ? "Set the alignment" : undefined}
      className="w-full text-left enabled:hover:opacity-80 disabled:cursor-default"
    >
      <Value yes={str(a[which])} status={str(a[`${which}_status`])} done={which === "base_plate" ? "Manufactured" : "In House"} />
    </button>
  );
}
